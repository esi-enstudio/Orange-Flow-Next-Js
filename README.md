# Orange Flow — Telecom Operations Platform

A full-stack web platform for telecom operations, featuring **FastAPI** backend with RBAC and **Next.js** frontend. Manages activations, retailer networks, field force, BTS inventory, and reporting — all with multi-tenant house-based isolation.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Frontend (Next.js)                 │
│   ┌──────────┐ ┌──────────┐ ┌────────────────────┐ │
│   │  Auth     │ │  Pages   │ │  i18n (BN/EN)     │ │
│   │  Context  │ │  (30+)   │ │                    │ │
│   └────┬─────┘ └────┬─────┘ └────────────────────┘ │
│        └────────────┼──────────────────────────────┘ │
│                     │ HTTP API                       │
├─────────────────────┼────────────────────────────────┤
│              Backend (FastAPI)                        │
│   ┌──────────┐ ┌──────────┐ ┌────────────────────┐ │
│   │  Auth     │ │  CRUD    │ │  Automation Engine │ │
│   │  RBAC     │ │  Endpoints│ │  (Playwright)     │ │
│   └──────────┘ └──────────┘ └────────────────────┘ │
│                        │                             │
│                        ▼                             │
│               PostgreSQL Database                    │
└──────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer        | Technology                        |
|-------------|-----------------------------------|
| **Frontend** | Next.js (App Router), TypeScript, Tailwind CSS |
| **Backend**  | Python 3.13+, FastAPI, SQLAlchemy (async) |
| **Database** | PostgreSQL 16+ with asyncpg       |
| **Auth**     | JWT-based, Role & House scoped    |
| **Infra**    | Docker Compose, nginx reverse proxy |

---

## Features

### Core Modules
- **House Management** — Multi-tenant org units with isolated data
- **User & Role Management** — Fine-grained RBAC with permission scoping
- **Retailer Management** — CRUD, search, and bulk import/export
- **Employee (Field Force) Management** — RSO/Supervisor profiles, bank info, hierarchy
- **Activation Management** — Import & query activation records from Excel
- **BTS Management** — Base station inventory and tracking
- **Target Management** — House, Supervisor, and RSO-level target setting

### Retailer Marking
- Create tags (DRC, RSP, BSP, etc.) per house
- Mark retailers with tags for report exclusion
- Bulk tag assignment with server-side search (debounced)
- Left panel shows tagged retailers per tag

### Reports & Analytics
- **Activation Report** — Date-range filtered, tag-exclusion support, paginated
- **iTop-Up Details** — Granular iTop transaction view
- **Live Activations** — Real-time activation monitoring
- **SIM Issues** — Problem SIM tracking
- **Scratch Card Report** — Card inventory reporting
- Export capabilities (Excel/CSV)

### Automation
- **GA Live Sync** — Auto-fetches activations every 5 minutes (8AM–12AM)
- **DMS Sync** — Scheduled Playwright-based DMS portal scraping
- **Excel Processing Pipeline** — Validated bulk import (retailers, employees, targets, etc.)

---

## Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 18+ (for local frontend dev)
- Python 3.11+ (for local backend dev)

### Production (Docker)

```bash
cp .env.example .env          # configure your environment
docker-compose up -d          # starts all services
```

Services:
- **Frontend** → `http://localhost:3000`
- **Backend API** → `http://localhost:8000`
- **Database** → `localhost:5432`

### Development

