import assert from "node:assert/strict";
import net from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { metadataRequest, reportLabels, sendAttempt } from "../src/herdr.ts";

async function withHerdrServer(
  respond: (request: { id?: unknown }, socket: net.Socket) => void,
  run: () => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-herdr-socket-"));
  const socketPath = path.join(directory, "herdr.sock");
  const previous = {
    env: process.env.HERDR_ENV,
    socket: process.env.HERDR_SOCKET_PATH,
    pane: process.env.HERDR_PANE_ID,
  };
  const server = net.createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      respond(JSON.parse(buffer.slice(0, newline)), socket);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  process.env.HERDR_ENV = "1";
  process.env.HERDR_SOCKET_PATH = socketPath;
  process.env.HERDR_PANE_ID = "w1:p1";
  try {
    await run();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previous.env === undefined) delete process.env.HERDR_ENV;
    else process.env.HERDR_ENV = previous.env;
    if (previous.socket === undefined) delete process.env.HERDR_SOCKET_PATH;
    else process.env.HERDR_SOCKET_PATH = previous.socket;
    if (previous.pane === undefined) delete process.env.HERDR_PANE_ID;
    else process.env.HERDR_PANE_ID = previous.pane;
    await rm(directory, { recursive: true, force: true });
  }
}

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

test("accepts only a matching, complete successful response", async () => {
  await withHerdrServer((request, socket) => {
    socket.write(`${JSON.stringify({ id: "other", result: {} })}\n`);
    const response = `${JSON.stringify({ id: request.id, result: { status: "ok" } })}\n`;
    socket.write(response.slice(0, 5));
    setTimeout(() => socket.end(response.slice(5)), 5);
  }, async () => {
    assert.equal(await sendAttempt({ id: "request-1" }, 200), true);
  });
});

test("rejects explicit and malformed Herdr responses", async () => {
  await withHerdrServer((request, socket) => {
    socket.end(`${JSON.stringify({ id: request.id, error: { message: "rejected" } })}\n`);
  }, async () => {
    assert.equal(await sendAttempt({ id: "request-2" }, 200), false);
  });

  await withHerdrServer((_request, socket) => socket.end("not-json\n"), async () => {
    assert.equal(await sendAttempt({ id: "request-3" }, 200), false);
  });

  await withHerdrServer((_request, socket) => socket.end("null\n"), async () => {
    assert.equal(await sendAttempt({ id: "request-null" }, 200), false);
  });

  await withHerdrServer((request, socket) => {
    socket.end(`${JSON.stringify({ id: request.id })}\n`);
  }, async () => {
    assert.equal(await sendAttempt({ id: "request-missing-result" }, 200), false);
  });
});

test("retries after an explicit Herdr error", async () => {
  let attempts = 0;
  await withHerdrServer((request, socket) => {
    attempts += 1;
    socket.end(`${JSON.stringify(
      attempts === 1
        ? { id: request.id, error: { message: "retry" } }
        : { id: request.id, result: { status: "ok" } },
    )}\n`);
  }, async () => {
    await reportLabels("Prompt", "Task");
    assert.equal(attempts, 2);
  });
});

test("rejects EOF and timeout without a matching response", async () => {
  await withHerdrServer((_request, socket) => socket.end(), async () => {
    assert.equal(await sendAttempt({ id: "request-4" }, 200), false);
  });

  await withHerdrServer(() => undefined, async () => {
    assert.equal(await sendAttempt({ id: "request-5" }, 20), false);
  });
});
