"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DataNotice,
  EmptyState,
  SentimentBadge,
  type Sentiment,
} from "./components/ui";
import {
  apiRequest,
  asBoolean,
  asNumber,
  asRecord,
  asString,
  formatDateTime,
  formatShortTime,
  unwrapItems,
} from "./lib/api";
import {
  downloadSocialListeningPdf,
  type PdfReportPost,
  type SocialListeningPdfReport,
} from "./lib/pdf-report";

type CommentItem = {
  id: string;
  platform: "facebook" | "tiktok" | "threads";
  source: string;
  authorName: string | null;
  anonymous: boolean;
  anonymousVariant: number | null;
  content: string;
  sentiment: Sentiment | null;
  confidence: number;
  commentPublishedAt: string | null;
  commentCollectedAt: string | null;
  commentTimeParseStatus: "parsed" | "unknown";
  originalUrl: string | null;
  parentCommentId: string | null;
  observedOrder: number | null;
  postId: string;
  postContext: string;
  postPublishedAt: string | null;
  postCollectedAt: string | null;
  postTimeParseStatus: "parsed" | "unknown";
  postAuthorName: string | null;
  postAnonymous: boolean;
  postAnonymousVariant: number | null;
  postSentiment: Sentiment | null;
  postConfidence: number;
  postUrl: string | null;
  keywords: string[];
};

type PostItem = {
  id: string;
  platform: "facebook" | "tiktok" | "threads";
  source: string;
  authorName: string | null;
  anonymous: boolean;
  anonymousVariant: number | null;
  content: string;
  sentiment: Sentiment | null;
  confidence: number;
  publishedAt: string | null;
  collectedAt: string | null;
  url: string | null;
  keywords: string[];
};

type TimelinePoint = {
  label: string;
  positive: number;
  neutral: number;
  negative: number;
};

type DashboardSnapshot = {
  total: number;
  posts: number;
  comments: number;
  replies: number;
  unknownTime: number;
  pending: number;
  positive: number;
  neutral: number;
  negative: number;
  timeline: TimelinePoint[];
  items: CommentItem[];
};

type DataMode = "live" | "offline" | "degraded";

type GroupedPost = {
  key: string;
  post: CommentItem;
  keywords: string[];
  comments: Array<{ item: CommentItem; depth: number }>;
};

function authorLabel(name: string | null, anonymous: boolean): string {
  if (anonymous) return "Người tham gia ẩn danh";
  return name?.trim() || "Không xác định";
}

function authorInitial(name: string | null, anonymous: boolean): string {
  if (anonymous) return "A";
  return name?.trim().charAt(0).toLocaleUpperCase("vi-VN") || "?";
}

function stableAvatarVariant(value: number | null, seed: string): number {
  if (value !== null && Number.isInteger(value) && value >= 0 && value <= 7) {
    return value;
  }
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 8;
}

function AnonymousAvatarMark(): ReactNode {
  return (
    <span className="anonymous-avatar-mark" aria-hidden="true">
      <span />
    </span>
  );
}

function renderCommentContent(
  content: string,
  parentAuthorName: string | null,
  isReply: boolean,
): ReactNode {
  if (!isReply) return content;
  const candidates = parentAuthorName?.trim() ? [parentAuthorName.trim()] : [];
  const anonymousPrefix =
    /^(người tham gia ẩn danh(?:\s+\d{1,4})?|thành viên ẩn danh(?:\s+\d{1,4})?|anonymous participant(?:\s+\d{1,4})?|anonymous member(?:\s+\d{1,4})?)(?=\s|[:,.!?]|$)/iu.exec(
      content,
    )?.[1];
  if (anonymousPrefix) candidates.push(anonymousPrefix);

  for (const candidate of candidates.sort(
    (left, right) => right.length - left.length,
  )) {
    const withAt = content.startsWith("@") ? `@${candidate}` : candidate;
    if (
      content.slice(0, withAt.length).toLocaleLowerCase("vi-VN") !==
      withAt.toLocaleLowerCase("vi-VN")
    ) {
      continue;
    }
    const boundary = content.charAt(withAt.length);
    if (boundary && !/[\s:,.!?]/u.test(boundary)) continue;
    return (
      <>
        <span className="comment-mention">{content.slice(0, withAt.length)}</span>
        {content.slice(withAt.length)}
      </>
    );
  }
  return content;
}

function orderCommentThread(
  comments: CommentItem[],
): Array<{ item: CommentItem; depth: number }> {
  const comparePosition = (left: CommentItem, right: CommentItem) => {
    if (
      left.observedOrder !== null &&
      right.observedOrder !== null &&
      left.observedOrder !== right.observedOrder
    ) {
      return left.observedOrder - right.observedOrder;
    }
    const leftTime = Date.parse(
      left.commentPublishedAt ?? left.commentCollectedAt ?? "",
    );
    const rightTime = Date.parse(
      right.commentPublishedAt ?? right.commentCollectedAt ?? "",
    );
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
      return leftTime - rightTime;
    }
    return left.id.localeCompare(right.id);
  };
  const ids = new Set(comments.map((comment) => comment.id));
  const children = new Map<string, CommentItem[]>();
  const roots: CommentItem[] = [];

  for (const comment of comments) {
    if (!comment.parentCommentId || !ids.has(comment.parentCommentId)) {
      roots.push(comment);
      continue;
    }
    const siblings = children.get(comment.parentCommentId) ?? [];
    siblings.push(comment);
    children.set(comment.parentCommentId, siblings);
  }
  roots.sort(comparePosition);
  for (const siblings of children.values()) {
    siblings.sort(comparePosition);
  }

  const ordered: Array<{ item: CommentItem; depth: number }> = [];
  const visited = new Set<string>();
  const append = (comment: CommentItem, depth: number) => {
    if (visited.has(comment.id)) return;
    visited.add(comment.id);
    ordered.push({ item: comment, depth });
    for (const child of children.get(comment.id) ?? []) {
      append(child, depth + 1);
    }
  };

  for (const root of roots) append(root, 0);
  for (const comment of comments) append(comment, 0);
  return ordered;
}

