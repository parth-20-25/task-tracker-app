# Python Extraction Service

Private FastAPI service used by the Node backend to extract fixture rows and anchored images from `.xlsx` files.

## Run locally

```bash
cd python-service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app/main.py
```

The service binds to `127.0.0.1:8000` by default and is intended to stay private.

## Environment variables

- `DESIGN_EXTRACTION_SERVICE_TOKEN` or `EXTRACTION_SERVICE_TOKEN`: shared secret expected in the `x-extraction-token` header.
- `PUBLIC_UPLOAD_BASE_URL`: public base URL for extracted image files. Default: `http://localhost:5000/uploads/design-excel`
- `EXTRACTED_IMAGE_DIR`: directory where extracted images are written. Default: `../backend/uploads/design-excel`
- `EXTRACTION_MAX_UPLOAD_BYTES`: max accepted file size in bytes. Default: `10485760`
- `HOST`: bind host. Default: `127.0.0.1`
- `PORT`: bind port. Default: `8000`
