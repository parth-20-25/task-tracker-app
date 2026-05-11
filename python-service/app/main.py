from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
import uuid
from io import BytesIO
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, Request
from fastapi.responses import JSONResponse
from openpyxl import load_workbook
from starlette.datastructures import UploadFile as StarletteUploadFile

ALLOWED_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
ALLOWED_EXTENSION = ".xlsx"
ALLOWED_IMAGE_COLUMNS = {6: "image_1_url"}
EXPECTED_UPLOAD_FIELD = "file"
MAX_UPLOAD_BYTES = int(os.getenv("EXTRACTION_MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
SERVICE_TOKEN = (os.getenv("EXTRACTION_SERVICE_TOKEN") or os.getenv("DESIGN_EXTRACTION_SERVICE_TOKEN") or "").strip()
BACKEND_API_URL = (os.getenv("BACKEND_API_URL") or "").strip()
PUBLIC_UPLOAD_BASE_URL = (os.getenv("PUBLIC_UPLOAD_BASE_URL") or "").strip()
DEFAULT_IMAGE_DIR = Path(__file__).resolve().parents[2] / "backend" / "uploads" / "design-excel"
IMAGE_OUTPUT_DIR = Path(os.getenv("EXTRACTED_IMAGE_DIR", str(DEFAULT_IMAGE_DIR))).resolve()

FIXTURE_NUMBER_PATTERN = re.compile(r"^PARC\d{4,}$", re.IGNORECASE)
OP_NUMBER_PATTERN = re.compile(r"^OP[\s._/-]*\d+[A-Z0-9._/-]*$", re.IGNORECASE)
FIXTURE_TYPE_KEYWORDS = (
    "fixture",
    "weld",
    "welding",
    "mig",
    "tig",
    "robotic",
    "robot",
    "assy",
    "assly",
    "jig",
    "gauge",
    "check",
    "checking",
    "inspection",
    "holding",
    "clamping",
    "mounting",
)
HEADER_FIELD_ALIASES = {
    "row_reference": {
        "sno",
        "srno",
        "serialno",
        "serialnumber",
        "rowno",
        "lineno",
        "sequenceno",
        "sequencenumber",
    },
    "fixture_no": {
        "fixtureno",
        "fixtureno.",
        "fixture",
        "fixtureid",
        "fixtureidentifier",
        "fixturenumber",
        "fixturecode",
    },
    "op_no": {
        "opno",
        "opnumber",
        "operationno",
        "operationnumber",
        "operation",
        "op",
    },
    "part_name": {
        "partname",
        "partdescription",
        "componentname",
        "componentdescription",
        "particular",
        "itemdescription",
        "description",
    },
    "fixture_type": {
        "fixturetype",
        "typeoffixture",
        "fixturedescription",
        "type",
        "fixturecategory",
        "category",
    },
    "qty": {"qty", "quantity", "nos", "noofqty"},
}

logger = logging.getLogger("design_extraction")
if not logger.handlers:
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "DEBUG").upper(), format="%(asctime)s - %(message)s")

# Performance timing context manager
class Timer:
    def __init__(self, name: str):
        self.name = name
        self.start = None

    def __enter__(self):
        self.start = time.perf_counter()
        return self

    def __exit__(self, *args):
        elapsed = time.perf_counter() - self.start
        log_event("timing", operation=self.name, elapsed_ms=round(elapsed * 1000, 2))

app = FastAPI()


@app.api_route("/", methods=["GET", "HEAD"])
def root() -> dict[str, str]:
    return {"status": "ok"}


@app.api_route("/health", methods=["GET", "HEAD"])
def health() -> dict[str, str]:
    return {"status": "ok"}


def log_event(event: str, **payload: Any) -> None:
    record = {"event": event, **payload}
    logger.info(json.dumps(record, default=str))


def normalize_base_url(value: str) -> str:
    return value.strip().rstrip("/")


def resolve_public_upload_base_url() -> str:
    configured_public_url = normalize_base_url(PUBLIC_UPLOAD_BASE_URL)
    if configured_public_url:
        return configured_public_url

    configured_backend_api_url = normalize_base_url(BACKEND_API_URL)
    if not configured_backend_api_url:
        raise RuntimeError("BACKEND_API_URL or PUBLIC_UPLOAD_BASE_URL must be configured.")

    backend_origin = configured_backend_api_url[:-4] if configured_backend_api_url.endswith("/api") else configured_backend_api_url
    return f"{backend_origin}/uploads/design-excel"


def get_database_connection():
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        return None

    import psycopg2

    return psycopg2.connect(database_url, sslmode="require")


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def normalize_wbs_header_text(value: Any) -> str:
    """
    Normalize WBS header text for robust matching.
    Handles variations like:
    - WBS - PARC2600M001-Fuel Tank weld Line
    - WBS- PARC2600M001 Fuel Tank weld Line
    - WBS - PARC2600M001_Fuel Tank weld Line
    - WBS_PARC2600M001 - Fuel Tank weld Line
    - WBS -PARC2600M001- Fuel Tank weld Line
    - WBS - PARC2600M001-Fuel Tank weld Line_Belrise Industries Limited
    """
    if value is None:
        return ""

    text = str(value).strip()

    # Step 1: Collapse multiple spaces to single space
    text = re.sub(r"\s+", " ", text)

    # Step 2: Normalize WBS prefix variations
    # Match: WBS, WBS-, WBS_, WBS -, WBS- , WBS_ , etc.
    wbs_pattern = re.compile(r"^WBS\s*[-_]?\s*", re.IGNORECASE)
    text = wbs_pattern.sub("WBS-", text)

    # Step 3: Normalize separators between project code and project name
    # Look for pattern like: WBS-PARC2600M001 followed by various separators
    # Normalize to: WBS-PARC2600M001-ProjectName_CompanyName

    # Step 4: Collapse multiple dashes/underscores/mixed separators
    # Replace patterns like "-_", "_-", "--", "__" with single "-"
    text = re.sub(r"[-_]{2,}", "-", text)

    # Step 5: Normalize spaces around dashes in the project name portion
    # Pattern: "word - word" or "word- word" or "word -word" → "word-word"
    # But preserve the separator between project code and project name
    parts = text.split("-", 2)  # Split into max 3 parts: WBS, PARC..., rest
    if len(parts) >= 3:
        # parts[0] = WBS, parts[1] = PARC..., parts[2] = rest
        project_code = parts[1].strip()
        remainder = parts[2].strip()

        # Normalize spaces within the remainder
        remainder = re.sub(r"\s*-\s*", "-", remainder)
        remainder = re.sub(r"\s*_\s*", "_", remainder)
        remainder = re.sub(r"\s+", " ", remainder)

        text = f"WBS-{project_code}-{remainder}"

    return text


