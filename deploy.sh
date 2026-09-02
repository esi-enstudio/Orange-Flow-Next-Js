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

STATUS_FILE="/tmp/orangeflow-deploy-status.json"

write_status() {
  local state="$1" exit_code="${2:-0}" message="${3:-}"
  cat > "$STATUS_FILE" <<EOF
{"state":"${state}","exit_code":${exit_code},"message":"${message}","timestamp":"$(date -Iseconds)"}
EOF
}

# Write initial status
write_status "running" 0 "Deploy started"

# Cleanup trap — write status on unexpected exit
trap 'write_status "failed" $? "Deploy interrupted"' EXIT

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
  if ! git pull --ff-only; then
    echo "ERROR: git pull failed (could be local changes or conflicts)." >&2
    echo "       Resolve conflicts then re-run, or use --no-pull to skip." >&2
    write_status "failed" 1 "git pull failed"
    exit 1
  fi
  echo "==> git pull successful"
fi

# ── Step 2: Install deps + production build ────────────────────────────────
echo ""
echo "==> [2/3] Installing dependencies & building frontend"
cd "$FRONTEND_DIR"

echo "==> Running npm install..."
if ! npm install; then
  echo "ERROR: npm install failed." >&2
  write_status "failed" 2 "npm install failed"
  exit 2
fi

echo "==> Building (this takes a few minutes)..."
if ! npm run build; then
  echo "ERROR: npm run build failed." >&2
  write_status "failed" 3 "npm run build failed"
  exit 3
fi

echo "==> Frontend build successful"

# ── Step 3: Restart services ───────────────────────────────────────────────
echo ""
echo "==> [3/3] Restarting services"
cd "$PROJECT_DIR"

# Frontend is a systemd service (runs `next start` -> serves the new build)
echo "--> Restarting frontend (systemd: orangeflow-frontend)"
if ! systemctl restart orangeflow-frontend; then
  echo "ERROR: Failed to restart frontend service." >&2
  write_status "failed" 4 "Frontend restart failed"
  exit 4
fi

# Backend runs in Docker
echo "--> Restarting backend (docker: orange_flow_backend)"
if ! docker restart orange_flow_backend; then
  echo "ERROR: Failed to restart backend container." >&2
  write_status "failed" 5 "Backend restart failed"
  exit 5
fi

echo ""
echo "==> Waiting for services to come up..."
sleep 10

# ── Verification ───────────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "  Deploy complete. Status:"
echo "============================================================"
if command -v orangeflow &>/dev/null; then
  orangeflow status
fi

echo ""
echo "  Service checks:"
FRONTEND_OK=false
BACKEND_OK=false

if curl -sf -o /dev/null --max-time 10 http://localhost:3000; then
  echo "    Frontend  : http://localhost:3000  -> OK"
  FRONTEND_OK=true
else
  echo "    Frontend  : http://localhost:3000  -> NOT responding"
fi

if curl -sf -o /dev/null --max-time 10 http://localhost:8000/docs; then
  echo "    Backend   : http://localhost:8000  -> OK"
  BACKEND_OK=true
else
  echo "    Backend   : http://localhost:8000  -> NOT responding"
fi

# Remove trap — we completed successfully
trap - EXIT

if [ "$FRONTEND_OK" = true ] && [ "$BACKEND_OK" = true ]; then
  write_status "completed" 0 "Deploy successful — all services healthy"
  echo ""
  echo "  RESULT: Deploy SUCCESS"
else
  write_status "completed" 0 "Deploy finished with warnings — some services may not be responding"
  echo ""
  echo "  RESULT: Deploy completed with warnings (check services above)"
fi
