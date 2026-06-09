# PARC Task Tracking Deployment Guide

## Overview

This guide covers deploying the PARC Task Tracking System with proper separation of concerns between the backend (Node.js), Python service (FastAPI), and frontend (React/Vite). Render/Vercel examples remain below, but the target deployment is an Ubuntu Server 24.04 VM without Docker, Nginx, PM2, Redis, queues, or cloud services.

## Ubuntu VM Prerequisites

Target versions:
- Ubuntu Server 24.04
- Node.js 22 LTS
- npm 10 or newer
- Python 3.12
- PostgreSQL 16

Service ports:
- Backend API: `5000`
- Python extraction service: `8000`
- Frontend Vite preview: `4173`
- Frontend Vite dev server: `8080`

Current local production endpoints:
- Frontend: `http://192.168.1.227:4173`
- Backend: `http://192.168.1.227:5000`
- Python service: `http://192.168.1.227:8000`
- Database: `postgresql://parc_user:<production-password>@localhost:5432/parc_task_tracker`

## Project Structure

```
TaskTrackerApp/
├── backend/                    # Node.js Express API
│   ├── package.json           # Backend dependencies
│   ├── server.js              # Entry point
│   ├── config/env.js          # Environment configuration
│   └── [other backend files]
├── python-service/            # FastAPI Python service
│   ├── app/
│   │   ├── __init__.py
│   │   └── main.py            # FastAPI app
│   ├── requirements.txt        # Python dependencies
│   └── [other python files]
├── frontend/                   # React/Vite application
│   ├── package.json
│   ├── .env.example           # Development template
│   ├── .env.development       # Local development environment
│   ├── .env.production        # Local production environment, ignored by git
│   ├── .env.production.example # Production template
│   └── [other frontend files]
├── render.yaml                # Render deployment config
└── package.json               # Root (workspace reference)
```

## Environment Variables

### Backend (.env / Render config)

**Required:**
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Secret key for JWT tokens
- `CORS_ORIGIN` - Allowed CORS origin. Current production: `http://192.168.1.227:4173`
- `UPLOADS_DIR` - Persistent writable upload directory

**Local PostgreSQL SSL:**
- Set `DATABASE_SSL=false` for a local VM PostgreSQL server that does not support SSL.
- Leave `DATABASE_SSL` unset, set `DATABASE_SSL=true`, or add `sslmode=require` for managed PostgreSQL hosts that require SSL.

**Optional:**
- `NODE_ENV` - Set to `production` for deployments
- `PORT` - Backend port, defaults to `5000`
- `REPORT_TEMP_DIR` - Writable temp directory for report exports
- `ENABLE_TASK_SEED` - Set to "false" for production
- `RBAC_AUTO_CREATE_PERMISSIONS` - Keep "false" unless intentionally bootstrapping new permissions
- `PERFORMANCE_MIN_APPROVED_TASKS` - Minimum approved tasks before analytics scoring, default `5`
- `DEPARTMENT_OVERDUE_PENALTY_FACTOR` - Overdue task scoring multiplier, default `1`
- `PERFORMANCE_ANALYTICS_REFRESH_MS` - Worker refresh interval, default `900000`
- `REPORT_FORMATTER_SCRIPT` - Optional Python formatter script override for report exports
- `REPORT_FORMATTER_PYTHON` - Optional Python executable override for report exports
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_STORAGE_BUCKET` - Optional Supabase storage integration
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` - Optional email settings

### Python Service (.env / Render config)

**Required for `/extract`:**
- `EXTRACTION_SERVICE_TOKEN` or `DESIGN_EXTRACTION_SERVICE_TOKEN` - Shared token expected in the `x-extraction-token` header

**Optional:**
- `NODE_ENV` - Set to `production` for deployments
- `HOST` - Bind host, default `0.0.0.0`
- `PORT` - Port to run on, current production `8000`
- `LOG_LEVEL` - Log level, production template uses `INFO`
- `EXTRACTION_MAX_UPLOAD_BYTES` - Max accepted upload size, default `10485760`
- `DATABASE_URL` - Optional. Leave unset for the current local VM database because the Python helper forces `sslmode=require` when present.

### Frontend (.env files / Render/Vercel)

**Required:**
- `VITE_API_URL` - Backend API base URL. Current production: `http://192.168.1.227:5000`

**Development (.env.development):**
```
VITE_API_URL=http://localhost:5000
```

**Production (.env.production):**
```
VITE_API_URL=http://192.168.1.227:5000
```

## Local Development Setup

### 1. Backend

```bash
cd backend
npm install
npm start
```

Server runs on `http://localhost:5000`

### 2. Python Service

```bash
cd python-service
python -m venv venv
source venv/bin/activate  # or `venv\Scripts\activate` on Windows
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Service runs on `http://localhost:8000`

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

App runs on `http://localhost:8080`

## Local VM Production Setup

Use the same three processes as local development, but set production env vars explicitly before starting them.

Backend required env:
```bash
NODE_ENV=production
PORT=5000
DATABASE_URL=postgresql://parc_user:<production-password>@localhost:5432/parc_task_tracker
DATABASE_SSL=false
JWT_SECRET=<strong-random-secret>
CORS_ORIGIN=http://192.168.1.227:4173
UPLOADS_DIR=uploads
ENABLE_TASK_SEED=false
RBAC_AUTO_CREATE_PERMISSIONS=false
```

