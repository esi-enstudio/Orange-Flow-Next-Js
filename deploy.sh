#!/usr/bin/env bash
# deploy.sh — One-command production deploy for Orange Flow
#
# Pulls latest code, rebuilds the frontend production bundle, and restarts
# both services. This is REQUIRED because `npm start` (next start) serves a
# pre-built copy (.next), NOT the live source — so a plain `git pull` alone
# will never show new changes.
#
# Usage:
#   ./deploy.sh            # pull + build + restart
#   ./deploy.sh --no-pull  # skip git pull (build local changes only)
#
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

FRONTEND_DIR="$PROJECT_DIR/frontend"
NODE_BIN="/root/.nvm/versions/node/v24.20.0/bin"
export PATH="$NODE_BIN:$PATH"

# Single-instance lock shared with auto-deploy-poll.sh, so a manual deploy and
# an auto-deploy never run at the same time. Blocks (waits) if another deploy
# is already running.
LOCK_FILE="/tmp/orangeflow-auto-deploy.lock"
exec 9>"$LOCK_FILE"
flock 9

PULL=true
if [ "${1:-}" = "--no-pull" ]; then
  PULL=false
  echo "==> Skipping git pull (--no-pull)"
fi

echo "========================================================================"
echo "  Orange Flow Deploy"
echo "  Project : $PROJECT_DIR"
echo "========================================================================"

# ── Step 1: Pull latest code ────────────────────────────────────────────────
if [ "$PULL" = true ]; then
  echo ""
  echo "==> [1/3] git pull"
  git pull --ff-only
  if [ $? -ne 0 ]; then
    echo "ERROR: git pull failed (could be local changes or conflicts)." >&2
    echo "       Resolve conflicts then re-run, or use --no-pull to skip." >&2
    exit 1
  fi
fi

# ── Step 2: Install deps (if package.json changed) + production build ──────
echo ""
echo "==> [2/3] Installing dependencies & building frontend"
cd "$FRONTEND_DIR"
npm install
echo "--> Building (this takes a few minutes)..."
npm run build

# ── Step 3: Restart services ───────────────────────────────────────────────
echo ""
echo "==> [3/3] Restarting services"
cd "$PROJECT_DIR"

# Frontend is a systemd service (runs `next start` -> serves the new build)
echo "--> Restarting frontend (systemd: orangeflow-frontend)"
systemctl restart orangeflow-frontend

# Backend runs in Docker
echo "--> Restarting backend (docker: orange_flow_backend)"
docker restart orange_flow_backend

echo ""
echo "==> Waiting for services to come up..."
sleep 10

# ── Verification ───────────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "  Deploy complete. Status:"
echo "============================================================"
orangeflow status

echo ""
echo "  Frontend reachable check:"
if curl -sf -o /dev/null --max-time 10 http://localhost:3000; then
  echo "    Frontend  : http://localhost:3000  → OK"
else
  echo "    Frontend  : http://localhost:3000  → NOT responding (check logs: orangeflow logs)"
fi
