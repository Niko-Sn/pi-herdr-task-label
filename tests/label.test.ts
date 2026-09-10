import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LABEL_LENGTH,
  HERDR_MAX_LABEL_LENGTH,
  MAX_LABEL_LENGTH,
  MIN_LABEL_LENGTH,
  labelFromPrompt,
  lastPromptFromPrompt,
  normalizeAgentTitle,
  resolveMaxLabelLength,
} from "../src/label.ts";

test("resolves configured label lengths within Herdr bounds", () => {
  assert.equal(resolveMaxLabelLength("10"), MIN_LABEL_LENGTH);
  assert.equal(resolveMaxLabelLength(" 50 "), 50);
  assert.equal(resolveMaxLabelLength("80"), HERDR_MAX_LABEL_LENGTH);
});

test("uses the default for invalid configured lengths", () => {
  for (const value of [undefined, "", "9", "81", "12.5", "invalid"]) {
    assert.equal(resolveMaxLabelLength(value), DEFAULT_LABEL_LENGTH);
  }
});

test("preserves the latest prompt, including short follow-ups", () => {
  assert.equal(lastPromptFromPrompt("  do   it.  "), "do it.");
  assert.equal(lastPromptFromPrompt("[Image attached]"), null);
});

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

test("accepts and normalizes a coherent agent title", () => {
  assert.equal(normalizeAgentTitle("  Fix   Herdr sidebar labels. "), "Fix Herdr sidebar labels");
});

test("rejects incoherent-size agent titles", () => {
  assert.throws(() => normalizeAgentTitle("x"), /at least 3/);
  assert.throws(() => normalizeAgentTitle("x".repeat(MAX_LABEL_LENGTH + 1)), /42 characters/);
});

test("clips labels at a readable word boundary", () => {
  const result = labelFromPrompt(
    "Implement a comprehensive and extremely detailed synchronization mechanism for every active Herdr agent pane",
  );
  assert.ok(result);
  assert.ok(result.length <= MAX_LABEL_LENGTH);
  assert.ok(result.endsWith("…"));
});
