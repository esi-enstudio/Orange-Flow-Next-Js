import assert from "node:assert/strict";
import test from "node:test";
import { initialLiveC2CHouseId } from "./live-c2c-house-selection.ts";

test("does not select a house when none are accessible", () => {
  assert.equal(initialLiveC2CHouseId([]), null);
});

test("auto-selects the only accessible house", () => {
  assert.equal(initialLiveC2CHouseId([{ id: 8 }]), 8);
});

test("requires explicit selection when multiple houses are accessible", () => {
  assert.equal(initialLiveC2CHouseId([{ id: 8 }, { id: 12 }]), null);
});