def normalize_header(value: Any) -> str:
    return "".join(ch for ch in normalize_text(value).lower() if ch.isalnum())


def normalize_key(value: Any) -> str:
    return " ".join(normalize_text(value).lower().split())


def normalize_fixture_number(value: Any) -> str:
    return normalize_text(value).upper().replace(" ", "")


def build_error(message: str, excel_row: int | None = None, raw_data: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "excel_row": excel_row,
        "error_message": message,
        "raw_data": raw_data or {},
    }


def build_error_response(status_code: int, message: str, errors: list[dict[str, Any]] | None = None) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "message": message,
            "errors": errors or [],
        },
    )


def parse_wbs_header(raw_header: str) -> dict[str, str]:
    """
    Parse WBS header with flexible separator support.
    Handles formats like:
    - WBS-PARC2600M001-Fuel Tank weld Line_Belrise Industries Limited
    - WBS-PARC2600M001-Fuel Tank weld Line-Belrise Industries Limited
    - WBS-PARC2600M001 Fuel Tank weld Line (space separator)
    - WBS-PARC2600M001-Fuel-Tank-weld-Line_Belrise-Industries-Limited
    """
    # First normalize spacing in the raw header
    header = re.sub(r"\s+", " ", str(raw_header).strip())

    if not header.upper().startswith("WBS"):
        raise ValueError("Invalid header format: missing 'WBS' prefix.")

    # Extract project code using regex - look for PARC followed by 4+ digits
    # The code can be followed by space, dash, underscore, or end of string
    wbs_code_match = re.search(r"WBS\s*[-_]?\s*(PARC\d{4,}[A-Z0-9]*)(?:\s|[-_]|$)", header, re.IGNORECASE)
    if not wbs_code_match:
        raise ValueError("Invalid header format: could not extract project code.")

    project_code = wbs_code_match.group(1).upper()

    # Get everything after the project code
    code_end_pos = wbs_code_match.end(1)
    remainder = header[code_end_pos:].strip()

    # Remove leading separator from remainder
    remainder = re.sub(r"^[-_\s]+", "", remainder)

    # Find the separator between project name and company name
    # Priority: underscore is strongest separator, then check for space+Capital pattern
    # that suggests a company name (e.g., "Line Belrise Industries")
    project_name = ""
    company_name = ""

    # 1. Look for underscore separator (strongest indicator of company name)
    # Use FIRST underscore to split (not last), so "CLIENT_ONE" stays together as company
    if "_" in remainder:
        underscore_pos = remainder.find("_")
        project_name = remainder[:underscore_pos].strip("-_")
        company_name = remainder[underscore_pos + 1:].strip("-_")
    else:
        # 2. No underscore - check for company name pattern:
        # Space followed by capital letter that looks like a company name
        # (2+ capitalized words at the end, e.g., "Belrise Industries Limited")
        # We need at least 2 words that look like proper nouns (Capitalized)
        company_match = re.search(r"\s+([A-Z][a-zA-Z]+\s+(?:[A-Z][a-zA-Z]+\s*)+)\s*$", remainder)
        if company_match:
            # Check that the potential company name is multi-word (at least 2 capitalized words)
            potential_company = company_match.group(1).strip()
            capitalized_words = re.findall(r"\b[A-Z][a-zA-Z]+\b", potential_company)
            if len(capitalized_words) >= 2:
                company_name = potential_company
                project_name = remainder[:company_match.start()].strip()
            else:
                # Single capitalized word at end - likely part of project name
                project_name = remainder.strip()
                company_name = "Unknown"
        else:
            # 3. No company pattern found - everything is project name
            project_name = remainder.strip()
            company_name = "Unknown"

    # Clean up project name: normalize dashes/underscores to spaces for readability
    project_name = re.sub(r"[-_]+", " ", project_name).strip()

    # Clean up company name: normalize dashes/underscores to spaces
    company_name = re.sub(r"[-_]+", " ", company_name).strip()

    if not project_code:
        raise ValueError("Invalid header format: project code is required.")

    if not project_name:
        project_name = "Unnamed Project"

    if not company_name:
        company_name = "Unknown Company"

    return {
        "project_code": project_code,
        "project_name": project_name,
        "company_name": company_name,
    }


def find_metadata_row(worksheet) -> tuple[int, str]:
    """
    Find the WBS metadata row using robust pattern matching.
    Supports flexible formatting: WBS -, WBS-, WBS_, with various spacing.
    """
    # WBS pattern: PARC followed by 4+ digits and optional M + digits
    wbs_code_pattern = re.compile(r"PARC\d{4,}[A-Z0-9]*", re.IGNORECASE)

    for row_index, row_values in enumerate(worksheet.iter_rows(min_row=1, max_row=50, values_only=True), start=1):
        for cell_value in row_values:
            if cell_value is None:
                continue

            # Normalize the cell text for flexible matching
            normalized = normalize_wbs_header_text(cell_value)

            # Check if normalized text starts with WBS- and contains a PARC code
            if normalized.startswith("WBS-") and wbs_code_pattern.search(normalized):
                return row_index, normalized

            # Fallback: Check raw text for WBS-like patterns
            raw_text = normalize_text(cell_value).upper()
            if raw_text.startswith(("WBS", "WBS-", "WBS_", "WBS ")) and wbs_code_pattern.search(raw_text):
                # Normalize and return
                return row_index, normalize_wbs_header_text(cell_value)

    raise ValueError("Could not find the WBS metadata row in the workbook.")


