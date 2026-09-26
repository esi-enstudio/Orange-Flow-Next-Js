#!/usr/bin/env bash
# snapshot.sh — Create a Restore Point (code + database + config snapshot).
#
# Runs inside the deploy-service container, which is the only process that can
# see all three pieces at once:
#   - /project            -> the host repo (bind mount)  => git state
#   - docker socket       -> the Postgres container     => database dump
#   - $PROJECT_DIR/.env   -> DB credentials (env_file)  => pg_dump/pg_restore
#
# Output layout (on a host bind mount shared with the backend container):
#   backend/backups/restore_points/<snapshot_id>/
#     manifest.json      metadata the UI reads (git state, sizes, file list)
#     database.dump      PostgreSQL custom-format dump
#     config/<relpath>   copies of git-ignored .env files
#
# The snapshot dir is git-ignored (see .gitignore `backend/backups/*`), so it
# never pollutes `git status` and survives `git reset --hard`.
#
# Emits the same step markers the deploy service parses for live progress:
#   [SNAPSHOT_STEP:<name>] / [SNAPSHOT_COMPLETE] / [SNAPSHOT_FAILED:<reason>]
#
# Usage: snapshot.sh [label] [trigger_source]
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/project}"
SNAPSHOT_ROOT="$PROJECT_DIR/backend/backups/restore_points"
LABEL="${1:-}"
TRIGGER_SOURCE="${2:-manual}"
KEEP="${RESTORE_POINT_KEEP:-10}"

DB_CONTAINER="${DB_CONTAINER:-orange_flow_db}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-orange_flow_dev_db}"

TS="$(date +%Y%m%d_%H%M%S)"

SNAP_DIR=""

# Remove a half-written snapshot directory on failure. Without this a failed
# run leaves an empty directory that later shows up in the UI as an
# "incomplete" restore point the user cannot roll back to.
fail() {
  echo "[SNAPSHOT_FAILED:${1}]" >&2
  if [ -n "$SNAP_DIR" ] && [ -d "$SNAP_DIR" ] && [ ! -f "$SNAP_DIR/manifest.json" ]; then
    rm -rf "$SNAP_DIR"
    echo "(removed incomplete snapshot $SNAP_DIR)" >&2
  fi
  exit 1
}

run_git() { git -C "$PROJECT_DIR" "$@"; }

# ── Step 1: read git state ──────────────────────────────────────────────────
echo "[SNAPSHOT_STEP:capturing]"
echo "==> [1/4] Capturing git state"

GIT_SHA="$(run_git rev-parse HEAD 2>/dev/null || true)"
[ -n "$GIT_SHA" ] || fail "cannot_read_git_head"
GIT_SHORT_SHA="$(run_git rev-parse --short HEAD 2>/dev/null || echo "${GIT_SHA:0:8}")"
GIT_BRANCH="$(run_git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
GIT_SUBJECT="$(run_git log -1 --pretty=format:%s 2>/dev/null || echo '')"
# `--porcelain` counts untracked files too. Restore point artifacts are
# git-ignored, so they never inflate this number.
GIT_DIRTY="$(run_git status --porcelain 2>/dev/null | grep -c . || true)"

SNAPSHOT_ID="${TS}-${GIT_SHORT_SHA}"
SNAP_DIR="$SNAPSHOT_ROOT/$SNAPSHOT_ID"

echo "    commit : $GIT_SHORT_SHA ($GIT_BRANCH)"
echo "    subject: $GIT_SUBJECT"
echo "    dirty  : $GIT_DIRTY file(s)"

mkdir -p "$SNAP_DIR"

# ── Step 2: copy git-ignored config files ───────────────────────────────────
# `git reset --hard` can never bring these back — they are not in any commit.
# This is the one part of the system a commit SHA cannot restore.
echo ""
echo "[SNAPSHOT_STEP:config]"
echo "==> [2/4] Capturing config files"

CONFIG_FILES=()
for rel in .env backend/.env; do
  if [ -f "$PROJECT_DIR/$rel" ]; then
    mkdir -p "$SNAP_DIR/config/$(dirname "$rel")"
    cp -p "$PROJECT_DIR/$rel" "$SNAP_DIR/config/$rel"
    CONFIG_FILES+=("$rel")
    echo "    captured: $rel"
  fi
done
if [ "${#CONFIG_FILES[@]}" -eq 0 ]; then
  echo "    (no .env files found — nothing to capture)"