**Backend:**
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev                 # → http://localhost:3000
```

---

## Project Structure

```
Orange-Flow-Next-Js/
├── backend/                    # FastAPI application
│   ├── main.py                 # API entry point (all routes)
│   ├── app/
│   │   ├── models/             # SQLAlchemy models
│   │   ├── services/           # Business logic & automation
│   │   │   ├── automation/     # Excel processing, scraping
│   │   │   └── db_service.py   # Database helpers
│   │   ├── core/               # Browser engine, auth core
│   │   ├── utils/              # Helpers, validators, access control
│   │   └── routers/            # API endpoints (merged from controllers)
│   ├── alembic/                # Database migrations
│   ├── config/settings.py      # Environment config
│   ├── data/                   # Data assets (renamed from _data_list)
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/                   # Next.js application
│   ├── src/
│   │   ├── app/                # App Router pages (30+ routes)
│   │   ├── components/         # Shared UI & layout components
│   │   ├── context/            # Auth, color theme contexts
│   │   ├── i18n/               # BN/EN translations
│   │   ├── hooks/              # Custom React hooks
│   │   ├── types/              # TypeScript interfaces/types
│   │   ├── constants/          # Application constants
│   │   ├── services/           # API service layer
│   │   └── lib/                # Shared utilities
│   ├── public/
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml          # Orchestration
└── .env.example
```

---

## API Overview

All endpoints are prefixed with `/api/`. Authentication via JWT Bearer token.

| Group              | Key Endpoints                                      |
|--------------------|---------------------------------------------------|
| **Auth**           | `POST /api/login`, `GET /api/me`                  |
| **Users**          | `GET/POST/PUT/DELETE /api/users`                  |
| **Roles**          | `GET/POST/PUT/DELETE /api/roles`                  |
| **Permissions**    | `GET /api/permissions`                            |
| **Houses**         | `GET/POST/PUT/DELETE /api/houses`                 |
| **Retailers**      | `GET/POST/PUT/DELETE /api/retailers`, `GET /api/retailers/export` |
| **Employees**      | `GET/POST/PUT/DELETE /api/employees`              |
| **BTS**            | `GET/POST/PUT/DELETE /api/bts`                    |
| **Activations**    | `GET /api/activations`, `GET /api/activations/report` |
| **Filter Tags**    | `GET/POST/DELETE /api/filter-tags`                |
| **Retailer Filters** | `GET/POST/DELETE /api/retailer-filters`, `POST /api/retailer-filters/bulk` |
| **Targets**        | `GET/POST /api/targets/house`, `/api/targets/supervisor`, `/api/targets/rso` |
| **Import**         | `POST /api/upload/*` (Excel file uploads)         |
| **Reports**        | `GET /api/reports/*` (various report formats)     |

---

## RBAC Model

```
User ──┬── Role ──┬── Permission
       │          │
       └── House ─┘
```

- Users belong to houses (multi-tenant)
- Roles group permissions (view, create, edit, delete)
- Permissions are granular: `view_retailers`, `edit_employees`, `view_reports`, etc.
- House context limits data visibility — admins see all, managers see their house

---

## Environment Variables

Key variables in `.env`:

| Variable              | Purpose                           |
|----------------------|-----------------------------------|
| `DATABASE_URL`       | PostgreSQL connection string      |
| `SECRET_KEY`         | JWT signing secret                |
| `JWT_ALGORITHM`      | Token algorithm (default HS256)   |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Session duration         |
| `BOT_TOKEN`          | Telegram bot token (legacy)       |
| `SUPER_ADMIN_ID`     | Telegram super admin ID           |
| `ENABLE_GA_SYNC`     | Enable auto activation sync       |
| `HEADLESS_MODE`      | Browser automation visibility     |

---

## i18n

The platform supports **Bengali (BN)** and **English (EN)**. Language is selected via a UI toggle in the sidebar.

Translation files: `frontend/src/i18n/translations.ts`

---

## Common Tasks

### Restart backend after code changes
```bash
docker restart orange_flow_backend
```

### Run database migrations
```bash
docker exec -it orange_flow_backend alembic upgrade head
```

### Add a new page
1. Create `frontend/src/app/<route>/page.tsx`
2. Add navigation item in `frontend/src/lib/constants.ts`
3. Add translations in `frontend/src/i18n/translations.ts`
4. Add API endpoints in `backend/main.py` (if needed)

---

## License

Proprietary software. All rights reserved.

---

## Support

For technical support or feature requests, contact the development team.
