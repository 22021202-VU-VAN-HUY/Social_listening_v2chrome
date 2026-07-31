export type SafeReadControlMode =
  | "groups"
  | "posts"
  | "comments"
  | "comment_filter_trigger"
  | "comment_filter_option";

const SAFE_LABEL_PATTERNS: Record<SafeReadControlMode, RegExp> = {
  groups: /^(see more|show more|xem them|hien thi them)$/u,
  posts: /^(see more|xem them)$/u,
  comments:
    /^(view more comments|view previous comments|more comments|xem them binh luan|xem binh luan truoc|view more replies|view \d+ (?:more )?repl(?:y|ies)|xem them phan hoi|xem (?:them )?\d+ phan hoi)$/u,
  comment_filter_trigger: /^(most relevant|phu hop nhat)$/u,
  comment_filter_option: /^(all comments|tat ca binh luan)$/u
};

const WRITE_CONTROL_SIGNATURE =
  /(?:^|[_\s-])(composer|create.?post|like|publish|react|reply.?button|send|share|submit|ufiaddcomment)(?:$|[_\s-])/iu;

export function normalizeControlLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("vi-VN")
    .replace(/\s+/gu, " ")
    .trim();
}

export function isSafeReadControlLabel(
  mode: SafeReadControlMode,
  value: string
): boolean {
  return SAFE_LABEL_PATTERNS[mode].test(normalizeControlLabel(value));
}

/**
 * Runtime gate for the only DOM click in the Facebook content bundle.
 * Labels must be exact read/expand actions and the element must not be a
 * composer, submit control, editable field, reaction, share, reply, or send action.
 */
export function isSafeReadControlElement(
  mode: SafeReadControlMode,
  element: Element
): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (
    element.matches(
      "input, textarea, select, option, [contenteditable='true'], [contenteditable='plaintext-only']"
    ) ||
    element.closest(
      "[contenteditable='true'], [contenteditable='plaintext-only'], [data-testid*='composer' i]"
    )
  ) {
    return false;
  }
  if (
    element instanceof HTMLButtonElement &&
    (element.getAttribute("type")?.toLocaleLowerCase("en-US") === "submit" ||
      (element.closest("form") &&
        element.type.toLocaleLowerCase("en-US") === "submit"))
  ) {
    return false;
  }

  const signature = [
    element.id,
    element.getAttribute("name") ?? "",
    element.getAttribute("data-testid") ?? "",
    element.getAttribute("data-pagelet") ?? "",
    element.getAttribute("type") ?? ""
  ].join(" ");
  if (WRITE_CONTROL_SIGNATURE.test(signature)) {
    return false;
  }

  const label = element.getAttribute("aria-label") ?? element.textContent ?? "";
  return isSafeReadControlLabel(mode, label);
}
