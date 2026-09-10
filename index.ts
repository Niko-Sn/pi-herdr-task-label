import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { reportLabel } from "./src/herdr.ts";
import { MAX_LABEL_LENGTH, labelFromPrompt, normalizeAgentTitle } from "./src/label.ts";
import {
  DEFAULT_STATE,
  ENTRY_TYPE,
  type LabelState,
  latestUserPrompt,
  restoreState,
} from "./src/state.ts";

export default function piHerdrTaskLabel(pi: ExtensionAPI): void {
  let state: LabelState = { ...DEFAULT_STATE };

  const publish = () => void reportLabel(state.label);

  const save = (next: LabelState) => {
    state = next;
    pi.appendEntry(ENTRY_TYPE, state);
    publish();
  };

  const restore = (ctx: ExtensionContext) => {
    state = restoreState(ctx);
    if (!state.label) {
      const sessionName = pi.getSessionName();
      const promptLabel = labelFromPrompt(latestUserPrompt(ctx) ?? "");
      const label = sessionName || promptLabel;
      if (label) state = { label, automatic: true };
    }
    publish();
  };

  pi.on("session_start", async (_event, ctx) => restore(ctx));
  pi.on("session_tree", async (_event, ctx) => restore(ctx));

  pi.on("before_agent_start", (event) => {
    if (!state.automatic) return;
    const label = labelFromPrompt(event.prompt);
    if (label && label !== state.label) save({ label, automatic: true });
  });

  pi.on("session_info_changed", (event) => {
    if (!state.automatic || !event.name || event.name === state.label) return;
    save({ label: event.name, automatic: true });
  });

  pi.on("session_shutdown", async (event) => {
    if (event.reason === "quit") await reportLabel(null);
  });

  pi.registerTool({
    name: "set_herdr_title",
    label: "Set Herdr Title",
    description:
      "Set a concise, coherent title describing this Pi session's current task in the Herdr agent sidebar.",
    promptSnippet: "Set the concise task title displayed for this Pi session in Herdr",
    promptGuidelines: [
      "Call set_herdr_title near the beginning of every substantive user task and again only when the objective materially changes. Use a coherent action-oriented title of 3-7 words, no status words or directory names, and at most 42 characters.",
    ],
    parameters: Type.Object(
      {
        title: Type.String({
          minLength: 3,
          maxLength: MAX_LABEL_LENGTH,
          description: "A coherent 3-7 word task title, at most 42 characters",
        }),
      },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params) {
      if (!state.automatic) {
        return {
          content: [{ type: "text", text: "Manual Herdr label is active; title unchanged." }],
          details: { applied: false, label: state.label },
        };
      }
      const title = normalizeAgentTitle(params.title);
      save({ label: title, automatic: true });
      return {
        content: [{ type: "text", text: `Herdr title set: ${title}` }],
        details: { applied: true, label: title },
      };
    },
  });

  pi.registerCommand("herdr-label", {
    description: "Set a persistent manual task label for this Herdr agent row",
    handler: async (args, ctx) => {
      const label = args.trim();
      if (!label) {
        ctx.ui.notify("Usage: /herdr-label <task>", "warning");
        return;
      }
      const normalized = labelFromPrompt(label) ?? label.slice(0, 42);
      save({ label: normalized, automatic: false });
      ctx.ui.notify(`Herdr label: ${normalized}`, "info");
    },
  });

  pi.registerCommand("herdr-label-auto", {
    description: "Resume automatic Herdr task labels from user prompts",
    handler: async (_args, ctx) => {
      save({ ...state, automatic: true });
      ctx.ui.notify("Automatic Herdr task labels enabled.", "info");
    },
  });

  pi.registerCommand("herdr-label-clear", {
    description: "Clear and pause the Herdr task label",
    handler: async (_args, ctx) => {
      save({ label: null, automatic: false });
      ctx.ui.notify("Herdr task label cleared.", "info");
    },
  });
}
