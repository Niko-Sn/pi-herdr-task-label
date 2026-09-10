import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PI_ROWS_ASSIGNMENT,
  installHerdrLayout,
  patchHerdrConfig,
} from "../src/setup.ts";

test("adds the rows table without changing existing config", () => {
  const original = "onboarding = false\n\n[theme]\nname = \"gruvbox\"\n";
  const patched = patchHerdrConfig(original);
  assert.ok(patched.startsWith(original));
  assert.ok(patched.includes(`[ui.sidebar.agents.rows_by_agent]\n${PI_ROWS_ASSIGNMENT}`));
});

test("replaces only the Pi assignment and preserves surrounding TOML", () => {
  const original = `[ui.sidebar.agents.rows_by_agent]
# Keep this comment
claude = [["state_icon", "agent"]]
pi = [
  ["state_icon", "agent"], # old layout
  ["$session_task"],
]

[ui.sound]
enabled = false
`;
  const patched = patchHerdrConfig(original);
  assert.ok(patched.includes("# Keep this comment"));
  assert.ok(patched.includes('claude = [["state_icon", "agent"]]'));
  assert.ok(patched.includes(PI_ROWS_ASSIGNMENT));
  assert.ok(patched.includes("[ui.sound]\nenabled = false"));
  assert.equal(patchHerdrConfig(patched), patched);
});

test("backs up, atomically installs, validates, and reloads", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-herdr-setup-"));
  const configPath = path.join(directory, "config.toml");
  const original = "onboarding = false\n";
  await writeFile(configPath, original);
  let validations = 0;
  let reloads = 0;
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
    assert.equal(validations, 2);
    assert.equal(reloads, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("restores the original if installed-config validation fails", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-herdr-rollback-"));
  const configPath = path.join(directory, "config.toml");
  const original = "onboarding = false\n";
  await writeFile(configPath, original);
  let validations = 0;
  try {
    await assert.rejects(
      installHerdrLayout(configPath, {
        validate: async () => {
          validations += 1;
          if (validations === 2) throw new Error("invalid config");
        },
        reload: async () => undefined,
      }),
      /original restored/,
    );
    assert.equal(await readFile(configPath, "utf8"), original);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("aborts if the config changes concurrently", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-herdr-concurrent-"));
  const configPath = path.join(directory, "config.toml");
  await writeFile(configPath, "onboarding = false\n");
  try {
    await assert.rejects(
      installHerdrLayout(configPath, {
        validate: async () => { await writeFile(configPath, "# changed elsewhere\n"); },
        reload: async () => undefined,
      }),
      /changed during setup/,
    );
    assert.equal(await readFile(configPath, "utf8"), "# changed elsewhere\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
