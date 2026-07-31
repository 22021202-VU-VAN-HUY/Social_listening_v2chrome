import { ApiError, BackendApiClient } from "../backend/api-client";
import { assertCommentListeningSnapshot } from "../backend/snapshot";
import {
  buildGroupSearchUrl,
  FACEBOOK_JOINED_GROUPS_URL
} from "../content/facebook-urls";
import { ExtensionStorage } from "../shared/storage";
import { mergePostKeywordHits } from "../shared/post-merge";
import type {
  AuthState,
  CrawlCheckpoint,
  CrawlPostResult,
  CrawlSearchResult,
  DiscoverGroupsResult,
  PopupStatus,
  ProgressCounters,
  RunnerRecord,
  SafePostDto
} from "../shared/types";
import { EXTENSION_VERSION } from "../shared/types";
import {
  isTransientMessageChannelError,
  TabLeaseManager
} from "./tab-lease-manager";

export interface StartResult {
  accepted: boolean;
  jobId: string;
  reason?: string;
}

class JobRunError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly status: "failed" | "needs_login" | "interrupted",
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "JobRunError";
  }
}

interface ActiveRun {
  jobId: string;
  runId: string;
  controller: AbortController;
  promise: Promise<void>;
}

function defaultCheckpoint(): CrawlCheckpoint {
  return {
    phase: "start",
    sourceIndex: 0,
    keywordIndex: 0,
    postIndex: 0
  };
}

function idempotencyKey(
  jobId: string,
  ...parts: Array<string | number>
): string {
  return [jobId, ...parts].join(":").slice(0, 240);
}

function errorFromUnknown(error: unknown): JobRunError {
  if (error instanceof JobRunError) return error;
  if (error instanceof ApiError) {
    const interrupted = error.status === 401 || error.status === 409;
    return new JobRunError(
      error.code,
      error.message,
      interrupted ? "interrupted" : "failed",
      error.retryable
    );
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return new JobRunError(
      "CANCELLED",
      "Crawl was cancelled.",
      "interrupted",
      false
    );
  }
  if (isTransientMessageChannelError(error)) {
    return new JobRunError(
      "FACEBOOK_CHANNEL_INTERRUPTED",
      error.message,
      "interrupted",
      true
    );
  }
  return new JobRunError(
    "EXTENSION_ERROR",
    error instanceof Error ? error.message : "Unknown extension error.",
    "failed",
    false
  );
}

export class JobRunner {
  private active: ActiveRun | null = null;
  private startSerial: Promise<void> = Promise.resolve();
  private cleanupInProgress = false;

  public constructor(
    private readonly storage: ExtensionStorage,
    private readonly api: BackendApiClient,
    private readonly tabs: TabLeaseManager
  ) {}

  private exclusiveStart<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.startSerial.then(operation, operation);
    this.startSerial = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  public async getPopupStatus(): Promise<PopupStatus> {
    const [connection, runner] = await Promise.all([
      this.storage.getConnection(),
      this.storage.getRunner()
    ]);
    const status: PopupStatus = {
      paired: Boolean(connection.deviceId && connection.deviceToken),
      installationId: connection.installationId,
      apiBaseUrl: connection.apiBaseUrl,
      presence: runner
        ? runner.phase === "needs_login"
          ? "needs_login"
          : "running"
        : connection.deviceId
          ? "online"
          : "offline"
    };
    if (connection.deviceId) status.deviceId = connection.deviceId;
    if (runner) {
      status.runner = {
        jobId: runner.jobId,
        phase: runner.phase,
        updatedAt: runner.updatedAt
      };
    }
    return status;
  }

  public async startJob(jobId: string): Promise<StartResult> {
    return this.exclusiveStart(async () => {
      if (this.active) {
        return {
          accepted: this.active.jobId === jobId,
          jobId,
          reason: this.active.jobId === jobId ? "already_running" : "busy"
        };
      }

      const existing = await this.storage.getRunner();
      if (existing) {
        await this.reconcile();
        const after = await this.storage.getRunner();
        if (after) {
          return {
            accepted: after.jobId === jobId,
            jobId,
            reason: after.jobId === jobId ? "recovering" : "busy"
          };
        }
      }

      const claim = await this.api.claim(jobId);
      if (claim.jobId !== jobId) {
        throw new JobRunError(
          "CLAIM_JOB_MISMATCH",
          "Backend claim returned another job.",
          "failed",
          false
        );
      }
      const now = new Date().toISOString();
      const record: RunnerRecord = {
        jobId,
        runId: crypto.randomUUID(),
        phase: "claiming",
        startedAt: now,
        updatedAt: now,
        leaseToken: claim.leaseToken,
        fencingToken: claim.fencingToken,
        leaseExpiresAt: claim.leaseExpiresAt,
        snapshot: claim.snapshot,
        checkpoint: defaultCheckpoint()
      };
      await this.storage.saveRunner(record);
      this.launch(record);
      return { accepted: true, jobId };
    });
  }

