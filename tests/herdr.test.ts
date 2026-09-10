import assert from "node:assert/strict";
import test from "node:test";
import { metadataRequest } from "../src/herdr.ts";

test("builds display-only metadata for the current Herdr pane", () => {
  const previous = process.env.HERDR_PANE_ID;
  process.env.HERDR_PANE_ID = "w2:p7";
  try {
    assert.deepEqual(metadataRequest("Review authentication", 42), {
      id: "pi-herdr-task-label:42",
      method: "pane.report_metadata",
      params: {
        pane_id: "w2:p7",
        source: "pi-herdr-task-label",
        tokens: { session_task: "Review authentication" },
        seq: 42,
      },
    });
  } finally {
    if (previous === undefined) delete process.env.HERDR_PANE_ID;
    else process.env.HERDR_PANE_ID = previous;
  }
});

test("uses null to clear only its own token", () => {
  const request = metadataRequest(null, 43) as {
    params: { tokens: Record<string, string | null> };
  };
  assert.deepEqual(request.params.tokens, { session_task: null });
});
