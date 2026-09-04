#!/usr/bin/env bash
# deploy.sh — Deployment script run inside the deploy-service container.
#
# The container has:
#   - docker socket  -> restart backend container
#   - nsenter        -> run commands in the HOST namespace (systemd, host node/npm)
#   - /project mount -> host project dir at /opt/Orange-Flow-Next-Js
#
# Emits step markers that server.js parses for real-time progress:
#   [DEPLOY_STEP:<step_name>]
#   [DEPLOY_COMPLETE]
#   [DEPLOY_FAILED:<reason>]
#
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/project}"            # path inside container
HOST_PROJECT_DIR="${HOST_PROJECT_DIR:-/opt/Orange-Flow-Next-Js}"  # path on host (same mount)
STATE_DIR="${DEPLOY_STATE_DIR:-/app/state}"

STATUS_FILE="$STATE_DIR/status.json"
LOCK_FILE="$STATE_DIR/deploy.lock"
START_TIME=$(date +%s)

# Run a command in the HOST namespace (uses host's node, systemd, tools).
# Falls back to running directly if nsenter is unavailable.
host() {
  if nsenter -t 1 -m -u -i -n -- true 2>/dev/null; then
    nsenter -t 1 -m -u -i -n -- "$@"
  else
    "$@"
  fi
}

write_status() {
  local state="$1" exit_code="${2:-0}" message="${3:-}"
  cat > "$STATUS_FILE" <<EOF
{"state":"${state}","exit_code":${exit_code},"message":"${message}","timestamp":"$(date -Iseconds)"}
EOF
}

elapsed() {
  local now=$(date +%s)
  local diff=$((now - START_TIME))
  local min=$((diff / 60))
  local sec=$((diff % 60))
  if [ "$min" -gt 0 ]; then
    echo "${min}m ${sec}s"
  else
    echo "${sec}s"
  fi
}

# Single-instance lock
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[DEPLOY_FAILED:another_deploy_in_progress]"
  exit 1
fi

# Cleanup trap
trap 'write_status "failed" $? "Deploy interrupted"; echo "[DEPLOY_FAILED: interrupted]" >&2' EXIT

write_status "running" 0 "Deploy started"
echo "========================================================================"
echo "  Orange Flow Deploy (via deploy-service container)"
echo "  Host project : $HOST_PROJECT_DIR"
echo "  Started      : $(date)"
echo "========================================================================"

# ── Step 1: Pull latest code ────────────────────────────────────────────────
echo ""
echo "[DEPLOY_STEP:pulling]"
echo "==> [1/4] Pulling latest code"
cd "$PROJECT_DIR"

if ! git pull --ff-only; then
  echo "ERROR: git pull failed (could be local changes or conflicts)." >&2
  write_status "failed" 1 "git pull failed"
  echo "[DEPLOY_FAILED:git_pull_failed]"
  exit 1
fi
echo "==> git pull successful"

# ── Step 2 & 3: Install deps + Build frontend (on HOST) ─────────────────────
echo ""
echo "[DEPLOY_STEP:installing]"
echo "==> [2/4] Installing frontend dependencies (host)"

FRONTEND_ON_HOST="$HOST_PROJECT_DIR/frontend"

# Source nvm if present so the host's correct node/npm is used.
NVM_INIT=""
for c in /root/.nvm/nvm.sh /root/.nvm/node/nvm.sh; do
  if [ -f "$c" ]; then
    NVM_INIT="source '$c' && nvm use default && "
    break
  fi
done

if ! host bash -lc "${NVM_INIT}cd '$FRONTEND_ON_HOST' && npm install"; then
  echo "ERROR: npm install failed." >&2
  write_status "failed" 2 "npm install failed"
  echo "[DEPLOY_FAILED:npm_install_failed]"
  exit 2
fi
echo "==> npm install successful"

echo ""
echo "[DEPLOY_STEP:building]"
echo "==> [3/4] Building frontend (production, host)"

if ! host bash -lc "${NVM_INIT}cd '$FRONTEND_ON_HOST' && npm run build"; then
  echo "ERROR: npm run build failed." >&2
  write_status "failed" 3 "npm run build failed"
  echo "[DEPLOY_FAILED:build_failed]"
  exit 3
fi
echo "==> Frontend build successful"

# ── Step 4: Restart services ────────────────────────────────────────────────
echo ""
echo "[DEPLOY_STEP:restarting]"
echo "==> [4/4] Restarting services"

