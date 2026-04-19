# TaskTrackerApp Project Overview

A full-stack task tracking application with a React/TypeScript frontend and a Node.js/Express backend.

## Architecture

### Frontend
- **Framework:** [React](https://reactjs.org/) (Vite)
- **Language:** [TypeScript](https://www.typescriptlang.org/)
- **Styling:** [Tailwind CSS](https://tailwindcss.com/)
- **UI Components:** [Shadcn UI](https://ui.shadcn.com/) (Radix UI primitives)
- **State Management:** [TanStack Query](https://tanstack.com/query/latest) (React Query)
- **Forms:** [React Hook Form](https://react-hook-form.com/) + [Zod](https://zod.dev/)
- **Icons:** [Lucide React](https://lucide.dev/)

### Backend
- **Framework:** [Express.js](https://expressjs.com/) (Node.js)
- **Database:** [PostgreSQL](https://www.postgresql.org/) (using `pg` driver)
- **Authentication:** JWT (JSON Web Tokens) with `jsonwebtoken` and `bcrypt` for hashing.
- **File Handling:** `multer` for task proof uploads.
- **Email:** `nodemailer` for notifications.
- **Background Tasks:** Includes job processing (`jobService`) and escalation workers (`escalationWorkerService`).

## Project Structure

```text
/
├── backend/                # Express.js backend
│   ├── config/             # Environment and constant configurations
│   ├── middleware/         # Auth and error handling middleware
│   ├── repositories/       # Database access layer (SQL queries)
│   ├── routes/             # API endpoint definitions
│   ├── services/           # Business logic and workers
│   └── server.js           # Entry point
├── src/                    # React frontend source
│   ├── api/                # API client wrappers (fetch)
│   ├── components/         # Shared and Shadcn UI components
│   ├── contexts/           # React Contexts (Auth, Tasks)
│   ├── hooks/              # Custom React hooks (Queries/Mutations)
│   ├── pages/              # Application pages/views
│   └── types/              # TypeScript definitions
├── package.json            # Frontend dependencies and scripts
└── backend/package.json    # Backend dependencies and scripts
```

## Building and Running

### Prerequisites
- Node.js (v18+)
- PostgreSQL database

### Setup Environment
1.  **Backend:** Create a `.env` file in the `backend/` directory based on the defaults in `backend/config/env.js`.
    - `PORT`: 5000 (default)
    - `PGUSER`, `PGHOST`, `PGDATABASE`, `PGPASSWORD`, `PGPORT`
    - `JWT_SECRET`
2.  **Frontend:** Ensure `VITE_API_BASE_URL` is set if different from `http://localhost:5000/api`.

### Key Commands

#### Frontend (Root Directory)
- `npm install`: Install dependencies.
- `npm run dev`: Start development server.
- `npm run build`: Build for production.
- `npm run lint`: Run ESLint.
- `npm run test`: Run tests with Vitest.

#### Backend (`backend/` Directory)
- `cd backend && npm install`: Install dependencies.
- `npm start`: Start the backend server.
- The backend automatically initializes the database schema via `bootstrapService` on startup.

## Development Conventions

- **Frontend:** Use functional components and hooks. Prefer TanStack Query for data fetching. Use Shadcn components for UI consistency.
- **Backend:** Follow the Repository pattern for database access. Business logic should reside in services. Use `asyncHandler` for Express routes to handle errors gracefully.
- **API:** Communication is handled via a centralized `apiRequest` utility in `src/api/http.ts`.
- **Testing:** Frontend uses Vitest and React Testing Library. Backend testing is currently TBD (placeholder in scripts).
