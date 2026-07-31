import {
  assertPrivacySafePayload,
  makeSafeAuthor,
  sanitizeAuthorName
} from "../shared/privacy";
import type {
  AuthState,
  CrawlKeyword,
  SafeAuthorDto,
  SafeCommentDto,
  SafePostDto,
  SafeSourceDto,
  TimeParseStatus
} from "../shared/types";
import {
  canonicalCommentUrl,
  canonicalGroupUrl,
  canonicalPostUrl
} from "./facebook-urls";

const GROUP_RESERVED_PATHS = new Set([
  "activity",
  "create",
  "discover",
  "feed",
  "joins",
  "notifications"
]);

const ANONYMOUS_LABELS = [
  "anonymous",
  "anonymous author",
  "anonymous member",
  "anonymous participant",
  "anonymous user",
  "tac gia an danh",
  "thanh vien an danh",
  "nguoi dung an danh",
  "nguoi tham gia an danh"
] as const;

const POST_ROOT_SELECTORS = [
  "[data-sl-post]",
  "[data-pagelet^='FeedUnit_']",
  "[aria-posinset]",
  "article",
  "div[role='article']"
] as const;

const COMMENT_ROOT_SELECTORS = [
  "[data-sl-comment]",
  "[data-commentid]",
  "[data-comment-id]",
  "[aria-label^='Comment by']",
  "[aria-label^='Bình luận dưới tên']",
  "[aria-label^='Bình luận của']"
] as const;

const COMMENT_OWNER_SELECTOR = [
  ...COMMENT_ROOT_SELECTORS,
  "div[role='article']"
].join(",");

const COMMENT_END_LABELS = new Set([
  "no more comments",
  "there are no more comments",
  "khong con binh luan",
  "khong con binh luan nao"
]);

const GROUP_LIST_END_LABELS = new Set([
  "you have reached the end of the list",
  "you've reached the end of the list",
  "ban da xem het danh sach"
]);

const POST_SEARCH_END_LABELS = new Set([
  "end of results",
  "no results",
  "you have reached the end of the results",
  "you've reached the end of the results",
  "ban da xem het ket qua",
  "khong co ket qua"
]);

interface TimestampResult {
  publishedAt: string | null;
  timeParseStatus: TimeParseStatus;
}

interface LocalDateTimeParts {
  year: number;
  monthIndex: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

interface PostExtractionOptions {
  sourceExternalId: string;
  keywords: CrawlKeyword[];
  windowStartUtc: string | null;
  windowEndUtc: string | null;
  maxPosts: number;
}

interface CommentExtractionOptions {
  postExternalId: string;
  maxComments: number;
}

function visibleText(element: Element | null): string {
  if (!element) return "";
  const rendered =
    "innerText" in element && typeof element.innerText === "string"
      ? element.innerText
      : element.textContent ?? "";
  return rendered.replace(/\s+/gu, " ").trim();
}

function normalizedLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[đĐ]/gu, "d")
    .normalize("NFKC")
    .toLocaleLowerCase("vi-VN")
    .replace(/\s+/gu, " ")
    .trim();
}

export function isAnonymousAuthorLabel(value: string): boolean {
  const candidate = normalizedLabel(value);
  return ANONYMOUS_LABELS.some(
    (label) =>
      candidate === label ||
      candidate.startsWith(`${label} ·`) ||
      candidate.startsWith(`${label} `)
  );
}

