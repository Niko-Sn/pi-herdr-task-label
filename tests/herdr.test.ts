import assert from "node:assert/strict";
import test from "node:test";
import { metadataRequest } from "../src/herdr.ts";

test("builds display-only metadata for the current Herdr pane", () => {
  const previous = process.env.HERDR_PANE_ID;
  process.env.HERDR_PANE_ID = "w2:p7";
  try {
    assert.deepEqual(metadataRequest("Please review auth", "Review authentication", 42), {
      id: "pi-herdr-task-label:42",
      method: "pane.report_metadata",
      params: {
        pane_id: "w2:p7",
        source: "pi-herdr-task-label",
        tokens: {
          last_prompt: "Please review auth",
          agent_task: "Review authentication",
          session_task: null,
        },
        seq: 42,
      },
    });
  } finally {
    if (previous === undefined) delete process.env.HERDR_PANE_ID;
    else process.env.HERDR_PANE_ID = previous;
  }
});

test("uses null to clear only its own tokens", () => {
  const request = metadataRequest(null, null, 43) as {
    params: { tokens: Record<string, string | null> };
  };
  assert.deepEqual(request.params.tokens, {
    last_prompt: null,
    agent_task: null,
    session_task: null,
  });
});
