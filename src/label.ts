export const MAX_LABEL_LENGTH = 64;

const NON_TASK_FOLLOW_UP = /^(?:y(?:es|ep)?|no|n(?:ope)?|ok(?:ay)?|sure|do it|go ahead|continue|proceed|thanks?|thank you)[.!?]*$/i;

/** Turn a user prompt into a stable, one-line Herdr sidebar label. */
export function labelFromPrompt(prompt: string): string | null {
  let label = prompt
    .replace(/\[(?:image|attachment)[^\]]*\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

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

  if (label.length <= MAX_LABEL_LENGTH) return label;
  const candidate = label.slice(0, MAX_LABEL_LENGTH - 1);
  const boundary = candidate.lastIndexOf(" ");
  const clipped = boundary >= 36 ? candidate.slice(0, boundary) : candidate;
  return `${clipped.trimEnd()}…`;
}
