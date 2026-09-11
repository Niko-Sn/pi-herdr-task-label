import assert from "node:assert/strict";
import { link as fsLink, lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PI_ROWS_ASSIGNMENT,
  defaultHerdrConfigPath,
  installHerdrLayout,
  patchHerdrConfig,
  resolveHerdrConfigPath,
} from "../src/setup.ts";

const NOOP_RELOAD = async () => undefined;
const NOOP_VALIDATE = async () => undefined;

test("uses HERDR_CONFIG_PATH before the platform config directory", () => {
  const previousConfig = process.env.HERDR_CONFIG_PATH;
  const previousXdg = process.env.XDG_CONFIG_HOME;
  try {
    delete process.env.HERDR_CONFIG_PATH;
    process.env.XDG_CONFIG_HOME = "/tmp/pi-herdr-xdg";
    if (process.platform !== "win32") {
      assert.equal(defaultHerdrConfigPath(), "/tmp/pi-herdr-xdg/herdr/config.toml");
    }
    process.env.HERDR_CONFIG_PATH = "/tmp/pi-herdr-explicit.toml";
    assert.equal(defaultHerdrConfigPath(), "/tmp/pi-herdr-explicit.toml");
  } finally {
    if (previousConfig === undefined) delete process.env.HERDR_CONFIG_PATH;
    else process.env.HERDR_CONFIG_PATH = previousConfig;
    if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdg;
  }
});

test("adds the rows table without changing existing config", () => {
  const original = "onboarding = false\n\n[theme]\nname = \"gruvbox\"\n";
  const patched = patchHerdrConfig(original);
  assert.ok(patched.startsWith(original));
  assert.ok(patched.includes(`[ui.sidebar.agents.rows_by_agent]\n${PI_ROWS_ASSIGNMENT}`));
});

test("replaces only a quoted Pi value and preserves surrounding TOML", () => {
  const original = `[ui.sidebar.agents.rows_by_agent]
# Keep this comment
claude = [["state_icon", "agent"]]
"pi" = "legacy" # preserve trailing comment

[ui.sound]
enabled = false
`;
  const patched = patchHerdrConfig(original);
  assert.ok(patched.includes("# Keep this comment"));
  assert.ok(patched.includes('claude = [["state_icon", "agent"]]'));
  assert.ok(patched.includes('"pi" = [\n'));
  assert.ok(patched.includes("] # preserve trailing comment"));
  assert.ok(patched.includes("[ui.sound]\nenabled = false"));
  assert.equal(patchHerdrConfig(patched), patched);
});

test("handles array rows without trailing commas and fake headers in multiline strings", () => {
  const original = `note = '''
[ui.sidebar.agents.rows_by_agent]
pi = "not real"
'''
[ui.sidebar.agents.rows_by_agent]
pi = [
  ["state_icon", "agent"],
  ["$session_task"]
]
`;
  const patched = patchHerdrConfig(original);
  assert.ok(patched.startsWith("note = '''"));
  assert.ok(patched.includes(PI_ROWS_ASSIGNMENT));
  assert.equal((patched.match(/\$last_prompt/g) ?? []).length, 1);
});

