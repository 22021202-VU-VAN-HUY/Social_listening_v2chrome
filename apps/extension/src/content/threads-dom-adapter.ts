import { assertPrivacySafePayload, makeSafeAuthor } from "../shared/privacy";
import type {
  AuthState,
  CrawlKeyword,
  SafeCommentDto,
  SafePostDto
} from "../shared/types";
import { keywordMatches } from "./facebook-dom-adapter";
import {
  canonicalThreadsPostUrl,
  threadsShortcode
} from "./threads-urls";

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

interface ThreadsCard {
  root: Element;
  externalId: string;
  url: string;
  body: string;
  publishedAt: string | null;
}

function visibleText(element: Element | null): string {
  if (!element) return "";
  const rendered =
    "innerText" in element && typeof element.innerText === "string"
      ? element.innerText
      : element.textContent ?? "";
  return rendered.replace(/\s+/gu, " ").trim();
}

function cardRoot(link: Element): Element | null {
  return (
    link.closest("[data-pressable-container='true']") ??
    link.closest("article") ??
    link.closest("[role='article']")
  );
}

function isContentText(element: Element, root: Element): boolean {
  if (!visibleText(element)) return false;
  if (element.closest("a, button, [role='button'], [contenteditable='true']")) {
    return false;
  }
  let parent = element.parentElement;
  while (parent && parent !== root) {
    if (
      parent.matches("[dir='auto']") &&
      !parent.closest("a, button, [role='button'], [contenteditable='true']")
    ) {
      return false;
    }
    parent = parent.parentElement;
  }
  return true;
}

function bodyFromCard(root: Element): string {
  const parts: string[] = [];
  for (const element of root.querySelectorAll("[dir='auto']")) {
    if (!isContentText(element, root)) continue;
    const text = visibleText(element);
    if (!text || parts.includes(text)) continue;
    parts.push(text);
  }
  return parts.join("\n").trim().slice(0, 200_000);
}

function timestampFromCard(root: Element): string | null {
  const raw = root.querySelector("time[datetime]")?.getAttribute("datetime");
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function isInsideWindow(
  publishedAt: string | null,
  startUtc: string | null,
  endUtc: string | null
): boolean {
  if (!publishedAt) return true;
  const value = Date.parse(publishedAt);
  const start = startUtc ? Date.parse(startUtc) : Number.NEGATIVE_INFINITY;
  const end = endUtc ? Date.parse(endUtc) : Number.POSITIVE_INFINITY;
  return value >= start && value <= end;
}

export class ThreadsDomAdapter {
  public constructor(
    private readonly document: Document,
    private readonly pageUrl: string
  ) {}

  public detectAuthState(): AuthState {
    const location = new URL(this.pageUrl);
    const pageText = visibleText(this.document.documentElement)
      .toLocaleLowerCase("vi-VN")
      .slice(0, 10_000);
    if (
      location.pathname.includes("challenge") ||
      pageText.includes("xác nhận danh tính") ||
      pageText.includes("confirm your identity")
    ) {
      return {
        state: "challenge_required",
        reason: "Threads requires an account verification challenge."
      };
    }
    if (
      this.document.querySelector("input[name='username'], input[name='password']") ||
      this.document.querySelector("a[href*='/login']")
    ) {
      return {
        state: "login_required",
        reason: "Sign in to Threads in Chrome before starting the collector."
      };
    }
    const authenticatedNavigation = this.document.querySelector(
      "a[href^='/messages'], a[href^='/activity'], a[href^='/saved']"
    );
    return authenticatedNavigation
      ? { state: "authenticated" }
      : {
          state: "login_required",
          reason: "The Threads signed-in navigation was not detected."
        };
  }

  private cards(): ThreadsCard[] {
    const cards = new Map<string, ThreadsCard>();
    for (const link of this.document.querySelectorAll(
      "a[href*='/post/'], a[href*='/t/']"
    )) {
      if (!link.querySelector("time")) continue;
      const href = link.getAttribute("href");
      if (!href) continue;
      const url = canonicalThreadsPostUrl(new URL(href, this.pageUrl).toString());
      const externalId = threadsShortcode(href);
      const root = cardRoot(link);
      if (!url || !externalId || !root || cards.has(externalId)) continue;
      const body = bodyFromCard(root);
      if (!body) continue;
      cards.set(externalId, {
        root,
        externalId,
        url,
        body,
        publishedAt: timestampFromCard(root)
      });
    }
    return [...cards.values()];
  }

  public extractPosts(options: PostExtractionOptions): SafePostDto[] {
    const collectedAt = new Date().toISOString();
    const posts: SafePostDto[] = [];
    for (const card of this.cards()) {
      if (posts.length >= options.maxPosts) break;
      if (
        !isInsideWindow(
          card.publishedAt,
          options.windowStartUtc,
          options.windowEndUtc
        )
      ) {
        continue;
      }
      const matchedKeywordIds = options.keywords
        .filter((keyword) => keywordMatches(card.body, keyword))
        .flatMap((keyword) => (keyword.id ? [keyword.id] : []));
      if (matchedKeywordIds.length === 0) continue;
      posts.push({
        externalId: card.externalId,
        sourceExternalId: options.sourceExternalId,
        url: card.url,
        body: card.body,
        publishedAt: card.publishedAt,
        collectedAt,
        timeParseStatus: card.publishedAt ? "parsed" : "unknown",
        matchedKeywordIds,
        author: makeSafeAuthor(null, false)
      });
    }
    assertPrivacySafePayload(posts);
    return posts;
  }

  public extractCurrentPost(
    options: Omit<PostExtractionOptions, "maxPosts">
  ): SafePostDto | null {
    const currentId = threadsShortcode(this.pageUrl);
    if (!currentId) return null;
    return (
      this.extractPosts({ ...options, maxPosts: 500 }).find(
        (post) => post.externalId === currentId
      ) ?? null
    );
  }

  public extractComments(options: CommentExtractionOptions): SafeCommentDto[] {
    const collectedAt = new Date().toISOString();
    const comments: SafeCommentDto[] = [];
    for (const card of this.cards()) {
      if (comments.length >= options.maxComments) break;
      if (card.externalId === options.postExternalId) continue;
      comments.push({
        externalId: card.externalId,
        postExternalId: options.postExternalId,
        parentCommentExternalId: null,
        observedOrder: comments.length,
        url: card.url,
        body: card.body,
        publishedAt: card.publishedAt,
        collectedAt,
        timeParseStatus: card.publishedAt ? "parsed" : "unknown",
        author: makeSafeAuthor(null, false)
      });
    }
    assertPrivacySafePayload(comments);
    return comments;
  }

  public hasExplicitSearchEnd(): boolean {
    const text = visibleText(this.document.querySelector("main, [role='main']"))
      .toLocaleLowerCase("vi-VN");
    return /không có kết quả|no results|end of results/iu.test(text);
  }

  public hasExplicitCommentEnd(): boolean {
    const text = visibleText(this.document.querySelector("main, [role='main']"))
      .toLocaleLowerCase("vi-VN");
    return /chưa có câu trả lời|no replies yet|no replies/iu.test(text);
  }
}