function groupByPost(items: CommentItem[]): GroupedPost[] {
  const groups = new Map<string, CommentItem[]>();
  for (const item of items) {
    const key = item.postId || `unknown-post-${item.id}`;
    const comments = groups.get(key) ?? [];
    comments.push(item);
    groups.set(key, comments);
  }

  return [...groups.entries()].map(([key, comments]) => ({
    key,
    post: comments[0]!,
    keywords: [
      ...new Set(
        comments
          .flatMap((comment) => comment.keywords)
          .filter((keyword) => keyword !== "Chưa xác định"),
      ),
    ],
    comments: orderCommentThread(comments),
  }));
}

function filterCommentThreads(
  items: CommentItem[],
  platform: string,
  sentiment: string,
  query: string,
): CommentItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("vi-VN");
  const byId = new Map(items.map((item) => [item.id, item]));
  const rootIds = new Map<string, string>();

  const findRootId = (item: CommentItem): string => {
    const cached = rootIds.get(item.id);
    if (cached) return cached;
    const visited = new Set<string>([item.id]);
    let current = item;
    while (current.parentCommentId) {
      const parent = byId.get(current.parentCommentId);
      if (!parent || visited.has(parent.id)) break;
      visited.add(parent.id);
      current = parent;
    }
    for (const id of visited) rootIds.set(id, current.id);
    return current.id;
  };

  const membersByRoot = new Map<string, CommentItem[]>();
  for (const item of items) {
    const rootId = findRootId(item);
    const members = membersByRoot.get(rootId) ?? [];
    members.push(item);
    membersByRoot.set(rootId, members);
  }

  const selectedRoots = new Set<string>();
  for (const [rootId, members] of membersByRoot) {
    const root = byId.get(rootId) ?? members[0]!;
    if (platform !== "all" && root.platform !== platform) continue;
    if (
      sentiment !== "all" &&
      !members.some((item) =>
        sentiment === "pending"
          ? item.sentiment === null
          : item.sentiment === sentiment,
      )
    ) {
      continue;
    }
    if (
      normalizedQuery &&
      !members.some((item) =>
        `${item.content} ${item.source} ${item.postContext} ${item.keywords.join(" ")}`
          .toLocaleLowerCase("vi-VN")
          .includes(normalizedQuery),
      )
    ) {
      continue;
    }
    selectedRoots.add(rootId);
  }

  return items.filter((item) => selectedRoots.has(findRootId(item)));
}

function sentimentOf(value: unknown): Sentiment | null {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).toLowerCase();
  if (normalized.includes("pos") || normalized.includes("tích")) return "positive";
  if (normalized.includes("neg") || normalized.includes("tiêu")) return "negative";
  if (normalized.includes("neu") || normalized.includes("trung")) return "neutral";
  return null;
}

function normalizeConfidence(value: unknown): number {
  const result = asNumber(value, 0);
  return Math.max(0, Math.min(1, result > 1 ? result / 100 : result));
}

function nestedName(record: Record<string, unknown>, key: string): string {
  const nested = asRecord(record[key]);
  return asString(
    nested.name ??
      nested.authorName ??
      nested.author_name ??
      nested.displayName ??
      nested.display_name,
  );
}

function normalizeAuthor(record: Record<string, unknown>): {
  name: string | null;
  anonymous: boolean;
  variant: number | null;
} {
  const nested = asRecord(record.author);
  const name =
    asString(record.authorName ?? record.author_name) ||
    nestedName(record, "author") ||
    null;
  const kind = asString(
    record.authorKind ??
      record.author_kind ??
      record.authorType ??
      record.author_type ??
      nested.authorKind ??
      nested.author_kind,
  ).toLowerCase();
  const anonymous =
    asBoolean(
      record.isAnonymous ??
        record.is_anonymous ??
        record.anonymous ??
        nested.isAnonymous ??
        nested.is_anonymous,
    ) ||
    kind === "anonymous";
  const variantValue =
    record.anonymousAvatarVariant ??
    record.anonymous_avatar_variant ??
    nested.anonymousAvatarVariant ??
    nested.anonymous_avatar_variant;
  const parsedVariant = Number(variantValue);
  const variant =
    anonymous &&
    Number.isInteger(parsedVariant) &&
    parsedVariant >= 0 &&
    parsedVariant <= 7
      ? parsedVariant
      : null;
  return { name, anonymous, variant };
}

function keywordValues(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") return entry.trim();
      const record = asRecord(entry);
      const nestedKeyword = asRecord(record.keyword);
      return asString(
        record.value ??
          record.name ??
          record.keywordValue ??
          record.keyword_value ??
          nestedKeyword.value,
      ).trim();
    })
    .filter(Boolean);
}

