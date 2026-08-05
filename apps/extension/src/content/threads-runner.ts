import { assertPrivacySafePayload } from "../shared/privacy";
import type {
  AuthState,
  ContentCommand,
  CrawlPostResult,
  CrawlSearchResult,
  SafeCommentDto,
  SafePostDto
} from "../shared/types";
import {
  assessCommentCoverage,
  assessPostSearchCoverage,
  type CrawlProgressSignal
} from "./facebook-runner";
import { readRunMarker, RUN_MARKER_KEY } from "./platform-urls";
import { ThreadsDomAdapter } from "./threads-dom-adapter";

const SESSION_RUN_KEY = "__listening_social_owned_run";

type ProgressReporter = (progress: CrawlProgressSignal) => void | Promise<void>;

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
    // The service worker record and URL marker remain authoritative.
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
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const timer = setTimeout(() => finish(false), timeoutMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export class ThreadsContentRunner {
  private assignedRunId: string | null;
  private activeController: AbortController | null = null;

  public constructor(
    private readonly document: Document,
    private readonly win: Window,
    private readonly reportProgress: ProgressReporter = () => undefined
  ) {
    this.assignedRunId =
      readRunMarker(win.location.href) ?? safeSessionGet(win) ?? null;
    if (this.assignedRunId) safeSessionSet(win, this.assignedRunId);
  }

  private adapter(): ThreadsDomAdapter {
    return new ThreadsDomAdapter(this.document, this.win.location.href);
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
    ).catch(() => undefined);
  }

  private async scrollOnce(timeoutMs: number, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) throw abortError();
    const beforeHeight = this.document.documentElement.scrollHeight;
    const beforeTop = this.win.scrollY;
    this.win.scrollTo({ top: beforeHeight, behavior: "auto" });
    const changed = await waitForMutation(this.document, timeoutMs, signal);
    return (
      changed ||
      this.document.documentElement.scrollHeight > beforeHeight ||
      this.win.scrollY > beforeTop
    );
  }

  private async crawlSearch(
    command: Extract<ContentCommand, { type: "CRAWL_SEARCH" }>
  ): Promise<CrawlSearchResult> {
    const signal = this.beginOperation(command.runId);
    const byId = new Map<string, SafePostDto>();
    let plateau = 0;
    let hitLimit = false;
    this.progress(command.runId, "crawl_search", 0, 0);

    for (let round = 0; round < command.limits.maxScrollRounds; round += 1) {
      const before = byId.size;
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
      const changed = await this.scrollOnce(command.limits.mutationWaitMs, signal);
      this.progress(command.runId, "crawl_search", round + 1, byId.size);
      plateau = byId.size === before && !changed ? plateau + 1 : 0;
      if (plateau >= 2) break;
    }

    const result: CrawlSearchResult = {
      posts: [...byId.values()],
      ...assessPostSearchCoverage(hitLimit, this.adapter().hasExplicitSearchEnd())
    };
    assertPrivacySafePayload(result);
    return result;
  }

  private async crawlPost(
    command: Extract<ContentCommand, { type: "CRAWL_POST" }>
  ): Promise<CrawlPostResult> {
    const signal = this.beginOperation(command.runId);
    const byId = new Map<string, SafeCommentDto>();
    let plateau = 0;
    let hitLimit = false;
    this.progress(command.runId, "crawl_post", 0, 0);

    for (
      let round = 0;
      round < command.limits.maxCommentExpandRounds;
      round += 1
    ) {
      const before = byId.size;
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
      const changed = await this.scrollOnce(command.limits.mutationWaitMs, signal);
      this.progress(command.runId, "crawl_post", round + 1, byId.size);
      plateau = byId.size === before && !changed ? plateau + 1 : 0;
      if (plateau >= 2) break;
    }

    const post = this.adapter().extractCurrentPost({
      sourceExternalId: command.sourceExternalId,
      keywords: command.keywords,
      windowStartUtc: command.windowStartUtc,
      windowEndUtc: command.windowEndUtc
    });
    const result: CrawlPostResult = {
      post,
      comments: [...byId.values()],
      ...assessCommentCoverage(hitLimit, this.adapter().hasExplicitCommentEnd())
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
        throw new Error("Threads does not support source discovery.");
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