fi

# ── Step 3: dump the database ───────────────────────────────────────────────
echo ""
echo "[SNAPSHOT_STEP:database]"
echo "==> [3/4] Dumping database ($DB_NAME)"

DB_DUMP="$SNAP_DIR/database.dump"
DB_SIZE=0
if [ "${SNAPSHOT_SKIP_DATABASE:-0}" = "1" ]; then
  echo "    SKIPPED (SNAPSHOT_SKIP_DATABASE=1) — code + config only"
  rm -f "$DB_DUMP"
else
  # `-i` + stdout redirect keeps the dump on the shared host mount instead of
  # inside the DB container, so the backend container can read it too.
  if ! docker exec -i "$DB_CONTAINER" pg_dump \
        -U "$DB_USER" -d "$DB_NAME" \
        -Fc --no-owner --no-privileges > "$DB_DUMP" 2>/tmp/snapshot-pgdump.err; then
    ERR="$(tail -n 5 /tmp/snapshot-pgdump.err 2>/dev/null || echo 'unknown error')"
    rm -f "$DB_DUMP"
    echo "    pg_dump failed: $ERR" >&2
    fail "database_dump_failed"
  fi
  DB_SIZE="$(wc -c < "$DB_DUMP" | tr -d ' ')"
  if [ "$DB_SIZE" -lt 1024 ]; then
    rm -f "$DB_DUMP"
    fail "database_dump_empty"
  fi
  echo "    dump written: $DB_SIZE bytes"
fi

# ── Step 4: manifest + retention ────────────────────────────────────────────
echo ""
echo "[SNAPSHOT_STEP:finalizing]"
echo "==> [4/4] Writing manifest & applying retention (keep last $KEEP)"

CONFIG_CSV=""
for f in ${CONFIG_FILES+"${CONFIG_FILES[@]}"}; do
  CONFIG_CSV="${CONFIG_CSV:+$CONFIG_CSV,}$f"
done

# JSON-escape a value for safe embedding in manifest.json
esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\n\r'; }

TOTAL_SIZE="$(du -sb "$SNAP_DIR" 2>/dev/null | cut -f1 || echo 0)"

cat > "$SNAP_DIR/manifest.json" <<EOF
{
  "snapshot_id": "$SNAPSHOT_ID",
  "label": "$(esc "${LABEL}")",
  "trigger_source": "$TRIGGER_SOURCE",
  "created_at": "$(date -Iseconds)",
  "git_sha": "$GIT_SHA",
  "git_short_sha": "$GIT_SHORT_SHA",
  "git_branch": "$(esc "$GIT_BRANCH")",
  "git_subject": "$(esc "$GIT_SUBJECT")",
  "git_dirty_files": $GIT_DIRTY,
  "has_database_dump": $([ "$DB_SIZE" -gt 0 ] && echo true || echo false),
  "database_size": $DB_SIZE,
  "config_files": "$(esc "$CONFIG_CSV")",
  "total_size": $TOTAL_SIZE,
  "status": "success"
}
EOF

chmod -R go-rwx "$SNAP_DIR/config" 2>/dev/null || true
chmod 0644 "$SNAP_DIR/manifest.json" 2>/dev/null || true

# Retention — drop the oldest snapshots beyond the keep count.
#
# Only directories that hold a readable manifest are eligible: that skips the
# `pre_rollback_*.dump` safety dumps (plain files) and any half-written snapshot
# from an interrupted run, which must not be silently deleted.
DELETED=0
while IFS= read -r old; do
  [ -n "$old" ] || continue
  [ -f "$SNAPSHOT_ROOT/$old/manifest.json" ] || continue
  rm -rf "$SNAPSHOT_ROOT/$old"
  DELETED=$((DELETED + 1))
  echo "    pruned: $old"
done <<EOF
$(ls -1dt "$SNAPSHOT_ROOT"/*/ 2>/dev/null | sed "s:/$::" | xargs -r -n1 basename 2>/dev/null | tail -n "+$((KEEP + 1))")
EOF
if [ "$DELETED" -gt 0 ]; then
  echo "    pruned $DELETED old snapshot(s) (keeping the newest $KEEP)"
fi

# Final manifest on stdout for the caller (server.js) to parse.
cat "$SNAP_DIR/manifest.json"
echo ""
echo "[SNAPSHOT_COMPLETE]"
