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

The service binds to `0.0.0.0:8000` by default and is intended to stay private behind Render networking or an internal URL.

## Environment variables

- `DESIGN_EXTRACTION_SERVICE_TOKEN` or `EXTRACTION_SERVICE_TOKEN`: shared secret expected in the `x-extraction-token` header.
- `BACKEND_API_URL`: backend API base URL, for example `https://your-backend.onrender.com/api`.
- `PUBLIC_UPLOAD_BASE_URL`: optional override for extracted image URLs. If omitted, the service derives `https://.../uploads/design-excel` from `BACKEND_API_URL`.
- `DATABASE_URL`: optional Neon/Postgres connection string. When used, connect with SSL mode `require`.
- `EXTRACTED_IMAGE_DIR`: directory where extracted images are written. Default: `../backend/uploads/design-excel`
- `EXTRACTION_MAX_UPLOAD_BYTES`: max accepted file size in bytes. Default: `10485760`
- `HOST`: bind host. Default: `0.0.0.0`
- `PORT`: bind port. Default: `8000`
