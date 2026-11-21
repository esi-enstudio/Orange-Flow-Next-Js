# Report Delivery Empty Channel State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the report delivery modal’s no-channel state generic and hide unavailable delivery-form controls.

**Architecture:** Reuse `availableChannels` to gate only the new/edit delivery form. Keep the existing empty state and saved schedule/history sections; update its localized hint and remove the amber missing-requirements block.

**Tech Stack:** Next.js App Router, React, TypeScript, Zustand translation store.

**Spec:** [2026-11-21-report-delivery-empty-channel-state-design.md](../specs/2026-11-21-report-delivery-empty-channel-state-design.md)

## Global Constraints

- The no-channel hint is generic in English and Bangla and does not name a provider.
- Hide the new/edit delivery form whenever no delivery channel is available.
- Keep existing schedules and delivery history visible.
- Remove the amber missing-requirements block; retain validation that disables actions.
- Do not add a frontend test runner; verify with lint and TypeScript.

## Review Focus

- No available channels: no form fields, summary, preview, or send/save actions render.
- Available channel(s): the form and corresponding channel-specific inputs remain available.
- No-channel state retains its localized Connections action and saved schedules/history.
- Both language versions of the generic hint are present.
- Missing-requirements validation continues to control action-disabled state without the amber message block.

---

### Task 1: Simplify and Gate the Delivery Form

**Files:**
- Modify: `frontend/src/components/ReportDeliveryModal.tsx`
- Modify: `frontend/src/i18n/translations.ts`
- Modify: `docs/agents/report-delivery.md`

**Interfaces:**
- Consumes: Existing `availableChannels`, `t`, and `missingRequirements`.
- Produces: Generic localized no-channel hint; form rendered only if a channel is available; no amber validation message block.

- [x] **Step 1: Replace the provider-specific empty-state hint in both locales**

  Update `connectionsPage.modal.none_hint` to say “Connect an app for this house to share reports.” in English and provide the equivalent Bangla text.

- [x] **Step 2: Gate the new/edit form**

  Render the existing form section only when `availableChannels.length > 0`. Keep the channel empty state, QR flow, saved schedules, and delivery history outside that condition.

- [x] **Step 3: Remove the amber missing-requirements block**

  Delete the block that maps `missingRequirements` into amber paragraphs. Keep `missingRequirements` and `canSave` for validation.

- [x] **Step 4: Document the no-channel behavior**

  Update the provider gate description in `docs/agents/report-delivery.md` to note the generic hint and hidden delivery form when there are no available channels.

- [x] **Step 5: Run frontend lint and typecheck**

  Run: `cd frontend && npm run lint && npx tsc --noEmit`
  Expected: exit code 0; lint may report existing warnings but no errors.
