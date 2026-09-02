#!/usr/bin/env bash
# auto-deploy-poll.sh — Polls the git remote and auto-deploys on new commits.
#
# Runs periodically (via systemd timer or cron). On each run it fetches the
# remote, and if origin/main has moved ahead of the local HEAD, it pulls and
# triggers deploy.sh to rebuild + restart the services.
#
# Locking ensures a deploy already in progress is never re-triggered.
set -euo pipefail

PROJECT_DIR="/opt/Orange-Flow-Next-Js"
DEPLOY_LOG="/var/log/orangeflow/auto-deploy.log"
LOCK_FILE="/tmp/orangeflow-auto-deploy.lock"

# ── Helpers ────────────────────────────────────────────────────────────────
log() { echo "$(date '+%F %T')  $*" >> "$DEPLOY_LOG"; }

mkdir -p "$(dirname "$DEPLOY_LOG")"

# ── Single-instance lock (prevent overlapping runs) ────────────────────────
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "SKIP: another auto-deploy run is already in progress (or lock held by deploy.sh)."
  exit 0
fi

# ── Can we reach the remote at all? ────────────────────────────────────────
if ! git -C "$PROJECT_DIR" fetch --quiet origin main 2>/dev/null; then
  log "INFO: git fetch failed (network/offline?). Skipping this cycle."
  exit 0
fi

LOCAL_HEAD="$(git -C "$PROJECT_DIR" rev-parse HEAD)"
REMOTE_HEAD="$(git -C "$PROJECT_DIR" rev-parse FETCH_HEAD 2>/dev/null || echo '')"
LOCAL_BRANCH="$(git -C "$PROJECT_DIR" branch --show-current)"
LOCAL_STATUS="$(git -C "$PROJECT_DIR" status --porcelain | wc -l)"

if [ -z "$REMOTE_HEAD" ] || [ "$LOCAL_HEAD" = "$REMOTE_HEAD" ]; then
  log "INFO: no new commits (branch=$LOCAL_BRANCH, HEAD=${LOCAL_HEAD:0:8}, remote=${REMOTE_HEAD:0:8}, uncommitted_changes=$LOCAL_STATUS)."
  exit 0
fi

log "NEW COMMITS DETECTED: branch=$LOCAL_BRANCH local=${LOCAL_HEAD:0:8} -> remote=${REMOTE_HEAD:0:8}"
log "Starting auto-deploy (pull + build + restart)..."

# git pull + build + restart are handled by deploy.sh
DEPLOY_OUTPUT=$(mktemp)
if bash "$PROJECT_DIR/deploy.sh" >> "$DEPLOY_LOG" 2>&1; then
  NEW_HEAD="$(git -C "$PROJECT_DIR" rev-parse HEAD 2>/dev/null || echo 'unknown')"
  NEW_STATUS="$(git -C "$PROJECT_DIR" status --porcelain | wc -l)"
  log "AUTO-DEPLOY OK: now at ${NEW_HEAD:0:8} (was ${REMOTE_HEAD:0:8}), uncommitted_changes=$NEW_STATUS."
else
  EXIT_CODE=$?
  log "ERROR: deploy.sh failed (exit code: ${EXIT_CODE})."
  log "Check /tmp/orangeflow-deploy-status.json for details."
fi
rm -f "$DEPLOY_OUTPUT"

exit 0
