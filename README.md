# TaskTracker Application

This is a full-stack Task Tracker application structured as a monorepo. It contains two completely decoupled components:

## Structure

- `/frontend`: The React (Vite + TypeScript) client application.
- `/backend`: The Node.js (Express + PostgreSQL) REST API and background workers.

## Deployment Notes

Both the frontend and backend are independently deployable without conflicts:

- **Frontend (`/frontend`)** is configured to run and deploy on **Vercel**. When configuring Vercel, ensure you set the `Root Directory` within the Project Settings to `frontend`.
- **Backend (`/backend`)** is configured to run and deploy on **Render**. The project is pre-configured with a `render.yaml` specification that sets the `rootDir` appropriately.

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