function normalizeComment(value: unknown): CommentItem | null {
  const record = asRecord(value);
  const content = asString(
    record.content ?? record.text ?? record.body ?? record.message,
  );
  if (!content) return null;

  const post = asRecord(record.post ?? record.parentPost ?? record.parent_post);
  const commentAuthor = normalizeAuthor(record);
  const postAuthor = normalizeAuthor(post);
  const sentimentRecord = asRecord(record.sentiment);
  const postSentimentRecord = asRecord(post.sentiment);
  const platformValue = asString(record.platform, "facebook").toLowerCase();
  const platform: CommentItem["platform"] =
    platformValue === "tiktok" || platformValue === "threads"
      ? platformValue
      : "facebook";
  const postId = String(
    record.postId ??
      record.post_id ??
      post.id ??
      post.externalId ??
      post.external_id ??
      "",
  );
  const postContext =
    asString(
      post.title ??
        post.body ??
        post.content ??
        post.text ??
        record.postTitle ??
        record.post_title ??
        record.postBody ??
        record.post_body,
    ) || (postId ? `Bài post ${postId}` : "Bài post chưa có nội dung tóm tắt");
  const keywordCandidates = [
    record.matchedKeywords,
    record.matched_keywords,
    record.keywords,
    record.keywordHits,
    record.keyword_hits,
    record.matchedKeyword,
    record.matched_keyword,
    record.keyword,
    post.matchedKeywords,
    post.matched_keywords,
    post.keywords,
    post.keywordHits,
    post.keyword_hits,
  ];
  const keywords = [
    ...new Set(keywordCandidates.flatMap((entry) => keywordValues(entry))),
  ];
  const postAuthorName =
    postAuthor.name ||
    asString(record.postAuthorName ?? record.post_author_name) ||
    null;
  const postAnonymous =
    asBoolean(record.postIsAnonymous ?? record.post_is_anonymous) ||
    (!postAuthorName && postAuthor.anonymous);
  const postAnonymousVariant = postAuthor.anonymous
    ? postAuthor.variant
    : null;

  return {
    id: String(record.id ?? record.externalId ?? crypto.randomUUID()),
    platform,
    source:
      asString(
        record.sourceName ??
          record.source_name ??
          record.groupName ??
          post.sourceName ??
          post.source_name,
      ) ||
      nestedName(record, "source") ||
      nestedName(post, "source") ||
      "Nguồn chưa xác định",
    authorName: commentAuthor.name,
    anonymous: commentAuthor.anonymous,
    anonymousVariant: commentAuthor.variant,
    content,
    sentiment: sentimentOf(
      sentimentRecord.label ??
        record.sentimentLabel ??
        record.sentiment_label ??
        record.sentiment,
    ),
    confidence: normalizeConfidence(
      sentimentRecord.confidence ??
        record.confidence ??
        record.sentimentConfidence ??
        record.sentiment_confidence,
    ),
    commentPublishedAt:
      asString(record.publishedAt ?? record.published_at) || null,
    commentCollectedAt:
      asString(
        record.collectedAt ??
          record.collected_at ??
          record.createdAt ??
          record.created_at,
      ) || null,
    commentTimeParseStatus:
      asString(record.timeParseStatus ?? record.time_parse_status) === "parsed"
        ? "parsed"
        : "unknown",
    originalUrl:
      asString(
        record.originalUrl ??
          record.original_url ??
          record.permalink ??
          record.url,
      ) || null,
    parentCommentId:
      asString(
        record.parentCommentId ??
          record.parent_comment_id ??
          asRecord(record.parentComment).id,
      ) || null,
    observedOrder: (() => {
      const value = record.observedOrder ?? record.observed_order;
      if (value === null || value === undefined || value === "") return null;
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
    })(),
    postId,
    postContext,
    postPublishedAt:
      asString(
        post.publishedAt ??
          post.published_at ??
          record.postPublishedAt ??
        record.post_published_at,
      ) || null,
    postCollectedAt:
      asString(
        post.collectedAt ??
          post.collected_at ??
          record.postCollectedAt ??
          record.post_collected_at,
      ) || null,
    postTimeParseStatus:
      asString(
        post.timeParseStatus ??
          post.time_parse_status ??
          record.postTimeParseStatus ??
          record.post_time_parse_status,
      ) === "parsed"
        ? "parsed"
        : "unknown",
    postAuthorName,
    postAnonymous,
    postAnonymousVariant,
    postSentiment: sentimentOf(
      postSentimentRecord.label ??
        post.sentimentLabel ??
        post.sentiment_label ??
        post.sentiment,
    ),
    postConfidence: normalizeConfidence(
      postSentimentRecord.confidence ??
        post.sentimentConfidence ??
        post.sentiment_confidence,
    ),
    postUrl:
      asString(
        post.url ??
          post.originalUrl ??
          post.original_url ??
          post.permalink ??
          record.postUrl ??
          record.post_url,
      ) || null,
    keywords: keywords.length ? keywords : ["Chưa xác định"],
  };
}

