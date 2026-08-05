export const EXTENSION_VERSION = "0.2.3";

export type ExtensionPresenceStatus =
  | "offline"
  | "online"
  | "running"
  | "needs_login";

export type RunnerPhase =
  | "idle"
  | "claiming"
  | "reserving_tab"
  | "opening_platform"
  | "auth_check"
  | "discovering_groups"
  | "searching_posts"
  | "collecting_comments"
  | "uploading"
  | "completing"
  | "cancelling"
  | "recovering"
  | "cleanup"
  | "needs_login"
  | "failed";

export type JobKind = "discover_groups" | "crawl_content";
export type WebPlatform = "facebook" | "threads";
export type MatchMode = "whole_word" | "contains_phrase";

export interface StoredConnection {
  apiBaseUrl: string;
  installationId: string;
  deviceId?: string;
  deviceToken?: string;
  workspaceId?: string;
  pairedAt?: string;
}

export interface CrawlKeyword {
  id?: string;
  value: string;
  matchMode: MatchMode;
}

export interface CrawlSource {
  id?: string;
  externalId: string;
  name: string;
  url: string;
}

export interface CrawlTask {
  id: string;
  sourceId: string | null;
  keywordId: string | null;
  state: "pending" | "running" | "completed" | "failed";
  checkpoint?: CrawlCheckpoint;
}

export interface CrawlLimits {
  maxGroups: number;
  maxScrollRounds: number;
  maxPostsPerGroup: number;
  maxCommentsPerPost: number;
  maxCommentExpandRounds: number;
  mutationWaitMs: number;
}

export interface JobSnapshot {
  platform: WebPlatform;
  kind: JobKind;
  sources: CrawlSource[];
  keywords: CrawlKeyword[];
  tasks: CrawlTask[];
  windowStartUtc: string | null;
  windowEndUtc: string | null;
  crawlComments: boolean;
  limits: CrawlLimits;
}

export interface CrawlCheckpoint {
  phase:
    | "start"
    | "groups_uploaded"
    | "search_uploaded"
    | "comments_uploaded"
    | "done";
  sourceIndex: number;
  keywordIndex: number;
  postIndex: number;
}

export interface RunnerRecord {
  jobId: string;
  runId: string;
  phase: RunnerPhase;
  startedAt: string;
  updatedAt: string;
  tabId?: number;
  windowId?: number;
  leaseToken?: string;
  fencingToken?: number;
  leaseExpiresAt?: string;
  snapshot?: JobSnapshot;
  checkpoint?: CrawlCheckpoint;
  lastProgressAt?: string;
  cancelRequested?: boolean;
  lastErrorCode?: string;
}

export type AuthorKind = "real" | "anonymous" | "unknown";

/**
 * This is the entire author surface that may leave the content script.
 * Do not add identifiers or links here.
 */
export interface SafeAuthorDto {
  authorName: string | null;
  isAnonymous: boolean;
  authorKind: AuthorKind;
  /** Low-cardinality, post-scoped visual bucket. Never a profile identifier. */
  anonymousAvatarVariant?: number;
}

export type CoverageStatus = "complete" | "partial" | "unknown";
export type TimeParseStatus = "parsed" | "unknown";

export interface SafeSourceDto {
  externalId: string;
  name: string;
  canonicalUrl: string;
}

export interface SafePostDto {
  externalId: string;
  sourceExternalId: string;
  url: string;
  body: string;
  publishedAt: string | null;
  collectedAt: string;
  timeParseStatus: TimeParseStatus;
  matchedKeywordIds: string[];
  author: SafeAuthorDto;
}

export interface SafeCommentDto {
  externalId: string;
  postExternalId: string;
  parentCommentExternalId: string | null;
  observedOrder?: number;
  url: string | null;
  body: string;
  publishedAt: string | null;
  collectedAt: string;
  timeParseStatus: TimeParseStatus;
  author: SafeAuthorDto;
}

export interface DiscoverGroupsResult {
  sources: SafeSourceDto[];
  coverageStatus: CoverageStatus;
  partialReason?: string;
}

