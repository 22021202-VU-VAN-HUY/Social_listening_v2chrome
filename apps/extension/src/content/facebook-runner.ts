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

// Facebook can keep a "view more" control alive or mutate unrelated DOM even
// when no additional comments are exposed. Bound those unproductive rounds so
// one post is returned as partial and the durable checkpoint can move forward.
export const COMMENT_NO_GROWTH_ROUND_LIMIT = 6;
export const COMMENT_EXPECTED_NO_GROWTH_ROUND_LIMIT = 10;

interface CoverageAssessment {
  coverageStatus: CoverageStatus;
  partialReason?: string;
}

export interface CrawlProgressSignal {
  type: "CRAWL_PROGRESS";
  runId: string;
  operation: "discover_groups" | "crawl_search" | "crawl_post";
  round: number;
  itemsSeen: number;
}

type ProgressReporter = (progress: CrawlProgressSignal) => void | Promise<void>;

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
    private readonly win: Window,
    private readonly reportProgress: ProgressReporter = () => undefined
  ) {
    this.assignedRunId =
      readRunMarker(win.location.href) ?? safeSessionGet(win) ?? null;
    if (this.assignedRunId) {
      safeSessionSet(win, this.assignedRunId);
    }
  }

  private progress(
    runId: string,
    operation: CrawlProgressSignal["operation"],
    round: number,
    itemsSeen: number
  ): void {
    void Promise.resolve(
      this.reportProgress({
        type: "CRAWL_PROGRESS",
        runId,
        operation,
        round,
        itemsSeen
      })
    ).catch(() => {
      // Progress telemetry must never interrupt the read-only crawl itself.
    });
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

  private clickNextSafeControl(
    mode: SafeReadControlMode,
    scope: ParentNode = this.document
  ): number {
    for (const element of scope.querySelectorAll(
      "button, [role='button'], [role='menuitem'], [role='menuitemradio']"
    )) {
      if (this.clickVerifiedControl(mode, element)) return 1;
    }
    return 0;
  }

  private async clickSafeControlsAndWait(
    mode: SafeReadControlMode,
    timeoutMs: number,
    signal: AbortSignal,
    scope: ParentNode = this.document
  ): Promise<{ changed: boolean; clicked: number }> {
    if (signal.aborted) throw abortError();
    let clicked = 0;
    const changed = await new Promise<boolean>((resolve, reject) => {
      let settled = false;
      const finish = (value: boolean): void => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      };
      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timer);
        reject(abortError());
      };
      const observer = new MutationObserver(() => finish(true));
      observer.observe(this.document.documentElement, {
        childList: true,
        subtree: true,
        attributes: false
      });
      const timer = setTimeout(() => finish(false), timeoutMs);
      signal.addEventListener("abort", onAbort, { once: true });
      // Facebook can discard rapid clicks when several reply branches are
      // opened in the same task. Open one branch, wait for its DOM update, then
      // let the next crawl round process the next control.
      clicked = this.clickNextSafeControl(mode, scope);
      if (clicked === 0) finish(false);
    });
    return { changed, clicked };
  }

  private findSafeControl(
    mode: SafeReadControlMode,
    selector: string,
    scope: ParentNode = this.document
  ): HTMLElement | null {
    for (const element of scope.querySelectorAll(selector)) {
      if (isSafeReadControlElement(mode, element)) return element;
    }
    return null;
  }

  private async waitForSafeControl(
    mode: SafeReadControlMode,
    selector: string,
    timeoutMs: number,
    signal: AbortSignal,
    scope: ParentNode = this.document
  ): Promise<HTMLElement | null> {
    if (signal.aborted) throw abortError();
    const existing = this.findSafeControl(mode, selector, scope);
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
        const element = this.findSafeControl(mode, selector, scope);
        if (element) finish(element);
      });
      observer.observe(this.document.documentElement, {
        childList: true,
        subtree: true
      });
      const timer = setTimeout(() => finish(null), timeoutMs);
      signal.addEventListener("abort", onAbort, { once: true });

      // Close the gap between the initial lookup and observer registration.
      const afterObserve = this.findSafeControl(mode, selector, scope);
      if (afterObserve) finish(afterObserve);
    });
  }

  private async selectAllCommentsFilter(
    timeoutMs: number,
    signal: AbortSignal,
    scope: ParentNode
  ): Promise<boolean> {
    const optionSelector =
      "[role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox'], [role='radio']";
    const triggerSelector = "button, [role='button']";

    const alreadyOpen = this.findSafeControl(
      "comment_filter_option",
      optionSelector,
      scope
    );
    if (alreadyOpen) {
      if (!this.clickVerifiedControl("comment_filter_option", alreadyOpen)) {
        return false;
      }
      return Boolean(
        await this.waitForSafeControl(
          "comment_filter_option",
          triggerSelector,
          timeoutMs,
          signal,
          scope
        )
      );
    }

    // A closed trigger labelled "All comments" means the desired filter is
    // already selected. Do not click it, because that would toggle the menu.
    if (
      this.findSafeControl(
        "comment_filter_option",
        triggerSelector,
        scope
      )
    ) {
      return true;
    }

    const trigger = this.findSafeControl(
      "comment_filter_trigger",
      triggerSelector,
      scope
    );
    // Facebook omits the sort control on very small conversations. In that
    // case there is no alternative filtered view to switch away from.
    if (!trigger) return true;

    if (!this.clickVerifiedControl("comment_filter_trigger", trigger)) {
      return false;
    }
    const option = await this.waitForSafeControl(
      "comment_filter_option",
      optionSelector,
      timeoutMs,
      signal,
      scope
    );
    if (!option || !this.clickVerifiedControl("comment_filter_option", option)) {
      return false;
    }
    return Boolean(
      await this.waitForSafeControl(
        "comment_filter_option",
        triggerSelector,
        timeoutMs,
        signal,
        scope
      )
    );
  }

  private isRecentPostsControlSelected(element: Element): boolean {
    if (!isSafeReadControlElement("post_filter_option", element)) {
      return false;
    }
    if (element.hasAttribute("aria-haspopup")) return true;
    return (
      element.getAttribute("aria-checked") === "true" ||
      element.getAttribute("aria-pressed") === "true" ||
      element.getAttribute("aria-selected") === "true" ||
      /^(active|checked|selected)$/u.test(
        element.getAttribute("data-state") ?? ""
      )
    );
  }

  private findSelectedRecentPostsControl(
    selector: string
  ): HTMLElement | null {
    for (const element of this.document.querySelectorAll(selector)) {
      if (this.isRecentPostsControlSelected(element)) {
        return element as HTMLElement;
      }
    }
    return null;
  }

  private async waitForRecentPostsSelection(
    selector: string,
    timeoutMs: number,
    signal: AbortSignal
  ): Promise<boolean> {
    if (signal.aborted) throw abortError();
    if (this.findSelectedRecentPostsControl(selector)) return true;

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (selected: boolean): void => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        resolve(selected);
      };
      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timer);
        reject(abortError());
      };
      const observer = new MutationObserver(() => {
        if (this.findSelectedRecentPostsControl(selector)) finish(true);
      });
      observer.observe(this.document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          "aria-label",
          "aria-checked",
          "aria-pressed",
          "aria-selected",
          "data-state"
        ]
      });
      const timer = setTimeout(() => finish(false), timeoutMs);
      signal.addEventListener("abort", onAbort, { once: true });
      if (this.findSelectedRecentPostsControl(selector)) finish(true);
    });
  }

  private async selectRecentPostsFilter(
    timeoutMs: number,
    signal: AbortSignal
  ): Promise<boolean> {
    const optionSelector =
      "[role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox'], [role='radio'], [role='checkbox']";
    const triggerSelector = "button, [role='button']";
    const allSelectors = `${triggerSelector}, ${optionSelector}`;

    if (this.findSelectedRecentPostsControl(allSelectors)) return true;

    const visibleOption = this.findSafeControl(
      "post_filter_option",
      allSelectors
    );
    if (visibleOption) {
      if (!this.clickVerifiedControl("post_filter_option", visibleOption)) {
        return false;
      }
      return this.waitForRecentPostsSelection(
        allSelectors,
        timeoutMs,
        signal
      );
    }

    const trigger = this.findSafeControl(
      "post_filter_trigger",
      triggerSelector
    );
    if (!trigger) return false;
    if (!this.clickVerifiedControl("post_filter_trigger", trigger)) {
      return false;
    }

    const option = await this.waitForSafeControl(
      "post_filter_option",
      optionSelector,
      timeoutMs,
      signal
    );
    if (!option || !this.clickVerifiedControl("post_filter_option", option)) {
      return false;
    }
    return this.waitForRecentPostsSelection(
      allSelectors,
      timeoutMs,
      signal
    );
  }

  private async scrollOnce(
    mode: "groups" | "posts" | "comments",
    timeoutMs: number,
    signal: AbortSignal,
    clickControls = true,
    scope: ParentNode = this.document
  ): Promise<boolean> {
    if (signal.aborted) throw abortError();
    if (clickControls) this.clickSafeControls(mode);
    const before = this.document.documentElement.scrollHeight;
    const groupScroller =
      mode === "groups" ? this.findJoinedGroupsScroller() : null;
    const commentScroller =
      mode === "comments" ? this.findCommentScroller(scope) : null;
    const nestedScroller = groupScroller ?? commentScroller;
    const nestedScrollTop = nestedScroller?.scrollTop ?? 0;
    if (nestedScroller) {
      const step = Math.max(nestedScroller.clientHeight * 0.8, 600);
      nestedScroller.scrollTop = Math.min(
        nestedScroller.scrollHeight,
        nestedScroller.scrollTop + step
      );
      nestedScroller.dispatchEvent(new Event("scroll"));
    }
    this.win.scrollTo({ top: before, behavior: "auto" });
    const changed = await waitForMutation(this.document, timeoutMs, signal);
    const after = this.document.documentElement.scrollHeight;
    return (
      changed ||
      after > before ||
      Boolean(nestedScroller && nestedScroller.scrollTop > nestedScrollTop)
    );
  }

  private findCommentScope(postExternalId: string): ParentNode {
    for (const dialog of this.document.querySelectorAll("[role='dialog']")) {
      for (const anchor of dialog.querySelectorAll("a[href*='/posts/']")) {
        const href = anchor.getAttribute("href");
        if (!href) continue;
        try {
          const path = new URL(href, this.win.location.href).pathname;
          if (/\/posts\/([^/?#]+)/u.exec(path)?.[1] === postExternalId) {
            return dialog;
          }
        } catch {
          // Ignore malformed navigation links and continue within the dialog.
        }
      }
    }
    return this.document;
  }

  private findCommentScroller(scope: ParentNode): HTMLElement | null {
    const candidates = new Set<HTMLElement>();
    const seeds = [
      ...scope.querySelectorAll(
        "a[href*='comment_id='], [data-sl-comment], [data-commentid], [data-comment-id]"
      ),
      ...[...scope.querySelectorAll("button, [role='button']")].filter(
        (element) => isSafeReadControlElement("comments", element)
      )
    ];

    for (const seed of seeds) {
      let ancestor = seed.parentElement;
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
    this.progress(command.runId, "discover_groups", 0, 0);
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
      this.progress(command.runId, "discover_groups", round + 1, byId.size);
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
    this.progress(command.runId, "crawl_search", 0, 0);
    const byId = new Map<string, SafePostDto>();
    let plateau = 0;
    let hitLimit = false;
    const recentPostsSelected = await this.selectRecentPostsFilter(
      command.limits.mutationWaitMs,
      signal
    );

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
      this.progress(command.runId, "crawl_search", round + 1, byId.size);
      plateau = byId.size === before && !changed ? plateau + 1 : 0;
      if (plateau >= 2) break;
    }

    const coverage = recentPostsSelected
      ? assessPostSearchCoverage(
          hitLimit,
          this.adapter().hasExplicitPostSearchEnd()
        )
      : {
          coverageStatus: "partial" as const,
          partialReason: "recent_posts_filter_unconfirmed"
        };
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
    this.progress(command.runId, "crawl_post", 0, 0);
    const byId = new Map<string, SafeCommentDto>();
    let plateau = 0;
    let noGrowthRounds = 0;
    let hitLimit = false;
    let expectedCount = this.adapter().expectedCommentCount(
      command.postExternalId
    );

    let commentScope = this.findCommentScope(command.postExternalId);
    const allCommentsSelected = await this.selectAllCommentsFilter(
      command.limits.mutationWaitMs,
      signal,
      commentScope
    );

    for (
      let round = 0;
      round < command.limits.maxCommentExpandRounds;
      round += 1
    ) {
      const before = byId.size;
      commentScope = this.findCommentScope(command.postExternalId);
      expectedCount =
        this.adapter().expectedCommentCount(command.postExternalId) ??
        expectedCount;
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
      if (expectedCount !== null && byId.size >= expectedCount) {
        break;
      }

      const expansion = await this.clickSafeControlsAndWait(
        "comments",
        command.limits.mutationWaitMs,
        signal,
        commentScope
      );
      this.progress(command.runId, "crawl_post", round + 1, byId.size);
      const changed = await this.scrollOnce(
        "comments",
        command.limits.mutationWaitMs,
        signal,
        false,
        commentScope
      );
      // Collect once more after expansion/scroll so comments revealed by the
      // final permitted round are not deferred to a round that never runs.
      for (const comment of this.adapter().extractComments({
        postExternalId: command.postExternalId,
        maxComments: command.limits.maxCommentsPerPost
      })) {
        byId.set(comment.externalId, comment);
      }
      if (byId.size >= command.limits.maxCommentsPerPost) {
        hitLimit = true;
      }
      expectedCount =
        this.adapter().expectedCommentCount(command.postExternalId) ??
        expectedCount;
      this.progress(command.runId, "crawl_post", round + 1, byId.size);
      noGrowthRounds = byId.size === before ? noGrowthRounds + 1 : 0;
      plateau =
        byId.size === before &&
        expansion.clicked === 0 &&
        !expansion.changed &&
        !changed
          ? plateau + 1
          : 0;
      if (
        hitLimit ||
        (expectedCount !== null && byId.size >= expectedCount) ||
        (expectedCount === null && plateau >= 2) ||
        noGrowthRounds >=
          (expectedCount === null
            ? COMMENT_NO_GROWTH_ROUND_LIMIT
            : COMMENT_EXPECTED_NO_GROWTH_ROUND_LIMIT)
      ) {
        break;
      }
    }

    const post = this.adapter().extractCurrentPost({
      sourceExternalId: command.sourceExternalId,
      keywords: command.keywords,
      windowStartUtc: command.windowStartUtc,
      windowEndUtc: command.windowEndUtc
    });
    const expectedCountReached =
      expectedCount !== null && byId.size >= expectedCount;
    const coverage = !allCommentsSelected
      ? {
          coverageStatus: "partial" as const,
          partialReason: "all_comments_filter_unconfirmed"
        }
      : expectedCountReached && !hitLimit
        ? { coverageStatus: "complete" as const }
        : expectedCount !== null && !hitLimit
          ? {
              coverageStatus: "partial" as const,
              partialReason: "comment_count_incomplete"
            }
          : assessCommentCoverage(
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
