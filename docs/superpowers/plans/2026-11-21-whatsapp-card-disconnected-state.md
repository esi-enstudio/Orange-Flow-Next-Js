# WhatsApp Card Disconnected State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After WhatsApp disconnects, show “Not set up” and offer a connect action instead of “Manage connection”.

**Architecture:** Use the existing connection state in `WhatsAppCard`. Convert disconnected card status to the existing `not_configured` presentation and let users with `whatsapp.connect` reopen the QR setup flow; keep management actions for connected devices.

**Tech Stack:** Next.js App Router, React, TypeScript.

**Spec:** [2026-11-21-whatsapp-card-disconnected-state-design.md](../specs/2026-11-21-whatsapp-card-disconnected-state-design.md)

## Global Constraints

- “Manage connection” is offered only for connected WhatsApp.
- A disconnected WhatsApp card offers “Connect” only to users with `whatsapp.connect`.
- Use the existing QR setup flow; do not change backend status or connection APIs.
- Do not add a frontend test runner; verify with lint and TypeScript.

## Review Focus

- Shared connection disconnected: status is “Not set up”; button is “Connect” and opens setup.
- Shared connection connected: existing management button and permissions remain unchanged.
- Disconnected user without `whatsapp.connect`: no misleading management or connect button.
- No shared connection configured: existing “Connect” setup flow and “Not set up” status remain correct.
- Error status is not converted into “Not set up”.

---

### Task 1: Correct WhatsApp Card Actions and Status

**Files:**
- Modify: `frontend/src/app/connections/_components/WhatsAppCard.tsx`

**Interfaces:**
- Consumes: Existing `state.status`, `state.connected`, shared connection reference, and permission checks.
- Produces: Connected-only Manage action; permission-gated Connect action otherwise; disconnected status presented as `not_configured`.

- [x] **Step 1: Correct the displayed status**

  Map `state.status === "disconnected"` to the existing `not_configured` presentation. Preserve `error` and other statuses.

- [x] **Step 2: Correct action visibility, label, and click behavior**

  Show Manage only while connected. When disconnected, show Connect only if `canConnect` and call `startConnection()`; preserve the existing connected management path.

- [x] **Step 3: Run frontend lint and typecheck**

  Run: `cd frontend && npm run lint && npx tsc --noEmit`
  Expected: exit code 0; lint may report existing warnings but no errors.
