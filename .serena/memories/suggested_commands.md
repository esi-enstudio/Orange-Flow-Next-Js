# Common project commands (Linux)

- Start local stack: `docker compose up -d --build` from repo root (includes db, redis, backend, WhatsApp gateway). Avoid `docker compose down -v` unless the user explicitly intends to delete persisted volumes/data.
- Frontend: `cd frontend && npm install` (only when dependencies need installing); `cd frontend && npm run dev`; `cd frontend && npm run lint`; `cd frontend && npm run build`.
- Backend tests: `cd backend && python -m pytest tests/<focused_test>.py`; full backend suite: `cd backend && python -m pytest` (pytest.ini sets `testpaths = tests`, asyncio auto mode).
- Plan-module parity is specifically expected from repo root: `python -m pytest backend/tests/test_plan_modules_parity.py`. Endpoint/module coverage test: `cd backend && python -m pytest tests/test_module_coverage.py`.
- DB migrations in running API container (when appropriate): `docker exec -it orange_flow_backend alembic upgrade head`.
- Initial local setup flow is documented in root `README.md`; frontend setup page is `/setup`. Do not copy secrets from env files into chat or memory.
- Select targeted checks for each change; see `mem:task_completion`.