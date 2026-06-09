# TaskTracker Application

This is the PARC Task Tracking System, structured as a monorepo with three deployable services:

## Structure

- `/frontend`: The React (Vite + TypeScript) client application.
- `/backend`: The Node.js (Express + PostgreSQL) REST API and background workers.
- `/python-service`: The FastAPI extraction service used by design ingestion.

## Deployment Notes

The app can run on an Ubuntu Server 24.04 VM without Docker, Nginx, or PM2 as long as the Node backend, Vite-built frontend, Python extraction service, and PostgreSQL database are started with explicit environment variables.

Target runtime prerequisites:
- Node.js 22 LTS with npm 10+
- Python 3.12
- PostgreSQL 16
- Backend on port `5000`
- Python service on port `8000`
- Frontend production preview on port `4173`
- Frontend development server on port `8080`

Required backend env vars:
- `DATABASE_URL`
- `JWT_SECRET`
- `CORS_ORIGIN`
- `UPLOADS_DIR`
- `DATABASE_SSL=false` for local VM PostgreSQL that does not support SSL; leave unset or use `DATABASE_SSL=true`/`sslmode=require` for managed databases that require SSL.

Required frontend build env var:
- `VITE_API_URL`

Python extraction token:
- `EXTRACTION_SERVICE_TOKEN` or `DESIGN_EXTRACTION_SERVICE_TOKEN`

Current local production endpoints:
- Frontend: `http://192.168.1.227:4173`
- Backend: `http://192.168.1.227:5000`
- Python service: `http://192.168.1.227:8000`
- Database: `postgresql://parc_user:<production-password>@localhost:5432/parc_task_tracker`

For persistent local uploads, set `UPLOADS_DIR` to a durable filesystem path. `REPORT_TEMP_DIR` is optional; when unset, report exports use the OS temp directory.

Production notes:
- Runtime database bootstrap still creates/updates schema at startup. Treat that as a production migration risk until replaced by reviewed migrations.
- `/uploads` is served statically by the backend. Do not place sensitive files in the upload tree unless route-level authorization is added.
- `.env` files are local runtime files and should not be committed.

## Local Development

Run the frontend:
```bash
cd frontend
npm install
npm run dev
```

Run the backend:
```bash
cd backend
npm install
npm run start
```
