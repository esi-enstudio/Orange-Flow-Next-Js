#!/usr/bin/env bash
# rollback.sh — Restore the whole system to a previously captured Restore Point.
#
# The mirror image of snapshot.sh. Recovers all three layers captured there:
#   code   -> git reset --hard <commit>
#   config -> copies the snapshot's .env files back (git can never restore these)
#   data   -> pg_restore of the snapshot's database dump
# then rebuilds and restarts both services so the reverted code is what serves
# traffic again.
#
# Runs inside the deploy-service container (see snapshot.sh for why it lives
# there). Emits step markers the deploy service parses for live progress:
#   [ROLLBACK_STEP:<name>] / [ROLLBACK_COMPLETE] / [ROLLBACK_FAILED:<reason>]
#
# Usage: rollback.sh <snapshot_id> [--no-code] [--no-database] [--no-config]
set -euo pipefail

# ── Re-exec from a copy outside the repo ────────────────────────────────────
# `git reset --hard <old commit>` DELETES files that were tracked in the current
# commit but absent in the target one. If this script arrived with a newer
# deploy, resetting would delete the very file bash is currently reading and the
# run would die halfway through. Copy to /tmp (inside the container, not the
# repo) and re-exec from there.
if [ -z "${RP_ROLLBACK_REEXEC:-}" ]; then
  cp -f "$0" /tmp/rp-rollback.sh
  chmod +x /tmp/rp-rollback.sh
  export RP_ROLLBACK_REEXEC=1
  exec /tmp/rp-rollback.sh "$@"
fi

PROJECT_DIR="${PROJECT_DIR:-/project}"
SNAPSHOT_ROOT="$PROJECT_DIR/backend/backups/restore_points"
HOST_PROJECT_DIR="${HOST_PROJECT_DIR:-/opt/Orange-Flow-Next-Js}"

DB_CONTAINER="${DB_CONTAINER:-orange_flow_db}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-orange_flow_dev_db}"

SNAPSHOT_ID="${1:-}"
INCLUDE_CODE=1
INCLUDE_DATABASE=1
INCLUDE_CONFIG=1
for arg in "$@"; do
  case "$arg" in
    --no-code)     INCLUDE_CODE=0 ;;
    --no-database) INCLUDE_DATABASE=0 ;;
    --no-config)   INCLUDE_CONFIG=0 ;;
  esac
done

[ -n "$SNAPSHOT_ID" ] || { echo "[ROLLBACK_FAILED:missing_snapshot_id]" >&2; exit 1; }

# Reject anything that is not a plain directory name — this value reaches the
# filesystem and a `../` here would let a request escape the snapshot root.
case "$SNAPSHOT_ID" in
  */*|.|..|*' '*|*';'*) echo "[ROLLBACK_FAILED:invalid_snapshot_id]" >&2; exit 1 ;;
esac

SNAP_DIR="$SNAPSHOT_ROOT/$SNAPSHOT_ID"
MANIFEST="$SNAP_DIR/manifest.json"

fail() {
  echo "[ROLLBACK_FAILED:${1}]" >&2
  exit 1
}

# Run a command in the REAL host namespace (same technique as deploy.sh).
host() {
  docker run --rm --pid=host --privileged --net=none \
    --entrypoint nsenter alpine -t 1 -m -u -i -n -- "$@"
}
host_systemctl() { host systemctl "$@"; }

HOST_NODE_BIN="/root/.nvm/versions/node/v24.20.0/bin"
HOST_FRONTEND_DIR="$HOST_PROJECT_DIR/frontend"
host_build() {
  host env "PATH=$HOST_NODE_BIN:/usr/local/bin:/usr/bin:/bin" "NODE_ENV=production" \
    bash -c "cd '$HOST_FRONTEND_DIR' && $*"
}

# Read a scalar out of manifest.json. Deliberately dependency-free (no jq in the
# image). The values this feeds the ROLLBACK on — git_sha, has_database_dump —
# are machine-generated and contain no commas, so the character class is safe. A
# commit subject containing a comma is truncated, but that field is display-only.
json_str() { sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\{0,1\}\([^\",}]*\)\"\{0,1\}.*/\1/p" "$MANIFEST" | head -n 1; }

