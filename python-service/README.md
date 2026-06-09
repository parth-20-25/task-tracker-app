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

The service binds to `0.0.0.0:8000` by default and is intended to stay private behind internal networking.

Current local production URL: `http://192.168.1.227:8000`

## Environment variables

- `DESIGN_EXTRACTION_SERVICE_TOKEN` or `EXTRACTION_SERVICE_TOKEN`: shared secret expected in the `x-extraction-token` header for `POST /extract`.
- `DATABASE_URL`: optional Postgres connection string. Leave unset for the current local VM PostgreSQL deployment because the helper forces SSL with `sslmode=require` when this is present.
- `EXTRACTION_MAX_UPLOAD_BYTES`: max accepted file size in bytes. Default: `10485760`
- `LOG_LEVEL`: Python logging level. Production template uses `INFO`.
- `HOST`: bind host. Default: `0.0.0.0`
- `PORT`: bind port. Default: `8000`
