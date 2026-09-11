import { execFile as execFileCallback } from "node:child_process";
import { constants } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import {
  access,
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { parseTOML } from "toml-eslint-parser";

const execFile = promisify(execFileCallback);
const ROWS_PATH = ["ui", "sidebar", "agents", "rows_by_agent"];
const ROWS_TABLE = ROWS_PATH.join(".");
const PI_ROWS_VALUE = `[
  ["state_icon", "agent", "workspace"],
  [{ token = "$last_prompt", fg = "#928374" }],
  [{ token = "$agent_task", fg = "#bdae93" }],
]`;
const PI_ROWS_VALUE_INLINE = '[["state_icon", "agent", "workspace"], [{ token = "$last_prompt", fg = "#928374" }], [{ token = "$agent_task", fg = "#bdae93" }]]';

export const PI_ROWS_ASSIGNMENT = `pi = ${PI_ROWS_VALUE}`;

export type SetupResult = {
  changed: boolean;
  configPath: string;
  backupPath: string | null;
  reloadWarning: string | null;
};

type SetupDependencies = {
  now?: () => Date;
  validate?: (configPath: string) => Promise<void>;
  reload?: () => Promise<void>;
  beforeCommit?: () => Promise<void>;
  installLink?: (source: string, target: string) => Promise<void>;
  restoreMoved?: (source: string, target: string) => Promise<boolean>;
};

type Snapshot = {
  content: string;
  mode: number;
  dev: bigint;
  ino: bigint;
};

type TomlNode = {
  type?: string;
  body?: TomlNode[];
  resolvedKey?: string[];
  key?: { keys?: Array<{ name?: string; value?: unknown }> };
  value?: { type?: string; body?: TomlNode[]; range?: [number, number] };
  range?: [number, number];
};

type SemanticAssignment = {
  node: TomlNode;
  path: string[];
  context: string[];
  inline: boolean;
};

function keyParts(node: TomlNode): string[] {
  return node.key?.keys?.map((part) => String(part.name ?? part.value ?? "")) ?? [];
}

function parseNodes(config: string): TomlNode[] {
  const program = parseTOML(config) as unknown as TomlNode;
  return program.body?.flatMap((top) => top.body ?? []) ?? [];
}

function semanticAssignments(nodes: TomlNode[]): SemanticAssignment[] {
  const assignments: SemanticAssignment[] = [];
  const visit = (node: TomlNode, context: string[], inline: boolean) => {
    if (node.type === "TOMLTable") {
      for (const child of node.body ?? []) visit(child, node.resolvedKey ?? [], false);
      return;
    }
    if (node.type !== "TOMLKeyValue") return;
    const resolved = [...context, ...keyParts(node)];
    assignments.push({ node, path: resolved, context, inline });
    if (node.value?.type === "TOMLInlineTable") {
      for (const child of node.value.body ?? []) visit(child, resolved, true);
    }
  };
  for (const node of nodes) visit(node, [], false);
  return assignments;
}

function samePath(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

function lineEnding(config: string): "\r\n" | "\n" {
  return config.includes("\r\n") ? "\r\n" : "\n";
}

/** Replace only rows_by_agent.pi while preserving all unrelated TOML text. */
export function patchHerdrConfig(config: string): string {
  const eol = lineEnding(config);
  const rowsValue = PI_ROWS_VALUE.replace(/\n/g, eol);
  const nodes = parseNodes(config);
  const assignments = semanticAssignments(nodes);
  const targetPath = [...ROWS_PATH, "pi"];
  const existing = assignments.find((assignment) => samePath(assignment.path, targetPath));
  if (existing?.node.value?.range) {
    const [start, end] = existing.node.value.range;
    const value = existing.inline ? PI_ROWS_VALUE_INLINE : rowsValue;
    return `${config.slice(0, start)}${value}${config.slice(end)}`;
  }

  const inlineRows = assignments.find((assignment) =>
    samePath(assignment.path, ROWS_PATH) && assignment.node.value?.type === "TOMLInlineTable");
  if (inlineRows?.node.value?.range) {
    const insertion = inlineRows.node.value.range[0] + 1;
    const separator = inlineRows.node.value.body?.length ? ", " : "";
    return `${config.slice(0, insertion)}pi = ${PI_ROWS_VALUE_INLINE}${separator}${config.slice(insertion)}`;
  }

  const table = nodes.find((node) =>
    node.type === "TOMLTable" && samePath(node.resolvedKey ?? [], ROWS_PATH));
  if (table) {
    const insertion = table.range?.[1];
    if (insertion === undefined) throw new Error("Could not locate the rows_by_agent table");
    const prefix = config.slice(0, insertion);
    const separator = prefix.endsWith("\n") ? "" : eol;
    return `${prefix}${separator}pi = ${rowsValue}${config.slice(insertion)}`;
  }

  const related = assignments.find((assignment) =>
    assignment.path.length > ROWS_PATH.length &&
    ROWS_PATH.every((part, index) => assignment.path[index] === part));
  if (related?.node.range) {
    if (related.context.length > ROWS_PATH.length) {
      throw new Error(
        `Could not patch ${ROWS_TABLE}: it is defined as an array of tables or has deeper subtables; add the Pi row manually`,
      );
    }
    const newline = config.indexOf("\n", related.node.range[1]);
    const insertion = newline < 0 ? config.length : newline + 1;
    const relativeTarget = targetPath.slice(related.context.length).join(".");
    const prefix = insertion === 0 || config[insertion - 1] === "\n" ? "" : "\n";
    return `${config.slice(0, insertion)}${prefix}${relativeTarget} = ${rowsValue}${eol}${config.slice(insertion)}`;
  }

  const separator = !config ? "" : config.endsWith("\n") ? "" : eol;
  return `${config}${separator}${config ? eol : ""}[${ROWS_TABLE}]${eol}pi = ${rowsValue}${eol}`;
}

export function defaultHerdrConfigPath(): string {
  if (process.env.HERDR_CONFIG_PATH) return path.resolve(process.env.HERDR_CONFIG_PATH);
  if (process.platform === "win32") {
    return path.resolve(process.env.APPDATA || path.join(homedir(), "AppData/Roaming"), "herdr/config.toml");
  }
  return path.resolve(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "herdr/config.toml");
}

async function runHerdr(args: string[], configPath?: string): Promise<void> {
  await execFile("herdr", args, {
    env: configPath ? { ...process.env, HERDR_CONFIG_PATH: configPath } : process.env,
    timeout: 10_000,
  });
}

export async function resolveHerdrConfigPath(requestedPath: string): Promise<string> {
  try {
    const stats = await lstat(requestedPath);
    if (!stats.isSymbolicLink()) return requestedPath;
    try {
      return await realpath(requestedPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Herdr config is a dangling symlink: ${requestedPath}`);
      }
      throw error;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return requestedPath;
    throw error;
  }
}

function timestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function uniqueBackupPath(configPath: string, stamp: string): Promise<string> {
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const candidate = `${configPath}.bak-${stamp}${suffix ? `-${suffix}` : ""}`;
    try {
      await access(candidate, constants.F_OK);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return candidate;
      throw error;
    }
  }
  throw new Error("Could not allocate a unique Herdr config backup path");
}

async function readSnapshot(configPath: string): Promise<Snapshot | null> {
  try {
    const handle = await open(configPath, "r");
    try {
      const stats = await handle.stat({ bigint: true });
      if (!stats.isFile()) throw new Error(`Herdr config is not a regular file: ${configPath}`);
      return {
        content: await handle.readFile("utf8"),
        mode: Number(stats.mode & 0o777n),
        dev: stats.dev,
        ino: stats.ino,
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function sameSnapshot(left: Snapshot | null, right: Snapshot | null): boolean {
  return left === null || right === null
    ? left === right
    : left.dev === right.dev && left.ino === right.ino &&
      left.mode === right.mode && left.content === right.content;
}

async function writeExclusive(filePath: string, content: string, mode: number): Promise<void> {
  const handle = await open(filePath, "wx", mode);
  try {
    await handle.writeFile(content, "utf8");
    await handle.chmod(mode);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directory: string): Promise<void> {
  try {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (!(["EINVAL", "ENOTSUP", "EISDIR"] as Array<string | undefined>).includes(
      (error as NodeJS.ErrnoException).code,
    )) throw error;
  }
}

async function restoreMovedFile(displacedPath: string, configPath: string): Promise<boolean> {
  try {
    await link(displacedPath, configPath);
    await unlink(displacedPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

type SetupLock = { handle: FileHandle; dev: bigint; ino: bigint };

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function acquireSetupLock(lockPath: string): Promise<SetupLock> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(`${process.pid}\n`, "utf8");
        await handle.sync();
        const stats = await handle.stat({ bigint: true });
        return { handle, dev: stats.dev, ino: stats.ino };
      } catch (error) {
        await handle.close().catch(() => undefined);
        await unlink(lockPath).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let owner: number | null = null;
      for (let read = 0; read < 5; read += 1) {
        const parsed = Number.parseInt((await readFile(lockPath, "utf8").catch(() => "")).trim(), 10);
        if (Number.isInteger(parsed) && parsed > 0) {
          owner = parsed;
          break;
        }
        // The lock exists but has no pid yet: its creator may still be
        // writing it. Retry briefly before giving up.
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      if (owner !== null && !processIsRunning(owner)) {
        await unlink(lockPath).catch(() => undefined);
        continue;
      }
      throw new Error(owner === null
        ? `Herdr setup lock is unreadable or was just created: ${lockPath}`
        : `Another Herdr setup is already running: ${lockPath}`);
    }
  }
  throw new Error(`Could not clear stale Herdr setup lock: ${lockPath}`);
}

async function releaseSetupLock(lockPath: string, lock: SetupLock): Promise<void> {
  await lock.handle.close();
  try {
    const current = await lstat(lockPath, { bigint: true });
    if (current.dev === lock.dev && current.ino === lock.ino) await unlink(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function installHerdrLayout(
  requestedPath = defaultHerdrConfigPath(),
  dependencies: SetupDependencies = {},
): Promise<SetupResult> {
  const configPath = await resolveHerdrConfigPath(requestedPath);
  const validate = dependencies.validate ?? ((candidate) => runHerdr(["config", "check"], candidate));
  const reload = dependencies.reload ?? (() => runHerdr(["server", "reload-config"]));
  const now = dependencies.now ?? (() => new Date());
  const installLink = dependencies.installLink ?? link;
  const restoreMoved = dependencies.restoreMoved ?? restoreMovedFile;
  const directory = path.dirname(configPath);
  await mkdir(directory, { recursive: true });

  const lockPath = `${configPath}.pi-herdr-setup.lock`;
  const lock = await acquireSetupLock(lockPath);

  const transaction = randomUUID();
  const temporaryPath = `${configPath}.pi-herdr-setup-${transaction}`;
  const displacedPath = `${configPath}.pi-herdr-original-${transaction}`;
  let keepDisplaced = false;
  try {
    const original = await readSnapshot(configPath);
    const patched = patchHerdrConfig(original?.content ?? "");
    if (patched === original?.content) {
      return { changed: false, configPath, backupPath: null, reloadWarning: null };
    }

    const mode = original?.mode ?? 0o600;
    await writeExclusive(temporaryPath, patched, mode);
    await validate(temporaryPath);
    await dependencies.beforeCommit?.();

    if (!sameSnapshot(original, await readSnapshot(configPath))) {
      throw new Error("Herdr config changed during setup; no changes were applied");
    }

    let backupPath: string | null = null;
    if (original) {
      await rename(configPath, displacedPath);
      keepDisplaced = true;

      const moved = await readSnapshot(displacedPath);
      if (!sameSnapshot(original, moved)) {
        keepDisplaced = !(await restoreMoved(displacedPath, configPath));
        const location = keepDisplaced ? ` Concurrent data preserved at ${displacedPath}.` : "";
        throw new Error(`Herdr config changed during setup; no setup changes were applied.${location}`);
      }

      backupPath = await uniqueBackupPath(configPath, timestamp(now()));
      await link(displacedPath, backupPath);
      await syncDirectory(directory);
    }

    try {
      await installLink(temporaryPath, configPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        if (original) {
          await unlink(displacedPath);
          keepDisplaced = false;
        }
        throw new Error("Herdr config was created or replaced concurrently; no setup changes were applied");
      }
      if (original) keepDisplaced = !(await restoreMoved(displacedPath, configPath));
      throw error;
    }

    await unlink(temporaryPath);
    if (original) {
      await unlink(displacedPath);
      keepDisplaced = false;
    }
    await syncDirectory(directory);

    let reloadWarning: string | null = null;
    try {
      await reload();
    } catch (error) {
      reloadWarning = (error as Error).message;
    }
    return { changed: true, configPath, backupPath, reloadWarning };
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
    if (!keepDisplaced) await unlink(displacedPath).catch(() => undefined);
    await releaseSetupLock(lockPath, lock);
  }
}