  private launch(record: RunnerRecord): void {
    if (this.active) return;
    const controller = new AbortController();
    const active: ActiveRun = {
      jobId: record.jobId,
      runId: record.runId,
      controller,
      promise: Promise.resolve()
    };
    this.active = active;
    active.promise = this.execute(record, controller.signal)
      .catch(async (error: unknown) => {
        await this.reportFailure(record.runId, errorFromUnknown(error));
      })
      .finally(async () => {
        await this.cleanup(record.jobId, record.runId);
        if (this.active?.runId === record.runId) {
          this.active = null;
        }
      });
    void active.promise;
  }

  private requireLease(record: RunnerRecord): {
    leaseToken: string;
    fencingToken: number;
  } {
    if (!record.leaseToken || record.fencingToken === undefined) {
      throw new JobRunError(
        "LEASE_MISSING",
        "Runner lease is missing.",
        "interrupted",
        true
      );
    }
    return {
      leaseToken: record.leaseToken,
      fencingToken: record.fencingToken
    };
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (!signal.aborted) return;
    const reason = signal.reason;
    throw reason instanceof Error
      ? reason
      : new JobRunError("CANCELLED", "Crawl cancelled.", "interrupted", false);
  }

  private async heartbeat(record: RunnerRecord, signal: AbortSignal): Promise<void> {
    this.throwIfAborted(signal);
    const lease = this.requireLease(record);
    const response = await this.api.heartbeat({
      status: "running",
      jobId: record.jobId,
      leaseToken: lease.leaseToken,
      fencingToken: lease.fencingToken
    });
    if (response.leaseExpiresAt) {
      record.leaseExpiresAt = response.leaseExpiresAt;
      await this.storage.patchRunner(record.runId, {
        leaseExpiresAt: response.leaseExpiresAt
      });
    }
    if (response.cancelRequested) {
      throw new JobRunError(
        "CANCELLED_BY_USER",
        "Job cancellation was requested.",
        "interrupted",
        false
      );
    }
  }

  private async navigateAndReady(
    tabId: number,
    record: RunnerRecord,
    url: string,
    phase: RunnerRecord["phase"],
    signal: AbortSignal
  ): Promise<void> {
    this.throwIfAborted(signal);
    await this.storage.patchRunner(record.runId, { phase });
    await this.tabs.navigate(tabId, record.runId, url);
    await this.tabs.waitUntilReady(tabId, record.runId);
    await this.heartbeat(record, signal);
  }