function normalizePost(value: unknown): PostItem | null {
  const record = asRecord(value);
  const content = asString(
    record.body ?? record.content ?? record.text ?? record.message,
  );
  const id = asString(record.id ?? record.externalId ?? record.external_id);
  if (!id || !content) return null;
  const author = normalizeAuthor(record);
  const sentimentRecord = asRecord(record.sentiment);
  const platformValue = asString(record.platform, "facebook").toLowerCase();
  const platform: PostItem["platform"] =
    platformValue === "tiktok" || platformValue === "threads"
      ? platformValue
      : "facebook";
  const keywordCandidates = [
    record.matchedKeywords,
    record.matched_keywords,
    record.keywords,
    record.keywordHits,
    record.keyword_hits,
  ];
  const keywords = [
    ...new Set(keywordCandidates.flatMap((entry) => keywordValues(entry))),
  ];

  return {
    id,
    platform,
    source:
      asString(record.sourceName ?? record.source_name) ||
      nestedName(record, "source") ||
      "Nguồn chưa xác định",
    authorName: author.name,
    anonymous: author.anonymous,
    anonymousVariant: author.variant,
    content,
    sentiment: sentimentOf(
      sentimentRecord.label ??
        record.sentimentLabel ??
        record.sentiment_label ??
        record.sentiment,
    ),
    confidence: normalizeConfidence(
      sentimentRecord.confidence ??
        record.sentimentConfidence ??
        record.sentiment_confidence,
    ),
    publishedAt: asString(record.publishedAt ?? record.published_at) || null,
    collectedAt: asString(record.collectedAt ?? record.collected_at) || null,
    url:
      asString(
        record.url ??
          record.originalUrl ??
          record.original_url ??
          record.permalink,
      ) || null,
    keywords: keywords.length ? keywords : ["Chưa xác định"],
  };
}

async function fetchAllListeningItems(path: string): Promise<unknown[]> {
  const pageSize = 200;
  const collected: unknown[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const separator = path.includes("?") ? "&" : "?";
    const page = unwrapItems(
      await apiRequest<unknown>(
        `${path}${separator}limit=${pageSize}&offset=${offset}`,
      ),
    );
    collected.push(...page);
    if (page.length < pageSize) break;
  }
  return collected;
}

function buildTimeline(items: CommentItem[]): TimelinePoint[] {
  const points = new Map<string, TimelinePoint>();
  for (const item of items) {
    if (!item.sentiment || !item.commentPublishedAt) continue;
    const date = new Date(item.commentPublishedAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = date.toISOString().slice(0, 10);
    const current = points.get(key) ?? {
      label: new Intl.DateTimeFormat("vi-VN", {
        day: "2-digit",
        month: "2-digit",
      }).format(date),
      positive: 0,
      neutral: 0,
      negative: 0,
    };
    current[item.sentiment] += 1;
    points.set(key, current);
  }
  return [...points.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-7)
    .map(([, point]) => point);
}

function buildSnapshot(items: CommentItem[]): DashboardSnapshot {
  const comments = items.length;
  return {
    total: comments,
    posts: new Set(items.map((item) => item.postId).filter(Boolean)).size,
    comments,
    replies: items.filter((item) => item.parentCommentId).length,
    unknownTime: items.filter(
      (item) => item.commentTimeParseStatus === "unknown",
    ).length,
    pending: items.filter((item) => item.sentiment === null).length,
    positive: items.filter((item) => item.sentiment === "positive").length,
    neutral: items.filter((item) => item.sentiment === "neutral").length,
    negative: items.filter((item) => item.sentiment === "negative").length,
    timeline: buildTimeline(items),
    items,
  };
}

function normalizeSummary(
  value: unknown,
  fallback: DashboardSnapshot,
): Pick<
  DashboardSnapshot,
  | "total"
  | "posts"
  | "comments"
  | "replies"
  | "unknownTime"
  | "pending"
  | "positive"
  | "neutral"
  | "negative"
> {
  const record = asRecord(value);
  const replies =
    record.replies === undefined
      ? fallback.replies
      : asNumber(record.replies);
  const comments =
    record.comments === undefined
      ? fallback.comments
      : asNumber(record.comments);
  return {
    total: comments,
    posts:
      record.posts === undefined ? fallback.posts : asNumber(record.posts),
    comments,
    replies,
    unknownTime:
      record.unknownTime === undefined && record.unknown_time === undefined
        ? fallback.unknownTime
        : asNumber(record.unknownTime ?? record.unknown_time),
    pending:
      record.pendingAnalysis === undefined &&
      record.pending_analysis === undefined
        ? fallback.pending
        : asNumber(record.pendingAnalysis ?? record.pending_analysis),
    positive:
      record.positive === undefined
        ? fallback.positive
        : asNumber(record.positive),
    neutral:
      record.neutral === undefined
        ? fallback.neutral
        : asNumber(record.neutral),
    negative:
      record.negative === undefined
        ? fallback.negative
        : asNumber(record.negative),
  };
}

function normalizeTimeline(value: unknown): TimelinePoint[] {
  const points = new Map<string, TimelinePoint>();
  for (const item of unwrapItems(value)) {
    const record = asRecord(item);
    const dateValue = asString(record.date ?? record.day);
    const sentiment = sentimentOf(record.label ?? record.sentiment);
    if (!dateValue || !sentiment) continue;
    const date = new Date(dateValue);
    const current = points.get(dateValue) ?? {
      label: Number.isNaN(date.getTime())
        ? dateValue
        : new Intl.DateTimeFormat("vi-VN", {
            day: "2-digit",
            month: "2-digit",
          }).format(date),
      positive: 0,
      neutral: 0,
      negative: 0,
    };
    current[sentiment] += asNumber(record.count);
    points.set(dateValue, current);
  }

  return [...points.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-7)
    .map(([, point]) => point);
}

function buildPdfReport(
  posts: PostItem[],
  comments: CommentItem[],
  summary: Pick<
    DashboardSnapshot,
    | "comments"
    | "pending"
    | "positive"
    | "neutral"
    | "negative"
  >,
): SocialListeningPdfReport {
  const commentsByPost = new Map<string, CommentItem[]>();
  for (const comment of comments) {
    const postComments = commentsByPost.get(comment.postId) ?? [];
    postComments.push(comment);
    commentsByPost.set(comment.postId, postComments);
  }

  const reportPosts: PdfReportPost[] = posts.map((post) => ({
    id: post.id,
    platform: post.platform,
    source: post.source,
    author: authorLabel(post.authorName, post.anonymous),
    text: post.content,
    sentiment: post.sentiment,
    confidence: post.confidence,
    publishedAt: post.publishedAt,
    collectedAt: post.collectedAt,
    url: post.url,
    keywords: post.keywords,
    comments: orderCommentThread(commentsByPost.get(post.id) ?? []).map(
      ({ item, depth }) => ({
        author: authorLabel(item.authorName, item.anonymous),
        text: item.content,
        sentiment: item.sentiment,
        confidence: item.confidence,
        publishedAt: item.commentPublishedAt,
        depth,
      }),
    ),
  }));

  const knownPostIds = new Set(reportPosts.map((post) => post.id));
  for (const [postId, postComments] of commentsByPost) {
    if (knownPostIds.has(postId) || !postComments.length) continue;
    const sample = postComments[0]!;
    reportPosts.push({
      id: postId,
      platform: sample.platform,
      source: sample.source,
      author: authorLabel(sample.postAuthorName, sample.postAnonymous),
      text: sample.postContext,
      sentiment: sample.postSentiment,
      confidence: sample.postConfidence,
      publishedAt: sample.postPublishedAt,
      collectedAt: sample.postCollectedAt,
      url: sample.postUrl,
      keywords: [
        ...new Set(postComments.flatMap((comment) => comment.keywords)),
      ],
      comments: orderCommentThread(postComments).map(({ item, depth }) => ({
        author: authorLabel(item.authorName, item.anonymous),
        text: item.content,
        sentiment: item.sentiment,
        confidence: item.confidence,
        publishedAt: item.commentPublishedAt,
        depth,
      })),
    });
  }

  reportPosts.sort((left, right) => {
    const leftTime = Date.parse(left.publishedAt ?? left.collectedAt ?? "");
    const rightTime = Date.parse(right.publishedAt ?? right.collectedAt ?? "");
    return (Number.isFinite(rightTime) ? rightTime : 0) -
      (Number.isFinite(leftTime) ? leftTime : 0);
  });

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      posts: reportPosts.length,
      comments: summary.comments,
      pending: summary.pending,
      positive: summary.positive,
      neutral: summary.neutral,
      negative: summary.negative,
    },
    posts: reportPosts,
  };
}

