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

# Status/log shared with the backend container via the backend bind mount
BACKEND_DIR="$PROJECT_DIR/backend"
DEPLOY_DIR="$BACKEND_DIR/.deploy"
STATUS_FILE="$DEPLOY_DIR/status.json"

LAST_STATUS_STATE="none"
write_status() {
  local state="$1" exit_code="${2:-0}" message="${3:-}"
  cat > "$STATUS_FILE" <<EOF
{"state":"${state}","exit_code":${exit_code},"message":"${message}","timestamp":"$(date -Iseconds)"}
EOF
  LAST_STATUS_STATE="$state"
}

# Write initial status
write_status "running" 0 "Deploy started"

# Cleanup trap — only fills in a generic failure if the script was still
# "running". Every explicit `write_status "failed" ...` before an exit carries a
# specific, actionable reason ("git pull failed", "restore point capture
# failed", ...); without this guard the trap overwrote all of them with
# "Deploy interrupted" and no deploy failure could be diagnosed.
trap 'if [ "$LAST_STATUS_STATE" = "running" ]; then write_status "failed" $? "Deploy interrupted"; fi' EXIT

# Single-instance lock, so two deploys can never run at the same time. Blocks
# (waits) if one is already running. The filename is kept as-is: an older
# deploy-service still passing this path must keep excluding itself rather than
# racing a new deploy.
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

# ── Step 0: Capture a restore point ─────────────────────────────────────────
# This script is the entry point for deploy-worker.sh, which runs it when a
# super admin triggers a deploy from the deploy UI. deploy-service's own
# deploy.sh captures too, so both deploy paths record a restore point. There is
# no auto-deploy any more — this only ever runs on a human trigger.
#
# Must run BEFORE the git pull: the point of a snapshot is to record the state
# that is about to be replaced.
#
# Set SKIP_RESTORE_POINT=1 to bypass (e.g. a hotfix deploy that must not be
# blocked by a failing database).
echo ""
echo "==> [0/4] Capturing a restore point of the current state"

SNAPSHOT_SCRIPT="$PROJECT_DIR/deploy-service/snapshot.sh"
if [ "${SKIP_RESTORE_POINT:-0}" = "1" ]; then
  echo "    SKIPPED (SKIP_RESTORE_POINT=1)"
elif [ ! -f "$SNAPSHOT_SCRIPT" ]; then
  echo "    snapshot.sh not found at $SNAPSHOT_SCRIPT — skipping" >&2
elif PROJECT_DIR="$PROJECT_DIR" bash "$SNAPSHOT_SCRIPT" \
      "Before deploy at $(date -Iseconds)" manual; then
  echo "==> Restore point captured"
else
  # Aborting here is deliberate. A deploy with no way back is exactly the
  # failure mode restore points exist to prevent, and a database that cannot be
  # dumped would very likely break the deploy too. Nothing has changed yet.
  echo "ERROR: Could not capture a restore point before deploying." >&2
  echo "       Nothing has been changed yet, so the running system is still intact." >&2
  echo "       Fix the cause, or re-run with SKIP_RESTORE_POINT=1 to deploy anyway." >&2
  write_status "failed" 1 "restore point capture failed"
  exit 1
fi

# Snapshot the files that require a backend image rebuild. Python packages and
# apt dependencies are baked into the image, while backend source is bind-mounted
# — so changing requirements.txt without rebuilding leaves the app crash-looping
# on a missing module.
PRE_PULL_DOCKERFILE_MD5=$(md5sum "$PROJECT_DIR/backend/Dockerfile" 2>/dev/null | awk '{print $1}')
PRE_PULL_COMPOSE_MD5=$(md5sum "$PROJECT_DIR/docker-compose.yml" 2>/dev/null | awk '{print $1}')
PRE_PULL_REQS_MD5=$(md5sum "$PROJECT_DIR/backend/requirements.txt" 2>/dev/null | awk '{print $1}')
NEED_BACKEND_REBUILD=false

# ── Step 1: Pull latest code ────────────────────────────────────────────────
if [ "$PULL" = true ]; then
  echo ""
  echo "==> [1/4] git pull"
  # Fetch + explicit single-branch merge (see deploy-service/deploy.sh for why).
  if ! git fetch --prune origin main; then
    echo "ERROR: git fetch failed (network or auth problem)." >&2
    echo "       Resolve network issues then re-run, or use --no-pull to skip." >&2
    write_status "failed" 1 "git fetch failed"
    exit 1
  fi
  if ! git merge --ff-only origin/main; then
    echo "ERROR: git pull failed (local changes or conflicts)." >&2
    echo "       Resolve conflicts then re-run, or use --no-pull to skip." >&2
    write_status "failed" 1 "git pull failed"
    exit 1
  fi
  echo "==> git pull successful"
