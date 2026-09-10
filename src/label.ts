// Fits a dedicated description row in the configured 46-column Herdr sidebar
// after the panel's padding and status rail.
export const MAX_LABEL_LENGTH = 42;

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
  const clipped = boundary >= 24 ? candidate.slice(0, boundary) : candidate;
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