  private async execute(record: RunnerRecord, signal: AbortSignal): Promise<void> {
    const snapshot = record.snapshot;
    if (!snapshot) {
      throw new JobRunError(
        "SNAPSHOT_MISSING",
        "Job snapshot is unavailable.",
        "interrupted",
        true
      );
    }
    const lease = this.requireLease(record);
    assertCommentListeningSnapshot(snapshot);
    const tabId = await this.tabs.ensureOwnedTab(record.jobId, record.runId);
    await this.tabs.waitUntilReady(tabId, record.runId);
    await this.storage.patchRunner(record.runId, { phase: "auth_check" });
    const auth = await this.tabs.command<AuthState>(tabId, {
      type: "CHECK_AUTH",
      runId: record.runId
    });
    if (auth.state !== "authenticated") {
      throw new JobRunError(
        auth.state === "login_required" ? "FACEBOOK_LOGIN_REQUIRED" : "FACEBOOK_CHALLENGE",
        auth.reason,
        "needs_login",
        false
      );
    }

    if (snapshot.kind === "discover_groups") {
      await this.navigateAndReady(
        tabId,
        record,
        FACEBOOK_JOINED_GROUPS_URL,
        "discovering_groups",
        signal
      );
      const result = await this.tabs.command<DiscoverGroupsResult>(tabId, {
        type: "DISCOVER_GROUPS",
        runId: record.runId,
        limits: {
          maxGroups: snapshot.limits.maxGroups,
          maxScrollRounds: snapshot.limits.maxScrollRounds,
          mutationWaitMs: snapshot.limits.mutationWaitMs
        }
      });
      const checkpoint: CrawlCheckpoint = {
        phase: "groups_uploaded",
        sourceIndex: 0,
        keywordIndex: 0,
        postIndex: 0
      };
      await this.storage.patchRunner(record.runId, { phase: "uploading" });
      await this.api.uploadSources({
        jobId: record.jobId,
        ...lease,
        checkpoint,
        sources: result.sources,
        idempotencyKey: idempotencyKey(record.jobId, "sources")
      });
      await this.storage.patchRunner(record.runId, { checkpoint });
      await this.storage.patchRunner(record.runId, { phase: "completing" });
      await this.api.complete({
        jobId: record.jobId,
        ...lease,
        outcome: result.coverageStatus === "complete" ? "crawl_complete" : "partial",
        coverageStatus: result.coverageStatus,
        ...(result.partialReason ? { partialReason: result.partialReason } : {})
      });
      return;
    }

    if (snapshot.sources.length === 0 || snapshot.keywords.length === 0) {
      throw new JobRunError(
        "EMPTY_CRAWL_SNAPSHOT",
        "Crawl snapshot has no selected source or keyword.",
        "failed",
        false
      );
    }

    const progress: ProgressCounters = {};
    let partial = false;
    let partialReason: string | undefined;
    const checkpoint = record.checkpoint ?? defaultCheckpoint();

    for (
      let sourceIndex = checkpoint.sourceIndex;
      sourceIndex < snapshot.sources.length;
      sourceIndex += 1
    ) {
      const source = snapshot.sources[sourceIndex];
      if (!source) continue;
      const firstKeyword =
        sourceIndex === checkpoint.sourceIndex ? checkpoint.keywordIndex : 0;
      const groupPosts = new Map<string, SafePostDto>();

      for (
        let keywordIndex = firstKeyword;
        keywordIndex < snapshot.keywords.length;
        keywordIndex += 1
      ) {
        const keyword = snapshot.keywords[keywordIndex];
        if (!keyword) continue;
        const task = snapshot.tasks.find(
          (candidate) =>
            candidate.sourceId === (source.id ?? null) &&
            candidate.keywordId === (keyword.id ?? null)
        );
        if (!task?.id) {
          throw new JobRunError(
            "TASK_SNAPSHOT_MISSING",
            `Crawl snapshot is missing a task for source ${source.externalId} and keyword ${keyword.value}.`,
            "failed",
            false
          );
        }
        await this.navigateAndReady(
          tabId,
          record,
          buildGroupSearchUrl(source.url, keyword.value),
          "searching_posts",
          signal
        );
        const searchResult = await this.tabs.command<CrawlSearchResult>(tabId, {
          type: "CRAWL_SEARCH",
          runId: record.runId,
          sourceExternalId: source.externalId,
          keywords: [keyword],
          windowStartUtc: snapshot.windowStartUtc,
          windowEndUtc: snapshot.windowEndUtc,
          limits: {
            maxPostsPerGroup: snapshot.limits.maxPostsPerGroup,
            maxScrollRounds: snapshot.limits.maxScrollRounds,
            mutationWaitMs: snapshot.limits.mutationWaitMs
          }
        });
        const postsToUpload: SafePostDto[] = [];
        const postsForCommentCrawl: SafePostDto[] = [];
        for (const post of searchResult.posts) {
          const existingPost = groupPosts.get(post.externalId);
          if (!existingPost) {
            groupPosts.set(post.externalId, post);
            postsToUpload.push(post);
            postsForCommentCrawl.push(post);
            continue;
          }
          const merged = mergePostKeywordHits(existingPost, post);
          groupPosts.set(post.externalId, merged.post);
          if (merged.hasNewKeywordHit) {
            postsToUpload.push(merged.post);
          }
        }
        progress.postsScanned = (progress.postsScanned ?? 0) + searchResult.posts.length;
        progress.postsMatched =
          (progress.postsMatched ?? 0) + postsForCommentCrawl.length;
        if (searchResult.coverageStatus !== "complete") {
          partial = true;
          partialReason ??= searchResult.partialReason ?? "post_coverage_partial";
        }

        const searchCheckpoint: CrawlCheckpoint = {
          phase: "search_uploaded",
          sourceIndex,
          keywordIndex,
          postIndex: 0
        };
        await this.storage.patchRunner(record.runId, { phase: "uploading" });
        if (postsToUpload.length > 0) {
          await this.api.uploadContent({
            jobId: record.jobId,
            ...lease,
            taskId: task.id,
            checkpoint: searchCheckpoint,
            posts: postsToUpload,
            comments: [],
            idempotencyKey: idempotencyKey(
              record.jobId,
              "source",
              sourceIndex,
              "keyword",
              keywordIndex,
              "posts"
            )
          });
        }
        await this.storage.patchRunner(record.runId, {
          checkpoint: searchCheckpoint
        });

        if (snapshot.crawlComments) {
          const firstPost =
            sourceIndex === checkpoint.sourceIndex &&
            keywordIndex === checkpoint.keywordIndex
              ? checkpoint.postIndex
              : 0;
          for (
            let postIndex = firstPost;
            postIndex < postsForCommentCrawl.length;
            postIndex += 1
          ) {
            const post = postsForCommentCrawl[postIndex];
            if (!post) continue;
            await this.navigateAndReady(
              tabId,
              record,
              post.url,
              "collecting_comments",
              signal
            );
            const detail = await this.tabs.command<CrawlPostResult>(tabId, {
              type: "CRAWL_POST",
              runId: record.runId,
              sourceExternalId: source.externalId,
              postExternalId: post.externalId,
              keywords: snapshot.keywords,
              windowStartUtc: snapshot.windowStartUtc,
              windowEndUtc: snapshot.windowEndUtc,
              limits: {
                maxCommentsPerPost: snapshot.limits.maxCommentsPerPost,
                maxCommentExpandRounds: snapshot.limits.maxCommentExpandRounds,
                mutationWaitMs: snapshot.limits.mutationWaitMs
              }
            });
            progress.commentsCollected =
              (progress.commentsCollected ?? 0) + detail.comments.length;
            if (detail.coverageStatus !== "complete") {
              partial = true;
              partialReason ??=
                detail.partialReason ?? "comment_coverage_partial";
            }

            const commentCheckpoint: CrawlCheckpoint = {
              phase: "comments_uploaded",
              sourceIndex,
              keywordIndex,
              postIndex: postIndex + 1
            };
            await this.storage.patchRunner(record.runId, { phase: "uploading" });
            if (detail.post || detail.comments.length > 0) {
              await this.api.uploadContent({
                jobId: record.jobId,
                ...lease,
                taskId: task.id,
                checkpoint: commentCheckpoint,
                posts: detail.post ? [detail.post] : [],
                comments: detail.comments,
                idempotencyKey: idempotencyKey(
                  record.jobId,
                  "source",
                  sourceIndex,
                  "keyword",
                  keywordIndex,
                  "post",
                  post.externalId
                )
              });
            }
            await this.storage.patchRunner(record.runId, {
              checkpoint: commentCheckpoint
            });
            await this.heartbeat(record, signal);
          }
        }

        await this.storage.patchRunner(record.runId, {
          checkpoint: {
            phase: "comments_uploaded",
            sourceIndex,
            keywordIndex: keywordIndex + 1,
            postIndex: 0
          }
        });
      }
      progress.groupsProcessed = (progress.groupsProcessed ?? 0) + 1;
      await this.storage.patchRunner(record.runId, {
        checkpoint: {
          phase: "comments_uploaded",
          sourceIndex: sourceIndex + 1,
          keywordIndex: 0,
          postIndex: 0
        }
      });
    }

    await this.storage.patchRunner(record.runId, {
      phase: "completing",
      checkpoint: {
        phase: "done",
        sourceIndex: snapshot.sources.length,
        keywordIndex: 0,
        postIndex: 0
      }
    });
    await this.api.complete({
      jobId: record.jobId,
      ...lease,
      outcome: partial ? "partial" : "crawl_complete",
      coverageStatus: partial ? "partial" : "complete",
      ...(partialReason ? { partialReason } : {})
    });
  }

