# Hide WhatsApp Recipient Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide the entire WhatsApp recipient picker when WhatsApp is disconnected.

**Architecture:** Reuse the existing `whatsappReady` state at the picker render site. Do not change channel state, validation, or Telegram rendering.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS.

**Spec:** [2026-11-21-hide-whatsapp-recipient-picker-design.md](../specs/2026-11-21-hide-whatsapp-recipient-picker-design.md)

## Global Constraints

- Hide the complete picker only when the selected channel is WhatsApp and `whatsappReady` is false.
- Keep current connection state, channel selection, and schedule validation behavior unchanged.
- Telegram behavior is out of scope.
- Frontend has no test runner; do not install one.
- Frontend verification: `cd frontend && npm run lint` and `cd frontend && npx tsc --noEmit`.

## Review Focus

- WhatsApp disconnected: recipient label, tabs, search, and empty state must all be absent.
- WhatsApp connected: picker remains available.
- Telegram selected: no WhatsApp picker is rendered, regardless of WhatsApp connection state.
- Existing WhatsApp schedule edited while disconnected: picker is hidden and existing validation remains unchanged.
- Connection state initially unresolved: picker remains hidden until `whatsappReady` becomes true.

---

### Task 1: Gate WhatsApp Recipient Picker Rendering

**Files:**
- Modify: `frontend/src/components/ReportDeliveryModal.tsx` at the `renderRecipientPicker()` call site.

**Interfaces:**
- Consumes: Existing `form.channel` and `whatsappReady` values.
- Produces: The picker renders only when the selected channel is WhatsApp and WhatsApp is ready.

- [x] **Step 1: Add the connection condition at the existing render site**

  Render `renderRecipientPicker()` only when both `form.channel === "whatsapp"` and `whatsappReady` are true. Do not alter the picker implementation or schedule validation.

- [x] **Step 2: Verify the relevant UI states**

  Check that a disconnected or unresolved WhatsApp connection hides the full picker; a connected WhatsApp connection shows it; and a Telegram selection does not show it.

- [x] **Step 3: Run frontend lint**

  Run: `cd frontend && npm run lint`
  Expected: exit code 0.

- [x] **Step 4: Run frontend typecheck**

  Run: `cd frontend && npx tsc --noEmit`
  Expected: exit code 0.
