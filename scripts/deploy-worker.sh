#!/usr/bin/env bash
# deploy-worker.sh — Fast (every 30s) host worker for the manual-deploy UI.
#
# Two responsibilities:
#   1. Refresh ./backend/.deploy/commits.json with how many commits are behind
#      origin/main and their commit messages (so the UI badge + confirm modal
#      have fresh data). The backend container reads this file (shared bind mount).
#   2. Watch for a "deploy-trigger" file. When present, run deploy.sh and stream
#      its output to ./backend/.deploy/deploy.log + write status to status.json.
#
# This is separate from auto-deploy-poll.sh (which auto-pulls every 5 min).
set -euo pipefail

PROJECT_DIR="/opt/Orange-Flow-Next-Js"
BACKEND_DIR="$PROJECT_DIR/backend"
DEPLOY_DIR="$BACKEND_DIR/.deploy"
COMMITS_FILE="$DEPLOY_DIR/commits.json"
STATUS_FILE="$DEPLOY_DIR/status.json"
LOG_FILE="$DEPLOY_DIR/deploy.log"
TRIGGER_FILE="$DEPLOY_DIR/deploy-trigger"
LOCK_FILE="/tmp/orangeflow-deploy-worker.lock"
DEPLOY_LOG="/var/log/orangeflow/deploy-worker.log"

mkdir -p "$DEPLOY_DIR"
log() { echo "$(date '+%F %T')  $*" >> "$DEPLOY_LOG"; }

# prevent overlapping runs
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  exit 0
fi

write_status() {
  local state="$1" exit_code="${2:-null}" message="${3:-}" extra="${4:-}"
  cat > "$STATUS_FILE" <<EOF
{"state":"${state}","exit_code":${exit_code},"message":"${message}","last_updated":"$(date -Iseconds)"${extra}}
EOF
}

emit_commits() {
  # local/remote head and pending commit messages since origin/main
  local local_head remote_head count
  if ! git -C "$PROJECT_DIR" fetch --quiet origin main 2>/dev/null; then
    write_status "idle" null "git fetch failed (network/offline?)"
    return
  fi

  local_head="$(git -C "$PROJECT_DIR" rev-parse HEAD 2>/dev/null || echo '')"
  remote_head="$(git -C "$PROJECT_DIR" rev-parse FETCH_HEAD 2>/dev/null || echo '')"

  if [ -z "$remote_head" ] || [ "$local_head" = "$remote_head" ]; then
    count=0
  else
    count="$(git -C "$PROJECT_DIR" rev-list --count "${local_head}..${remote_head}" 2>/dev/null || echo 0)"
  fi

  # commit messages
  local messages="[]"
  if [ "$count" -gt 0 ]; then
    messages="$(git -C "$PROJECT_DIR" log --no-merges --pretty=format:'{"hash":"%h","subject":"%s"}' "${local_head}..${remote_head}" 2>/dev/null | awk 'BEGIN{printf "["} {if(NR>1)printf ","; printf "%s",$0} END{printf "]"}')"
    if [ -z "$messages" ] || [ "$messages" = "[]" ]; then
      # fallback include merges if no non-merge commits
      messages="$(git -C "$PROJECT_DIR" log --merges --pretty=format:'{"hash":"%h","subject":"%s"}' "${local_head}..${remote_head}" 2>/dev/null | awk 'BEGIN{printf "["} {if(NR>1)printf ","; printf "%s",$0} END{printf "]"}')"
    fi
  fi

  cat > "$COMMITS_FILE" <<EOF
{"local_head":"${local_head}","remote_head":"${remote_head}","count":${count},"commits":${messages}}
EOF
  write_status "idle" null "ok"
}

# ── Handle manual trigger ────────────────────────────────────────────────
if [ -f "$TRIGGER_FILE" ]; then
  rm -f "$TRIGGER_FILE"
  log "MANUAL DEPLOY triggered via UI"
  echo "" > "$LOG_FILE"
  write_status "running" null "Deploy started"
  if bash "$PROJECT_DIR/deploy.sh" >> "$LOG_FILE" 2>&1; then
    write_status "completed" 0 "Deploy successful"
    log "MANUAL DEPLOY OK"
  else
    local ec=$?
    write_status "failed" "$ec" "Deploy failed (exit $ec)"
    log "MANUAL DEPLOY FAILED (exit $ec)"
  fi
  exit 0
fi

# ── Otherwise just refresh commit info ───────────────────────────────────
emit_commits
exit 0
