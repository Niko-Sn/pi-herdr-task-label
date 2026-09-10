import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { latestUserPrompt } from "../src/state.ts";

function contextWithBranch(entries: unknown[]): ExtensionContext {
  return {
    sessionManager: { getBranch: () => entries },
  } as unknown as ExtensionContext;
}

test("finds the latest structured user prompt", () => {
  const ctx = contextWithBranch([
    { type: "message", message: { role: "user", content: [{ type: "text", text: "Older task" }] } },
    { type: "message", message: { role: "assistant", content: [] } },
    { type: "message", message: { role: "user", content: [{ type: "text", text: "Current task" }] } },
  ]);
  assert.equal(latestUserPrompt(ctx), "Current task");
});

test("supports string messages and ignores non-user entries", () => {
  const ctx = contextWithBranch([
    { type: "message", message: { role: "user", content: "String task" } },
    { type: "custom", customType: "other", data: {} },
  ]);
  assert.equal(latestUserPrompt(ctx), "String task");
});