[ -d "$SNAP_DIR" ] || fail "snapshot_not_found"
[ -f "$MANIFEST" ] || fail "manifest_missing"

TARGET_SHA="$(json_str git_sha)"
TARGET_BRANCH="$(json_str git_branch)"
TARGET_SUBJECT="$(json_str git_subject)"
SNAP_HAS_DB="$(json_str has_database_dump)"

[ -n "$TARGET_SHA" ] || fail "manifest_invalid"

echo "========================================================================"
echo "  Orange Flow Restore Point Rollback"
echo "  Snapshot : $SNAPSHOT_ID"
echo "  Target   : ${TARGET_SHA:0:8} ($TARGET_BRANCH)"
echo "  Subject  : $TARGET_SUBJECT"
echo "  Layers   : code=$INCLUDE_CODE database=$INCLUDE_DATABASE config=$INCLUDE_CONFIG"
echo "========================================================================"

# ── Step 1: validate + safety dump ──────────────────────────────────────────
echo ""
echo "[ROLLBACK_STEP:preparing]"
echo "==> [1/6] Validating snapshot & taking a safety dump"

CURRENT_SHA="$(git -C "$PROJECT_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
CURRENT_SHORT="$(git -C "$PROJECT_DIR" rev-parse --short HEAD 2>/dev/null || echo '???????')"
echo "    current code: $CURRENT_SHORT"

if git -C "$PROJECT_DIR" cat-file -e "${TARGET_SHA}^{commit}" 2>/dev/null; then
  echo "    target commit exists in this repository"
else
  fail "target_commit_missing"
fi

SAFETY_DUMP=""
if [ "$INCLUDE_DATABASE" = "1" ] && [ "$SNAP_HAS_DB" = "true" ]; then
  SAFETY_DUMP="$SNAPSHOT_ROOT/pre_rollback_$(date +%Y%m%d_%H%M%S).dump"
  echo "    safety dump -> $(basename "$SAFETY_DUMP")"
  if ! docker exec -i "$DB_CONTAINER" pg_dump \
        -U "$DB_USER" -d "$DB_NAME" \
        -Fc --no-owner --no-privileges > "$SAFETY_DUMP" 2>/tmp/rollback-safety.err; then
    ERR="$(tail -n 5 /tmp/rollback-safety.err 2>/dev/null || echo 'unknown error')"
    rm -f "$SAFETY_DUMP"
    echo "    ERROR: safety dump failed: $ERR" >&2
    echo "    Aborting so the current database is never left unprotected." >&2
    fail "safety_dump_failed"
  fi
  echo "    safety dump OK ($(wc -c < "$SAFETY_DUMP" | tr -d ' ') bytes)"
else
  echo "    no safety dump needed (database layer not selected)"
fi

