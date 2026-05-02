from __future__ import annotations

import asyncio
import json
import logging
import os
import re
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
ALLOWED_IMAGE_COLUMNS = {6: "image_1_url", 9: "image_2_url"}
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
    "remark": {"remark", "remarks", "scope", "scoperemarks", "comment", "comments"},
}

logger = logging.getLogger("design_extraction")
if not logger.handlers:
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper(), format="%(message)s")

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
    header = normalize_text(raw_header)
    if not header.startswith("WBS-"):
        raise ValueError("Invalid header format: missing 'WBS-' prefix.")

    without_prefix = header[4:]
    first_dash = without_prefix.find("-")
    if first_dash == -1:
        raise ValueError("Invalid header format: missing '-' after project code.")

    project_code = without_prefix[:first_dash].strip()
    remainder = without_prefix[first_dash + 1 :].strip()
    parts = remainder.split("_")

    if len(parts) < 2:
        raise ValueError("Invalid header format: missing '_' separator for company name.")

    scope_name = parts[0].strip()
    company_name = "_".join(parts[1:]).strip()

    if not project_code or not scope_name or not company_name:
        raise ValueError("Invalid header format: project code, scope name, and company name are required.")

    return {
        "project_code": project_code,
        "scope_name": scope_name,
        "company_name": company_name,
    }


