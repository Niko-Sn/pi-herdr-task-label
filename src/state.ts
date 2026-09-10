import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const ENTRY_TYPE = "pi-herdr-task-label-state";

export type LabelState = {
  label: string | null;
  automatic: boolean;
};

export const DEFAULT_STATE: LabelState = { label: null, automatic: true };

export function isLabelState(value: unknown): value is LabelState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LabelState>;
  return (candidate.label === null || typeof candidate.label === "string") &&
    typeof candidate.automatic === "boolean";
}

export function restoreState(ctx: ExtensionContext): LabelState {
  const entries = ctx.sessionManager.getBranch();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
    if (isLabelState(entry.data)) return { ...entry.data };
  }
  return { ...DEFAULT_STATE };
}