def find_workbook_metadata(workbook) -> tuple[str, int, str]:
    for worksheet in workbook.worksheets:
        try:
            metadata_row, metadata_value = find_metadata_row(worksheet)
            return worksheet.title, metadata_row, metadata_value
        except ValueError:
            continue

    raise ValueError("Could not find the WBS metadata row in the workbook.")


def build_public_image_url(file_name: str) -> str:
    return f"{resolve_public_upload_base_url()}/{file_name}"


def save_image_bytes(image_bytes: bytes, excel_row: int, slot_name: str, extension: str) -> str:
    IMAGE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    file_name = f"{excel_row}-{slot_name}-{uuid.uuid4().hex}.{extension}"
    output_path = IMAGE_OUTPUT_DIR / file_name
    output_path.write_bytes(image_bytes)
    return build_public_image_url(file_name)


def extract_anchored_images(worksheet) -> tuple[dict[int, dict[str, str]], list[dict[str, Any]]]:
    images_by_row: dict[int, dict[str, str]] = {}
    errors: list[dict[str, Any]] = []

    # DEBUG: Log worksheet image detection details
    log_event("image_extraction_start", sheet_title=worksheet.title)

    # Check all possible image locations in openpyxl 3.1.5
    direct_images = getattr(worksheet, "_images", [])
    drawings = getattr(worksheet, "_drawing", None)

    # Log worksheet attributes for debugging
    ws_attrs = [attr for attr in dir(worksheet) if not attr.startswith('__') and 'image' in attr.lower() or 'drawing' in attr.lower() or attr in ['_images', '_charts', '_rels']]
    log_event("worksheet_attributes",
              sheet_title=worksheet.title,
              relevant_attrs=ws_attrs[:10])

    log_event("image_detection_debug",
              sheet_title=worksheet.title,
              direct_images_count=len(direct_images),
              has_drawing=drawings is not None,
              drawing_type=type(drawings).__name__ if drawings else None)

    # DEBUG: Inspect drawing structure if present
    if drawings:
        drawing_attrs = [attr for attr in dir(drawings) if not attr.startswith('__')]
        log_event("drawing_attributes", attributes=drawing_attrs[:15])
        drawing_images = getattr(drawings, "_images", [])
        drawing_charts = getattr(drawings, "_charts", [])
        log_event("drawing_structure_debug",
                  drawing_images_count=len(drawing_images),
                  drawing_charts_count=len(drawing_charts))

    # Try multiple sources for images
    all_images = []

    # Source 1: Direct _images attribute (primary source in openpyxl 3.1.5)
    if direct_images:
        all_images.extend(direct_images)
        log_event("image_source_direct", count=len(direct_images))
        # Log first image details for debugging
        if direct_images:
            first_img = direct_images[0]
            log_event("first_image_debug",
                      image_type=type(first_img).__name__,
                      has_anchor=hasattr(first_img, "anchor"),
                      anchor_type=type(getattr(first_img, "anchor", None)).__name__)

    # Source 2: Drawing _images attribute (fallback)
    if drawings and hasattr(drawings, "_images"):
        drawing_img_list = drawings._images
        if drawing_img_list:
            all_images.extend(drawing_img_list)
            log_event("image_source_drawing", count=len(drawing_img_list))

    log_event("image_total_found", total_images=len(all_images))

    for idx, image in enumerate(all_images):
        anchor = getattr(image, "anchor", None)

        # Handle different anchor types
        anchor_from = None
        anchor_type = type(anchor).__name__ if anchor else None

        if anchor is None:
            log_event("image_no_anchor", image_index=idx, image_type=type(image).__name__)
            errors.append(build_error("Found an image without an anchor.", excel_row=None))
            continue

        # Get _from attribute from anchor
        anchor_from = getattr(anchor, "_from", None)

        # Handle different anchor structures
        if anchor_from is None:
            # Try direct row/col on anchor (for some Excel versions)
            if hasattr(anchor, "row") and hasattr(anchor, "col"):
                anchor_from = anchor
            else:
                log_event("image_anchor_missing",
                          image_index=idx,
                          image_type=type(image).__name__,
                          anchor_type=anchor_type,
                          anchor_attrs=[a for a in dir(anchor) if not a.startswith('_')][:10])
                errors.append(build_error(
                    f"Found an image without a readable anchor position. Anchor type: {anchor_type}",
                    excel_row=None
                ))
                continue

        # Extract row and column from anchor
        try:
            # Handle both AnchorMarker objects and direct row/col attributes
            if hasattr(anchor_from, "row") and hasattr(anchor_from, "col"):
                row_val = anchor_from.row
                col_val = anchor_from.col
            else:
                row_val = getattr(anchor_from, "row", 0)
                col_val = getattr(anchor_from, "col", 0)

            excel_row = int(row_val) + 1  # Convert 0-indexed to 1-indexed
            excel_column = int(col_val) + 1  # Convert 0-indexed to 1-indexed
        except (ValueError, TypeError, AttributeError) as e:
            log_event("image_anchor_parse_error",
                      image_index=idx,
                      error=str(e),
                      anchor_attrs=dir(anchor_from))
            errors.append(build_error(
                f"Could not parse image anchor position: {e}",
                excel_row=None
            ))
            continue

        log_event("image_anchor_debug",
                  image_index=idx,
                  anchor_type=anchor_type,
                  anchor_row=row_val,
                  anchor_col=col_val,
                  excel_row=excel_row,
                  excel_column=excel_column)

        if excel_column not in ALLOWED_IMAGE_COLUMNS:
            log_event("image_column_rejected",
                      excel_row=excel_row,
                      excel_column=excel_column,
                      allowed_columns=list(ALLOWED_IMAGE_COLUMNS.keys()))
            # Only log as error if NOT column I (9) which is header image
            if excel_column != 9:
                errors.append(
                    build_error(
                        "Image must be anchored in column F only.",
                        excel_row=excel_row,
                        raw_data={"column": excel_column},
                    )
                )
            continue

        slot_name = ALLOWED_IMAGE_COLUMNS[excel_column]
        row_images = images_by_row.setdefault(excel_row, {})

        if slot_name in row_images:
            errors.append(
                build_error(
                    "Multiple images were found in the same mapped column for one row.",
                    excel_row=excel_row,
                    raw_data={"column": excel_column},
                )
            )
            continue

        image_format = normalize_text(getattr(image, "format", "")) or "png"
        log_event("image_processing",
                  excel_row=excel_row,
                  slot_name=slot_name,
                  format=image_format,
                  has_data_method=hasattr(image, "_data"))
        try:
            image_bytes = image._data()
            saved_url = save_image_bytes(image_bytes, excel_row, slot_name, image_format.lower())
            row_images[slot_name] = saved_url
            log_event("image_saved_success",
                      excel_row=excel_row,
                      slot_name=slot_name,
                      url=saved_url[:50] if saved_url else None)
        except Exception as exc:
            errors.append(
                build_error(
                    "Failed to save an extracted image.",
                    excel_row=excel_row,
                    raw_data={"details": str(exc)},
                )
            )

    log_event("image_extraction_complete",
              sheet_title=worksheet.title,
              images_mapped=len(images_by_row),
              errors_count=len(errors))
    return images_by_row, errors