# ── Step 2: code ────────────────────────────────────────────────────────────
echo ""
echo "[ROLLBACK_STEP:code]"
echo "==> [2/6] Restoring code"
if [ "$INCLUDE_CODE" = "1" ]; then
  DIRTY="$(git -C "$PROJECT_DIR" status --porcelain 2>/dev/null | grep -c . || true)"
  if [ "$DIRTY" -gt 0 ]; then
    echo "    WARNING: discarding $DIRTY uncommitted change(s) in the working tree"
    git -C "$PROJECT_DIR" status --porcelain 2>/dev/null | head -n 20 | sed 's/^/      /'
  fi
  if ! git -C "$PROJECT_DIR" reset --hard "$TARGET_SHA" >/dev/null 2>&1; then
    fail "git_reset_failed"
  fi
  echo "    HEAD is now $(git -C "$PROJECT_DIR" rev-parse --short HEAD)"

  # Remove files the newer version ADDED, so the old code can build. Scoped to
  # source trees only: backend/uploads (profile pictures), backend/backups
  # (dumps + snapshots), node_modules and .env are all left untouched. Files
  # added under deploy-service/ are deliberately kept — this script and its
  # siblings live there and deleting the running script mid-run is unsafe.
  echo "    removing untracked leftovers in source trees..."
  CLEAN_PATHS=()
  for p in backend/app backend/config backend/scripts backend/migrations backend/alembic \
           backend/main.py backend/requirements.txt frontend/src frontend/public deploy.sh; do
    [ -e "$PROJECT_DIR/$p" ] && CLEAN_PATHS+=("$p")
  done
  if [ "${#CLEAN_PATHS[@]}" -gt 0 ]; then
    git -C "$PROJECT_DIR" clean -fdq -- "${CLEAN_PATHS[@]}" 2>/dev/null || true
    echo "    cleaned ${#CLEAN_PATHS[@]} path(s)"
  fi
else
  echo "    SKIPPED (--no-code) — keeping $CURRENT_SHORT"
fi

# ── Step 3: config ──────────────────────────────────────────────────────────
echo ""
echo "[ROLLBACK_STEP:config]"
echo "==> [3/6] Restoring config files"
if [ "$INCLUDE_CONFIG" = "1" ] && [ -d "$SNAP_DIR/config" ]; then
  RESTORED=0
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    if [ -f "$SNAP_DIR/config/$f" ]; then
      mkdir -p "$(dirname "$PROJECT_DIR/$f")"
      cp -p "$SNAP_DIR/config/$f" "$PROJECT_DIR/$f"
      echo "    restored: $f"
      RESTORED=$((RESTORED + 1))
    else
      echo "    not in snapshot, left as-is: $f"
    fi
  done <<EOF
