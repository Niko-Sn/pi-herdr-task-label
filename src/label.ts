export const LABEL_LENGTH_ENV = "PI_HERDR_TASK_LABEL_MAX_LENGTH";
export const DEFAULT_LABEL_LENGTH = 42;
export const MIN_LABEL_LENGTH = 10;
export const HERDR_MAX_LABEL_LENGTH = 80;

export function resolveMaxLabelLength(value: string | undefined): number {
  const normalized = value?.trim() ?? "";
  if (!/^\d+$/.test(normalized)) return DEFAULT_LABEL_LENGTH;
  const length = Number(normalized);
  return length >= MIN_LABEL_LENGTH && length <= HERDR_MAX_LABEL_LENGTH
    ? length
    : DEFAULT_LABEL_LENGTH;
}

// Defaults to the configured 46-column sidebar while respecting Herdr's
// metadata-value limit.
export const MAX_LABEL_LENGTH = resolveMaxLabelLength(process.env[LABEL_LENGTH_ENV]);

const NON_TASK_FOLLOW_UP = /^(?:y(?:es|ep)?|no|n(?:ope)?|ok(?:ay)?|sure|do it|go ahead|continue|proceed|thanks?|thank you)[.!?]*$/i;

export function normalizeAgentTitle(title: string): string {
  const normalized = title.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  if (normalized.length < 3) throw new Error("title must contain at least 3 characters");
  if (normalized.length > MAX_LABEL_LENGTH) {
    throw new Error(`title must be ${MAX_LABEL_LENGTH} characters or fewer`);
  }
  return normalized;
}

function clipLabel(label: string): string {
  if (label.length <= MAX_LABEL_LENGTH) return label;
  const candidate = label.slice(0, MAX_LABEL_LENGTH - 1);
  const boundary = candidate.lastIndexOf(" ");
  const minimumUsefulBoundary = Math.floor(MAX_LABEL_LENGTH * 0.57);
  const clipped = boundary >= minimumUsefulBoundary ? candidate.slice(0, boundary) : candidate;
  return `${clipped.trimEnd()}…`;
}

function cleanPrompt(prompt: string): string {
  return prompt
    .replace(/\[(?:image|attachment)[^\]]*\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Preserve the latest prompt as a readable, sidebar-sized line. */
export function lastPromptFromPrompt(prompt: string): string | null {
  const label = cleanPrompt(prompt);
  return label ? clipLabel(label) : null;
}

/** Turn a user prompt into a stable fallback task label. */
export function labelFromPrompt(prompt: string): string | null {
  let label = cleanPrompt(prompt);

  if (!label || NON_TASK_FOLLOW_UP.test(label)) return null;

  label = label
    .replace(/^please\s+/i, "")
    .replace(/^(?:can|could|would)\s+you\s+/i, "")
    .replace(/^can\s+we\s+/i, "")
    .replace(/^let(?:'|’)s\s+/i, "")
    .replace(/[.!?]+$/, "")
    .trim();

  if (!label) return null;
  label = label[0]!.toUpperCase() + label.slice(1);

  return clipLabel(label);
}