def open_excel_workbook(file_bytes: bytes, *, read_only: bool) -> Any:
    return load_workbook(
        filename=BytesIO(file_bytes),
        data_only=True,
        keep_links=False,
        read_only=read_only,
    )


def extract_images_from_workbook(file_bytes: bytes) -> tuple[dict[int, dict[str, str]], list[dict[str, Any]]]:
    workbook = open_excel_workbook(file_bytes, read_only=False)
    try:
        worksheet = workbook.active
        return extract_anchored_images(worksheet)
    finally:
        workbook.close()


def tokenize_header(value: Any) -> set[str]:
    text = normalize_text(value).lower().replace("_", " ")
    return {token for token in re.split(r"[^a-z0-9]+", text) if token}


def match_header_field(cell_text: str) -> str | None:
    normalized = normalize_header(cell_text)
    tokens = tokenize_header(cell_text)

    for field_name, aliases in HEADER_FIELD_ALIASES.items():
        if normalized in aliases:
            return field_name

    if {"s", "no"} <= tokens or {"sr", "no"} <= tokens:
        return "row_reference"

    if {"serial", "no"} <= tokens or {"serial", "number"} <= tokens:
        return "row_reference"

    if {"row", "no"} <= tokens or {"line", "no"} <= tokens:
        return "row_reference"

    if {"fixture", "no"} <= tokens or {"fixture", "number"} <= tokens:
        return "fixture_no"

    if "fixture" in tokens and "type" in tokens:
        return "fixture_type"

    if ("op" in tokens and ("no" in tokens or "number" in tokens)) or ({"operation", "no"} <= tokens):
        return "op_no"

    if "qty" in tokens or "quantity" in tokens:
        return "qty"

    if "part" in tokens and ("name" in tokens or "description" in tokens):
        return "part_name"

    if "component" in tokens and ("name" in tokens or "description" in tokens):
        return "part_name"

    if {"item", "description"} <= tokens:
        return "part_name"

    return None


def detect_header_hints(worksheet, metadata_row: int) -> dict[str, int]:
    with Timer("detect_header_hints_internal"):
        best_match_count = 0
        best_mapping: dict[str, int] = {}

        start_row = max(1, metadata_row + 1)
        end_row = min(max(start_row + 30, 30), worksheet.max_row)

        # Pre-compile the header detection to avoid repeated function calls
        for row_values in worksheet.iter_rows(min_row=start_row, max_row=end_row, values_only=True):
            current_mapping: dict[str, int] = {}
            for column_index, cell_value in enumerate(row_values, start=1):
                field_name = match_header_field(normalize_text(cell_value))
                if field_name and field_name not in current_mapping:
                    current_mapping[field_name] = column_index

            match_count = len(current_mapping)
            has_primary_identity = "fixture_no" in current_mapping or ("part_name" in current_mapping and "qty" in current_mapping)

            if has_primary_identity and match_count > best_match_count:
                best_match_count = len(current_mapping)
                best_mapping = current_mapping

        result = best_mapping if best_match_count >= 3 else {}
        log_event("header_hints_detected", hints_found=len(result), match_count=best_match_count)
        return result


def build_semantic_cells(row_values: tuple[Any, ...]) -> list[dict[str, Any]]:
    cells: list[dict[str, Any]] = []

    for column_index, cell_value in enumerate(row_values, start=1):
        text = normalize_text(cell_value)
        if not text:
            continue

        cells.append(
            {
                "column": column_index,
                "text": text,
                "normalized": normalize_key(text),
                "header_key": normalize_header(text),
            }
        )

    return cells


def build_row_snapshot(cells: list[dict[str, Any]], row_images: dict[str, str]) -> dict[str, Any]:
    return {
        "cells": [{"column": cell["column"], "value": cell["text"]} for cell in cells],
        "images_present": sorted(row_images.keys()),
    }


def is_separator_row(cells: list[dict[str, Any]]) -> bool:
    if not cells:
        return False
    return all(not any(ch.isalnum() for ch in cell["text"]) for cell in cells)


def is_header_row(cells: list[dict[str, Any]]) -> bool:
    matched_fields = {match_header_field(cell["text"]) for cell in cells}
    matched_fields.discard(None)
    return len(matched_fields) >= 3


def looks_like_op_number(value: str) -> bool:
    if not value:
        return False
    return bool(OP_NUMBER_PATTERN.match(value.strip()))


def parse_op_value(value: Any) -> str | None:
    text = normalize_text(value)
    if not text:
        return None

    if looks_like_op_number(text):
        normalized = re.sub(r"[\s._/-]+", " ", text).strip()
        normalized = re.sub(r"^OP\b", "OP", normalized, flags=re.IGNORECASE)
        normalized = re.sub(r"^OP\s*", "OP ", normalized, flags=re.IGNORECASE)
        return normalized.upper()

    if re.fullmatch(r"\d+(?:\.0+)?", text):
        numeric_text = text.split(".", 1)[0]
        return f"OP {numeric_text}"

    return None