def find_metadata_row(worksheet) -> tuple[int, str]:
    for row_index, row_values in enumerate(worksheet.iter_rows(min_row=1, max_row=25, values_only=True), start=1):
        for cell_value in row_values:
            cell_text = normalize_text(cell_value)
            if cell_text.startswith("WBS-"):
                return row_index, cell_text
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

    for image in getattr(worksheet, "_images", []):
        anchor = getattr(image, "anchor", None)
        anchor_from = getattr(anchor, "_from", None)

        if anchor_from is None:
            errors.append(build_error("Found an image without a readable anchor position."))
            continue

        excel_row = int(anchor_from.row) + 1
        excel_column = int(anchor_from.col) + 1

        if excel_column not in ALLOWED_IMAGE_COLUMNS:
            errors.append(
                build_error(
                    "Image must be anchored in column F or I.",
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
        try:
            image_bytes = image._data()
            row_images[slot_name] = save_image_bytes(image_bytes, excel_row, slot_name, image_format.lower())
        except Exception as exc:
            errors.append(
                build_error(
                    "Failed to save an extracted image.",
                    excel_row=excel_row,
                    raw_data={"details": str(exc)},
                )
            )

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

    if "remark" in tokens or "remarks" in tokens or "comment" in tokens or "comments" in tokens:
        return "remark"

    if "scope" in tokens:
        return "remark"

    return None


def detect_header_hints(worksheet, metadata_row: int) -> dict[str, int]:
    best_match_count = 0
    best_mapping: dict[str, int] = {}

    start_row = max(1, metadata_row + 1)
    end_row = min(max(start_row + 30, 30), worksheet.max_row)

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

    return best_mapping if best_match_count >= 3 else {}


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


def looks_like_scope_text(value: str) -> bool:
    normalized = normalize_key(value)
    return "scope" in normalized or "parc" in normalized or "customer" in normalized


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
    if field_name == "fixture_no":
        return looks_like_fixture_number(value)
    if field_name == "op_no":
        return parse_op_value(value) is not None
    if field_name == "qty":
        return parse_qty_value(value) is not None
    if field_name == "fixture_type":
        return looks_like_fixture_type(value)
    if field_name == "remark":
        return looks_like_scope_text(value)
    if field_name == "part_name":
        return True
    return False


def should_carry_field_value(field_name: str) -> bool:
    return field_name in {"fixture_no", "fixture_type", "remark", "qty"}


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
        "remark": "",
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

    hint_remark_column = header_hints.get("remark")
    hint_remark = choose_hint_text(cell_map, hint_remark_column)
    if hint_remark:
        parsed["remark"] = hint_remark
        if hint_remark_column:
            used_columns.add(hint_remark_column)
    else:
        remark_candidates = [cell for cell in cells if cell["column"] not in used_columns and looks_like_scope_text(cell["text"])]
        if len(remark_candidates) > 1:
            return None, build_error(
                "Multiple possible values found for Remarks; row rejected to avoid guessing.",
                excel_row=row_index,
                raw_data={
                    **snapshot,
                    "candidate_field": "Remarks",
                    "candidate_values": [{"column": cell["column"], "value": cell["text"]} for cell in remark_candidates],
                },
            )
        if len(remark_candidates) == 1:
            parsed["remark"] = remark_candidates[0]["text"]
            used_columns.add(remark_candidates[0]["column"])
        elif inherited_hints.get("remark"):
            parsed["remark"] = inherited_hints["remark"]

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
            if looks_like_scope_text(cell["text"]):
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

    return (
        {
            "excel_row": row_index,
            "fixture_no": parsed["fixture_no"],
            "op_no": parsed["op_no"],
            "part_name": parsed["part_name"],
            "fixture_type": parsed["fixture_type"],
            "remark": parsed["remark"],
            "qty": parsed["qty"],
            "image_1_url": row_images.get("image_1_url"),
            "image_2_url": row_images.get("image_2_url"),
            "parser_confidence": "HIGH",
            "raw_data": {
                **snapshot,
                "normalized_fields": {
                    "fixture_no": parsed["fixture_no"] or None,
                    "op_no": parsed["op_no"] or None,
                    "part_name": parsed["part_name"] or None,
                    "fixture_type": parsed["fixture_type"] or None,
                    "qty": parsed["qty"] or None,
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


def get_effective_row_values(worksheet, row_index: int, max_column: int, vertical_merge_lookup: dict[tuple[int, int], Any]) -> tuple[Any, ...]:
    values: list[Any] = []

    for column_index in range(1, max_column + 1):
        cell_value = worksheet.cell(row=row_index, column=column_index).value
        if cell_value in (None, ""):
            cell_value = vertical_merge_lookup.get((row_index, column_index), cell_value)
        values.append(cell_value)

    return tuple(values)


def build_rows(
    worksheet,
    metadata_row: int,
    header_hints: dict[str, int],
    images_by_row: dict[int, dict[str, str]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    rows: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    vertical_merge_lookup = build_vertical_merge_lookup(worksheet)
    carry_hints: dict[str, str] = {}
    start_row = max(1, metadata_row + 1)

    for row_index in range(start_row, worksheet.max_row + 1):
        row_images = images_by_row.get(row_index, {})
        row_values = get_effective_row_values(worksheet, row_index, worksheet.max_column, vertical_merge_lookup)
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
            for field_name in ("fixture_no", "op_no", "part_name", "fixture_type", "remark", "qty"):
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

    return rows, errors


def _process_workbook(file_bytes: bytes) -> dict[str, Any]:
    workbook = open_excel_workbook(file_bytes, read_only=False)
    try:
        _metadata_sheet_name, _metadata_row, metadata_value = find_workbook_metadata(workbook)
        file_info = parse_wbs_header(metadata_value)

        all_rows: list[dict[str, Any]] = []
        all_errors: list[dict[str, Any]] = []

        for worksheet in workbook.worksheets:
            try:
                metadata_row, _ = find_metadata_row(worksheet)
            except ValueError:
                metadata_row = 0

            header_hints = detect_header_hints(worksheet, metadata_row)
            images_by_row, image_errors = extract_anchored_images(worksheet)
            rows, parsing_errors = build_rows(worksheet, metadata_row, header_hints, images_by_row)

            all_rows.extend(rows)
            all_errors.extend(image_errors)
            all_errors.extend(parsing_errors)
    finally:
        workbook.close()

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
            "scope_name": file_info["scope_name"],
            "scope_name_display": file_info["scope_name"],
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
