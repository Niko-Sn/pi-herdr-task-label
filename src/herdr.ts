import net from "node:net";

export const SOURCE = "pi-herdr-task-label";
export const TOKEN = "session_task";
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

export function metadataRequest(label: string | null, seq = nextSeq()): object {
  return {
    id: `${SOURCE}:${seq}`,
    method: "pane.report_metadata",
    params: {
      pane_id: process.env.HERDR_PANE_ID,
      source: SOURCE,
      tokens: { [TOKEN]: label },
      seq,
    },
  };
}

function sendAttempt(request: unknown, timeoutMs: number): Promise<boolean> {
  if (!isHerdrEnvironment()) return Promise.resolve(true);
  const socketPath = process.env.HERDR_SOCKET_PATH!;
  const endpoint = process.platform === "win32" ? `\\\\.\\pipe\\${socketPath}` : socketPath;

  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const socket = net.createConnection(endpoint);
    const finish = (delivered: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      socket.destroy();
      resolve(delivered);
    };
    socket.on("error", () => finish(false));
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", () => finish(true));
    socket.on("end", () => finish(false));
    timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
  });
}

async function send(request: unknown): Promise<void> {
  if (await sendAttempt(request, 500)) return;
  await sendAttempt(request, 1500);
}

export function reportLabel(label: string | null): Promise<void> {
  if (!isHerdrEnvironment()) return Promise.resolve();
  return send(metadataRequest(label));
}