def looks_like_fixture_number(value: str) -> bool:
    candidate = normalize_fixture_number(value)
    if not candidate:
        return False
    if looks_like_op_number(candidate):
        return False
    if "SCOPE" in candidate:
        return False
    if candidate.startswith("WBS-"):
        return False
    return bool(FIXTURE_NUMBER_PATTERN.match(candidate))


def parse_qty_value(value: Any) -> int | None:
    text = normalize_text(value)
    if not text:
        return None
    if re.fullmatch(r"\d+", text):
        qty = int(text)
        return qty if qty > 0 else None
    if re.fullmatch(r"\d+(?:\.0+)?", text):
        qty = int(float(text))
        return qty if qty > 0 else None
    return None


def looks_like_fixture_type(value: str) -> bool:
    normalized = normalize_key(value)
    if not normalized:
        return False
    return any(keyword in normalized for keyword in FIXTURE_TYPE_KEYWORDS)



def choose_hint_text(cell_map: dict[int, str], column_index: int | None, validator=None) -> str:
    if not column_index:
        return ""
    text = cell_map.get(column_index, "")
    if not text:
        return ""
    if validator and not validator(text):
        return ""
    return text


def is_valid_field_value(field_name: str, value: str) -> bool:
    if not value:
        return False
    if field_name == "row_reference":
        return True
    if field_name == "fixture_no":
        return looks_like_fixture_number(value)
    if field_name == "op_no":
        return parse_op_value(value) is not None
    if field_name == "qty":
        return parse_qty_value(value) is not None
    if field_name == "fixture_type":
        return looks_like_fixture_type(value)
    if field_name == "part_name":
        return True
    return False


def should_carry_field_value(field_name: str) -> bool:
    return field_name in {"fixture_no", "fixture_type", "qty"}


def normalize_business_row_reference(value: Any) -> str | None:
    text = normalize_text(value)
    if not text:
        return None
    return text


def looks_like_business_row_reference(value: Any) -> bool:
    text = normalize_text(value)
    if not text:
        return False

    if looks_like_fixture_number(text) or looks_like_op_number(text):
        return False

    return bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]*", text))


def choose_single_candidate(candidates: list[dict[str, Any]], field_label: str, row_index: int, snapshot: dict[str, Any]):
    if len(candidates) == 1:
        return candidates[0], None
    if not candidates:
        return None, build_error(
            f"Could not confidently extract required field: {field_label}.",
            excel_row=row_index,
            raw_data={**snapshot, "candidate_field": field_label},
        )
    return None, build_error(
        f"Multiple possible values found for {field_label}; row rejected to avoid guessing.",
        excel_row=row_index,
        raw_data={
            **snapshot,
            "candidate_field": field_label,
            "candidate_values": [{"column": cell["column"], "value": cell["text"]} for cell in candidates],
        },
    )


