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
- Frontend Vite preview: `8080`

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
│   ├── .env.development       # Development environment
│   ├── .env.production        # Production environment
│   └── [other frontend files]
├── render.yaml                # Render deployment config
└── package.json               # Root (workspace reference)
```

## Environment Variables

### Backend (.env / Render config)

**Required:**
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Secret key for JWT tokens
- `CORS_ORIGIN` - Allowed CORS origin (e.g., `https://your-frontend.onrender.com`)
- `UPLOADS_DIR` - Persistent writable upload directory

**Local PostgreSQL SSL:**
- Set `DATABASE_SSL=false` for a local VM PostgreSQL server that does not support SSL.
- Leave `DATABASE_SSL` unset, set `DATABASE_SSL=true`, or add `sslmode=require` for managed PostgreSQL hosts that require SSL.

**Optional:**
- `NODE_ENV` - Set to `production` for deployments
- `PORT` - Backend port, defaults to `5000`
- `REPORT_TEMP_DIR` - Writable temp directory for report exports
- `ENABLE_TASK_SEED` - Set to "false" for production
- `DESIGN_EXTRACTION_SERVICE_URL` - URL to extraction service
- `DESIGN_EXTRACTION_SERVICE_TOKEN` - Token for extraction service

### Python Service (.env / Render config)

**Required:**
- `DATABASE_URL` - Same PostgreSQL connection as backend
- `BACKEND_API_URL` - Backend API URL (e.g., `https://your-backend.onrender.com`)

**Optional:**
- `PORT` - Port to run on (Render provides this automatically)
- `EXTRACTION_SERVICE_TOKEN` - Token for extraction service
- `PUBLIC_UPLOAD_BASE_URL` - Public URL for uploaded files

### Frontend (.env files / Render/Vercel)

**Required:**
- `VITE_API_URL` - Backend API base URL

**Development (.env.development):**
```
VITE_API_URL=http://localhost:5000
```

**Production (.env.production):**
```
VITE_API_URL=https://your-backend.onrender.com
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
DATABASE_URL=postgresql://...
DATABASE_SSL=false
JWT_SECRET=<strong-random-secret>
CORS_ORIGIN=http://<frontend-host>:8080
UPLOADS_DIR=/srv/tasktracker/uploads
```

Frontend build required env:
```bash
VITE_API_URL=http://<backend-host>:5000
npm run build
npm run preview
```

Python extraction service env:
```bash
PORT=8000
EXTRACTION_SERVICE_TOKEN=<same-token-used-by-backend>
BACKEND_API_URL=http://<backend-host>:5000/api
EXTRACTED_IMAGE_DIR=/srv/tasktracker/uploads/design-excel
```

Optional report temp env:
```bash
REPORT_TEMP_DIR=/srv/tasktracker/report-tmp
```

Runtime filesystem requirements:
- `UPLOADS_DIR` must be writable by the backend process and must be persistent across restarts.
- `REPORT_TEMP_DIR`, if set, must be writable by the backend process.
- The Python extraction image directory must point at the same persistent upload tree when local image URLs are expected.

Known production risks to manage:
- Backend startup still performs runtime schema bootstrap (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, index creation, permission alignment, and repair/sync routines). Keep database backups and treat startup as a migration event until this is replaced with reviewed migrations.
- `/uploads` is a static public file mount. Uploaded task proofs and reference images are reachable by URL if the path is known; add route-level authorization before storing sensitive files.
- Do not use `CORS_ORIGIN=*` in production. Production startup rejects wildcard CORS.

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

Set environment variable: `VITE_API_URL=https://your-backend.onrender.com`

### Option 2: Render

Create a static site service with:
- Build Command: `npm run build`
- Publish Directory: `dist`
- Environment Variables: `VITE_API_URL=https://your-backend.onrender.com`

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
- [ ] `CORS_ORIGIN` matches production frontend URL
- [ ] `DESIGN_EXTRACTION_SERVICE_TOKEN` is set (if using extraction)
- [ ] Frontend `VITE_API_URL` points to production backend
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