export interface CrawlSearchResult {
  posts: SafePostDto[];
  coverageStatus: CoverageStatus;
  partialReason?: string;
}

export interface CrawlPostResult {
  post: SafePostDto | null;
  comments: SafeCommentDto[];
  coverageStatus: CoverageStatus;
  partialReason?: string;
}

export interface ProgressCounters {
  stage: string;
  currentSource?: string | null;
  sourcesTotal?: number;
  sourcesDone?: number;
  tasksTotal?: number;
  tasksDone?: number;
  postsScanned?: number;
  postsMatched?: number;
  postsSaved?: number;
  commentsSaved?: number;
  sentimentTotal?: number;
  sentimentDone?: number;
  lastHeartbeatAt?: string | null;
}

export interface SourcesBatch {
  deviceId: string;
  leaseToken: string;
  fencingToken: number;
  kind: "sources";
  checksum: string;
  checkpoint?: CrawlCheckpoint;
  sources: SafeSourceDto[];
}

export interface ContentBatch {
  deviceId: string;
  leaseToken: string;
  fencingToken: number;
  kind: "content";
  checksum: string;
  taskId: string;
  checkpoint?: CrawlCheckpoint;
  posts: SafePostDto[];
  comments: SafeCommentDto[];
}

export type IngestBatch = SourcesBatch | ContentBatch;

export interface PairResponse {
  deviceId: string;
  deviceToken: string;
  workspaceId: string;
}

export interface HeartbeatResponse {
  serverTime: string;
  leaseExpiresAt?: string;
  cancelRequested: boolean;
  availableJobId?: string;
}

export interface ClaimResponse {
  jobId: string;
  leaseToken: string;
  fencingToken: number;
  leaseExpiresAt: string;
  snapshot: JobSnapshot;
}

export type ContentCommand =
  | { type: "PING" }
  | { type: "GET_OWNERSHIP" }
  | { type: "ASSIGN_RUN"; runId: string }
  | { type: "CHECK_AUTH"; runId: string }
  | {
      type: "DISCOVER_GROUPS";
      runId: string;
      limits: Pick<CrawlLimits, "maxGroups" | "maxScrollRounds" | "mutationWaitMs">;
    }
  | {
      type: "CRAWL_SEARCH";
      runId: string;
      sourceExternalId: string;
      keywords: CrawlKeyword[];
      windowStartUtc: string | null;
      windowEndUtc: string | null;
      limits: Pick<CrawlLimits, "maxPostsPerGroup" | "maxScrollRounds" | "mutationWaitMs">;
    }
  | {
      type: "CRAWL_POST";
      runId: string;
      sourceExternalId: string;
      postExternalId: string;
      keywords: CrawlKeyword[];
      windowStartUtc: string | null;
      windowEndUtc: string | null;
      limits: Pick<
        CrawlLimits,
        "maxCommentsPerPost" | "maxCommentExpandRounds" | "mutationWaitMs"
      >;
    }
  | { type: "CANCEL_RUN"; runId: string };

export const READ_ONLY_CONTENT_COMMAND_TYPES = [
  "PING",
  "GET_OWNERSHIP",
  "ASSIGN_RUN",
  "CHECK_AUTH",
  "DISCOVER_GROUPS",
  "CRAWL_SEARCH",
  "CRAWL_POST",
  "CANCEL_RUN"
] as const satisfies readonly ContentCommand["type"][];

export function isReadOnlyContentCommand(value: unknown): value is ContentCommand {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return (
    typeof type === "string" &&
    (READ_ONLY_CONTENT_COMMAND_TYPES as readonly string[]).includes(type)
  );
}

export type AuthState =
  | { state: "authenticated" }
  | { state: "login_required"; reason: string }
  | { state: "challenge_required"; reason: string };

export interface PopupStatus {
  paired: boolean;
  installationId: string;
  deviceId?: string;
  apiBaseUrl: string;
  presence: ExtensionPresenceStatus;
  runner?: Pick<RunnerRecord, "jobId" | "phase" | "updatedAt">;
}
