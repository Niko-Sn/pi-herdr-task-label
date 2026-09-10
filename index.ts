import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { reportLabels } from "./src/herdr.ts";
import { defaultHerdrConfigPath, installHerdrLayout } from "./src/setup.ts";
import {
  MAX_LABEL_LENGTH,
  labelFromPrompt,
  lastPromptFromPrompt,
  normalizeAgentTitle,
} from "./src/label.ts";
import {
  DEFAULT_STATE,
  ENTRY_TYPE,
  type LabelState,
  latestUserPrompt,
  restoreState,
} from "./src/state.ts";

export default function piHerdrTaskLabel(pi: ExtensionAPI): void {
  let state: LabelState = { ...DEFAULT_STATE };

  const publish = () => void reportLabels(state.lastPrompt, state.agentTask);

  const save = (next: LabelState) => {
    state = next;
    pi.appendEntry(ENTRY_TYPE, state);
    publish();
  };

  const restore = (ctx: ExtensionContext) => {
    state = restoreState(ctx);
    const lastPrompt = lastPromptFromPrompt(latestUserPrompt(ctx) ?? "");
    if (lastPrompt !== state.lastPrompt) state = { ...state, lastPrompt };
    publish();
  };

  pi.on("session_start", async (_event, ctx) => restore(ctx));
  pi.on("session_tree", async (_event, ctx) => restore(ctx));

  pi.on("before_agent_start", (event) => {
    const lastPrompt = lastPromptFromPrompt(event.prompt);
    if (lastPrompt !== state.lastPrompt) save({ ...state, lastPrompt });
  });

  pi.on("session_shutdown", async (event) => {
    if (event.reason === "quit") await reportLabels(null, null);
  });

  pi.registerTool({
    name: "set_herdr_title",
    label: "Set Herdr Title",
    description:
      "Set a concise, coherent title describing this Pi session's current task in the Herdr agent sidebar.",
    promptSnippet: "Set the concise task title displayed for this Pi session in Herdr",
    promptGuidelines: [
      `Call set_herdr_title near the beginning of every substantive user task and again only when the objective materially changes. Use a coherent action-oriented title of 3-7 words, no status words or directory names, and at most ${MAX_LABEL_LENGTH} characters.`,
    ],
    parameters: Type.Object(
      {
        title: Type.String({
          minLength: 3,
          maxLength: MAX_LABEL_LENGTH,
          description: `A coherent 3-7 word task title, at most ${MAX_LABEL_LENGTH} characters`,
        }),
      },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params) {
      if (!state.automatic) {
        return {
          content: [{ type: "text", text: "Manual Herdr task is active; title unchanged." }],
          details: { applied: false, label: state.agentTask },
        };
      }
      const title = normalizeAgentTitle(params.title);
      save({ ...state, agentTask: title });
      return {
        content: [{ type: "text", text: `Herdr title set: ${title}` }],
        details: { applied: true, label: title },
      };
    },
  });

  pi.registerCommand("herdr-label", {
    description: "Set a persistent manual agent task for this Herdr row",
    handler: async (args, ctx) => {
      const label = args.trim();
      if (!label) {
        ctx.ui.notify("Usage: /herdr-label <task>", "warning");
        return;
      }
      const normalized = labelFromPrompt(label) ?? label.slice(0, MAX_LABEL_LENGTH);
      save({ ...state, agentTask: normalized, automatic: false });
      ctx.ui.notify(`Herdr task: ${normalized}`, "info");
    },
  });

  pi.registerCommand("herdr-label-auto", {
    description: "Resume agent-managed Herdr task titles",
    handler: async (_args, ctx) => {
      save({ ...state, automatic: true });
      ctx.ui.notify("Agent-managed Herdr task titles enabled.", "info");
    },
  });

  pi.registerCommand("herdr-label-setup", {
    description: "Safely configure the three styled Pi rows in Herdr",
    handler: async (_args, ctx) => {
      const configPath = defaultHerdrConfigPath();
      const confirmed = await ctx.ui.confirm(
        "Configure Herdr agent rows?",
        `Update only the Pi agent-row layout in ${configPath}? A timestamped backup will be created before any existing config is replaced.`,
      );
      if (!confirmed) {
        ctx.ui.notify("Herdr setup canceled; no files changed.", "info");
        return;
      }

      try {
        const result = await installHerdrLayout(configPath);
        if (!result.changed) {
          ctx.ui.notify("Herdr Pi agent-row layout is already configured.", "info");
          return;
        }
        const backup = result.backupPath ? ` Backup: ${result.backupPath}.` : "";
        const reload = result.reloadWarning
          ? " Config saved, but server reload failed; run `herdr server reload-config`."
          : " Server config reloaded.";
        ctx.ui.notify(
          `Herdr Pi rows configured.${backup}${reload} Press Ctrl+B, then Shift+R in Herdr to reload the client UI.`,
          result.reloadWarning ? "warning" : "info",
        );
      } catch (error) {
        ctx.ui.notify(`Herdr setup failed: ${(error as Error).message}`, "error");
      }
    },
  });

  pi.registerCommand("herdr-label-clear", {
    description: "Clear and pause the agent-managed Herdr task title",
    handler: async (_args, ctx) => {
      save({ ...state, agentTask: null, automatic: false });
      ctx.ui.notify("Herdr agent task cleared.", "info");
    },
  });
}