export function normalizeKeywordText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("vi-VN")
    .replace(/\s+/gu, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function keywordMatches(text: string, keyword: CrawlKeyword): boolean {
  const haystack = normalizeKeywordText(text);
  const needle = normalizeKeywordText(keyword.value);
  if (!needle) return false;
  if (keyword.matchMode === "contains_phrase") {
    return haystack.includes(needle);
  }

  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}_])${escapeRegExp(needle)}($|[^\\p{L}\\p{N}_])`,
    "iu"
  );
  return pattern.test(haystack);
}

function uniqueElements(elements: Element[]): Element[] {
  return [...new Set(elements)];
}

function readHref(element: Element): string | null {
  if (element.tagName.toLocaleLowerCase("en-US") !== "a") {
    return null;
  }
  return element.getAttribute("href");
}

function parsePostExternalId(url: string): string | null {
  try {
    const parsed = new URL(url);
    return (
      /\/posts\/([^/?#]+)/u.exec(parsed.pathname)?.[1] ??
      /\/permalink\/([^/?#]+)/u.exec(parsed.pathname)?.[1] ??
      null
    );
  } catch {
    return null;
  }
}

function parseCommentExternalId(url: string): string | null {
  try {
    const parsed = new URL(url);
    return (
      parsed.searchParams.get("reply_comment_id") ??
      parsed.searchParams.get("comment_id")
    );
  } catch {
    return null;
  }
}

function parseParentCommentExternalId(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.has("reply_comment_id")
      ? parsed.searchParams.get("comment_id")
      : null;
  } catch {
    return null;
  }
}

function parseThreadRootExternalId(url: string): string | null {
  try {
    return new URL(url).searchParams.get("comment_id");
  } catch {
    return null;
  }
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function findFirstText(root: Element, selectors: readonly string[]): string {
  for (const selector of selectors) {
    for (const element of root.querySelectorAll(selector)) {
      const text = visibleText(element);
      if (text) return text;
    }
  }
  return "";
}

function isOwnedByCommentRoot(root: Element, element: Element): boolean {
  const owner = element.closest(COMMENT_OWNER_SELECTOR);
  return !owner || owner === root;
}

function commentAuthorFromAriaLabel(root: Element): string {
  const label = (root.getAttribute("aria-label") ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!label) return "";

  for (const pattern of [
    /^Bình luận dưới tên (.+?)(?: vào | lúc | · |$)/iu,
    /^Bình luận của (.+?)(?: vào | lúc | · |$)/iu,
    /^Comment by (.+?)(?: at | on | · |$)/iu
  ]) {
    const candidate = pattern.exec(label)?.[1]?.trim();
    if (candidate) return candidate;
  }
  return "";
}

function findCommentBody(root: Element): string {
  for (const selector of [
    "[data-sl-comment-body]",
    "[data-ad-preview='message']",
    "[data-testid='comment_body']",
    "span[lang]"
  ]) {
    for (const element of root.querySelectorAll(selector)) {
      if (!isOwnedByCommentRoot(root, element)) continue;
      const text = visibleText(element);
      if (text) return text.slice(0, 50_000);
    }
  }
  return "";
}

function authorCandidateFromRoot(root: Element, comment: boolean): string {
  const selectors = comment
    ? [
        "[data-sl-comment-author]",
        "[data-testid='comment_author_link']",
        "[data-ad-rendering-role='profile_name']",
        "h3 strong",
        "h3 a[role='link']",
        "strong a[role='link']",
        "a[role='link']"
      ]
    : [
        "[data-sl-author]",
        "[data-ad-rendering-role='profile_name']",
        "[data-testid='story-subtitle'] strong",
        "h2 strong",
        "h2 a[role='link']",
        "h3 strong",
        "h3 a[role='link']"
      ];

  let candidate = comment ? commentAuthorFromAriaLabel(root) : "";
  for (const selector of selectors) {
    if (candidate) break;
    for (const element of root.querySelectorAll(selector)) {
      if (comment && !isOwnedByCommentRoot(root, element)) {
        continue;
      }
      if (
        element.tagName.toLocaleLowerCase("en-US") === "a" &&
        !element.hasAttribute("data-sl-author") &&
        !element.hasAttribute("data-sl-comment-author")
      ) {
        const href = element.getAttribute("href") ?? "";
        if (/\/groups\/|\/posts\/|\/permalink\//u.test(href)) {
          continue;
        }
      }
      candidate = visibleText(element);
      if (candidate) break;
    }
    if (candidate) break;
  }

  return candidate;
}

function authorFromRoot(root: Element, comment: boolean): SafeAuthorDto {
  const candidate = authorCandidateFromRoot(root, comment);
  return makeSafeAuthor(candidate, isAnonymousAuthorLabel(candidate));
}

function replyTargetAuthorFromBody(root: Element): string {
  for (const selector of [
    "[data-sl-comment-body] a[role='link']",
    "[data-testid='comment_body'] a[role='link']",
    "span[lang] a[role='link']"
  ]) {
    for (const element of root.querySelectorAll(selector)) {
      if (!isOwnedByCommentRoot(root, element)) continue;
      const candidate = visibleText(element);
      if (candidate) return candidate;
    }
  }
  return "";
}

const ENGLISH_MONTH_INDEX = new Map<string, number>([
  ["january", 0],
  ["february", 1],
  ["march", 2],
  ["april", 3],
  ["may", 4],
  ["june", 5],
  ["july", 6],
  ["august", 7],
  ["september", 8],
  ["october", 9],
  ["november", 10],
  ["december", 11]
]);

const ENGLISH_WEEKDAY = new Map<string, number>([
  ["sunday", 0],
  ["monday", 1],
  ["tuesday", 2],
  ["wednesday", 3],
  ["thursday", 4],
  ["friday", 5],
  ["saturday", 6]
]);

const VIETNAMESE_WEEKDAY = new Map<string, number>([
  ["chu nhat", 0],
  ["thu hai", 1],
  ["thu ba", 2],
  ["thu tu", 3],
  ["thu nam", 4],
  ["thu sau", 5],
  ["thu bay", 6]
]);

function localDateTimeToIso(parts: LocalDateTimeParts): string | null {
  const value = new Date(
    parts.year,
    parts.monthIndex,
    parts.day,
    parts.hour,
    parts.minute,
    0,
    0
  );
  if (
    value.getFullYear() !== parts.year ||
    value.getMonth() !== parts.monthIndex ||
    value.getDate() !== parts.day ||
    value.getHours() !== parts.hour ||
    value.getMinutes() !== parts.minute ||
    value.getDay() !== parts.weekday
  ) {
    return null;
  }
  return value.toISOString();
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  const value = new Date(Date.UTC(year, month - 1, day));
  return (
    value.getUTCFullYear() === year &&
    value.getUTCMonth() === month - 1 &&
    value.getUTCDate() === day
  );
}

/**
 * Facebook exposes full viewer-local timestamps in permalink aria-labels.
 * Only the two unambiguous, full date + year + time formats below are accepted.
 * Partial dates, numeric locale dates, and English 12-hour times without AM/PM
 * intentionally stay unknown.
 */
export function parseFacebookAbsoluteTimeLabel(value: string): string | null {
  const normalized = normalizedLabel(value);
  const vietnamese =
    /^(chu nhat|thu hai|thu ba|thu tu|thu nam|thu sau|thu bay), (\d{1,2}) thang (\d{1,2}), (\d{4}) luc (\d{1,2}):(\d{2})$/u.exec(
      normalized
    );
  if (vietnamese) {
    const weekday = VIETNAMESE_WEEKDAY.get(vietnamese[1] ?? "");
    const day = Number(vietnamese[2]);
    const month = Number(vietnamese[3]);
    const year = Number(vietnamese[4]);
    const hour = Number(vietnamese[5]);
    const minute = Number(vietnamese[6]);
    if (
      weekday === undefined ||
      month < 1 ||
      month > 12 ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59
    ) {
      return null;
    }
    return localDateTimeToIso({
      year,
      monthIndex: month - 1,
      day,
      hour,
      minute,
      weekday
    });
  }

  const english =
    /^(sunday|monday|tuesday|wednesday|thursday|friday|saturday), (january|february|march|april|may|june|july|august|september|october|november|december) (\d{1,2}), (\d{4}) at (\d{1,2}):(\d{2}) (am|pm)$/u.exec(
      normalized
    );
  if (!english) return null;

  const weekday = ENGLISH_WEEKDAY.get(english[1] ?? "");
  const monthIndex = ENGLISH_MONTH_INDEX.get(english[2] ?? "");
  const day = Number(english[3]);
  const year = Number(english[4]);
  const hour12 = Number(english[5]);
  const minute = Number(english[6]);
  const meridiem = english[7];
  if (
    weekday === undefined ||
    monthIndex === undefined ||
    hour12 < 1 ||
    hour12 > 12 ||
    minute < 0 ||
    minute > 59 ||
    (meridiem !== "am" && meridiem !== "pm")
  ) {
    return null;
  }
  const hour = (hour12 % 12) + (meridiem === "pm" ? 12 : 0);
  return localDateTimeToIso({
    year,
    monthIndex,
    day,
    hour,
    minute,
    weekday
  });
}

function parseFacebookCompactTimeLabel(
  value: string,
  now: Date
): string | null {
  const normalized = normalizedLabel(value);
  const vietnamese =
    /^(\d{1,2}) thang (\d{1,2}) luc (\d{1,2}):(\d{2})$/u.exec(normalized);
  if (!vietnamese) return null;

  const day = Number(vietnamese[1]);
  const month = Number(vietnamese[2]);
  const hour = Number(vietnamese[3]);
  const minute = Number(vietnamese[4]);
  if (
    month < 1 ||
    month > 12 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  let year = now.getFullYear();
  let parsed = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (parsed.getTime() > now.getTime() + 24 * 60 * 60 * 1_000) {
    year -= 1;
    parsed = new Date(year, month - 1, day, hour, minute, 0, 0);
  }
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day ||
    parsed.getHours() !== hour ||
    parsed.getMinutes() !== minute
  ) {
    return null;
  }
  return parsed.toISOString();
}

function timestampFromRoot(root: Element, now: Date): TimestampResult {
  const candidates: string[] = [];
  for (const element of root.querySelectorAll(
    "[data-sl-published-at], time[datetime], abbr[data-utime]"
  )) {
    const direct =
      element.getAttribute("data-sl-published-at") ??
      element.getAttribute("datetime") ??
      element.getAttribute("data-utime");
    if (direct) candidates.push(direct);
  }

  for (const candidate of candidates) {
    if (/^\d{9,13}$/u.test(candidate)) {
      const numeric = Number(candidate);
      const millis = candidate.length <= 10 ? numeric * 1_000 : numeric;
      const parsedEpoch = new Date(millis);
      if (Number.isFinite(parsedEpoch.getTime())) {
        return {
          publishedAt: parsedEpoch.toISOString(),
          timeParseStatus: "parsed"
        };
      }
    }

    const iso =
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/u.exec(
        candidate
      );
    if (iso) {
      const year = Number(iso[1]);
      const month = Number(iso[2]);
      const day = Number(iso[3]);
      const hour = Number(iso[4]);
      const minute = Number(iso[5]);
      const second = iso[6] === undefined ? 0 : Number(iso[6]);
      if (
        !isValidCalendarDate(year, month, day) ||
        hour > 23 ||
        minute > 59 ||
        second > 59
      ) {
        continue;
      }
      const parsed = Date.parse(candidate);
      if (!Number.isFinite(parsed)) continue;
      return {
        publishedAt: new Date(parsed).toISOString(),
        timeParseStatus: "parsed"
      };
    }
  }

  // Facebook's current feed reorders timestamp characters with CSS. In the
  // live page textContent is scrambled, while innerText is the date users see.
  for (const element of root.querySelectorAll("[aria-labelledby]")) {
    const compact = parseFacebookCompactTimeLabel(visibleText(element), now);
    if (compact) {
      return { publishedAt: compact, timeParseStatus: "parsed" };
    }
  }

  for (const element of root.querySelectorAll(
    "[data-sl-relative-time], a[aria-label][href*='/posts/'], a[aria-label][href*='comment_id='], a[href*='/posts/'] [aria-label], a[href*='comment_id='] [aria-label]"
  )) {
    const label =
      element.getAttribute("data-sl-relative-time") ??
      element.getAttribute("aria-label") ??
      "";
    const absolute = parseFacebookAbsoluteTimeLabel(label);
    if (absolute) {
      return { publishedAt: absolute, timeParseStatus: "parsed" };
    }

    const normalized = normalizedLabel(label);
    if (/^(?:vua xong|just now|a moment ago)$/u.test(normalized)) {
      return {
        publishedAt: now.toISOString(),
        timeParseStatus: "parsed"
      };
    }
    const match =
      /^(\d+)\s*(giay|second|seconds|sec|phut|minute|minutes|min|gio|hour|hours|hr|ngay|day|days)(?: ago| truoc)?$/u.exec(
        normalized
      );
    if (match?.[1] && match[2]) {
      const amount = Number(match[1]);
      const unit = match[2];
      const multiplier =
        /giay|second|sec/u.test(unit)
          ? 1_000
          : /phut|minute|min/u.test(unit)
            ? 60_000
            : /gio|hour|hr/u.test(unit)
              ? 3_600_000
              : 86_400_000;
      const relativeDate = new Date(now.getTime() - amount * multiplier);
      if (Number.isFinite(relativeDate.getTime())) {
        return {
          publishedAt: relativeDate.toISOString(),
          timeParseStatus: "parsed"
        };
      }
    }
  }

  return { publishedAt: null, timeParseStatus: "unknown" };
}

function insideWindow(
  publishedAt: string | null,
  windowStartUtc: string | null,
  windowEndUtc: string | null
): boolean {
  const hasWindow = Boolean(windowStartUtc || windowEndUtc);
  if (!publishedAt) return !hasWindow;
  const time = Date.parse(publishedAt);
  if (!Number.isFinite(time)) return !hasWindow;
  if (windowStartUtc && time < Date.parse(windowStartUtc)) return false;
  if (windowEndUtc && time > Date.parse(windowEndUtc)) return false;
  return true;
}

export class FacebookDomAdapter {
  public constructor(
    private readonly document: Document,
    private readonly pageUrl: string,
    private readonly now: Date = new Date()
  ) {}

  public detectAuthState(): AuthState {
    const parsed = new URL(this.pageUrl);
    const path = parsed.pathname.toLocaleLowerCase("en-US");
    if (/\/(?:login|recover)(?:\/|$)/u.test(path)) {
      return { state: "login_required", reason: "Facebook login page detected." };
    }
    if (/\/(?:checkpoint|challenge|two_factor)(?:\/|$)/u.test(path)) {
      return {
        state: "challenge_required",
        reason: "Facebook checkpoint or 2FA page detected."
      };
    }

    if (
      this.document.querySelector(
        "iframe[src*='captcha'], input[name='captcha_response'], [data-testid='captcha']"
      )
    ) {
      return {
        state: "challenge_required",
        reason: "Facebook CAPTCHA detected."
      };
    }

    if (
      this.document.querySelector(
        "form[action*='/login'], input[name='email'], input[name='pass']"
      )
    ) {
      return { state: "login_required", reason: "Facebook login form detected." };
    }

    const challengeText = normalizedLabel(
      [
        this.document.title,
        ...Array.from(
          this.document.querySelectorAll(
            "[role='dialog'], [data-testid='checkpoint_title']"
          ),
          visibleText
        )
      ].join(" ")
    );
    if (
      /two.factor|captcha|security check|kiem tra bao mat|xac thuc hai yeu to/u.test(
        challengeText
      )
    ) {
      return {
        state: "challenge_required",
        reason: "Facebook security challenge detected."
      };
    }

    return { state: "authenticated" };
  }

  public extractJoinedGroups(maxGroups = 500): SafeSourceDto[] {
    const roots = [
      ...this.document.querySelectorAll(
        "[data-sl-joined-groups], main, [role='main']"
      )
    ];
    const scope = roots.length > 0 ? roots : [this.document.documentElement];
    const seen = new Set<string>();
    const groups: SafeSourceDto[] = [];

    for (const root of scope) {
      for (const anchor of root.querySelectorAll("a[href*='/groups/']")) {
        const href = readHref(anchor);
        if (!href) continue;
        const canonical = canonicalGroupUrl(
          new URL(href, this.pageUrl).toString()
        );
        if (!canonical) continue;

        const parsed = new URL(canonical);
        const match = /^\/groups\/([^/]+)\/?$/u.exec(parsed.pathname);
        const externalId = match?.[1]
          ? decodeURIComponent(match[1]).slice(0, 200)
          : null;
        if (
          !externalId ||
          GROUP_RESERVED_PATHS.has(externalId.toLocaleLowerCase("en-US")) ||
          seen.has(externalId)
        ) {
          continue;
        }

        const name = visibleText(anchor).slice(0, 300);
        if (!name) continue;
        seen.add(externalId);
        groups.push({ externalId, name, canonicalUrl: canonical });
        if (groups.length >= maxGroups) {
          assertPrivacySafePayload(groups);
          return groups;
        }
      }
    }

    assertPrivacySafePayload(groups);
    return groups;
  }

  public expectedJoinedGroupCount(): number | null {
    for (const element of this.document.querySelectorAll(
      "h1, h2, h3, [role='heading'], [data-sl-joined-groups-count]"
    )) {
      const label = normalizedLabel(
        element.getAttribute("aria-label") ?? visibleText(element)
      );
      const match =
        /tat ca cac nhom ban da tham gia\s*\((\d+)\)/u.exec(label) ??
        /all (?:the )?groups you(?:'|’)ve joined\s*\((\d+)\)/u.exec(label);
      const count = match?.[1] ? Number.parseInt(match[1], 10) : Number.NaN;
      if (Number.isSafeInteger(count) && count >= 0 && count <= 10_000) {
        return count;
      }
    }
    return null;
  }

  private hasExactStatus(
    markerSelector: string,
    expectedLabels: ReadonlySet<string>
  ): boolean {
    for (const element of this.document.querySelectorAll(
      `${markerSelector}, [role='status']`
    )) {
      const label =
        element.getAttribute("aria-label") ??
        element.getAttribute("data-sl-end-label") ??
        visibleText(element);
      if (expectedLabels.has(normalizedLabel(label))) {
        return true;
      }
    }
    return false;
  }

  public hasExplicitGroupListEnd(): boolean {
    return this.hasExactStatus(
      "[data-sl-groups-end='true']",
      GROUP_LIST_END_LABELS
    );
  }

  public hasExplicitPostSearchEnd(): boolean {
    return this.hasExactStatus(
      "[data-sl-post-search-end='true']",
      POST_SEARCH_END_LABELS
    );
  }

  public findPostRoots(): Element[] {
    const candidates = uniqueElements(
      POST_ROOT_SELECTORS.flatMap((selector) => [
        ...this.document.querySelectorAll(selector)
      ])
    );

    return candidates.filter((candidate) => {
      const ownLink = this.findPostUrl(candidate);
      if (!ownLink) return false;
      return !candidates.some(
        (other) =>
          other !== candidate &&
          other.contains(candidate) &&
          this.findPostUrl(other) === ownLink
      );
    });
  }

  private findPostUrl(root: Element): string | null {
    for (const anchor of root.querySelectorAll(
      "a[href*='/posts/'], a[href*='/permalink/']"
    )) {
      const href = readHref(anchor);
      if (!href) continue;
      const canonical = canonicalPostUrl(new URL(href, this.pageUrl).toString());
      if (canonical) return canonical;
    }
    return null;
  }

  public extractPosts(options: PostExtractionOptions): SafePostDto[] {
    const posts: SafePostDto[] = [];
    const seen = new Set<string>();

    for (const root of this.findPostRoots()) {
      const url = this.findPostUrl(root);
      const externalId = url ? parsePostExternalId(url) : null;
      if (!url || !externalId || seen.has(externalId)) continue;

      const body = findFirstText(root, [
        "[data-sl-post-body]",
        "[data-ad-preview='message']",
        "[data-testid='post_message']"
      ]).slice(0, 100_000);
      if (!body) continue;

      const matched = options.keywords.filter((keyword) =>
        keywordMatches(body, keyword)
      );
      if (options.keywords.length > 0 && matched.length === 0) continue;

      const timestamp = timestampFromRoot(root, this.now);
      if (
        !insideWindow(
          timestamp.publishedAt,
          options.windowStartUtc,
          options.windowEndUtc
        )
      ) {
        continue;
      }

      seen.add(externalId);
      posts.push({
        externalId,
        sourceExternalId: options.sourceExternalId,
        url,
        body,
        publishedAt: timestamp.publishedAt,
        collectedAt: this.now.toISOString(),
        timeParseStatus: timestamp.timeParseStatus,
        matchedKeywordIds: matched.flatMap((keyword) =>
          keyword.id ? [keyword.id] : []
        ),
        author: authorFromRoot(root, false)
      });
      if (posts.length >= options.maxPosts) break;
    }

    assertPrivacySafePayload(posts);
    return posts;
  }

  private queryCommentRoots(scope: ParentNode): Element[] {
    const explicit = uniqueElements(
      COMMENT_ROOT_SELECTORS.flatMap((selector) => [
        ...scope.querySelectorAll(selector)
      ])
    );
    const explicitSet = new Set(explicit);
    const fallback = [...scope.querySelectorAll("div[role='article']")].filter(
      (element) =>
        Boolean(
          element.querySelector(
            "a[href*='comment_id='], [data-sl-comment-body], [data-commentid]"
          )
        ) &&
        !element.querySelector(
          "[data-ad-rendering-role='story_message'], [data-sl-post-body]"
        ) &&
        !explicit.some(
          (commentRoot) =>
            commentRoot !== element && element.contains(commentRoot)
        )
    );

    return uniqueElements([...explicit, ...fallback]).filter(
      (element) =>
        explicitSet.has(element) ||
        !element.querySelector(
          "[data-ad-rendering-role='story_message'], [data-sl-post-body]"
        )
    );
  }

  private findCommentRoots(postExternalId: string): Element[] {
    const matchingPostRoots = this.findPostRoots().filter((root) => {
      const postUrl = this.findPostUrl(root);
      return postUrl
        ? parsePostExternalId(postUrl) === postExternalId
        : false;
    });
    const pagePostExternalId = parsePostExternalId(this.pageUrl);

    return this.queryCommentRoots(this.document).filter((root) => {
      const url = this.findCommentUrl(root);
      if (url) {
        return parsePostExternalId(url) === postExternalId;
      }

      if (
        matchingPostRoots.some(
          (postRoot) => postRoot === root || postRoot.contains(root)
        )
      ) {
        return true;
      }

      return (
        matchingPostRoots.length === 0 &&
        pagePostExternalId === postExternalId
      );
    });
  }

  public hasExplicitCommentEnd(): boolean {
    return this.hasExactStatus(
      "[data-sl-comments-end='true']",
      COMMENT_END_LABELS
    );
  }

  private findCommentUrl(root: Element): string | null {
    for (const anchor of root.querySelectorAll("a[href*='comment_id=']")) {
      const owner = anchor.closest(COMMENT_OWNER_SELECTOR);
      if (owner && owner !== root && root.contains(owner)) {
        continue;
      }
      const href = readHref(anchor);
      if (!href) continue;
      const canonical = canonicalCommentUrl(
        new URL(href, this.pageUrl).toString()
      );
      if (canonical && parseCommentExternalId(canonical)) {
        return canonical;
      }
    }
    return null;
  }

  public extractComments(options: CommentExtractionOptions): SafeCommentDto[] {
    const comments: SafeCommentDto[] = [];
    const seen = new Set<string>();
    const roots = this.findCommentRoots(options.postExternalId);
    const idsByElement = new Map<Element, string>();
    const urlsByElement = new Map<Element, string | null>();
    const authorLabelsByElement = new Map<Element, string>();

    roots.forEach((root, index) => {
      const url = this.findCommentUrl(root);
      urlsByElement.set(root, url);
      const body = findCommentBody(root);
      const explicitId =
        root.getAttribute("data-sl-comment-id") ??
        root.getAttribute("data-commentid") ??
        root.getAttribute("data-comment-id") ??
        (url ? parseCommentExternalId(url) : null);
      const author = authorFromRoot(root, true);
      const externalId =
        explicitId ??
        `derived:${fnv1a(
          `${options.postExternalId}|${author.authorName ?? "anonymous"}|${body}|${String(index)}`
        )}`;
      idsByElement.set(root, externalId.slice(0, 200));
      authorLabelsByElement.set(
        root,
        normalizedLabel(authorCandidateFromRoot(root, true))
      );
    });

    for (const [rootIndex, root] of roots.entries()) {
      const externalId = idsByElement.get(root);
      if (!externalId || seen.has(externalId)) continue;

      const body = findCommentBody(root);
      if (!body) continue;

      const url = urlsByElement.get(root) ?? null;
      const urlParentCommentExternalId = url
        ? parseParentCommentExternalId(url)
        : null;
      let parentCommentExternalId =
        root.getAttribute("data-parent-comment-id") ?? null;
      if (!parentCommentExternalId) {
        let ancestor = root.parentElement;
        while (ancestor) {
          const parentId = idsByElement.get(ancestor);
          if (parentId) {
            parentCommentExternalId = parentId;
            break;
          }
          ancestor = ancestor.parentElement;
        }
      }

      // Facebook often flattens every reply in a thread and keeps comment_id
      // pointing at the top-level comment. The visible @name at the beginning
      // of the reply is the only safe, name-only signal for the direct parent.
      if (!parentCommentExternalId && urlParentCommentExternalId) {
        const targetAuthor = normalizedLabel(replyTargetAuthorFromBody(root));
        if (targetAuthor) {
          for (let index = rootIndex - 1; index >= 0; index -= 1) {
            const candidateRoot = roots[index];
            const candidateUrl = candidateRoot
              ? (urlsByElement.get(candidateRoot) ?? null)
              : null;
            const candidateId = candidateRoot
              ? (idsByElement.get(candidateRoot) ?? null)
              : null;
            const belongsToThread =
              candidateId === urlParentCommentExternalId ||
              (candidateUrl !== null &&
                parseThreadRootExternalId(candidateUrl) ===
                  urlParentCommentExternalId);
            if (
              candidateRoot &&
              belongsToThread &&
              authorLabelsByElement.get(candidateRoot) === targetAuthor
            ) {
              parentCommentExternalId = candidateId;
              break;
            }
          }
        }
      }
      if (!parentCommentExternalId) {
        parentCommentExternalId = urlParentCommentExternalId;
      }

      const timestamp = timestampFromRoot(root, this.now);
      seen.add(externalId);
      comments.push({
        externalId,
        postExternalId: options.postExternalId,
        parentCommentExternalId,
        url,
        body,
        publishedAt: timestamp.publishedAt,
        collectedAt: this.now.toISOString(),
        timeParseStatus: timestamp.timeParseStatus,
        observedOrder: rootIndex,
        author: authorFromRoot(root, true)
      });
      if (comments.length >= options.maxComments) break;
    }

    assertPrivacySafePayload(comments);
    return comments;
  }

  public extractCurrentPost(
    options: Omit<PostExtractionOptions, "maxPosts">
  ): SafePostDto | null {
    return this.extractPosts({ ...options, maxPosts: 1 })[0] ?? null;
  }
}

export function extractVisibleAuthorForTest(
  root: Element,
  comment = false
): SafeAuthorDto {
  const result = authorFromRoot(root, comment);
  if (result.authorKind === "real") {
    result.authorName = sanitizeAuthorName(result.authorName);
  }
  return result;
}