fi

# Rebuild the backend image only when an input to that image changed. A plain
# `docker restart` reuses the old image and cannot pick up new Python packages.
POST_PULL_DOCKERFILE_MD5=$(md5sum "$PROJECT_DIR/backend/Dockerfile" 2>/dev/null | awk '{print $1}')
POST_PULL_COMPOSE_MD5=$(md5sum "$PROJECT_DIR/docker-compose.yml" 2>/dev/null | awk '{print $1}')
POST_PULL_REQS_MD5=$(md5sum "$PROJECT_DIR/backend/requirements.txt" 2>/dev/null | awk '{print $1}')

if [ -n "${PRE_PULL_DOCKERFILE_MD5:-}" ] && [ "$PRE_PULL_DOCKERFILE_MD5" != "${POST_PULL_DOCKERFILE_MD5:-}" ]; then
  echo "    Dockerfile changed — backend image rebuild required"
  NEED_BACKEND_REBUILD=true
fi
if [ -n "${PRE_PULL_COMPOSE_MD5:-}" ] && [ "$PRE_PULL_COMPOSE_MD5" != "${POST_PULL_COMPOSE_MD5:-}" ]; then
  echo "    docker-compose.yml changed — backend image rebuild required"
  NEED_BACKEND_REBUILD=true
fi
if [ -n "${PRE_PULL_REQS_MD5:-}" ] && [ "$PRE_PULL_REQS_MD5" != "${POST_PULL_REQS_MD5:-}" ]; then
  echo "    backend/requirements.txt changed — backend image rebuild required"
  NEED_BACKEND_REBUILD=true
fi

# ── Step 2: Install deps + production build ────────────────────────────────
echo ""
echo "==> [2/4] Installing dependencies & building frontend"
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
echo "==> [3/4] Restarting services"
cd "$PROJECT_DIR"

# Requirement: every deploy must FULLY restart every running container EXCEPT
# the WhatsApp gateway. Restarting WhatsApp drops the paired session and forces
# a QR re-scan, so it is deliberately kept alive across deploys.
#
# The generic loop below restarts db, redis and any other running container.
# frontend / backend are skipped here and handled explicitly underneath so the
# rebuild-aware restart logic still applies to them.
echo "--> Restarting all containers except WhatsApp (db, redis, ...)"
for name in $(docker ps --format '{{.Names}}'); do
  case "$name" in
    *whatsapp*|*wa_gateway*|*wa-gateway*)
      echo "    KEEP ALIVE (WhatsApp session): $name"
      continue ;;
    orange_flow_frontend|orange_flow_frontend_dev|orange_flow_backend)
      continue ;;
  esac
  echo "--> Restarting $name"
  if docker restart "$name" >/dev/null 2>&1; then
    echo "==> $name restarted"
  else
    echo "WARNING: Failed to restart $name" >&2
  fi
done

# A restarted Postgres needs a moment to accept connections before the backend
# comes back up, otherwise the backend can boot into connection errors.
for _ in $(seq 1 30); do
  DB_HEALTH=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' orange_flow_db 2>/dev/null || echo none)
  [ "$DB_HEALTH" = "healthy" ] && break
  sleep 1
done

# Frontend runs as the `orange_flow_frontend` docker container (the host
# systemd unit `orangeflow-frontend` is disabled — it raced the container for
# port 3000 and crash-looped with EADDRINUSE).
echo "--> Restarting frontend (docker: orange_flow_frontend)"
if ! docker restart orange_flow_frontend; then
  echo "ERROR: Failed to restart frontend container." >&2
  write_status "failed" 4 "Frontend restart failed"
  exit 4
fi

# Backend runs in Docker. Rebuild the image when its inputs changed; otherwise a
# fast restart is enough.
echo "--> Restarting backend (docker: orange_flow_backend)"
if [ "$NEED_BACKEND_REBUILD" = true ]; then
  echo "    Rebuilding backend image (Dockerfile, docker-compose.yml or requirements.txt changed)..."
  if ! docker compose -f "$PROJECT_DIR/docker-compose.yml" build backend; then
    echo "ERROR: Backend image rebuild failed." >&2
    write_status "failed" 5 "Backend image rebuild failed"
    exit 5
  fi
  if ! docker compose -f "$PROJECT_DIR/docker-compose.yml" up -d --no-deps backend; then
    echo "ERROR: Failed to recreate backend container with the new image." >&2
    write_status "failed" 5 "Backend container recreate failed"
    exit 5
  fi
  echo "==> Backend recreated with the new image"
elif ! docker restart orange_flow_backend; then
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
  # A non-zero exit here must not abort the deploy: the service checks below are
  # authoritative, and a stale systemd unit reporting "inactive" is expected.
  orangeflow status || true
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
