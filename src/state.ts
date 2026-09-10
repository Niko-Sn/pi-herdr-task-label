import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const ENTRY_TYPE = "pi-herdr-task-label-state";

export type LabelState = {
  lastPrompt: string | null;
  agentTask: string | null;
  automatic: boolean;
};

type LegacyLabelState = {
  label: string | null;
  automatic: boolean;
};

export const DEFAULT_STATE: LabelState = {
  lastPrompt: null,
  agentTask: null,
  automatic: true,
};

export function isLabelState(value: unknown): value is LabelState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LabelState>;
  return (candidate.lastPrompt === null || typeof candidate.lastPrompt === "string") &&
    (candidate.agentTask === null || typeof candidate.agentTask === "string") &&
    typeof candidate.automatic === "boolean";
}

function isLegacyLabelState(value: unknown): value is LegacyLabelState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LegacyLabelState>;
  return (candidate.label === null || typeof candidate.label === "string") &&
    typeof candidate.automatic === "boolean";
}

export function latestUserPrompt(ctx: ExtensionContext): string | null {
  const entries = ctx.sessionManager.getBranch() as unknown[];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] as {
      type?: string;
      message?: { role?: string; content?: unknown };
    };
    if (entry?.type !== "message" || entry.message?.role !== "user") continue;
    const content = entry.message.content;
    if (typeof content === "string" && content.trim()) return content;
    if (Array.isArray(content)) {
      const text = content
        .filter((part): part is { type: "text"; text: string } =>
          !!part && typeof part === "object" &&
          (part as { type?: unknown }).type === "text" &&
          typeof (part as { text?: unknown }).text === "string")
        .map((part) => part.text)
        .join(" ")
        .trim();
      if (text) return text;
    }
  }
  return null;
}

export function restoreState(ctx: ExtensionContext): LabelState {
  const entries = ctx.sessionManager.getBranch();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
    if (isLabelState(entry.data)) return { ...entry.data };
    if (isLegacyLabelState(entry.data)) {
      return {
        lastPrompt: null,
        agentTask: entry.data.label,
        automatic: entry.data.automatic,
      };
    }
  }
  return { ...DEFAULT_STATE };
}
