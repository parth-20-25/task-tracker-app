from __future__ import annotations

import os
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


def find_metadata_and_header_rows(worksheet) -> tuple[int, str, int]:
    metadata_row = None
    metadata_value = ""

    for row_index in range(1, min(worksheet.max_row, 25) + 1):
        for cell in worksheet[row_index]:
            cell_value = normalize_text(cell.value)
            if cell_value.startswith("WBS-"):
                metadata_row = row_index
                metadata_value = cell_value
                break
        if metadata_row is not None:
            break

    if metadata_row is None:
        raise ValueError("Could not find the WBS metadata row in the workbook.")

    for row_index in range(metadata_row + 1, min(worksheet.max_row, metadata_row + 25) + 1):
        if any(normalize_text(cell.value) for cell in worksheet[row_index]):
            return metadata_row, metadata_value, row_index

    raise ValueError("Could not find the table header row below the WBS metadata row.")


def resolve_header_map(worksheet, header_row_index: int) -> dict[str, int]:
    header_lookup: dict[str, int] = {}
    expected = {
        "fixture_no": {"fixtureno"},
        "op_no": {"opno"},
        "part_name": {"partname"},
        "fixture_type": {"fixturetype"},
        "qty": {"qty"},
    }

    for column_index in range(1, worksheet.max_column + 1):
        normalized = normalize_header(worksheet.cell(header_row_index, column_index).value)
        if normalized and normalized not in header_lookup:
            header_lookup[normalized] = column_index

    resolved: dict[str, int] = {}
    missing: list[str] = []

    for field_name, candidates in expected.items():
        matched_column = next((header_lookup[candidate] for candidate in candidates if candidate in header_lookup), None)
        if matched_column is None:
            missing.append(field_name)
            continue
        resolved[field_name] = matched_column

    if missing:
        raise ValueError(f"Missing required table headers: {', '.join(missing)}.")

    return resolved


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


def build_rows(worksheet, header_row_index: int, header_map: dict[str, int], images_by_row: dict[int, dict[str, str]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []

    for row_index in range(header_row_index + 1, worksheet.max_row + 1):
        row_has_images = row_index in images_by_row
        row_snapshot = {
            "fixture_no": normalize_text(worksheet.cell(row_index, header_map["fixture_no"]).value),
            "op_no": normalize_text(worksheet.cell(row_index, header_map["op_no"]).value),
            "part_name": normalize_text(worksheet.cell(row_index, header_map["part_name"]).value),
            "fixture_type": normalize_text(worksheet.cell(row_index, header_map["fixture_type"]).value),
            "qty": normalize_text(worksheet.cell(row_index, header_map["qty"]).value),
        }

        if not row_has_images and not any(row_snapshot.values()):
            continue

        row_images = images_by_row.get(row_index, {})
        rows.append(
            {
                "excel_row": row_index,
                **row_snapshot,
                "image_1_url": row_images.get("image_1_url"),
                "image_2_url": row_images.get("image_2_url"),
            }
        )

    return rows


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
        workbook = load_workbook(filename=BytesIO(file_bytes), data_only=True)
        worksheet = workbook.active

        _, metadata_value, header_row_index = find_metadata_and_header_rows(worksheet)
        file_info = parse_wbs_header(metadata_value)
        header_map = resolve_header_map(worksheet, header_row_index)
        images_by_row, image_errors = extract_anchored_images(worksheet)
        rows = build_rows(worksheet, header_row_index, header_map, images_by_row)

        if not rows and not image_errors:
            image_errors.append(build_error("No fixture rows were found in the workbook."))

        return {
            "file_info": {
                "project_code": file_info["project_code"],
                "scope_name": file_info["scope_name"],
                "scope_name_display": file_info["scope_name"],
                "company_name": file_info["company_name"],
            },
            "rows": rows,
            "errors": image_errors,
        }
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
