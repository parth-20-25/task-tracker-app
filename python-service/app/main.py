from __future__ import annotations

import asyncio
import os
import re
import uuid
from io import BytesIO
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Header, UploadFile
from fastapi.responses import JSONResponse
from openpyxl import load_workbook

ALLOWED_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
ALLOWED_EXTENSION = ".xlsx"
ALLOWED_IMAGE_COLUMNS = {6: "image_1_url", 9: "image_2_url"}
MAX_UPLOAD_BYTES = int(os.getenv("EXTRACTION_MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
SERVICE_TOKEN = (os.getenv("EXTRACTION_SERVICE_TOKEN") or os.getenv("DESIGN_EXTRACTION_SERVICE_TOKEN") or "").strip()
BACKEND_API_URL = (os.getenv("BACKEND_API_URL") or "").strip()
PUBLIC_UPLOAD_BASE_URL = (os.getenv("PUBLIC_UPLOAD_BASE_URL") or "").strip()
DEFAULT_IMAGE_DIR = Path(__file__).resolve().parents[2] / "backend" / "uploads" / "design-excel"
IMAGE_OUTPUT_DIR = Path(os.getenv("EXTRACTED_IMAGE_DIR", str(DEFAULT_IMAGE_DIR))).resolve()

FIXTURE_NUMBER_PATTERN = re.compile(r"^(?=.*[A-Z])(?=.*\d)[A-Z0-9][A-Z0-9/_-]{4,}$")
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
    "fixture_no": {"fixtureno", "fixture", "fixtureid"},
    "op_no": {"opno", "opnumber", "operationno", "operationnumber"},
    "part_name": {"partname", "partdescription", "componentname"},
    "fixture_type": {"fixturetype", "typeoffixture", "fixturedescription"},
    "qty": {"qty", "quantity"},
    "remark": {"remark", "remarks"},
}

app = FastAPI()


@app.get("/")
def root() -> dict[str, str]:
    return {"status": "running"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


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


def match_header_field(cell_text: str) -> str | None:
    normalized = normalize_header(cell_text)
    for field_name, aliases in HEADER_FIELD_ALIASES.items():
        if normalized in aliases:
            return field_name
    return None


def detect_header_hints(worksheet, metadata_row: int) -> dict[str, int]:
    best_match_count = 0
    best_mapping: dict[str, int] = {}

    for row_values in worksheet.iter_rows(min_row=metadata_row + 1, max_row=min(metadata_row + 30, worksheet.max_row), values_only=True):
        current_mapping: dict[str, int] = {}
        for column_index, cell_value in enumerate(row_values, start=1):
            field_name = match_header_field(normalize_text(cell_value))
            if field_name and field_name not in current_mapping:
                current_mapping[field_name] = column_index

        if len(current_mapping) > best_match_count:
            best_match_count = len(current_mapping)
            best_mapping = current_mapping

    return best_mapping if best_match_count >= 3 else {}


def build_semantic_cells(row_values: tuple[Any, ...]) -> list[dict[str, Any]]:
    cells: list[dict[str, Any]] = []

    for column_index, cell_value in enumerate(row_values, start=1):
        if column_index in ALLOWED_IMAGE_COLUMNS:
            continue

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


def looks_like_fixture_number(value: str) -> bool:
    candidate = normalize_text(value).upper().replace(" ", "")
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
    return None


def looks_like_fixture_type(value: str) -> bool:
    normalized = normalize_key(value)
    if not normalized:
        return False
    return any(keyword in normalized for keyword in FIXTURE_TYPE_KEYWORDS)


def looks_like_scope_text(value: str) -> bool:
    normalized = normalize_key(value)
    return "scope" in normalized or "parc" in normalized or "customer" in normalized


def choose_hint_text(cell_map: dict[int, str], column_index: int | None) -> str:
    if not column_index:
        return ""
    return cell_map.get(column_index, "")


def choose_best_fixture_type(cells: list[dict[str, Any]], used_columns: set[int]) -> tuple[str, str]:
    candidates = [cell for cell in cells if cell["column"] not in used_columns and looks_like_fixture_type(cell["text"])]
    if not candidates:
        return "", ""
    best = max(candidates, key=lambda cell: (cell["text"].lower().count("fixture"), len(cell["text"])))
    return best["text"], best["column"]


def choose_best_part_name(cells: list[dict[str, Any]], used_columns: set[int]) -> tuple[str, str]:
    candidates = []
    for cell in cells:
        if cell["column"] in used_columns:
            continue
        if looks_like_fixture_number(cell["text"]) or looks_like_op_number(cell["text"]):
            continue
        if parse_qty_value(cell["text"]) is not None:
            continue
        if looks_like_scope_text(cell["text"]):
            continue
        if match_header_field(cell["text"]):
            continue
        candidates.append(cell)

    if not candidates:
        return "", ""

    best = max(candidates, key=lambda cell: (len(cell["text"]), -cell["column"]))
    return best["text"], best["column"]


def parse_fixture_candidate(
    row_index: int,
    cells: list[dict[str, Any]],
    header_hints: dict[str, int],
    row_images: dict[str, str],
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    cell_map = {cell["column"]: cell["text"] for cell in cells}
    used_columns: set[int] = set()
    snapshot = build_row_snapshot(cells, row_images)
    parsed = {
        "fixture_no": "",
        "op_no": "",
        "part_name": "",
        "fixture_type": "",
        "remark": "",
        "qty": "",
    }

    hint_fixture_no = choose_hint_text(cell_map, header_hints.get("fixture_no"))
    if looks_like_fixture_number(hint_fixture_no):
        parsed["fixture_no"] = hint_fixture_no.replace(" ", "")
        used_columns.add(header_hints["fixture_no"])

    hint_op_no = choose_hint_text(cell_map, header_hints.get("op_no"))
    if looks_like_op_number(hint_op_no):
        parsed["op_no"] = normalize_text(hint_op_no)
        used_columns.add(header_hints["op_no"])

    hint_qty = parse_qty_value(choose_hint_text(cell_map, header_hints.get("qty")))
    if hint_qty is not None:
        parsed["qty"] = str(hint_qty)
        used_columns.add(header_hints["qty"])

    hint_fixture_type_column = header_hints.get("fixture_type")
    hint_fixture_type = choose_hint_text(cell_map, hint_fixture_type_column)
    if hint_fixture_type:
        parsed["fixture_type"] = hint_fixture_type
        if hint_fixture_type_column:
            used_columns.add(hint_fixture_type_column)

    hint_part_name_column = header_hints.get("part_name")
    hint_part_name = choose_hint_text(cell_map, hint_part_name_column)
    if hint_part_name:
        parsed["part_name"] = hint_part_name
        if hint_part_name_column:
            used_columns.add(hint_part_name_column)

    hint_remark_column = header_hints.get("remark")
    hint_remark = choose_hint_text(cell_map, hint_remark_column)
    if hint_remark:
        parsed["remark"] = hint_remark
        if hint_remark_column:
            used_columns.add(hint_remark_column)

    if not parsed["fixture_no"]:
        for cell in cells:
            if cell["column"] in used_columns:
                continue
            if looks_like_fixture_number(cell["text"]):
                parsed["fixture_no"] = cell["text"].replace(" ", "")
                used_columns.add(cell["column"])
                break

    if not parsed["op_no"]:
        for cell in cells:
            if cell["column"] in used_columns:
                continue
            if looks_like_op_number(cell["text"]):
                parsed["op_no"] = cell["text"]
                used_columns.add(cell["column"])
                break

    if not parsed["qty"]:
        for cell in cells:
            if cell["column"] in used_columns:
                continue
            qty_value = parse_qty_value(cell["text"])
            if qty_value is not None:
                parsed["qty"] = str(qty_value)
                used_columns.add(cell["column"])
                break

    if not parsed["remark"]:
        for cell in cells:
            if cell["column"] in used_columns:
                continue
            if looks_like_scope_text(cell["text"]):
                parsed["remark"] = cell["text"]
                used_columns.add(cell["column"])
                break

    if not parsed["fixture_type"]:
        fixture_type_text, fixture_type_column = choose_best_fixture_type(cells, used_columns)
        if fixture_type_text:
            parsed["fixture_type"] = fixture_type_text
            used_columns.add(fixture_type_column)

    if not parsed["part_name"]:
        part_name_text, part_name_column = choose_best_part_name(cells, used_columns)
        if part_name_text:
            parsed["part_name"] = part_name_text
            used_columns.add(part_name_column)

    strong_identity = bool(parsed["fixture_no"] or parsed["op_no"])
    semantic_signal_count = sum(
        1
        for field_name in ("fixture_no", "op_no", "part_name", "fixture_type", "qty", "remark")
        if parsed[field_name]
    )

    if not strong_identity and not row_images:
        return None, None

    if semantic_signal_count < 2 and not row_images:
        return None, None

    missing_fields = [
        label
        for field_name, label in (
            ("fixture_no", "FIXTURE NO"),
            ("op_no", "OP.NO"),
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
            "raw_data": snapshot,
        },
        None,
    )


def build_rows(
    worksheet,
    metadata_row: int,
    header_hints: dict[str, int],
    images_by_row: dict[int, dict[str, str]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    rows: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []

    for row_index, row_values in enumerate(worksheet.iter_rows(min_row=metadata_row + 1, values_only=True), start=metadata_row + 1):
        row_images = images_by_row.get(row_index, {})
        cells = build_semantic_cells(row_values)

        if not cells and not row_images:
            continue

        if is_separator_row(cells):
            continue

        if any(cell["text"].startswith("WBS-") for cell in cells):
            continue

        if is_header_row(cells):
            continue

        parsed_row, error = parse_fixture_candidate(row_index, cells, header_hints, row_images)

        if error:
            errors.append(error)
            continue

        if parsed_row:
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
    workbook = open_excel_workbook(file_bytes, read_only=True)
    try:
        worksheet = workbook.active
        metadata_row, metadata_value = find_metadata_row(worksheet)
        file_info = parse_wbs_header(metadata_value)
        header_hints = detect_header_hints(worksheet, metadata_row)
        images_by_row, image_errors = extract_images_from_workbook(file_bytes)
        rows, parsing_errors = build_rows(worksheet, metadata_row, header_hints, images_by_row)
    finally:
        workbook.close()

    errors = [*image_errors, *parsing_errors]
    if not rows and not errors:
        errors.append(build_error("No fixture rows were found in the workbook."))

    return {
        "file_info": {
            "project_code": file_info["project_code"],
            "scope_name": file_info["scope_name"],
            "scope_name_display": file_info["scope_name"],
            "company_name": file_info["company_name"],
        },
        "rows": rows,
        "errors": errors,
    }


@app.post("/extract")
async def extract_workbook(
    file: UploadFile = File(...),
    x_extraction_token: str | None = Header(default=None),
):
    if not SERVICE_TOKEN:
        return build_error_response(500, "Service is not configured", [build_error("EXTRACTION_SERVICE_TOKEN is required.")])

    if x_extraction_token != SERVICE_TOKEN:
        return build_error_response(401, "Unauthorized", [build_error("Invalid extraction token.")])

    if not normalize_text(file.filename).lower().endswith(ALLOWED_EXTENSION):
        return build_error_response(400, "Failed to process file", [build_error("Only .xlsx files are allowed.")])

    if normalize_text(file.content_type).lower() != ALLOWED_CONTENT_TYPE:
        return build_error_response(400, "Failed to process file", [build_error("Only .xlsx MIME type is allowed.")])

    file_bytes = await file.read()
    if not file_bytes:
        return build_error_response(400, "Failed to process file", [build_error("Uploaded file is empty.")])

    if len(file_bytes) > MAX_UPLOAD_BYTES:
        return build_error_response(400, "Failed to process file", [build_error("Excel file exceeds the maximum allowed size.")])

    try:
        return await asyncio.to_thread(_process_workbook, file_bytes)
    except ValueError as exc:
        return build_error_response(422, "Failed to process file", [build_error(str(exc))])
    except Exception as exc:
        return build_error_response(500, "Failed to process file", [build_error(str(exc))])


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
    )
