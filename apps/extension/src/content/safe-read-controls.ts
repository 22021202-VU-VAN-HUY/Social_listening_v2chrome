export type SafeReadControlMode =
  | "groups"
  | "posts"
  | "comments"
  | "post_filter_trigger"
  | "post_filter_option"
  | "comment_filter_trigger"
  | "comment_filter_option";

const SAFE_LABEL_PATTERNS: Record<SafeReadControlMode, RegExp> = {
  groups: /^(see more|show more|xem them|hien thi them)$/u,
  posts: /^(see more|xem them)$/u,
  comments:
    /^(view more comments|view previous comments|view \d+ more comments|more comments|see more comments|xem them binh luan|xem them \d+ binh luan|xem (?:cac )?binh luan truoc|view more replies|view previous replies|view \d+ (?:more )?repl(?:y|ies)|see more replies|see \d+ (?:more )?repl(?:y|ies)|xem them phan hoi|xem (?:them )?\d+ phan hoi)$/u,
  post_filter_trigger:
    /^(most relevant|top posts|relevant posts|bai viet phu hop nhat|bai viet hang dau)$/u,
  post_filter_option:
    /^(recent posts|most recent|latest posts|newest posts|posts from recent|bai viet moi day|bai viet gan day(?: nhat)?|gan day nhat|moi nhat)$/u,
  comment_filter_trigger: /^(most relevant|phu hop nhat)$/u,
  comment_filter_option: /^(all comments|tat ca binh luan)$/u
};

const WRITE_CONTROL_SIGNATURE =
  /(?:^|[_\s-])(composer|create.?post|like|publish|react|reply.?button|send|share|submit|ufiaddcomment)(?:$|[_\s-])/iu;

export function normalizeControlLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[đĐ]/gu, "d")
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
  if (isSafeReadControlLabel(mode, label)) return true;

  // Facebook's sort menu appends an explanatory sentence to the menuitem's
  // accessible text (for example "All comments ... including potential
  // spam"). Keep the click gate exact by accepting only a descendant whose
  // complete label is the allow-listed option, and only inside a menu/radio
  // option. This supports the real DOM without turning prefix matches into a
  // general-purpose click path.
  if (
    (mode === "comment_filter_option" || mode === "post_filter_option") &&
    element.matches(
      "[role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox'], [role='radio']"
    )
  ) {
    for (const descendant of [...element.querySelectorAll("*")].slice(0, 32)) {
      const descendantLabel =
        descendant.getAttribute("aria-label") ?? descendant.textContent ?? "";
      if (isSafeReadControlLabel(mode, descendantLabel)) return true;
    }
  }

  return false;
}