$(sed -n 's/.*"config_files"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$MANIFEST" | tr ',' '\n')
EOF
  [ "$RESTORED" -eq 0 ] && echo "    (no config files in this snapshot)"
else
  echo "    SKIPPED (--no-config or no config in snapshot)"
fi

# ── Step 4: database ────────────────────────────────────────────────────────
echo ""
echo "[ROLLBACK_STEP:database]"
echo "==> [4/6] Restoring database"
if [ "$INCLUDE_DATABASE" = "1" ]; then
  if [ "$SNAP_HAS_DB" != "true" ] || [ ! -f "$SNAP_DIR/database.dump" ]; then
    fail "database_dump_missing"
  fi
  echo "    restoring $DB_NAME from database.dump ($(wc -c < "$SNAP_DIR/database.dump" | tr -d ' ') bytes)"
  echo "    (every record created after this snapshot will be permanently lost)"
  # -Fc is required: pg_restore cannot sniff the format when reading stdin.
  set +e
  docker exec -i "$DB_CONTAINER" pg_restore \
    -U "$DB_USER" -d "$DB_NAME" \
    -Fc --clean --if-exists --no-owner --no-privileges \
    < "$SNAP_DIR/database.dump" 2>/tmp/rollback-pgrestore.err
  RC=$?
  set -e
  # Exit 1 = non-fatal errors were ignored. Cross-version dumps emit harmless
  # "unrecognized configuration parameter" warnings for server settings that did
  # not exist on the source version; the restore still completes.
  if [ "$RC" = "1" ]; then
    if grep -q "pg_restore: error" /tmp/rollback-pgrestore.err 2>/dev/null &&
       ! grep "pg_restore: error" /tmp/rollback-pgrestore.err | grep -qv "unrecognized configuration parameter"; then
      echo "    only version-compatibility warnings — treating as success"
      RC=0
    fi
  fi
  if [ "$RC" != "0" ]; then
    ERR="$(grep 'pg_restore: error' /tmp/rollback-pgrestore.err 2>/dev/null | tail -n 5)"
    echo "    pg_restore FAILED. The database may be partially restored." >&2
    [ -n "$SAFETY_DUMP" ] && echo "    Recover with: pg_restore -d $DB_NAME ${SAFETY_DUMP}" >&2
    fail "database_restore_failed"
  fi
  echo "    database restored"
else
  echo "    SKIPPED (--no-database) — data left as-is"
fi

# ── Step 5: rebuild ─────────────────────────────────────────────────────────
echo ""
echo "[ROLLBACK_STEP:building]"
echo "==> [5/6] Rebuilding frontend (running in HOST namespace with Node v24)"
if ! host_build "npm install --include=dev"; then
  fail "npm_install_failed"
fi
if ! host_build npm run build; then
  fail "build_failed"
fi
echo "    build successful"

# ── Step 6: restart + verify ────────────────────────────────────────────────
echo ""
echo "[ROLLBACK_STEP:restarting]"
echo "==> [6/6] Restarting services"

if host_systemctl restart orangeflow-frontend; then
  echo "    frontend restarted"
else
  echo "ERROR: could not restart orangeflow-frontend via systemctl. The old" >&2
  echo "       next start would keep serving the reverted-away build." >&2
  fail "frontend_restart_failed"
fi

if docker restart orange_flow_backend >/dev/null 2>&1; then
  echo "    backend restarted"
else
  echo "WARNING: failed to restart backend container"
fi

echo ""
echo "[ROLLBACK_STEP:verifying]"
echo "==> Waiting for services..."
sleep 10

FRONTEND_OK=false
BACKEND_OK=false
if curl -sf --max-time 10 "http://host.docker.internal:3000/login" 2>/dev/null | grep -q "<body"; then
  FRONTEND_OK=true
  echo "    Frontend : OK"
else
  echo "    Frontend : NOT responding" >&2
fi
if curl -sf -o /dev/null --max-time 10 "http://host.docker.internal:8000/docs" 2>/dev/null ||
   curl -sf -o /dev/null --max-time 10 "http://172.17.0.1:8000/docs" 2>/dev/null; then
  BACKEND_OK=true
  echo "    Backend  : OK"
else
  echo "    Backend  : NOT responding" >&2
fi

# Record the outcome on disk. The database was just replaced by the snapshot, so
# the restore_points table no longer knows this rollback happened — this file is
# the surviving audit trail.
cat > "$SNAP_DIR/restore-result.json" <<EOF
{
  "snapshot_id": "$SNAPSHOT_ID",
  "restored_at": "$(date -Iseconds)",
  "from_commit": "$CURRENT_SHA",
  "to_commit": "$TARGET_SHA",
  "code_restored": $([ "$INCLUDE_CODE" = "1" ] && echo true || echo false),
  "database_restored": $([ "$INCLUDE_DATABASE" = "1" ] && echo true || echo false),
  "config_restored": $([ "$INCLUDE_CONFIG" = "1" ] && echo true || echo false),
  "safety_dump": "${SAFETY_DUMP##*/}",
  "frontend_ok": $FRONTEND_OK,
  "backend_ok": $BACKEND_OK
}
EOF

if [ "$FRONTEND_OK" != "true" ]; then
  echo "The rollback itself completed (code, config and database are all reverted)," >&2
  echo "but the frontend is not serving. Run 'systemctl restart orangeflow-frontend'" >&2
  echo "and redeploy to finish recovery." >&2
  fail "frontend_not_responding_after_rollback"
fi

echo ""
echo "  RESULT: Rolled back to ${TARGET_SHA:0:8} ($TARGET_BRANCH)"
[ -n "$SAFETY_DUMP" ] && echo "  Safety dump: ${SAFETY_DUMP##*/}"
echo "  NOTE: nothing deploys on its own any more, so this stays put until a"
echo "        super admin runs the next deploy from the Deploy UI. Until then"
echo "        this commit is what is live."
echo "[ROLLBACK_COMPLETE]"
