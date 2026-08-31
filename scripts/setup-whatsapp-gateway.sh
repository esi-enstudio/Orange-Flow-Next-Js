#!/usr/bin/env bash
# setup-whatsapp-gateway.sh
#
# Builds and starts the WhatsApp gateway (go-whatsapp-multi-session-rest-api)
# from the vendored source in ./wa-gateway, on any fresh machine.
# Idempotent: safe to run multiple times.
#
# Usage:
#   ./scripts/setup-whatsapp-gateway.sh          # build + start
#   ./scripts/setup-whatsapp-gateway.sh --restart  # force recreate the container
#
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

IMAGE="ghiovanidebrians/go-whatsapp-multi-session-rest-api:pgx-fixed"

echo "==> [1/3] Checking vendored gateway source (./wa-gateway)"
if [ ! -f "wa-gateway/Dockerfile" ]; then
  echo "ERROR: wa-gateway/Dockerfile not found. The vendored gateway source is required." >&2
  exit 1
fi

# Sanity check: the WhatsApp 405 MACOS-platform fix must be present.
if ! grep -q "ClientPayload_UserAgent_MACOS" wa-gateway/pkg/whatsapp/whatsapp.go; then
  echo "ERROR: wa-gateway is missing the 405 MACOS-platform patch." >&2
  echo "       See wa-gateway/README.md for how to re-apply it." >&2
  exit 1
fi

echo "==> [2/3] Building image ${IMAGE}"
docker build -t "${IMAGE}" ./wa-gateway

echo "==> [3/3] Starting whatsapp-gateway container"
if [ "${1:-}" = "--restart" ] || docker compose ps --status running | grep -q orange_flow_wa_gateway; then
  docker compose up -d --force-recreate whatsapp-gateway
else
  docker compose up -d whatsapp-gateway
fi

echo "==> Done. Gateway health:"
sleep 8
curl -sf http://localhost:7001/ && echo
echo
echo "Hint: verify WhatsApp connection at GET /admin/devices/status"
echo "      (header: X-Admin-Secret: \${WA_GATEWAY_ADMIN_KEY:-changeme-admin-secret})"