import { execFile as execFileCallback } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const ROWS_TABLE = "ui.sidebar.agents.rows_by_agent";

export const PI_ROWS_ASSIGNMENT = `pi = [
  ["state_icon", "agent", "workspace"],
  [{ token = "$last_prompt", fg = "#928374" }],
  [{ token = "$agent_task", fg = "#bdae93" }],
]`;

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
};

function tableRanges(config: string): Array<{ name: string; start: number; bodyStart: number; end: number }> {
  const matches = [...config.matchAll(/^\s*\[([^\]\n]+)\]\s*(?:#.*)?$/gm)];
  return matches.map((match, index) => ({
    name: match[1]!.trim(),
    start: match.index!,
    bodyStart: match.index! + match[0].length,
    end: matches[index + 1]?.index ?? config.length,
  }));
}

function assignmentEnd(config: string, arrayStart: number, limit: number): number {
  let depth = 0;
  let quote: "\"" | "'" | null = null;
  let escaped = false;
  let comment = false;
  for (let index = arrayStart; index < limit; index += 1) {
    const char = config[index]!;
    if (comment) {
      if (char === "\n") comment = false;
      continue;
    }
    if (quote) {
      if (quote === "\"" && escaped) {
        escaped = false;
      } else if (quote === "\"" && char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "#") {
      comment = true;
    } else if (char === "\"" || char === "'") {
      quote = char;
    } else if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  throw new Error("Could not parse the existing rows_by_agent.pi array");
}

/** Replace only rows_by_agent.pi while preserving all unrelated TOML text. */
export function patchHerdrConfig(config: string): string {
  const table = tableRanges(config).find((candidate) => candidate.name === ROWS_TABLE);
  if (!table) {
    const separator = !config ? "" : config.endsWith("\n") ? "\n" : "\n\n";
    return `${config}${separator}[${ROWS_TABLE}]\n${PI_ROWS_ASSIGNMENT}\n`;
  }

  const body = config.slice(table.bodyStart, table.end);
  const assignment = /^([ \t]*)pi[ \t]*=/m.exec(body);
  if (!assignment) {
    const insertion = table.end;
    const prefix = config.slice(0, insertion);
    const separator = prefix.endsWith("\n") ? "" : "\n";
    return `${prefix}${separator}${PI_ROWS_ASSIGNMENT}\n${config.slice(insertion)}`;
  }

  const start = table.bodyStart + assignment.index;
  const equals = start + assignment[0].lastIndexOf("=");
  const arrayStart = config.indexOf("[", equals + 1);
  if (arrayStart < 0 || arrayStart >= table.end) {
    throw new Error("Could not find the existing rows_by_agent.pi array");
  }
  const end = assignmentEnd(config, arrayStart, table.end);
  const indent = assignment[1] ?? "";
  const replacement = PI_ROWS_ASSIGNMENT.split("\n").map((line) => `${indent}${line}`).join("\n");
  return `${config.slice(0, start)}${replacement}${config.slice(end)}`;
}

export function defaultHerdrConfigPath(): string {
  return path.resolve(process.env.HERDR_CONFIG_PATH || path.join(homedir(), ".config/herdr/config.toml"));
}

async function runHerdr(args: string[], configPath?: string): Promise<void> {
  await execFile("herdr", args, {
    env: configPath ? { ...process.env, HERDR_CONFIG_PATH: configPath } : process.env,
    timeout: 10_000,
  });
}

async function resolveConfigPath(requestedPath: string): Promise<string> {
  try {
    const stats = await lstat(requestedPath);
    return stats.isSymbolicLink() ? await realpath(requestedPath) : requestedPath;
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
    } catch {
      return candidate;
    }
  }
  throw new Error("Could not allocate a unique Herdr config backup path");
}

async function atomicRestore(configPath: string, content: string, mode: number): Promise<void> {
  const restorePath = `${configPath}.pi-herdr-restore-${process.pid}`;
  await writeFile(restorePath, content, { encoding: "utf8", flag: "wx", mode });
  await rename(restorePath, configPath);
}

export async function installHerdrLayout(
  requestedPath = defaultHerdrConfigPath(),
  dependencies: SetupDependencies = {},
): Promise<SetupResult> {
  const configPath = await resolveConfigPath(requestedPath);
  const validate = dependencies.validate ?? ((candidate) => runHerdr(["config", "check"], candidate));
  const reload = dependencies.reload ?? (() => runHerdr(["server", "reload-config"]));
  const now = dependencies.now ?? (() => new Date());

  let original = "";
  let mode = 0o600;
  let exists = true;
  try {
    original = await readFile(configPath, "utf8");
    mode = (await lstat(configPath)).mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    exists = false;
  }

  const patched = patchHerdrConfig(original);
  if (patched === original) {
    return { changed: false, configPath, backupPath: null, reloadWarning: null };
  }

  const temporaryPath = `${configPath}.pi-herdr-setup-${process.pid}`;
  let backupPath: string | null = null;
  try {
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(temporaryPath, patched, { encoding: "utf8", flag: "wx", mode });
    await validate(temporaryPath);

    if (exists && await readFile(configPath, "utf8") !== original) {
      throw new Error("Herdr config changed during setup; no changes were applied");
    }

    if (exists) {
      backupPath = await uniqueBackupPath(configPath, timestamp(now()));
      await copyFile(configPath, backupPath, constants.COPYFILE_EXCL);
      await chmod(backupPath, mode);
    }

    await rename(temporaryPath, configPath);
    try {
      await validate(configPath);
    } catch (error) {
      if (exists) await atomicRestore(configPath, original, mode);
      else await unlink(configPath);
      throw new Error(`Herdr config validation failed; original restored: ${(error as Error).message}`);
    }
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }

  let reloadWarning: string | null = null;
  try {
    await reload();
  } catch (error) {
    reloadWarning = (error as Error).message;
  }
  return { changed: true, configPath, backupPath, reloadWarning };
}