echo "--> Restarting frontend (systemd: orangeflow-frontend)"
# IMPORTANT: The frontend MUST be restarted after a rebuild so `next start`
# loads the freshly built .next. An old `next start` process kept running
# against an overwritten .next serves mismatched client/server chunks and
# renders BLANK pages. A failed restart is NOT acceptable here.
if host systemctl restart orangeflow-frontend; then
  echo "==> Frontend restarted"
else
  echo "ERROR: Could not restart frontend service via systemctl. The old " >&2
  echo "       next start process would keep serving a stale/mismatched build" >&2
  echo "       and render blank pages. Aborting deploy." >&2
  write_status "failed" 4 "frontend restart failed"
  echo "[DEPLOY_FAILED:frontend_restart_failed]" >&2
  exit 4
fi

# Verify the running `next start` process actually restarted after the build.
FIS=$(host systemctl show orangeflow-frontend -p ActiveEnterTimestamp --value 2>/dev/null || echo "")
echo "    Frontend service ActiveEnterTimestamp: ${FIS:-unknown}"
case "$FIS" in
  ""|"unknown") echo "WARNING: Could not confirm frontend restart timestamp" >&2 ;;
  *) echo "    (built/build completed at START_TIME=$START_TIME seq)" ;;
esac

echo "--> Restarting backend (docker: orange_flow_backend)"
if docker restart orange_flow_backend; then
  echo "==> Backend restarted"
else
  echo "WARNING: Failed to restart backend container" >&2
fi

# ── Step 5: Verify ──────────────────────────────────────────────────────────
echo ""
echo "[DEPLOY_STEP:verifying]"
echo "==> Waiting for services to come up..."
sleep 10

FRONTEND_OK=false
BACKEND_OK=false

# Frontend must not only return HTTP 200 but actually stream a rendered shell.
# A stale/mismatched `next start` (build rebuilt without a service restart)
# returns 200 but serves an empty/blank page, which is exactly the bug we must
# catch.
frontend_shell_ok() {
  local body
  body=$(curl -sf --max-time 10 "http://localhost:3000/login" 2>/dev/null || \
        host curl -sf --max-time 10 "http://localhost:3000/login" 2>/dev/null || \
        curl -sf --max-time 10 "http://127.0.0.1:3000/login" 2>/dev/null) || return 1
  # Next.js always renders <body ...> ...; an empty/mismatched build has a bare head.
  echo "$body" | grep -q "<body" && echo "$body" | grep -qi "class="
}

if frontend_shell_ok; then
  echo "    Frontend  : http://localhost:3000  -> OK (shell rendered)"
  FRONTEND_OK=true
else
  echo "    Frontend  : http://localhost:3000  -> responding but EMPTY/BLANK (stale build!)" >&2
  FRONTEND_OK=false
fi

if curl -sf -o /dev/null --max-time 10 http://host.docker.internal:8000/docs 2>/dev/null || \
   curl -sf -o /dev/null --max-time 10 http://172.17.0.1:8000/docs 2>/dev/null || \
   host curl -sf -o /dev/null --max-time 10 http://localhost:8000/docs 2>/dev/null; then
  echo "    Backend   : http://localhost:8000  -> OK"
  BACKEND_OK=true
else
  echo "    Backend   : http://localhost:8000  -> NOT responding"
fi

# Remove trap — we completed successfully
trap - EXIT

DURATION=$(elapsed)

if [ "$FRONTEND_OK" = true ] && [ "$BACKEND_OK" = true ]; then
  write_status "completed" 0 "Deploy successful — all services healthy"
  echo ""
  echo "  RESULT: Deploy SUCCESS (duration: $DURATION)"
  echo "[DEPLOY_COMPLETE]"
elif [ "$FRONTEND_OK" = false ]; then
  # Blank/stale frontend is a hard failure — pages render empty to users.
  write_status "failed" 1 "Deploy failed — frontend is serving a blank/stale build. Restart needed."
  echo ""
  echo "  RESULT: Deploy FAILED — frontend serving blank/stale build" >&2
  echo "  Fix    : run 'systemctl restart orangeflow-frontend' and redeploy." >&2
  echo "[DEPLOY_FAILED:frontend_blank_after_deploy]"
  exit 1
else
  write_status "completed" 0 "Deploy finished with warnings — some services may not be responding"
  echo ""
  echo "  RESULT: Deploy completed with warnings (duration: $DURATION)"
  echo "[DEPLOY_COMPLETE]"
fi
