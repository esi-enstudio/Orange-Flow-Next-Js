# Hide Report Schedules Without Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide Active schedules and Delivery history when the house has no connected delivery channel.

**Architecture:** Reuse `availableChannels.length > 0` to conditionally render the existing schedules and history sections. Keep the delivery-channel empty state and Connections action visible.

**Tech Stack:** Next.js App Router, React, TypeScript.

**Spec:** [2026-11-21-report-delivery-empty-channel-state-design.md](../specs/2026-11-21-report-delivery-empty-channel-state-design.md)

## Global Constraints

- Hide Active schedules and Delivery history when `availableChannels.length === 0`.
- Keep these sections visible when at least one delivery channel is available.
- Keep the no-channel message and permission-controlled Connections action visible.
- Do not add a frontend test runner; verify with lint and TypeScript.

## Review Focus

- No available channels, including unresolved connection state: neither schedules nor history is rendered.
- At least one available channel: both sections remain rendered.
- The channel empty state and its Connections action remain visible with no available channels.
- The delivery form’s existing gate and validation remain unchanged.

---

### Task 1: Gate Saved Schedules and Delivery History

**Files:**
- Modify: `frontend/src/components/ReportDeliveryModal.tsx`
- Modify: `docs/agents/report-delivery.md`

**Interfaces:**
- Consumes: Existing `availableChannels`.
- Produces: Schedules and delivery history rendered only when a delivery channel is available.

- [x] **Step 1: Conditionally render both sections**

  Wrap `renderSchedules()` and `renderDeliveryHistory()` in the same `availableChannels.length > 0` condition, leaving the channel empty state and Connections action outside.

- [x] **Step 2: Update report-delivery documentation**

  State that the new/edit form, schedules, and history are hidden when there is no available channel.

- [x] **Step 3: Run frontend lint and typecheck**

  Run: `cd frontend && npm run lint && npx tsc --noEmit`
  Expected: exit code 0; lint may report existing warnings but no errors.
