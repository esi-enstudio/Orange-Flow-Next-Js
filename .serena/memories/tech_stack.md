# Technology stack

- Frontend: Next.js App Router 16.4.2, React 19, TypeScript 5 (strict), Tailwind CSS 4, npm; custom bilingual BN/EN translation system, Axios API wrapper, React Context/Zustand where established. Actual application package is `frontend/package.json`; root `package.json` is not the frontend app manifest.
- Backend: Python 3.11, FastAPI, async SQLAlchemy 2, PostgreSQL/asyncpg, Pydantic 2, Alembic; pytest config in `backend/pytest.ini`, dependencies in `backend/requirements.txt`.
- Infrastructure/integrations: Docker Compose, Redis, Playwright automation, WhatsApp gateway.
- See `mem:suggested_commands` for run/test commands; frontend-specific constraints in `mem:frontend/core`.