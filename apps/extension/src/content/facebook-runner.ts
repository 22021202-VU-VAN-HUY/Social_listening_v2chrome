import { assertPrivacySafePayload } from "../shared/privacy";
import type {
  AuthState,
  ContentCommand,
  CoverageStatus,
  CrawlPostResult,
  CrawlSearchResult,
  DiscoverGroupsResult,
  SafeCommentDto,
  SafePostDto,
  SafeSourceDto
} from "../shared/types";
import { FacebookDomAdapter } from "./facebook-dom-adapter";
import { readRunMarker, RUN_MARKER_KEY } from "./facebook-urls";
import {
  isSafeReadControlElement,
  type SafeReadControlMode
} from "./safe-read-controls";

const SESSION_RUN_KEY = "__listening_social_owned_run";

interface CoverageAssessment {
  coverageStatus: CoverageStatus;
  partialReason?: string;
}

function assessBoundedCoverage(
  hitLimit: boolean,
  explicitEndProven: boolean,
  limitReason: string,
  unknownReason: string
): CoverageAssessment {
  if (hitLimit) {
    return {
      coverageStatus: "partial",
      partialReason: limitReason
    };
  }
  if (explicitEndProven) {
    return { coverageStatus: "complete" };
  }
  return {
    coverageStatus: "unknown",
    partialReason: unknownReason
  };
}

export function assessCommentCoverage(
  hitLimit: boolean,
  explicitEndProven: boolean
): CoverageAssessment {
  return assessBoundedCoverage(
    hitLimit,
    explicitEndProven,
    "comment_limit_reached",
    "comment_end_not_proven"
  );
}

export function assessGroupListCoverage(
  hitLimit: boolean,
  explicitEndProven: boolean
): CoverageAssessment {
  return assessBoundedCoverage(
    hitLimit,
    explicitEndProven,
    "group_limit_reached",
    "group_list_end_not_proven"
  );
}

export function assessPostSearchCoverage(
  hitLimit: boolean,
  explicitEndProven: boolean
): CoverageAssessment {
  return assessBoundedCoverage(
    hitLimit,
    explicitEndProven,
    "post_limit_reached",
    "post_search_end_not_proven"
  );
}

function abortError(): DOMException {
  return new DOMException("Crawl cancelled.", "AbortError");
}

function safeSessionGet(win: Window): string | null {
  try {
    return win.sessionStorage.getItem(SESSION_RUN_KEY);
  } catch {
    return null;
  }
}

function safeSessionSet(win: Window, runId: string): void {
  try {
    win.sessionStorage.setItem(SESSION_RUN_KEY, runId);
  } catch {
    // Ownership also remains in the service worker record and URL marker.
  }
}

