# Orange Flow — Frontend

Next.js (App Router) + TypeScript + Tailwind CSS web application for the Orange Flow telecom operations platform.

## Tech Stack

- **Framework**: Next.js (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **State**: React Context (Auth, Color Theme)
- **API Client**: Axios-based wrapper with JWT interceptor
- **i18n**: Custom BN/EN translation system
- **Notifications**: react-hot-toast

## Available Scripts

```bash
npm run dev       # Development server → http://localhost:3000
npm run build     # Production build
npm run start     # Start production server
npm run lint      # Run ESLint
```

## Project Structure

```
src/
├── app/                    # App Router pages
│   ├── bts/                # BTS management
│   ├── employees/          # Field force management
│   ├── houses/             # House management
│   ├── import/             # Excel data import (activations, targets, etc.)
│   ├── reports/            # Reports (activations, iTop-up, live, SIM issues)
│   ├── retailers/          # Retailer list & management
│   ├── retailer-marking/   # Tag-based retailer marking
│   ├── roles/              # Role & permission management
│   ├── targets/            # Target setting (house/supervisor/RSO)
│   ├── users/              # User management
│   ├── settings/           # Profile & preferences
│   ├── login/              # Authentication
│   ├── layout.tsx          # Root layout (progress bar, providers)
│   └── page.tsx            # Dashboard
├── components/
│   ├── layout/             # Sidebar, DashboardLayout, ThemeToggle, etc.
│   └── ui/                 # Reusable UI components (Modal, ProgressBar, etc.)
├── context/                # AuthContext, ColorContext
├── i18n/                   # translations.ts, useLanguage hook
└── lib/                    # api.ts, utils.ts, constants.ts (nav items)
```

## Page Count

30+ pages covering: auth (1), dashboard (1), CRUD modules (7), targets (3), import (6), reports (5), marking (1), settings (1), BTS (1).

## Environment Variables

Copy `.env.example` to `.env.local`. The Google Maps section controls the
live-location map provider:

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Production browser key. Restrict it by HTTP referrer to the deployed origins. |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY_DEV` | Optional localhost-friendly key used only by `next dev`. |
| `NEXT_PUBLIC_GOOGLE_MAPS_ALLOWED_ORIGINS` | Optional mirror of the key's referrer list. Origins not listed never load Google Maps. |

A browser key only works on origins listed under **Google Cloud Console →
APIs & Services → Credentials → API key → Application restrictions → Websites**.
If the site address is missing there, Google answers with
`RefererNotAllowedMapError`; the app now skips a rejected key, remembers it per
origin and falls back to OpenStreetMap instead of replaying the error. Add the
pattern shown in the map panel (e.g. `http://localhost:3000/*`) and press
**Try again**.