def parse_fixture_candidate(
    row_index: int,
    cells: list[dict[str, Any]],
    header_hints: dict[str, int],
    row_images: dict[str, str],
    *,
    sheet_name: str,
    inherited_hints: dict[str, str] | None = None,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    inherited_hints = inherited_hints or {}
    snapshot = build_row_snapshot(cells, row_images)
    snapshot["sheet_name"] = sheet_name
    if inherited_hints:
        snapshot["inherited_hints"] = inherited_hints
    cell_map = {cell["column"]: cell["text"] for cell in cells}
    cells_by_column = {cell["column"]: cell for cell in cells}
    used_columns: set[int] = set()
    parsed = {
        "fixture_no": "",
        "op_no": "",
        "part_name": "",
        "fixture_type": "",
        "qty": "",
    }

    fixture_candidates = [cell for cell in cells if looks_like_fixture_number(cell["text"])]
    if not fixture_candidates:
        if row_images:
            return None, build_error(
                "Row contains mapped images but no valid fixture number pattern.",
                excel_row=row_index,
                raw_data=snapshot,
            )
        return None, None

    fixture_cell, fixture_error = choose_single_candidate(fixture_candidates, "FIXTURE NO", row_index, snapshot)
    if fixture_error:
        return None, fixture_error

    parsed["fixture_no"] = normalize_fixture_number(fixture_cell["text"])
    used_columns.add(fixture_cell["column"])

    hint_row_reference_column = header_hints.get("row_reference")
    business_row_reference = normalize_business_row_reference(
        choose_hint_text(cell_map, hint_row_reference_column)
    )
    if business_row_reference and hint_row_reference_column:
        used_columns.add(hint_row_reference_column)
    else:
        row_reference_candidates = [
            cell
            for cell in cells
            if cell["column"] not in used_columns
            and cell["column"] < fixture_cell["column"]
            and looks_like_business_row_reference(cell["text"])
        ]
        if len(row_reference_candidates) == 1:
            business_row_reference = normalize_business_row_reference(row_reference_candidates[0]["text"])
            used_columns.add(row_reference_candidates[0]["column"])

    hint_op_no = choose_hint_text(cell_map, header_hints.get("op_no"), lambda value: parse_op_value(value) is not None)
    if hint_op_no:
        parsed["op_no"] = parse_op_value(hint_op_no) or normalize_text(hint_op_no)
        if "op_no" in header_hints:
            used_columns.add(header_hints["op_no"])
    else:
        op_candidates = [cell for cell in cells if cell["column"] not in used_columns and looks_like_op_number(cell["text"])]
        if op_candidates:
            op_cell, op_error = choose_single_candidate(op_candidates, "OP.NO", row_index, snapshot)
            if op_error:
                return None, op_error
            parsed["op_no"] = parse_op_value(op_cell["text"]) or normalize_text(op_cell["text"])
            used_columns.add(op_cell["column"])
        elif inherited_hints.get("op_no"):
            parsed["op_no"] = parse_op_value(inherited_hints["op_no"]) or normalize_text(inherited_hints["op_no"])

    hint_qty_column = header_hints.get("qty")
    hint_qty_value = parse_qty_value(choose_hint_text(cell_map, hint_qty_column))
    if hint_qty_value is not None:
        parsed["qty"] = str(hint_qty_value)
        if hint_qty_column:
            used_columns.add(hint_qty_column)
    else:
        qty_candidates = [cell for cell in cells if cell["column"] not in used_columns and parse_qty_value(cell["text"]) is not None]
        if qty_candidates:
            qty_cell, qty_error = choose_single_candidate(qty_candidates, "QTY", row_index, snapshot)
            if qty_error:
                return None, qty_error
            parsed["qty"] = str(parse_qty_value(qty_cell["text"]))
            used_columns.add(qty_cell["column"])
        elif inherited_hints.get("qty"):
            inherited_qty = parse_qty_value(inherited_hints.get("qty"))
            if inherited_qty is not None:
                parsed["qty"] = str(inherited_qty)


    hint_fixture_type_column = header_hints.get("fixture_type")
    hint_fixture_type = choose_hint_text(cell_map, hint_fixture_type_column)
    if hint_fixture_type:
        parsed["fixture_type"] = hint_fixture_type
        if hint_fixture_type_column:
            used_columns.add(hint_fixture_type_column)
    else:
        fixture_type_candidates = [
            cell for cell in cells if cell["column"] not in used_columns and looks_like_fixture_type(cell["text"])
        ]
        fixture_type_cell, fixture_type_error = choose_single_candidate(
            fixture_type_candidates,
            "Fixture Type",
            row_index,
            snapshot,
        )
        if fixture_type_error:
            return None, fixture_type_error
        if fixture_type_cell:
            parsed["fixture_type"] = fixture_type_cell["text"]
            used_columns.add(fixture_type_cell["column"])
        elif inherited_hints.get("fixture_type"):
            parsed["fixture_type"] = inherited_hints["fixture_type"]

    hint_part_name_column = header_hints.get("part_name")
    hint_part_name = choose_hint_text(cell_map, hint_part_name_column)
    if hint_part_name:
        parsed["part_name"] = hint_part_name
        if hint_part_name_column:
            used_columns.add(hint_part_name_column)
    else:
        part_name_candidates = []
        for cell in cells:
            if cell["column"] in used_columns:
                continue
            if match_header_field(cell["text"]):
                continue
            if looks_like_fixture_type(cell["text"]):
                continue
            if looks_like_op_number(cell["text"]):
                continue
            if looks_like_fixture_number(cell["text"]):
                continue
            if parse_qty_value(cell["text"]) is not None:
                continue
            part_name_candidates.append(cell)

        part_name_cell = None
        if len(part_name_candidates) > 1:
            return None, build_error(
                "Multiple possible values found for Part Name; row rejected to avoid guessing.",
                excel_row=row_index,
                raw_data={
                    **snapshot,
                    "candidate_field": "Part Name",
                    "candidate_values": [{"column": cell["column"], "value": cell["text"]} for cell in part_name_candidates],
                },
            )
        if len(part_name_candidates) == 1:
            part_name_cell = part_name_candidates[0]

        if part_name_cell:
            parsed["part_name"] = part_name_cell["text"]
            used_columns.add(part_name_cell["column"])
        else:
            merged_part_name_source = choose_hint_text(cell_map, header_hints.get("op_no"))
            if (
                merged_part_name_source
                and not parse_op_value(merged_part_name_source)
                and not looks_like_fixture_number(merged_part_name_source)
                and parse_qty_value(merged_part_name_source) is None
            ):
                parsed["part_name"] = merged_part_name_source
        if not parsed["part_name"] and inherited_hints.get("part_name"):
            parsed["part_name"] = inherited_hints["part_name"]

    missing_fields = [
        label
        for field_name, label in (
            ("fixture_no", "FIXTURE NO"),
            ("part_name", "Part Name"),
            ("fixture_type", "Fixture Type"),
            ("qty", "QTY"),
        )
        if not parsed[field_name]
    ]

    if missing_fields:
        return None, build_error(
            f"Could not confidently extract required fields: {', '.join(missing_fields)}.",
            excel_row=row_index,
            raw_data={**snapshot, "parsed": parsed},
        )

    row_reference = business_row_reference or str(row_index)
    row_reference_source = "business_serial" if business_row_reference else "excel_row"
    row_number = int(business_row_reference) if business_row_reference and re.fullmatch(r"\d+", business_row_reference) else row_index

    return (
        {
            "excel_row": row_index,
            "row_number": row_number,
            "row_reference": row_reference,
            "row_reference_source": row_reference_source,
            "business_row_reference": business_row_reference,
            "fixture_no": parsed["fixture_no"],
            "op_no": parsed["op_no"],
            "part_name": parsed["part_name"],
            "fixture_type": parsed["fixture_type"],
            "qty": parsed["qty"],
            "remark": None,
            "image_1_url": row_images.get("image_1_url"),
            "image_2_url": None,
            "parser_confidence": "HIGH",
            "raw_data": {
                **snapshot,
                "excel_row": row_index,
                "row_reference": row_reference,
                "row_reference_source": row_reference_source,
                "business_row_reference": business_row_reference,
                "normalized_fields": {
                    "fixture_no": parsed["fixture_no"] or None,
                    "op_no": parsed["op_no"] or None,
                    "part_name": parsed["part_name"] or None,
                    "fixture_type": parsed["fixture_type"] or None,
                    "qty": parsed["qty"] or None,
                    "remark": None,
                    "image_1_url": row_images.get("image_1_url"),
                    "image_2_url": None,
                },
            },
        },
        None,
    )


def build_vertical_merge_lookup(worksheet) -> dict[tuple[int, int], Any]:
    lookup: dict[tuple[int, int], Any] = {}

    for merged_range in getattr(worksheet.merged_cells, "ranges", []):
        if merged_range.min_col != merged_range.max_col:
            continue

        master_value = worksheet.cell(merged_range.min_row, merged_range.min_col).value
        for row_index in range(merged_range.min_row, merged_range.max_row + 1):
            lookup[(row_index, merged_range.min_col)] = master_value

    return lookup


def get_effective_row_values_fast(worksheet, row_index: int, max_column: int, vertical_merge_lookup: dict[tuple[int, int], Any]) -> tuple[Any, ...]:
    """Optimized row value extraction using iter_rows for better performance."""
    # Use iter_rows with values_only for much faster bulk cell access
    row_values = next(worksheet.iter_rows(min_row=row_index, max_row=row_index, max_col=max_column, values_only=True), ())

    # Apply merge lookup only for cells that are empty
    if vertical_merge_lookup:
        values: list[Any] = []
        for col_idx, cell_value in enumerate(row_values, start=1):
            if cell_value in (None, ""):
                cell_value = vertical_merge_lookup.get((row_index, col_idx), cell_value)
            values.append(cell_value)
        # Pad with None if row is shorter than max_column
        while len(values) < max_column:
            values.append(vertical_merge_lookup.get((row_index, len(values) + 1), None))
        return tuple(values)

    # Pad with None if row is shorter than max_column (no merge lookup needed)
    values = list(row_values)
    while len(values) < max_column:
        values.append(None)
    return tuple(values)


def build_rows(
    worksheet,
    metadata_row: int,
    header_hints: dict[str, int],
    images_by_row: dict[int, dict[str, str]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    rows: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []

    with Timer("build_vertical_merge_lookup"):
        vertical_merge_lookup = build_vertical_merge_lookup(worksheet)

    carry_hints: dict[str, str] = {}
    start_row = max(1, metadata_row + 1)
    max_row = worksheet.max_row
    max_column = worksheet.max_column

    log_event("build_rows_start", start_row=start_row, max_row=max_row, max_column=max_column)

    # Use iter_rows for efficient iteration
    row_count = 0
    with Timer("iterate_rows"):
        for row_index, row_values in enumerate(
            worksheet.iter_rows(min_row=start_row, max_row=max_row, max_col=max_column, values_only=True),
            start=start_row
        ):
            row_count += 1
            row_images = images_by_row.get(row_index, {})

            # Apply merge lookup for empty cells (only if we have merged cells)
            if vertical_merge_lookup:
                effective_values: list[Any] = []
                for col_idx, cell_value in enumerate(row_values, start=1):
                    if cell_value in (None, ""):
                        cell_value = vertical_merge_lookup.get((row_index, col_idx), cell_value)
                    effective_values.append(cell_value)
                # Pad with None and apply merge lookup
                for col_idx in range(len(row_values) + 1, max_column + 1):
                    effective_values.append(vertical_merge_lookup.get((row_index, col_idx), None))
                row_values = tuple(effective_values)

            cells = build_semantic_cells(row_values)

            if not cells and not row_images:
                continue

            if is_separator_row(cells):
                continue

            if any(cell["text"].startswith("WBS-") for cell in cells):
                continue

            if is_header_row(cells):
                continue

            row_has_structured_content = bool(cells or row_images)
            inherited_hints: dict[str, str] = {}
            for field_name, column_index in header_hints.items():
                if not column_index:
                    continue

                raw_value = normalize_text(row_values[column_index - 1]) if column_index - 1 < len(row_values) else ""
                if raw_value and is_valid_field_value(field_name, raw_value):
                    carry_hints[field_name] = raw_value
                    continue

                if row_has_structured_content and field_name in carry_hints and should_carry_field_value(field_name):
                    inherited_hints[field_name] = carry_hints[field_name]

            parsed_row, error = parse_fixture_candidate(
                row_index,
                cells,
                header_hints,
                row_images,
                sheet_name=worksheet.title,
                inherited_hints=inherited_hints,
            )

            if error:
                errors.append(error)
                continue

            if parsed_row:
                for field_name in ("fixture_no", "op_no", "part_name", "fixture_type", "qty"):
                    if parsed_row.get(field_name):
                        carry_hints[field_name] = str(parsed_row[field_name])
                rows.append(parsed_row)
                continue

            if row_images:
                errors.append(
                    build_error(
                        "Row contains mapped images but no valid fixture data.",
                        excel_row=row_index,
                        raw_data=build_row_snapshot(cells, row_images),
                    )
                )

    log_event("build_rows_complete", rows_processed=row_count, rows_accepted=len(rows), errors_count=len(errors))
    return rows, errors


def _process_workbook(file_bytes: bytes) -> dict[str, Any]:
    with Timer("workbook_load"):
        workbook = open_excel_workbook(file_bytes, read_only=False)
    try:
        log_event("process_workbook_start", file_size_bytes=len(file_bytes))
        with Timer("find_metadata"):
            _metadata_sheet_name, _metadata_row, metadata_value = find_workbook_metadata(workbook)
        with Timer("parse_wbs_header"):
            file_info = parse_wbs_header(metadata_value)

        all_rows: list[dict[str, Any]] = []
        all_errors: list[dict[str, Any]] = []

        for worksheet in workbook.worksheets:
            log_event("processing_worksheet", sheet_title=worksheet.title, max_row=worksheet.max_row, max_column=worksheet.max_column)
            try:
                with Timer(f"find_metadata_{worksheet.title}"):
                    metadata_row, _ = find_metadata_row(worksheet)
            except ValueError:
                metadata_row = 0

            with Timer(f"detect_header_hints_{worksheet.title}"):
                header_hints = detect_header_hints(worksheet, metadata_row)
            with Timer(f"extract_images_{worksheet.title}"):
                images_by_row, image_errors = extract_anchored_images(worksheet)
            with Timer(f"build_rows_{worksheet.title}"):
                rows, parsing_errors = build_rows(worksheet, metadata_row, header_hints, images_by_row)

            all_rows.extend(rows)
            all_errors.extend(image_errors)
            all_errors.extend(parsing_errors)
    finally:
        workbook.close()

    with Timer("deduplication"):
        deduped_rows: list[dict[str, Any]] = []
        seen_row_keys: set[tuple[str, int, str]] = set()
        for row in all_rows:
            row_key = (
                row.get("raw_data", {}).get("sheet_name", ""),
                int(row["excel_row"]),
                row["fixture_no"],
            )
            if row_key in seen_row_keys:
                continue
            seen_row_keys.add(row_key)
            deduped_rows.append(row)

    errors = all_errors
    if not deduped_rows and not errors:
        errors.append(build_error("No fixture rows were found in the workbook."))

    for row in deduped_rows:
        log_event(
            "extract_row_accepted",
            excel_row=row["excel_row"],
            fixture_no=row["fixture_no"],
            parser_confidence=row["parser_confidence"],
        )

    for error in errors:
        log_event(
            "extract_row_rejected",
            excel_row=error.get("excel_row"),
            reason=error.get("error_message"),
            raw_data=error.get("raw_data", {}),
        )

    return {
        "file_info": {
            "project_code": file_info["project_code"],
            "project_name": file_info["project_name"],
            "company_name": file_info["company_name"],
        },
        "rows": deduped_rows,
        "errors": errors,
    }


@app.post("/extract")
async def extract_workbook(
    request: Request,
    x_extraction_token: str | None = Header(default=None),
):
    content_type = normalize_text(request.headers.get("content-type"))

    if not SERVICE_TOKEN:
        log_event("extract_request_rejected", reason="service_not_configured", content_type=content_type)
        return build_error_response(500, "Service is not configured", [build_error("EXTRACTION_SERVICE_TOKEN is required.")])

    form = await request.form()
    form_keys = list(form.keys())
    upload_fields = []
    for field_name, value in form.multi_items():
        if isinstance(value, StarletteUploadFile):
            upload_fields.append(
                {
                    "field_name": field_name,
                    "filename": normalize_text(value.filename),
                    "content_type": normalize_text(value.content_type),
                }
            )

    log_event(
        "extract_request_received",
        content_type=content_type,
        form_keys=form_keys,
        upload_fields=upload_fields,
    )

    if x_extraction_token != SERVICE_TOKEN:
        log_event("extract_request_rejected", reason="invalid_token", content_type=content_type, form_keys=form_keys)
        return build_error_response(401, "Unauthorized", [build_error("Invalid extraction token.")])

    if "multipart/form-data" not in content_type.lower():
        log_event("extract_request_rejected", reason="invalid_content_type", content_type=content_type, form_keys=form_keys)
        return build_error_response(422, "Failed to process file", [build_error("Request must use multipart/form-data.")])

    if EXPECTED_UPLOAD_FIELD not in form:
        log_event(
            "extract_request_rejected",
            reason="missing_expected_upload_field",
            expected_field=EXPECTED_UPLOAD_FIELD,
            form_keys=form_keys,
            upload_fields=upload_fields,
        )
        return build_error_response(
            422,
            "Failed to process file",
            [build_error(f"Expected multipart field '{EXPECTED_UPLOAD_FIELD}' was not provided.")],
        )

    uploaded_file = form.get(EXPECTED_UPLOAD_FIELD)
    if not isinstance(uploaded_file, StarletteUploadFile):
        log_event(
            "extract_request_rejected",
            reason="invalid_upload_field_type",
            expected_field=EXPECTED_UPLOAD_FIELD,
            form_keys=form_keys,
        )
        return build_error_response(
            422,
            "Failed to process file",
            [build_error(f"Multipart field '{EXPECTED_UPLOAD_FIELD}' must contain a file upload.")],
        )

    if len(upload_fields) != 1:
        log_event(
            "extract_request_rejected",
            reason="unexpected_upload_field_count",
            upload_fields=upload_fields,
        )
        return build_error_response(
            422,
            "Failed to process file",
            [build_error("Exactly one uploaded Excel file is required.")],
        )

    if not normalize_text(uploaded_file.filename).lower().endswith(ALLOWED_EXTENSION):
        log_event(
            "extract_request_rejected",
            reason="invalid_extension",
            filename=normalize_text(uploaded_file.filename),
        )
        return build_error_response(400, "Failed to process file", [build_error("Only .xlsx files are allowed.")])

    if normalize_text(uploaded_file.content_type).lower() != ALLOWED_CONTENT_TYPE:
        log_event(
            "extract_request_rejected",
            reason="invalid_mime_type",
            filename=normalize_text(uploaded_file.filename),
            file_content_type=normalize_text(uploaded_file.content_type),
        )
        return build_error_response(400, "Failed to process file", [build_error("Only .xlsx MIME type is allowed.")])

    file_bytes = await uploaded_file.read()
    if not file_bytes:
        log_event("extract_request_rejected", reason="empty_file", filename=normalize_text(uploaded_file.filename))
        return build_error_response(400, "Failed to process file", [build_error("Uploaded file is empty.")])

    if len(file_bytes) > MAX_UPLOAD_BYTES:
        log_event(
            "extract_request_rejected",
            reason="file_too_large",
            filename=normalize_text(uploaded_file.filename),
            size_bytes=len(file_bytes),
        )
        return build_error_response(400, "Failed to process file", [build_error("Excel file exceeds the maximum allowed size.")])

    log_event(
        "extract_processing_started",
        filename=normalize_text(uploaded_file.filename),
        size_bytes=len(file_bytes),
    )

    try:
        with Timer("total_processing"):
            result = await asyncio.to_thread(_process_workbook, file_bytes)
        log_event(
            "extract_processing_completed",
            filename=normalize_text(uploaded_file.filename),
            accepted_rows=len(result["rows"]),
            error_count=len(result["errors"]),
        )
        return result
    except ValueError as exc:
        log_event("extract_processing_failed", filename=normalize_text(uploaded_file.filename), reason=str(exc))
        return build_error_response(422, "Failed to process file", [build_error(str(exc))])
    except Exception as exc:
        log_event("extract_processing_failed", filename=normalize_text(uploaded_file.filename), reason=str(exc))
        return build_error_response(500, "Failed to process file", [build_error(str(exc))])


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
    )