test("updates and extends semantic dotted and inline rows_by_agent keys", () => {
  const existing = 'ui.sidebar.agents.rows_by_agent.pi = [["agent"]]\n';
  assert.ok(patchHerdrConfig(existing).startsWith("ui.sidebar.agents.rows_by_agent.pi = [\n"));

  const nested = '[ui.sidebar.agents]\nrows_by_agent.pi = [["agent"]]\n';
  assert.ok(patchHerdrConfig(nested).includes("rows_by_agent.pi = [\n"));

  const inline = '[ui.sidebar.agents]\nrows_by_agent = { pi = [["agent"]], claude = [["agent"]] }\n';
  const inlinePatched = patchHerdrConfig(inline);
  assert.ok(inlinePatched.includes('rows_by_agent = { pi = [["state_icon"'));
  assert.ok(inlinePatched.includes('claude = [["agent"]]'));
  assert.equal(patchHerdrConfig(inlinePatched), inlinePatched);

  const inlineWithoutPi = '[ui.sidebar.agents]\nrows_by_agent = { claude = [["agent"]] }\n';
  const inserted = patchHerdrConfig(inlineWithoutPi);
  assert.match(inserted, /rows_by_agent = \{pi = \[\["state_icon".*claude = \[\["agent"\]\]/);
  assert.equal(patchHerdrConfig(inserted), inserted);

  const other = 'ui.sidebar.agents.rows_by_agent.claude = [["agent"]]\n';
  const patched = patchHerdrConfig(other);
  assert.ok(patched.includes(other.trim()));
  assert.ok(patched.includes("ui.sidebar.agents.rows_by_agent.pi = ["));

  const nestedOther = '[ui.sidebar.agents]\nrows_by_agent.claude = [["agent"]]\n';
  const nestedPatched = patchHerdrConfig(nestedOther);
  assert.ok(nestedPatched.includes("rows_by_agent.pi = ["));
  assert.equal(nestedPatched.includes("ui.sidebar.agents.ui.sidebar"), false);

  const deeperKey = '[ui.sidebar.agents]\nrows_by_agent.claude.x = 1\n';
  const deeperPatched = patchHerdrConfig(deeperKey);
  assert.ok(deeperPatched.includes("rows_by_agent.pi = ["));
  assert.ok(deeperPatched.includes("rows_by_agent.claude.x = 1"));
  assert.equal(patchHerdrConfig(deeperPatched), deeperPatched);
});

test("rejects array-of-tables and deeper subtable layouts without corrupting them", () => {
  const rowsTable = "ui.sidebar.agents.rows_by_agent";
  const unsupported = [
    `[[${rowsTable}]]\npi = [["x"]]\n`,
    `[${rowsTable}.extra]\npi = [["x"]]\n`,
    `[${rowsTable}.extra]\nother = 1\n`,
  ];
  for (const original of unsupported) {
    assert.throws(
      () => patchHerdrConfig(original),
      /array of tables or has deeper subtables/,
    );
  }
});

test("backs up, atomically installs, validates, preserves mode, and reloads", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-herdr-setup-"));
  const configPath = path.join(directory, "config.toml");
  const original = "onboarding = false\n";
  await writeFile(configPath, original, { mode: 0o644 });
  let validations = 0;
  let reloads = 0;
  const oldUmask = process.umask(0o077);
  try {
    const result = await installHerdrLayout(configPath, {
      now: () => new Date("2026-09-10T12:34:56.000Z"),
      validate: async (candidate) => {
        validations += 1;
        assert.ok((await readFile(candidate, "utf8")).includes(PI_ROWS_ASSIGNMENT));
      },
      reload: async () => { reloads += 1; },
    });
    assert.equal(result.changed, true);
    assert.equal(result.backupPath, `${configPath}.bak-20260910T123456Z`);
    assert.equal(await readFile(result.backupPath!, "utf8"), original);
    assert.ok((await readFile(configPath, "utf8")).includes(PI_ROWS_ASSIGNMENT));
    assert.equal((await lstat(configPath)).mode & 0o777, 0o644);
    assert.equal((await lstat(result.backupPath!)).mode & 0o777, 0o644);
    assert.equal(validations, 1);
    assert.equal(reloads, 1);
  } finally {
    process.umask(oldUmask);
    await rm(directory, { recursive: true, force: true });
  }
});

test("staged validation failure leaves the original untouched", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-herdr-validation-"));
  const configPath = path.join(directory, "config.toml");
  const original = "onboarding = false\n";
  await writeFile(configPath, original);
  try {
    await assert.rejects(
      installHerdrLayout(configPath, {
        validate: async () => { throw new Error("invalid config"); },
        reload: NOOP_RELOAD,
      }),
      /invalid config/,
    );
    assert.equal(await readFile(configPath, "utf8"), original);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("aborts if an existing config changes before commit", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-herdr-concurrent-"));
  const configPath = path.join(directory, "config.toml");
  await writeFile(configPath, "onboarding = false\n");
  try {
    await assert.rejects(
      installHerdrLayout(configPath, {
        validate: NOOP_VALIDATE,
        reload: NOOP_RELOAD,
        beforeCommit: async () => { await writeFile(configPath, "# changed elsewhere\n"); },
      }),
      /changed during setup/,
    );
    assert.equal(await readFile(configPath, "utf8"), "# changed elsewhere\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("does not overwrite a concurrently created first config", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-herdr-new-race-"));
  const configPath = path.join(directory, "config.toml");
  try {
    await assert.rejects(
      installHerdrLayout(configPath, {
        validate: NOOP_VALIDATE,
        reload: NOOP_RELOAD,
        beforeCommit: async () => { await writeFile(configPath, "# created elsewhere\n"); },
      }),
      /changed during setup/,
    );
    assert.equal(await readFile(configPath, "utf8"), "# created elsewhere\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("keeps late writes to the displaced inode reachable through the backup", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-herdr-late-write-"));
  const configPath = path.join(directory, "config.toml");
  await writeFile(configPath, "onboarding = false\n");
  try {
    const result = await installHerdrLayout(configPath, {
      now: () => new Date("2026-09-10T12:34:56.000Z"),
      validate: NOOP_VALIDATE,
      reload: NOOP_RELOAD,
      installLink: async (source, target) => {
        const displaced = (await readdir(directory)).find((name) => name.includes(".pi-herdr-original-"));
        assert.ok(displaced);
        await writeFile(path.join(directory, displaced), "# late concurrent write\n");
        await fsLink(source, target);
      },
    });
    assert.equal(await readFile(result.backupPath!, "utf8"), "# late concurrent write\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("recovers stale locks but rejects a live setup lock", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-herdr-lock-"));
  const configPath = path.join(directory, "config.toml");
  const lockPath = `${configPath}.pi-herdr-setup.lock`;
  await writeFile(configPath, "onboarding = false\n");
  try {
    await writeFile(lockPath, "99999999\n");
    await installHerdrLayout(configPath, { validate: NOOP_VALIDATE, reload: NOOP_RELOAD });
    await writeFile(lockPath, `${process.pid}\n`);
    await assert.rejects(
      installHerdrLayout(configPath, { validate: NOOP_VALIDATE, reload: NOOP_RELOAD }),
      /already running/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("preserves a displaced original if installation and restoration both fail", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-herdr-restore-failure-"));
  const configPath = path.join(directory, "config.toml");
  const original = "onboarding = false\n";
  await writeFile(configPath, original);
  try {
    await assert.rejects(
      installHerdrLayout(configPath, {
        validate: NOOP_VALIDATE,
        reload: NOOP_RELOAD,
        installLink: async () => { throw Object.assign(new Error("install failed"), { code: "EIO" }); },
        restoreMoved: async () => { throw new Error("restore failed"); },
      }),
      /restore failed/,
    );
    const displaced = (await readdir(directory)).find((name) => name.includes(".pi-herdr-original-"));
    assert.ok(displaced);
    assert.equal(await readFile(path.join(directory, displaced), "utf8"), original);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("follows valid symlinks and rejects dangling symlinks", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-herdr-symlink-"));
  const target = path.join(directory, "actual.toml");
  const linkPath = path.join(directory, "config.toml");
  await writeFile(target, "onboarding = false\n");
  await symlink(target, linkPath);
  try {
    assert.equal(await resolveHerdrConfigPath(linkPath), target);
    await installHerdrLayout(linkPath, { validate: NOOP_VALIDATE, reload: NOOP_RELOAD });
    assert.equal((await lstat(linkPath)).isSymbolicLink(), true);
    assert.ok((await readFile(target, "utf8")).includes(PI_ROWS_ASSIGNMENT));

    const dangling = path.join(directory, "dangling.toml");
    await symlink(path.join(directory, "missing.toml"), dangling);
    await assert.rejects(resolveHerdrConfigPath(dangling), /dangling symlink/);
    assert.equal((await lstat(dangling)).isSymbolicLink(), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
