# OrangeFlow Telegram Mini App (TMA) Setup

This project now includes a modern **Next.js** frontend and a **FastAPI** backend.

## 1. Backend (Python API)
This is needed to supply data from your existing database.

**Command to run:**
```bash
python api_main.py
```
It will run at `http://localhost:8000`.

## 2. Frontend (Next.js)
This is the interface for your Telegram Mini App.

**Command to run:**
```bash
cd frontend
npm run dev
```
It will run at `http://localhost:3000`.

## 3. Connecting to Telegram
To add this Mini App to your Telegram bot:
1. Go to **BotFather**.
2. Select your bot and create a `Menu Button` or a button.
3. Enter your frontend URL as the URL. (Use **ngrok** for local testing).

### Local Testing with Ngrok:
```bash
ngrok http 3000
```
Then set the `https` URL provided by ngrok in BotFather.

---
**Technical Details:**
- **Framework:** Next.js 15 (App Router)
- **Styling:** Tailwind CSS (Telegram Theme Integrated)
- **SDK:** @twa-dev/sdk
- **Backend:** FastAPI
