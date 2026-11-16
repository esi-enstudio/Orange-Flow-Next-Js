# Completion and verification

- Run the smallest relevant tests first: backend `cd backend && python -m pytest tests/<focused_test>.py`; frontend `cd frontend && npm run lint`.
- For frontend changes affecting compilation/types, also run `cd frontend && npm run build` (Next build performs project compilation/type validation). There is no dedicated typecheck script in `frontend/package.json`.
- For new/changed API routes, check `backend/tests/test_module_coverage.py`; for nav/module/leaf grant changes, run the plan parity test from repo root: `python -m pytest backend/tests/test_plan_modules_parity.py`.
- Run broader suites only when targeted tests indicate a need or the change has broad impact. Never claim verification for commands not run.
- Check diff for scope, inspect relevant `AGENTS.md`, and preserve existing uncommitted user changes. Detailed module checks: `mem:backend/core` and `mem:frontend/core`.