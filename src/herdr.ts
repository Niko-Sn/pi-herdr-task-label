import net from "node:net";

export const SOURCE = "pi-herdr-task-label";
export const LAST_PROMPT_TOKEN = "last_prompt";
export const AGENT_TASK_TOKEN = "agent_task";
const LEGACY_TOKEN = "session_task";
let reportSeq = Date.now() * 1000;

function nextSeq(): number {
  reportSeq += 1;
  return reportSeq;
}

export function isHerdrEnvironment(): boolean {
  return process.env.HERDR_ENV === "1" &&
    !!process.env.HERDR_SOCKET_PATH &&
    !!process.env.HERDR_PANE_ID;
}

export function metadataRequest(
  lastPrompt: string | null,
  agentTask: string | null,
  seq = nextSeq(),
): object {
  return {
    id: `${SOURCE}:${seq}`,
    method: "pane.report_metadata",
    params: {
      pane_id: process.env.HERDR_PANE_ID,
      source: SOURCE,
      tokens: {
        [LAST_PROMPT_TOKEN]: lastPrompt,
        [AGENT_TASK_TOKEN]: agentTask,
        [LEGACY_TOKEN]: null,
      },
      seq,
    },
  };
}

const MAX_RESPONSE_BYTES = 64 * 1024;

type RpcRequest = { id?: unknown };
type RpcResponse = { id?: unknown; result?: unknown; error?: unknown };

function isRpcResponse(value: unknown): value is RpcResponse {
  return value !== null && typeof value === "object";
}

export function sendAttempt(request: RpcRequest, timeoutMs: number): Promise<boolean> {
  if (!isHerdrEnvironment()) return Promise.resolve(true);
  const socketPath = process.env.HERDR_SOCKET_PATH!;
  const endpoint = process.platform === "win32" ? `\\\\.\\pipe\\${socketPath}` : socketPath;

  return new Promise((resolve) => {
    let settled = false;
    let buffer = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const socket = net.createConnection(endpoint);
    const finish = (delivered: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      socket.destroy();
      resolve(delivered);
    };
    socket.setEncoding("utf8");
    socket.on("error", () => finish(false));
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, "utf8") > MAX_RESPONSE_BYTES) return finish(false);
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(line) as unknown;
          } catch {
            return finish(false);
          }
          if (!isRpcResponse(parsed)) return finish(false);
          if (parsed.id === request.id) {
            return finish(parsed.error === undefined && Object.hasOwn(parsed, "result"));
          }
        }
        newline = buffer.indexOf("\n");
      }
    });
    socket.on("end", () => finish(false));
    timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
  });
}

async function send(request: RpcRequest): Promise<void> {
  if (await sendAttempt(request, 500)) return;
  await sendAttempt(request, 1500);
}

export function reportLabels(
  lastPrompt: string | null,
  agentTask: string | null,
): Promise<void> {
  if (!isHerdrEnvironment()) return Promise.resolve();
  return send(metadataRequest(lastPrompt, agentTask) as RpcRequest);
}
