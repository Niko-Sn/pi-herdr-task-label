import assert from "node:assert/strict";
import test from "node:test";
import { MAX_LABEL_LENGTH, labelFromPrompt } from "../src/label.ts";

test("normalizes a normal task prompt", () => {
  assert.equal(
    labelFromPrompt("  can you add task labels to the Herdr sidebar?  "),
    "Add task labels to the Herdr sidebar",
  );
});

test("retains context for acknowledgement-only follow-ups", () => {
  for (const prompt of ["yes", "OK.", "do it", "go ahead", "continue", "thanks!"]) {
    assert.equal(labelFromPrompt(prompt), null, prompt);
  }
});

test("keeps meaningful corrections", () => {
  assert.equal(labelFromPrompt("actually use the highest CPU core"), "Actually use the highest CPU core");
  assert.equal(labelFromPrompt("undo"), "Undo");
});

test("removes attachment markers and collapses whitespace", () => {
  assert.equal(
    labelFromPrompt("[Image attached]\nPlease fix   the sidebar layout."),
    "Fix the sidebar layout",
  );
});

test("clips labels at a readable word boundary", () => {
  const result = labelFromPrompt(
    "Implement a comprehensive and extremely detailed synchronization mechanism for every active Herdr agent pane",
  );
  assert.ok(result);
  assert.ok(result.length <= MAX_LABEL_LENGTH);
  assert.ok(result.endsWith("…"));
});
