# WhatsApp Gateway (vendored source)

This directory is a vendored copy of the `go-whatsapp-multi-session-rest-api`
gateway, so that the Docker image used by `orange_flow` can be built from
source on any machine (the `ghiovanidebrians/go-whatsapp-multi-session-rest-api:pgx-fixed`
image is **not** published to Docker Hub — it must be built locally).

- Upstream: https://github.com/gdbrns/go-whatsapp-multi-session-rest-api
- Vendored upstream commit: `dab7403` ("Update whatsmeow to v20260322 and add AI webhook support")

## Why `:pgx-fixed` instead of upstream `:latest`

The published `:latest` image (2025-12-21) predates upstream commit `e678308c`
(2026-02-06, "Fix pgx DSN for Postgres") and appends
`prefer_simple_protocol=true` to the DSN, which Postgres rejects with
`FATAL 42704`. The vendored source contains that fix.

## Patch applied on top of `dab7403` (CRITICAL — do not lose)

### Problem: `WA_GATEWAY_ERROR: whatsapp client version is outdated for QR pairing` (405)

Since **February 2026** WhatsApp rejects `UserAgent.Platform.WEB` for new
device pairing with an immediate 405 `client_too_old`, even when advertising
the exact current web version (see whatsmeow issue #1164 and Baileys
PRs #2365/#2377). The fix is to identify as `MACOS` platform instead.

File: `pkg/whatsapp/whatsapp.go`

1. Default OS name changed `"Chrome"` -> `"Mac OS"` (line ~94)
2. In `Start` (client init), added:
   ```go
   store.BaseClientPayload.UserAgent.Platform = waWa6.ClientPayload_UserAgent_MACOS.Enum()
   store.DeviceProps.PlatformType = waCompanionReg.DeviceProps_CATALINA.Enum()
   ```
3. Added import `"go.mau.fi/whatsmeow/proto/waWa6"`

### If you ever re-pull from upstream

After `git pull`, re-apply the three changes above (grep for `ClientPayload_UserAgent_MACOS`
to verify). The `cat <<` search marker:
`grep -n "ClientPayload_UserAgent_MACOS" pkg/whatsapp/whatsapp.go`

## How the image gets built

`docker-compose.yml` (root of the orange_flow project):

```yaml
  whatsapp-gateway:
    build:
      context: ./wa-gateway
    image: ghiovanidebrians/go-whatsapp-multi-session-rest-api:pgx-fixed
```

Fresh machine (one command):

```bash
docker compose --profile whatsapp up -d --build whatsapp-gateway
```