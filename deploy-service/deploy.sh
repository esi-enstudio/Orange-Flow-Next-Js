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

# Run a command in the REAL host namespace.
#
# IMPORTANT: `nsenter -t 1` run directly in this container targets the
# CONTAINER'S OWN PID 1 (its mount namespace), so it only sees the container
# filesystem — NOT the host. It can never see /opt/Orange-Flow-Next-Js or the
# host's systemd services.
#
# The reliable way to reach the host is via the mounted docker socket: spawn a
# throwaway container with `--pid=host --privileged` and nsenter host PID 1
# from there. This gives real access to host systemd/systemctl.
host() {
  docker run --rm --pid=host --privileged --net=none \
    --entrypoint nsenter alpine -t 1 -m -u -i -n -- "$@"
}

# Same as host() but for the systemd `systemctl` subcommand specifically.
host_systemctl() {
  host systemctl "$@"
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

# Snapshot THIS script's md5 BEFORE pulling, so we can detect if git pull
# delivers a newer version of deploy.sh itself (see self-restart below).
PULL_SCRIPT="$PROJECT_DIR/deploy-service/deploy.sh"
PRE_PULL_MD5=$(md5sum "$PULL_SCRIPT" 2>/dev/null | awk '{print $1}')
PRE_PULL_DOCKERFILE_MD5=$(md5sum "$PROJECT_DIR/backend/Dockerfile" 2>/dev/null | awk '{print $1}')
PRE_PULL_COMPOSE_MD5=$(md5sum "$PROJECT_DIR/docker-compose.yml" 2>/dev/null | awk '{print $1}')

# Fetch + explicit single-branch merge. Plain `git pull --ff-only` derives its
# merge heads from FETCH_HEAD, which races with the background workers also
# running `git fetch` on this repo (host auto-deploy / commit-refresh /
# server.js startup). That race can produce "fatal: Cannot fast-forward to
# multiple branches." Merging an explicit ref avoids the ambiguity entirely.
if ! git fetch --prune origin main; then
  echo "ERROR: git fetch failed (network or auth problem)." >&2
  write_status "failed" 1 "git fetch failed"
  echo "[DEPLOY_FAILED:git_pull_failed]"
  exit 1
fi
if ! git merge --ff-only origin/main; then
  echo "ERROR: git pull failed (local changes conflict with origin/main)." >&2
  write_status "failed" 1 "git pull failed"
  echo "[DEPLOY_FAILED:git_pull_failed]"
  exit 1
fi
echo "==> git pull successful"

# ── Self-restart after pull if THIS script changed ─────────────────────────
# The currently executing deploy.sh is loaded at start; if git pull just
# delivered a NEWER deploy.sh (e.g. a bugfix like `npm install --include=dev`),
# this stale in-memory copy would keep running the OLD flow and the fix would
# never take effect. Restart with the freshly-pulled script instead.
POST_PULL_MD5=$(md5sum "$PULL_SCRIPT" 2>/dev/null | awk '{print $1}')
if [ -n "$PRE_PULL_MD5" ] && [ -n "$POST_PULL_MD5" ] && [ "$PRE_PULL_MD5" != "$POST_PULL_MD5" ]; then
  echo "==> deploy.sh changed during pull — restarting with the updated script"
  # `exec 9>` above is re-run in the new process; opening the lock file again
  # closes the inherited fd and re-acquires the flock cleanly.
  exec bash "$PULL_SCRIPT"
fi

# ── Step 2 & 3: Install deps + Build frontend (on HOST via nsenter) ────────
# Build MUST run in the host namespace so it uses the same Node.js version
# (v24) and OS (glibc) as the production `next start` service. Running inside
# this Alpine/musl container (Node 22) causes native module issues (sharp,
# playwright) and build hangs.
HOST_NODE_BIN="/root/.nvm/versions/node/v24.20.0/bin"
HOST_FRONTEND_DIR="$HOST_PROJECT_DIR/frontend"
host_build() {
  host env "PATH=$HOST_NODE_BIN:/usr/local/bin:/usr/bin:/bin" "NODE_ENV=production" \
    bash -c "cd '$HOST_FRONTEND_DIR' && $*"
}

echo ""
echo "[DEPLOY_STEP:installing]"
echo "==> [2/4] Installing frontend dependencies"
echo "    (running in HOST namespace with Node v24)"

# NOTE: NODE_ENV=production (set below for EVERY host command) makes plain
# `npm install` SKIP devDependencies. Next.js production builds still need
# build-time tooling from devDependencies (tailwindcss, @tailwindcss/postcss,
# typescript, etc.) — omitting them breaks `next build` with
# "Cannot find module '@tailwindcss/postcss'". Pass `--include=dev` so
# devDependencies are ALWAYS installed, regardless of NODE_ENV.
if ! host_build "npm install --include=dev"; then
  echo "ERROR: npm install failed." >&2
  write_status "failed" 2 "npm install failed"
  echo "[DEPLOY_FAILED:npm_install_failed]"
  exit 2
fi
echo "==> npm install successful"

echo ""
echo "[DEPLOY_STEP:building]"
echo "==> [3/4] Building frontend (production)"

if ! host_build npm run build; then
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
if host_systemctl restart orangeflow-frontend; then
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
FIS=$(host_systemctl show orangeflow-frontend -p ActiveEnterTimestamp --value 2>/dev/null || echo "")
echo "    Frontend service ActiveEnterTimestamp: ${FIS:-unknown}"
case "$FIS" in
  ""|"unknown") echo "WARNING: Could not confirm frontend restart timestamp" >&2 ;;
  *) echo "    (built/build completed at START_TIME=$START_TIME seq)" ;;