export function DashboardClient() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [mode, setMode] = useState<DataMode>("live");
  const [message, setMessage] = useState("Đang kết nối API…");
  const [lastUpdated, setLastUpdated] = useState("");
  const [platform, setPlatform] = useState("all");
  const [sentiment, setSentiment] = useState("all");
  const [query, setQuery] = useState("");
  const [analyzingAll, setAnalyzingAll] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [analysisNotice, setAnalysisNotice] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [reportNotice, setReportNotice] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const [summaryResult, timelineResult, commentsResult] =
        await Promise.allSettled([
        apiRequest<unknown>("/dashboard/summary"),
        apiRequest<unknown>("/dashboard/timeline"),
        fetchAllListeningItems(
          "/listening/comments?includeUnknownTime=true",
        ),
      ]);

      const dataResults = [summaryResult, timelineResult, commentsResult];
      const dataFailures = dataResults.filter(
        (result) => result.status === "rejected",
      ).length;

      if (dataFailures === dataResults.length) {
        setSnapshot(buildSnapshot([]));
        setMode("offline");
        setMessage(
          "API chưa phản hồi. Không hiển thị số liệu giả; hãy chạy Docker backend rồi tải lại.",
        );
      } else {
        const comments =
          commentsResult.status === "fulfilled"
            ? commentsResult.value
                .map(normalizeComment)
                .filter((item): item is CommentItem => item !== null)
                .sort((a, b) => {
                  const timeA = new Date(
                    a.commentPublishedAt ?? a.commentCollectedAt ?? 0,
                  ).getTime();
                  const timeB = new Date(
                    b.commentPublishedAt ?? b.commentCollectedAt ?? 0,
                  ).getTime();
                  return timeB - timeA;
                })
            : [];
        const feedFallback = buildSnapshot(comments);
        const summary =
          summaryResult.status === "fulfilled"
            ? normalizeSummary(summaryResult.value, feedFallback)
            : {
                total: feedFallback.total,
                posts: feedFallback.posts,
                comments: feedFallback.comments,
                replies: feedFallback.replies,
                unknownTime: feedFallback.unknownTime,
                pending: feedFallback.pending,
                positive: feedFallback.positive,
                neutral: feedFallback.neutral,
                negative: feedFallback.negative,
              };
        const timeline =
          timelineResult.status === "fulfilled"
            ? normalizeTimeline(timelineResult.value)
            : feedFallback.timeline;
        setSnapshot({
          ...summary,
          timeline,
          items: comments,
        });

        const degraded = dataFailures > 0;
        setMode(degraded ? "degraded" : "live");
        setMessage(
          dataFailures > 0
            ? `${dataResults.length - dataFailures}/3 nguồn dữ liệu đã phản hồi. KPI hoặc timeline thiếu sẽ được suy ra từ feed gần nhất.`
            : "Dữ liệu đang được làm mới tự động.",
        );
      }
      setLastUpdated(formatShortTime(new Date().toISOString()));
    } finally {
      refreshing.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const filteredItems = useMemo(
    () => filterCommentThreads(snapshot?.items ?? [], platform, sentiment, query),
    [platform, query, sentiment, snapshot?.items],
  );

  const groupedPosts = useMemo(
    () => groupByPost(filteredItems),
    [filteredItems],
  );

  const analyzeAll = useCallback(async () => {
    if (analyzingAll) return;
    setAnalyzingAll(true);
    setAnalysisNotice(null);
    try {
      const result = asRecord(
        await apiRequest<unknown>("/sentiment/analyze-all", {
          method: "POST",
          body: "{}",
        }),
      );
      const queued = asNumber(
        result.queued ??
          result.enqueued ??
          result.pending ??
          result.count ??
          result.total,
        -1,
      );
      setAnalysisNotice({
        kind: "success",
        message:
          queued >= 0
            ? queued > 0
              ? `Đã gửi ${queued.toLocaleString("vi-VN")} bài viết/bình luận chưa phân tích sang AI. Kết quả sẽ tự cập nhật.`
              : "Không có nội dung mới cần gửi AI; các mục đã phân tích được bỏ qua để tiết kiệm token."
            : asString(result.message) ||
              "Đã gửi các nội dung chưa phân tích sang AI. Kết quả sẽ tự cập nhật.",
      });
      await refresh();
    } catch (error) {
      setAnalysisNotice({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Không thể bắt đầu phân tích lúc này.",
      });
    } finally {
      setAnalyzingAll(false);
    }
  }, [analyzingAll, refresh]);

  const exportPdf = useCallback(async () => {
    if (exportingPdf) return;
    setExportingPdf(true);
    setReportNotice(null);
    try {
      const [postValues, commentValues, summaryValue] = await Promise.all([
        fetchAllListeningItems(
          "/listening/posts?includeUnknownTime=true",
        ),
        fetchAllListeningItems(
          "/listening/comments?includeUnknownTime=true",
        ),
        apiRequest<unknown>("/dashboard/summary"),
      ]);
      const posts = postValues
        .map(normalizePost)
        .filter((post): post is PostItem => post !== null);
      const comments = commentValues
        .map(normalizeComment)
        .filter((comment): comment is CommentItem => comment !== null);
      const fallback = buildSnapshot(comments);
      const summary = normalizeSummary(summaryValue, fallback);
      const filename = await downloadSocialListeningPdf(
        buildPdfReport(posts, comments, summary),
      );
      setReportNotice({
        kind: "success",
        message: `Đã tải ${filename}, gồm cơ cấu sắc thái và ${posts.length.toLocaleString("vi-VN")} bài post.`,
      });
    } catch (error) {
      setReportNotice({
        kind: "error",
        message:
          error instanceof Error
            ? `Không thể xuất PDF: ${error.message}`
            : "Không thể xuất báo cáo PDF lúc này.",
      });
    } finally {
      setExportingPdf(false);
    }
  }, [exportingPdf]);

  if (!snapshot) {
    return (
      <div className="page-loading" role="status" aria-live="polite">
        <span className="loading-orbit" aria-hidden="true" />
        <strong>Đang dựng bức tranh thảo luận…</strong>
        <p>Kết nối bình luận, luồng hội thoại và AI sentiment.</p>
      </div>
    );
  }

  const totalSentiment =
    snapshot.positive + snapshot.neutral + snapshot.negative;
  const positiveRate = totalSentiment
    ? Math.round((snapshot.positive / totalSentiment) * 100)
    : 0;
  const neutralRate = totalSentiment
    ? Math.round((snapshot.neutral / totalSentiment) * 100)
    : 0;
  const negativeRate = totalSentiment
    ? Math.max(0, 100 - positiveRate - neutralRate)
    : 0;
  const maxTimeline = Math.max(
    1,
    ...snapshot.timeline.map(
      (point) => point.positive + point.neutral + point.negative,
    ),
  );

  return (
    <div className="page-stack">
      <section className="page-intro dashboard-intro">
        <div>
          <h2>Người dùng đang nói gì về VinSmart Future?</h2>
        </div>
        <div className="intro-actions">
          <button
            className="button button-secondary report-export-button"
            type="button"
            onClick={() => void exportPdf()}
            disabled={exportingPdf}
          >
            <span aria-hidden="true">{exportingPdf ? "◌" : "⇩"}</span>
            {exportingPdf ? "Đang tạo PDF…" : "Tải PDF"}
          </button>
        </div>
      </section>

      {mode !== "live" && (
        <DataNotice
          mode={mode}
          message={message}
          lastUpdated={lastUpdated ? `Cập nhật ${lastUpdated}` : undefined}
        />
      )}

      {reportNotice && (
        <div
          className={`analysis-notice analysis-${reportNotice.kind}`}
          role={reportNotice.kind === "error" ? "alert" : "status"}
        >
          <span aria-hidden="true">
            {reportNotice.kind === "success" ? "✓" : "!"}
          </span>
          {reportNotice.message}
        </div>
      )}

      <section className="kpi-grid" aria-label="Chỉ số bình luận">
        <article className="metric-card metric-total">
          <span className="metric-label">Bình luận đã lọc</span>
          <strong>{snapshot.total.toLocaleString("vi-VN")}</strong>
          <p className="metric-total-meta">
            <span>{snapshot.posts.toLocaleString("vi-VN")} bài post</span>
            {snapshot.pending > 0 && (
              <span>{snapshot.pending.toLocaleString("vi-VN")} chờ AI</span>
            )}
          </p>
        </article>
        <article className="metric-card metric-positive">
          <span className="metric-label">Tích cực</span>
          <strong>{snapshot.positive.toLocaleString("vi-VN")}</strong>
        </article>
        <article className="metric-card metric-neutral">
          <span className="metric-label">Trung lập</span>
          <strong>{snapshot.neutral.toLocaleString("vi-VN")}</strong>
        </article>
        <article className="metric-card metric-negative">
          <span className="metric-label">Tiêu cực</span>
          <strong>{snapshot.negative.toLocaleString("vi-VN")}</strong>
        </article>
      </section>

      <section className="insight-grid">
        <article className="panel sentiment-panel">
          <div className="panel-heading">
            <div>
              <h3>Cơ cấu sắc thái comment</h3>
            </div>
            <span className="quiet-badge">{totalSentiment} mẫu</span>
          </div>
          {totalSentiment ? (
            <div className="sentiment-visual">
              <div
                className="sentiment-donut"
                style={{
                  background: `conic-gradient(var(--positive) 0 ${positiveRate}%, var(--neutral) ${positiveRate}% ${positiveRate + neutralRate}%, var(--negative) ${positiveRate + neutralRate}% 100%)`,
                }}
                role="img"
                aria-label={`${positiveRate}% tích cực, ${neutralRate}% trung lập, ${negativeRate}% tiêu cực`}
              >
                <span>
                  <strong>{positiveRate}%</strong>
                  tích cực
                </span>
              </div>
              <div className="sentiment-legend">
                {[
                  ["positive", "Tích cực", snapshot.positive, positiveRate],
                  ["neutral", "Trung lập", snapshot.neutral, neutralRate],
                  ["negative", "Tiêu cực", snapshot.negative, negativeRate],
                ].map(([key, label, count, rate]) => (
                  <div className={`legend-row legend-${key}`} key={String(key)}>
                    <span className="legend-dot" aria-hidden="true" />
                    <span>{label}</span>
                    <strong>{Number(count).toLocaleString("vi-VN")}</strong>
                    <small>{rate}%</small>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState
              title="Chưa có comment được phân tích"
              description="Kết quả sẽ xuất hiện sau khi AI phân loại sentiment."
            />
          )}
        </article>

        <article className="panel timeline-panel">
          <div className="panel-heading">
            <div>
              <h3>Comment theo ngày</h3>
            </div>
            <span className="quiet-badge">7 ngày</span>
          </div>
          {snapshot.timeline.length ? (
            <div
              className="timeline-chart"
              aria-label="Biểu đồ bình luận theo ngày"
            >
              {snapshot.timeline.map((point) => {
                const total = point.positive + point.neutral + point.negative;
                return (
                  <div className="timeline-column" key={point.label}>
                    <div className="timeline-value">{total}</div>
                    <div className="bar-rail">
                      <span
                        className="bar-positive"
                        style={{
                          height: `${(point.positive / maxTimeline) * 100}%`,
                        }}
                      />
                      <span
                        className="bar-neutral"
                        style={{
                          height: `${(point.neutral / maxTimeline) * 100}%`,
                        }}
                      />
                      <span
                        className="bar-negative"
                        style={{
                          height: `${(point.negative / maxTimeline) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="timeline-label">{point.label}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="Chưa có chuỗi thời gian"
              description="Biểu đồ sẽ xuất hiện khi có comment đã được AI phân tích."
            />
          )}
        </article>
      </section>

      <section className="panel content-panel">
        <div className="panel-heading content-heading">
          <div>
            <h3>Bình luận & phản hồi</h3>
          </div>
          <div className="content-heading-actions">
            <span className="quiet-badge">
              {groupedPosts.length} bài · {filteredItems.length} bình luận
            </span>
            <button
              className="button button-primary analyze-all-button"
              type="button"
              onClick={() => void analyzeAll()}
              disabled={analyzingAll}
            >
              <span aria-hidden="true">{analyzingAll ? "◌" : "✦"}</span>
              {analyzingAll ? "Đang gửi phân tích…" : "Phân tích tất cả"}
            </button>
          </div>
        </div>

        {analysisNotice && (
          <div
            className={`analysis-notice analysis-${analysisNotice.kind}`}
            role={analysisNotice.kind === "error" ? "alert" : "status"}
          >
            <span aria-hidden="true">
              {analysisNotice.kind === "success" ? "✓" : "!"}
            </span>
            {analysisNotice.message}
          </div>
        )}

        <div
          className="filter-bar comment-filter-bar"
          role="search"
          aria-label="Lọc bình luận"
        >
          <label className="search-field">
            <span className="sr-only">Tìm trong bình luận</span>
            <span aria-hidden="true">⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm comment, bài post, nguồn, từ khóa…"
            />
          </label>
          <label>
            <span className="sr-only">Nền tảng</span>
            <select
              value={platform}
              onChange={(event) => setPlatform(event.target.value)}
            >
              <option value="all">Mọi nền tảng</option>
              <option value="facebook">Facebook</option>
              <option value="tiktok">TikTok</option>
              <option value="threads">Threads</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Sắc thái</span>
            <select
              value={sentiment}
              onChange={(event) => setSentiment(event.target.value)}
            >
              <option value="all">Mọi sắc thái</option>
              <option value="positive">Tích cực</option>
              <option value="neutral">Trung lập</option>
              <option value="negative">Tiêu cực</option>
              <option value="pending">Chờ AI</option>
            </select>
          </label>
        </div>

        {filteredItems.length ? (
          <div className="facebook-feed">
            {groupedPosts.map(({ key, post, keywords, comments }) => (
              <article className="facebook-post-card" key={key}>
                <header className="facebook-post-header">
                  <span
                    className={`facebook-avatar${post.postAnonymous ? ` is-anonymous anonymous-variant-${stableAvatarVariant(post.postAnonymousVariant, post.postId)}` : ""}`}
                    aria-hidden="true"
                  >
                    {post.postAnonymous ? (
                      <AnonymousAvatarMark />
                    ) : (
                      authorInitial(post.postAuthorName, false)
                    )}
                  </span>
                  <div className="facebook-post-identity">
                    <strong>
                      {authorLabel(post.postAuthorName, post.postAnonymous)}
                    </strong>
                    <span>
                      {post.source} ·{" "}
                      {post.postPublishedAt
                        ? formatDateTime(post.postPublishedAt)
                        : "Không xác định thời gian"}
                    </span>
                  </div>
                  <span
                    className={`platform-pill platform-${post.platform}`}
                  >
                    {post.platform === "facebook"
                      ? "Facebook"
                      : post.platform === "tiktok"
                        ? "TikTok"
                        : "Threads"}
                  </span>
                  <div className="facebook-post-sentiment">
                    {post.postSentiment ? (
                      <SentimentBadge
                        sentiment={post.postSentiment}
                        confidence={post.postConfidence}
                      />
                    ) : (
                      <span className="pending-badge">Chờ AI</span>
                    )}
                  </div>
                </header>

                <p className="facebook-post-copy">{post.postContext}</p>

                <div className="facebook-post-meta">
                  <div className="facebook-keywords">
                    {keywords.length ? (
                      keywords.map((keyword) => (
                        <span className="keyword-chip" key={keyword}>
                          {keyword}
                        </span>
                      ))
                    ) : (
                      <span className="keyword-chip keyword-unknown">
                        Chưa xác định
                      </span>
                    )}
                  </div>
                  <div className="facebook-post-links">
                    {post.postUrl && (
                      <a
                        href={post.postUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Mở bài viết ↗
                      </a>
                    )}
                  </div>
                </div>

                <div className="facebook-comment-summary">
                  <span>{comments.length} bình luận</span>
                </div>

                <div className="facebook-comments">
                  {comments.map(({ item, depth }) => {
                    const parentAuthorName = item.parentCommentId
                      ? (comments.find(
                          ({ item: candidate }) =>
                            candidate.id === item.parentCommentId,
                        )?.item.authorName ?? null)
                      : null;
                    return (
                      <div
                        className={`facebook-comment${depth ? ` is-reply reply-depth-${depth}` : ""}`}
                        data-reply-depth={depth}
                        style={
                          depth
                            ? {
                                marginLeft: `${Math.min(depth, 8) * 30}px`,
                                ["--reply-depth" as string]: depth,
                              }
                            : undefined
                        }
                        key={item.id}
                      >
                      <span
                        className={`facebook-avatar facebook-comment-avatar${item.anonymous ? ` is-anonymous anonymous-variant-${stableAvatarVariant(item.anonymousVariant, `${item.postId}|${item.id}`)}` : ""}`}
                        aria-hidden="true"
                      >
                        {item.anonymous ? (
                          <AnonymousAvatarMark />
                        ) : (
                          authorInitial(item.authorName, false)
                        )}
                      </span>
                      <div className="facebook-comment-body">
                        <div className="facebook-comment-line">
                          <div className="facebook-comment-bubble">
                            <strong>
                              {authorLabel(item.authorName, item.anonymous)}
                            </strong>
                            <p>
                              {renderCommentContent(
                                item.content,
                                parentAuthorName,
                                depth > 0,
                              )}
                            </p>
                          </div>
                          <div className="facebook-comment-sentiment">
                            {item.sentiment ? (
                              <SentimentBadge
                                sentiment={item.sentiment}
                                confidence={item.confidence}
                              />
                            ) : (
                              <span className="pending-badge">Chờ AI</span>
                            )}
                          </div>
                        </div>
                        <div className="facebook-comment-actions">
                          <time>
                            {item.commentPublishedAt
                              ? formatDateTime(item.commentPublishedAt)
                              : "Không xác định thời gian"}
                          </time>
                          {item.originalUrl && (
                            <a
                              href={item.originalUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Mở bình luận ↗
                            </a>
                          )}
                        </div>
                      </div>
                        </div>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Không tìm thấy bình luận phù hợp"
            description={
              snapshot.items.length
                ? "Thử bỏ bớt bộ lọc hoặc đổi từ khóa tìm kiếm."
                : "API chưa có bình luận hoặc phản hồi nào."
            }
          />
        )}
      </section>
    </div>
  );
}