  private async reportFailure(runId: string, error: JobRunError): Promise<void> {
    const record = await this.storage.getRunner();
    if (!record || record.runId !== runId) return;
    await this.storage.patchRunner(runId, {
      phase: error.status === "needs_login" ? "needs_login" : "failed",
      lastErrorCode: error.code
    });
    if (!record.leaseToken || record.fencingToken === undefined) return;
    try {
      await this.api.fail({
        jobId: record.jobId,
        leaseToken: record.leaseToken,
        fencingToken: record.fencingToken,
        status: error.status,
        code: error.code,
        message: error.message,
        retryable: error.retryable
      });
    } catch {
      // The durable backend lease will expire if the terminal report is unreachable.
    }
  }

  private async cleanup(jobId: string, runId: string): Promise<void> {
    this.cleanupInProgress = true;
    try {
      const current = await this.storage.getRunner();
      if (current?.runId === runId) {
        await this.storage.patchRunner(runId, { phase: "cleanup" });
      }
      let cleaned = false;
      try {
        cleaned = await this.tabs.cleanupOwnedTab(jobId, runId);
      } catch {
        const remaining = await this.storage.getRunner();
        if (remaining?.runId === runId) {
          await this.storage.patchRunner(runId, {
            phase: "cleanup",
            lastErrorCode: "TAB_CLEANUP_PENDING"
          });
        }
        return;
      }

      const remaining = await this.storage.getRunner();
      if (
        !remaining ||
        remaining.runId !== runId ||
        cleaned ||
        remaining.tabId === undefined
      ) {
        await this.storage.clearRunner(runId);
        return;
      }

      // Ownership could not be proven. Keep the tab reference so a later
      // reconcile can retry; never close an unverified tab or orphan it.
      await this.storage.patchRunner(runId, {
        phase: "cleanup",
        lastErrorCode: "TAB_OWNERSHIP_UNVERIFIED"
      });
    } finally {
      this.cleanupInProgress = false;
    }
  }