esac

# ── Backend: rebuild image if Dockerfile/docker-compose changed ──────────────
# `docker restart` only restarts the existing container — it does NOT pick up
# Dockerfile changes (e.g. adding apt packages). We snapshot the md5 of
# Dockerfile and docker-compose.yml BEFORE git pull, compare AFTER, and rebuild
# only when they actually changed. This keeps fast-path restarts fast (~1s)
# while ensuring infra changes are applied.
NEED_BACKEND_REBUILD=false
POST_PULL_DOCKERFILE_MD5=$(md5sum "$PROJECT_DIR/backend/Dockerfile" 2>/dev/null | awk '{print $1}')
POST_PULL_COMPOSE_MD5=$(md5sum "$PROJECT_DIR/docker-compose.yml" 2>/dev/null | awk '{print $1}')

if [ -n "${PRE_PULL_DOCKERFILE_MD5:-}" ] && [ "$PRE_PULL_DOCKERFILE_MD5" != "${POST_PULL_DOCKERFILE_MD5:-}" ]; then
  echo "    Dockerfile changed — backend image rebuild required"
  NEED_BACKEND_REBUILD=true
fi
if [ -n "${PRE_PULL_COMPOSE_MD5:-}" ] && [ "$PRE_PULL_COMPOSE_MD5" != "${POST_PULL_COMPOSE_MD5:-}" ]; then
  echo "    docker-compose.yml changed — backend image rebuild required"
  NEED_BACKEND_REBUILD=true
fi

echo "--> Restarting backend (docker: orange_flow_backend)"
if [ "$NEED_BACKEND_REBUILD" = true ]; then
  echo "    Rebuilding backend image (Dockerfile or docker-compose.yml changed)..."
  if docker compose -f "$PROJECT_DIR/docker-compose.yml" build backend; then
    echo "    Backend image rebuilt successfully"
  else
    echo "ERROR: Backend image rebuild failed" >&2
    write_status "failed" 5 "backend image rebuild failed"
    echo "[DEPLOY_FAILED:backend_build_failed]"
    exit 5
  fi
fi

if docker restart orange_flow_backend; then
  echo "==> Backend restarted"
else
  echo "WARNING: Failed to restart backend container"
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
  # Container reaches the host's frontend via host.docker.internal (host-gateway).
  body=$(curl -sf --max-time 10 "http://host.docker.internal:3000/login" 2>/dev/null || \
        curl -sf --max-time 10 "http://172.17.0.1:3000/login" 2>/dev/null) || return 1
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
   curl -sf -o /dev/null --max-time 10 http://172.17.0.1:8000/docs 2>/dev/null; then
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
