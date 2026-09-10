import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { reportLabel } from "./src/herdr.ts";
import { labelFromPrompt } from "./src/label.ts";
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