  public async cancel(jobId?: string): Promise<boolean> {
    const active = this.active;
    if (active && (!jobId || active.jobId === jobId)) {
      active.controller.abort(
        new JobRunError(
          "CANCELLED_BY_USER",
          "Job cancelled by user.",
          "interrupted",
          false
        )
      );
      return true;
    }
    const record = await this.storage.getRunner();
    if (!record || (jobId && record.jobId !== jobId)) return false;
    await this.reportFailure(
      record.runId,
      new JobRunError(
        "CANCELLED_BY_USER",
        "Job cancelled by user.",
        "interrupted",
        false
      )
    );
    await this.cleanup(record.jobId, record.runId);
    return true;
  }

  public async reconcile(): Promise<void> {
    if (this.active) return;
    const record = await this.storage.getRunner();
    if (!record) {
      try {
        const heartbeat = await this.api.heartbeat({ status: "online" });
        if (heartbeat.availableJobId) {
          await this.startJob(heartbeat.availableJobId);
        }
      } catch {
        // Offline/unpaired is an expected idle state.
      }
      return;
    }
    if (record.phase === "cleanup") {
      await this.cleanup(record.jobId, record.runId);
      return;
    }
    if (!record.leaseToken || record.fencingToken === undefined || !record.snapshot) {
      await this.cleanup(record.jobId, record.runId);
      return;
    }
    try {
      const response = await this.api.heartbeat({
        status: "running",
        jobId: record.jobId,
        leaseToken: record.leaseToken,
        fencingToken: record.fencingToken
      });
      if (response.cancelRequested) {
        await this.cancel(record.jobId);
        return;
      }
      await this.storage.patchRunner(record.runId, {
        phase: "recovering",
        ...(response.leaseExpiresAt
          ? { leaseExpiresAt: response.leaseExpiresAt }
          : {})
      });
      this.launch({ ...record, phase: "recovering" });
    } catch {
      await this.cleanup(record.jobId, record.runId);
    }
  }

  public async onUnexpectedChild(tab: {
    id?: number;
    openerTabId?: number;
  }): Promise<void> {
    const closed = await this.tabs.closeUnexpectedChild(tab);
    if (closed && this.active) {
      this.active.controller.abort(
        new JobRunError(
          "UNEXPECTED_CHILD_TAB",
          "Facebook opened an unexpected child tab.",
          "failed",
          false
        )
      );
    }
  }

  public async onTabRemoved(tabId: number): Promise<void> {
    if (this.cleanupInProgress || !(await this.tabs.isOwnedTab(tabId))) return;
    if (this.active) {
      this.active.controller.abort(
        new JobRunError(
          "AUTOMATION_TAB_CLOSED",
          "The extension-owned Facebook tab was closed.",
          "interrupted",
          true
        )
      );
    }
  }

  public async unpair(): Promise<void> {
    await this.cancel();
    if (this.active) {
      await this.active.promise;
    }
    await this.storage.clearPairing();
  }

  public getVersion(): string {
    return EXTENSION_VERSION;
  }
}