function waitForMutation(
  document: Document,
  timeoutMs: number,
  signal: AbortSignal
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }

    let settled = false;
    const finish = (changed: boolean): void => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(changed);
    };
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      reject(abortError());
    };
    const observer = new MutationObserver(() => finish(true));
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: false
    });
    const timer = setTimeout(() => finish(false), timeoutMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export class FacebookContentRunner {
  private assignedRunId: string | null;
  private activeController: AbortController | null = null;

  public constructor(
    private readonly document: Document,
    private readonly win: Window
  ) {
    this.assignedRunId =
      readRunMarker(win.location.href) ?? safeSessionGet(win) ?? null;
    if (this.assignedRunId) {
      safeSessionSet(win, this.assignedRunId);
    }
  }

  private adapter(): FacebookDomAdapter {
    return new FacebookDomAdapter(this.document, this.win.location.href);
  }

  private requireOwnership(runId: string): void {
    if (!this.assignedRunId || this.assignedRunId !== runId) {
      throw new Error("Content script is not assigned to this run.");
    }
  }

  private beginOperation(runId: string): AbortSignal {
    this.requireOwnership(runId);
    this.activeController?.abort();
    this.activeController = new AbortController();
    return this.activeController.signal;
  }

  private clickVerifiedControl(
    mode: SafeReadControlMode,
    element: Element
  ): boolean {
    if (!isSafeReadControlElement(mode, element)) return false;
    element.click();
    return true;
  }

  private clickSafeControls(mode: SafeReadControlMode): number {
    let clicked = 0;
    for (const element of this.document.querySelectorAll(
      "button, [role='button'], [role='menuitem'], [role='menuitemradio']"
    )) {
      if (clicked >= 12) break;
      if (!this.clickVerifiedControl(mode, element)) continue;
      clicked += 1;
    }
    return clicked;
  }

  private findSafeControl(
    mode: SafeReadControlMode,
    selector: string
  ): HTMLElement | null {
    for (const element of this.document.querySelectorAll(selector)) {
      if (isSafeReadControlElement(mode, element)) return element;
    }
    return null;
  }

  private async waitForSafeControl(
    mode: SafeReadControlMode,
    selector: string,
    timeoutMs: number,
    signal: AbortSignal
  ): Promise<HTMLElement | null> {
    if (signal.aborted) throw abortError();
    const existing = this.findSafeControl(mode, selector);
    if (existing) return existing;

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (element: HTMLElement | null): void => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        resolve(element);
      };
      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timer);
        reject(abortError());
      };
      const observer = new MutationObserver(() => {
        const element = this.findSafeControl(mode, selector);
        if (element) finish(element);
      });
      observer.observe(this.document.documentElement, {
        childList: true,
        subtree: true
      });
      const timer = setTimeout(() => finish(null), timeoutMs);
      signal.addEventListener("abort", onAbort, { once: true });

      // Close the gap between the initial lookup and observer registration.
      const afterObserve = this.findSafeControl(mode, selector);
      if (afterObserve) finish(afterObserve);
    });
  }

  private async selectAllCommentsFilter(
    timeoutMs: number,
    signal: AbortSignal
  ): Promise<void> {
    const optionSelector = "[role='menuitem'], [role='menuitemradio']";
    const triggerSelector = "button, [role='button']";

    const alreadyOpen = this.findSafeControl(
      "comment_filter_option",
      optionSelector
    );
    if (alreadyOpen) {
      this.clickVerifiedControl("comment_filter_option", alreadyOpen);
      return;
    }

    // A closed trigger labelled "All comments" means the desired filter is
    // already selected. Do not click it, because that would toggle the menu.
    if (
      this.findSafeControl("comment_filter_option", triggerSelector)
    ) {
      return;
    }

    const trigger = this.findSafeControl(
      "comment_filter_trigger",
      triggerSelector
    );
    if (!trigger) return;

    // Open exactly once. If the option does not materialize, leave the filter
    // unresolved; later coverage remains unknown instead of toggling repeatedly.
    this.clickVerifiedControl("comment_filter_trigger", trigger);
    const option = await this.waitForSafeControl(
      "comment_filter_option",
      optionSelector,
      timeoutMs,
      signal
    );
    if (option) {
      this.clickVerifiedControl("comment_filter_option", option);
    }
  }

  private async scrollOnce(
    mode: "groups" | "posts" | "comments",
    timeoutMs: number,
    signal: AbortSignal
  ): Promise<boolean> {
    if (signal.aborted) throw abortError();
    this.clickSafeControls(mode);
    const before = this.document.documentElement.scrollHeight;
    const groupScroller =
      mode === "groups" ? this.findJoinedGroupsScroller() : null;
    const groupScrollTop = groupScroller?.scrollTop ?? 0;
    if (groupScroller) {
      const step = Math.max(groupScroller.clientHeight * 0.8, 600);
      groupScroller.scrollTop = Math.min(
        groupScroller.scrollHeight,
        groupScroller.scrollTop + step
      );
      groupScroller.dispatchEvent(new Event("scroll"));
    }
    this.win.scrollTo({ top: before, behavior: "auto" });
    const changed = await waitForMutation(this.document, timeoutMs, signal);
    const after = this.document.documentElement.scrollHeight;
    return (
      changed ||
      after > before ||
      Boolean(groupScroller && groupScroller.scrollTop > groupScrollTop)
    );
  }

  private findJoinedGroupsScroller(): HTMLElement | null {
    const candidates = new Set<HTMLElement>();
    for (const anchor of this.document.querySelectorAll(
      "main a[href*='/groups/'], [role='main'] a[href*='/groups/']"
    )) {
      let ancestor = anchor.parentElement;
      while (ancestor && ancestor !== this.document.body) {
        if (
          ancestor.scrollHeight > ancestor.clientHeight + 8 &&
          ancestor.clientHeight > 0
        ) {
          candidates.add(ancestor);
        }
        ancestor = ancestor.parentElement;
      }
    }

    return (
      [...candidates].sort(
        (left, right) =>
          right.scrollHeight -
          right.clientHeight -
          (left.scrollHeight - left.clientHeight)
      )[0] ?? null
    );
  }

  private async discover(command: Extract<
    ContentCommand,
    { type: "DISCOVER_GROUPS" }
  >): Promise<DiscoverGroupsResult> {
    const signal = this.beginOperation(command.runId);
    const byId = new Map<string, SafeSourceDto>();
    let plateau = 0;
    let hitLimit = false;
    let expectedCount: number | null = null;

    for (let round = 0; round < command.limits.maxScrollRounds; round += 1) {
      const before = byId.size;
      const adapter = this.adapter();
      expectedCount = adapter.expectedJoinedGroupCount() ?? expectedCount;
      for (const source of adapter.extractJoinedGroups(
        command.limits.maxGroups
      )) {
        byId.set(source.externalId, source);
      }
      if (byId.size >= command.limits.maxGroups) {
        hitLimit = true;
        break;
      }
      if (expectedCount !== null && byId.size >= expectedCount) {
        break;
      }

      const changed = await this.scrollOnce(
        "groups",
        command.limits.mutationWaitMs,
        signal
      );
      plateau = byId.size === before && !changed ? plateau + 1 : 0;
      if (plateau >= 2 && expectedCount === null) break;
    }

    const expectedCountReached =
      expectedCount !== null && byId.size >= expectedCount;
    const coverage = expectedCountReached
      ? { coverageStatus: "complete" as const }
      : assessGroupListCoverage(
          hitLimit,
          this.adapter().hasExplicitGroupListEnd()
        );
    const result: DiscoverGroupsResult = {
      sources: [...byId.values()],
      ...coverage
    };
    assertPrivacySafePayload(result);
    return result;
  }

  private async crawlSearch(command: Extract<
    ContentCommand,
    { type: "CRAWL_SEARCH" }
  >): Promise<CrawlSearchResult> {
    const signal = this.beginOperation(command.runId);
    const byId = new Map<string, SafePostDto>();
    let plateau = 0;
    let hitLimit = false;

    for (let round = 0; round < command.limits.maxScrollRounds; round += 1) {
      const before = byId.size;
      this.clickSafeControls("posts");
      for (const post of this.adapter().extractPosts({
        sourceExternalId: command.sourceExternalId,
        keywords: command.keywords,
        windowStartUtc: command.windowStartUtc,
        windowEndUtc: command.windowEndUtc,
        maxPosts: command.limits.maxPostsPerGroup
      })) {
        byId.set(post.externalId, post);
      }
      if (byId.size >= command.limits.maxPostsPerGroup) {
        hitLimit = true;
        break;
      }

      const changed = await this.scrollOnce(
        "posts",
        command.limits.mutationWaitMs,
        signal
      );
      plateau = byId.size === before && !changed ? plateau + 1 : 0;
      if (plateau >= 2) break;
    }

    const coverage = assessPostSearchCoverage(
      hitLimit,
      this.adapter().hasExplicitPostSearchEnd()
    );
    const result: CrawlSearchResult = {
      posts: [...byId.values()],
      ...coverage
    };
    assertPrivacySafePayload(result);
    return result;
  }

  private async crawlPost(command: Extract<
    ContentCommand,
    { type: "CRAWL_POST" }
  >): Promise<CrawlPostResult> {
    const signal = this.beginOperation(command.runId);
    const byId = new Map<string, SafeCommentDto>();
    let plateau = 0;
    let hitLimit = false;

    await this.selectAllCommentsFilter(
      command.limits.mutationWaitMs,
      signal
    );

    for (
      let round = 0;
      round < command.limits.maxCommentExpandRounds;
      round += 1
    ) {
      const before = byId.size;
      this.clickSafeControls("comments");
      for (const comment of this.adapter().extractComments({
        postExternalId: command.postExternalId,
        maxComments: command.limits.maxCommentsPerPost
      })) {
        byId.set(comment.externalId, comment);
      }
      if (byId.size >= command.limits.maxCommentsPerPost) {
        hitLimit = true;
        break;
      }

      const changed = await this.scrollOnce(
        "comments",
        command.limits.mutationWaitMs,
        signal
      );
      plateau = byId.size === before && !changed ? plateau + 1 : 0;
      if (plateau >= 2) break;
    }

    const post = this.adapter().extractCurrentPost({
      sourceExternalId: command.sourceExternalId,
      keywords: command.keywords,
      windowStartUtc: command.windowStartUtc,
      windowEndUtc: command.windowEndUtc
    });
    const coverage = assessCommentCoverage(
      hitLimit,
      this.adapter().hasExplicitCommentEnd()
    );
    const result: CrawlPostResult = {
      post,
      comments: [...byId.values()],
      ...coverage
    };
    assertPrivacySafePayload(result);
    return result;
  }

  public async handle(command: ContentCommand): Promise<unknown> {
    switch (command.type) {
      case "PING":
        return { ok: true, runId: this.assignedRunId };
      case "GET_OWNERSHIP":
        return { runId: this.assignedRunId };
      case "ASSIGN_RUN": {
        const marker = readRunMarker(this.win.location.href);
        const existing = this.assignedRunId ?? marker ?? safeSessionGet(this.win);
        if (existing && existing !== command.runId) {
          throw new Error("Refusing to replace content-script ownership.");
        }
        this.assignedRunId = command.runId;
        safeSessionSet(this.win, command.runId);
        return { assigned: true, runId: command.runId, marker: RUN_MARKER_KEY };
      }
      case "CHECK_AUTH":
        this.requireOwnership(command.runId);
        return this.adapter().detectAuthState() satisfies AuthState;
      case "DISCOVER_GROUPS":
        return this.discover(command);
      case "CRAWL_SEARCH":
        return this.crawlSearch(command);
      case "CRAWL_POST":
        return this.crawlPost(command);
      case "CANCEL_RUN":
        this.requireOwnership(command.runId);
        this.activeController?.abort();
        return { cancelled: true };
    }
  }
}