Frontend build required env:
```bash
VITE_API_URL=http://192.168.1.227:5000
npm run build
npm run preview
```

Python extraction service env:
```bash
NODE_ENV=production
PORT=8000
LOG_LEVEL=INFO
EXTRACTION_SERVICE_TOKEN=<strong-random-token>
EXTRACTION_MAX_UPLOAD_BYTES=10485760
```

Optional report temp env:
```bash
REPORT_TEMP_DIR=/srv/tasktracker/report-tmp
```

Runtime filesystem requirements:
- `UPLOADS_DIR` must be writable by the backend process and must be persistent across restarts.
- `REPORT_TEMP_DIR`, if set, must be writable by the backend process.

Known production risks to manage:
- Backend startup still performs runtime schema bootstrap (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, index creation, permission alignment, and repair/sync routines). Keep database backups and treat startup as a migration event until this is replaced with reviewed migrations.
- `/uploads` is a static public file mount. Uploaded task proofs and reference images are reachable by URL if the path is known; add route-level authorization before storing sensitive files.
- Do not use `CORS_ORIGIN=*` in production. Production startup rejects wildcard CORS.

Migration notes for the current production VM:
- Frontend preview was aligned to port `4173` in `frontend/package.json`. Restarting with `npm run preview` now preserves the current production frontend URL.
- Tracked `.env.example` and `.env.production.example` files redact secrets. The ignored `.env.production` files in this workspace contain the current local production values needed for service restart.
- If an existing production `JWT_SECRET` is replaced, existing user sessions will be invalidated and users must sign in again.
- Keep Python service `DATABASE_URL` unset for the current localhost PostgreSQL deployment unless the Python connection helper is changed to support non-SSL local Postgres.

## Render Deployment

### Configuration

Render uses `render.yaml` in the root directory. Key configuration:

```yaml
services:
  - type: web
    name: tasktracker-backend
    env: node
    rootDir: backend
    buildCommand: npm install
    startCommand: npm start
    
  - type: web
    name: tasktracker-python-service
    env: python
    rootDir: python-service
    buildCommand: pip install -r requirements.txt
    startCommand: uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

### Deployment Steps

1. **Connect Repository**: Link your GitHub repo to Render
2. **Create Backend Service**:
   - Name: `tasktracker-backend`
   - Environment: Node
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Environment Variables: See "Backend" section above
3. **Create Python Service**:
   - Name: `tasktracker-python-service`
   - Environment: Python
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - Environment Variables: See "Python Service" section above
4. **Update CORS**:
   - Set `CORS_ORIGIN` in backend to your frontend URL
   - Update `VITE_API_URL` in frontend to your backend URL

### Health Checks

**Backend**: `https://your-backend.onrender.com/api/health`

**Python**: `https://your-python-service.onrender.com/health`

## Frontend Deployment (Vercel / Render)

### Option 1: Vercel (Recommended for Vite)

```bash
npm run build
# Deploy dist/ folder to Vercel
```

Set environment variable: `VITE_API_URL=http://192.168.1.227:5000` for the current local VM, or your deployed backend URL for cloud hosting.

### Option 2: Render

Create a static site service with:
- Build Command: `npm run build`
- Publish Directory: `dist`
- Environment Variables: `VITE_API_URL=http://192.168.1.227:5000` for the current local VM, or your deployed backend URL for cloud hosting.

## Troubleshooting

### Backend won't start
- Check `npm install` completed successfully
- Verify all required environment variables are set
- Check `DATABASE_URL` is correct and accessible

### Python service won't start
- Verify `uvicorn` is installed: `pip install -r requirements.txt`
- Check `app/main.py` exists and has `app = FastAPI()`
- Verify database connection string

### Frontend API calls fail
- Check `VITE_API_URL` is correctly set
- Verify backend `CORS_ORIGIN` matches frontend URL
- Ensure both services are running and accessible

### Database migrations fail
- Check `DATABASE_URL` and `DATABASE_SSL` have proper SSL settings (`DATABASE_SSL=false` for local PostgreSQL, `?sslmode=require` or `DATABASE_SSL=true` for SSL-only managed PostgreSQL)
- Verify database user has necessary permissions
- Check network/firewall rules allow database access

## Production Checklist

- [ ] Backend `NODE_ENV=production` is set
- [ ] `JWT_SECRET` is set to a secure random value
- [ ] `DATABASE_URL` uses production database
- [ ] `DATABASE_SSL=false` is set for the current local PostgreSQL deployment
- [ ] `CORS_ORIGIN=http://192.168.1.227:4173`
- [ ] Frontend `VITE_API_URL=http://192.168.1.227:5000`
- [ ] Python `EXTRACTION_SERVICE_TOKEN` is set if `/extract` is used
- [ ] All services pass health checks
- [ ] SSL/HTTPS is enabled
- [ ] Database backups are configured
- [ ] Monitoring and logging are configured

## API Endpoints

### Backend Health
```
GET /api/health
Response: { "status": "ok" }
```

### Python Health
```
GET /health
Response: { "status": "ok" }
```

### Root Endpoints
- Backend: `GET /` → "Backend is running"
- Python: `GET /` → { "status": "running" }

## Support

For issues:
1. Check service logs in Render dashboard
2. Verify all environment variables are set
3. Test health endpoints
4. Check database connectivity
5. Review application logs for specific errors
