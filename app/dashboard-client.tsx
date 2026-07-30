"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AuthorBadge,
  DataNotice,
  EmptyState,
  ProgressBar,
  SentimentBadge,
  type Sentiment,
} from "./components/ui";
import {
  apiRequest,
  asBoolean,
  asNumber,
  asRecord,
  asString,
  clearActiveJobId,
  formatDateTime,
  formatShortTime,
  readActiveJobId,
  unwrapItems,
} from "./lib/api";

type CommentItem = {
  id: string;
  platform: "facebook" | "tiktok" | "threads";
  source: string;
  authorName: string | null;
  anonymous: boolean;
  content: string;
  sentiment: Sentiment | null;
  confidence: number;
  commentPublishedAt: string | null;
  commentCollectedAt: string | null;
  commentTimeParseStatus: "parsed" | "unknown";
  originalUrl: string | null;
  parentCommentId: string | null;
  postId: string;
  postContext: string;
  postPublishedAt: string | null;
  postCollectedAt: string | null;
  postTimeParseStatus: "parsed" | "unknown";
  postAuthorName: string | null;
  postAnonymous: boolean;
  postUrl: string | null;
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

type ActiveJob = {
  id: string;
  status: string;
  step: string;
  currentSource: string;
  progress: number;
  postsScanned: number;
  postsMatched: number;
  commentsSaved: number;
  sentimentDone: number;
  sentimentTotal: number;
  heartbeatAt: string | null;
  error: string | null;
  demo?: boolean;
};

type DataMode = "live" | "offline" | "degraded";

const DEMO_ITEMS: CommentItem[] = [
  {
    id: "demo-comment-01",
    platform: "facebook",
    source: "Khoa học & Đổi mới",
    authorName: null,
    anonymous: true,
    content:
      "Có lịch chi tiết cho chuỗi tọa đàm Vin Future chưa nhỉ? Mình muốn theo dõi trực tuyến.",
    sentiment: "neutral",
    confidence: 0.88,
    commentPublishedAt: "2026-07-30T08:16:00+07:00",
    commentCollectedAt: "2026-07-30T08:18:00+07:00",
    commentTimeParseStatus: "parsed",
    originalUrl: null,
    parentCommentId: null,
    postId: "demo-parent-01",
    postContext:
      "Lịch hoạt động và tọa đàm khoa học trong khuôn khổ VinFuture",
    postPublishedAt: "2026-07-30T07:40:00+07:00",
    postCollectedAt: "2026-07-30T08:11:00+07:00",
    postTimeParseStatus: "parsed",
    postAuthorName: "Ban tổ chức sự kiện",
    postAnonymous: false,
    postUrl: null,
    keywords: ["Vin Future"],
  },
  {
    id: "demo-comment-02",
    platform: "facebook",
    source: "Chuyện AI Việt Nam",
    authorName: "Hà Phương",
    anonymous: false,
    content:
      "Nội dung đáng quan tâm nhưng thông báo lịch sự kiện hơi chậm, khó chủ động sắp xếp thời gian.",
    sentiment: "negative",
    confidence: 0.79,
    commentPublishedAt: "2026-07-30T07:51:00+07:00",
    commentCollectedAt: "2026-07-30T07:56:00+07:00",
    commentTimeParseStatus: "parsed",
    originalUrl: null,
    parentCommentId: null,
    postId: "demo-parent-02",
    postContext:
      "Thảo luận về truyền thông và khả năng tiếp cận các chương trình VinFuture",
    postPublishedAt: "2026-07-29T22:34:00+07:00",
    postCollectedAt: "2026-07-30T07:45:00+07:00",
    postTimeParseStatus: "parsed",
    postAuthorName: "Tuấn Khoa",
    postAnonymous: false,
    postUrl: null,
    keywords: ["Vinfuture"],
  },
  {
    id: "demo-reply-01",
    platform: "facebook",
    source: "Chuyện AI Việt Nam",
    authorName: "Minh Anh",
    anonymous: false,
    content:
      "Mình đồng ý, nếu có thông báo sớm hơn thì sinh viên ở xa cũng dễ tham gia hơn.",
    sentiment: "positive",
    confidence: 0.91,
    commentPublishedAt: "2026-07-30T08:03:00+07:00",
    commentCollectedAt: "2026-07-30T08:08:00+07:00",
    commentTimeParseStatus: "parsed",
    originalUrl: null,
    parentCommentId: "demo-comment-02",
    postId: "demo-parent-02",
    postContext:
      "Thảo luận về truyền thông và khả năng tiếp cận các chương trình VinFuture",
    postPublishedAt: "2026-07-29T22:34:00+07:00",
    postCollectedAt: "2026-07-30T07:45:00+07:00",
    postTimeParseStatus: "parsed",
    postAuthorName: "Tuấn Khoa",
    postAnonymous: false,
    postUrl: null,
    keywords: ["Vinfuture"],
  },
  {
    id: "demo-comment-03",
    platform: "facebook",
    source: "Cộng đồng Công nghệ Việt",
    authorName: null,
    anonymous: false,
    content:
      "Mình thấy từ khóa VSF xuất hiện trong bài, không rõ có phải đang nhắc cùng chương trình không.",
    sentiment: "neutral",
    confidence: 0.58,
    commentPublishedAt: null,
    commentCollectedAt: "2026-07-29T21:10:00+07:00",
    commentTimeParseStatus: "unknown",
    originalUrl: null,
    parentCommentId: null,
    postId: "demo-parent-03",
    postContext: "Tổng hợp các giải thưởng khoa học quốc tế đáng chú ý",
    postPublishedAt: "2026-07-29T19:42:00+07:00",
    postCollectedAt: "2026-07-29T20:05:00+07:00",
    postTimeParseStatus: "parsed",
    postAuthorName: null,
    postAnonymous: true,
    postUrl: null,
    keywords: ["VSF"],
  },
  {
    id: "demo-reply-02",
    platform: "facebook",
    source: "Cộng đồng Công nghệ Việt",
    authorName: "Quang Huy",
    anonymous: false,
    content:
      "Bài này đang nói tới VinFuture, phần viết tắt trong ảnh có thể khiến mọi người nhầm.",
    sentiment: "neutral",
    confidence: 0.76,
    commentPublishedAt: "2026-07-29T21:26:00+07:00",
    commentCollectedAt: "2026-07-29T21:30:00+07:00",
    commentTimeParseStatus: "parsed",
    originalUrl: null,
    parentCommentId: "demo-comment-03",
    postId: "demo-parent-03",
    postContext: "Tổng hợp các giải thưởng khoa học quốc tế đáng chú ý",
    postPublishedAt: "2026-07-29T19:42:00+07:00",
    postCollectedAt: "2026-07-29T20:05:00+07:00",
    postTimeParseStatus: "parsed",
    postAuthorName: null,
    postAnonymous: true,
    postUrl: null,
    keywords: ["VSF", "VinFuture"],
  },
];

const DEMO_JOB: ActiveJob = {
  id: "demo-crawl-0726",
  status: "running",
  step: "Đang thu thập bình luận và phản hồi",
  currentSource: "Cộng đồng Công nghệ Việt",
  progress: 64,
  postsScanned: 186,
  postsMatched: 27,
  commentsSaved: 214,
  sentimentDone: 193,
  sentimentTotal: 241,
  heartbeatAt: "2026-07-30T09:12:42+07:00",
  error: null,
  demo: true,
};

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
  return { name, anonymous };
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
    ) || (postId ? `Bài cha ${postId}` : "Bài cha chưa có nội dung tóm tắt");
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
  const comments = items.filter((item) => !item.parentCommentId).length;
  const replies = items.length - comments;
  return {
    total: items.length,
    posts: new Set(items.map((item) => item.postId).filter(Boolean)).size,
    comments,
    replies,
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
  const total =
    record.total === undefined ? fallback.total : asNumber(record.total);
  const replies =
    record.replies === undefined
      ? fallback.replies
      : asNumber(record.replies);
  const rawComments =
    record.comments === undefined
      ? fallback.comments
      : asNumber(record.comments);
  const comments =
    record.replies === undefined && rawComments === total
      ? Math.max(0, total - replies)
      : rawComments;
  return {
    total,
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

function normalizeJob(value: unknown): ActiveJob | null {
  const record = asRecord(value);
  const id = String(record.id ?? record.jobId ?? record.job_id ?? "");
  if (!id) return null;
  const progressRecord = asRecord(record.progress);
  const status = asString(record.status, "queued").toLowerCase();
  const tasksTotal = asNumber(
    progressRecord.tasksTotal ?? progressRecord.tasks_total,
  );
  const tasksDone = asNumber(
    progressRecord.tasksDone ?? progressRecord.tasks_done,
  );
  const sourcesTotal = asNumber(
    progressRecord.sourcesTotal ?? progressRecord.sources_total,
  );
  const sourcesDone = asNumber(
    progressRecord.sourcesDone ?? progressRecord.sources_done,
  );
  const calculatedProgress = tasksTotal
    ? (tasksDone / tasksTotal) * 100
    : sourcesTotal
      ? (sourcesDone / sourcesTotal) * 100
      : ["completed", "complete"].includes(status)
        ? 100
        : 0;

  return {
    id,
    status,
    step: asString(
      record.step ??
        record.currentStep ??
        progressRecord.step ??
        progressRecord.stage,
      status === "queued" ? "Đang chờ extension" : "Đang xử lý",
    ),
    currentSource: asString(
      record.currentSource ??
        record.current_source ??
        progressRecord.currentSource ??
        progressRecord.current_source,
      "Chưa xác định",
    ),
    progress: asNumber(
      record.progressPercent ??
        record.progress_percent ??
        progressRecord.percent ??
        progressRecord.percentage,
      calculatedProgress,
    ),
    postsScanned: asNumber(
      record.postsScanned ??
        record.posts_scanned ??
        progressRecord.postsScanned ??
        progressRecord.posts_scanned,
    ),
    postsMatched: asNumber(
      record.postsMatched ??
        record.posts_matched ??
        progressRecord.postsMatched ??
        progressRecord.posts_matched,
    ),
    commentsSaved: asNumber(
      record.commentsSaved ??
        record.comments_saved ??
        progressRecord.commentsSaved ??
        progressRecord.comments_saved,
    ),
    sentimentDone: asNumber(
      record.sentimentDone ??
        record.sentiment_done ??
        progressRecord.sentimentDone ??
        progressRecord.sentiment_done,
    ),
    sentimentTotal: asNumber(
      record.sentimentTotal ??
        record.sentiment_total ??
        progressRecord.sentimentTotal ??
        progressRecord.sentiment_total,
    ),
    heartbeatAt:
      asString(
        record.heartbeatAt ??
          record.heartbeat_at ??
          progressRecord.heartbeatAt ??
          progressRecord.lastHeartbeatAt ??
          progressRecord.heartbeat_at,
      ) || null,
    error:
      asString(
        record.error ??
          record.errorMessage ??
          record.error_message ??
          record.lastError ??
          record.last_error,
      ) || null,
  };
}

function isTerminalJob(status: string): boolean {
  return [
    "completed",
    "complete",
    "failed",
    "cancelled",
    "canceled",
    "partial",
  ].includes(status.toLowerCase());
}

export function DashboardClient() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [mode, setMode] = useState<DataMode>("live");
  const [message, setMessage] = useState("Đang kết nối API…");
  const [lastUpdated, setLastUpdated] = useState("");
  const [platform, setPlatform] = useState("all");
  const [sentiment, setSentiment] = useState("all");
  const [query, setQuery] = useState("");
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    const activeJobId = readActiveJobId();

    try {
      const [summaryResult, timelineResult, commentsResult, jobResult] =
        await Promise.allSettled([
        apiRequest<unknown>("/dashboard/summary"),
        apiRequest<unknown>("/dashboard/timeline"),
        apiRequest<unknown>(
          "/listening/comments?limit=100&includeUnknownTime=true",
        ),
        activeJobId
          ? apiRequest<unknown>(`/jobs/${encodeURIComponent(activeJobId)}`)
          : Promise.resolve(null),
      ]);

      const dataResults = [summaryResult, timelineResult, commentsResult];
      const dataFailures = dataResults.filter(
        (result) => result.status === "rejected",
      ).length;

      if (dataFailures === dataResults.length) {
        setSnapshot(buildSnapshot(DEMO_ITEMS));
        setMode("offline");
        setMessage(
          "API chưa phản hồi. Bình luận và số liệu bên dưới là snapshot minh họa, không phải dữ liệu crawl thật.",
        );
        setActiveJob(activeJobId ? DEMO_JOB : null);
      } else {
        const comments =
          commentsResult.status === "fulfilled"
            ? unwrapItems(commentsResult.value)
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

        const jobUnavailable =
          Boolean(activeJobId) && jobResult.status === "rejected";
        const degraded = dataFailures > 0 || jobUnavailable;
        setMode(degraded ? "degraded" : "live");
        setMessage(
          dataFailures > 0
            ? `${dataResults.length - dataFailures}/3 nguồn dữ liệu đã phản hồi. KPI hoặc timeline thiếu sẽ được suy ra từ feed gần nhất.`
            : jobUnavailable
              ? "KPI và feed đang trực tiếp; riêng tiến độ job chưa phản hồi."
              : "KPI comment-only lấy từ API tổng hợp; feed 100 comment gần nhất làm mới mỗi 5 giây.",
        );

        if (jobResult.status === "fulfilled" && jobResult.value) {
          const job = normalizeJob(jobResult.value);
          setActiveJob(job);
          if (job && isTerminalJob(job.status)) clearActiveJobId(job.id);
        } else if (!activeJobId || jobUnavailable) {
          setActiveJob(null);
        }
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

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("vi-VN");
    return (snapshot?.items ?? []).filter((item) => {
      if (platform !== "all" && item.platform !== platform) return false;
      if (
        sentiment !== "all" &&
        (sentiment === "pending"
          ? item.sentiment !== null
          : item.sentiment !== sentiment)
      ) {
        return false;
      }
      if (
        normalizedQuery &&
        !`${item.content} ${item.source} ${item.postContext} ${item.keywords.join(" ")}`
          .toLocaleLowerCase("vi-VN")
          .includes(normalizedQuery)
      ) {
        return false;
      }
      return true;
    });
  }, [platform, query, sentiment, snapshot?.items]);

  if (!snapshot) {
    return (
      <div className="page-loading" role="status" aria-live="polite">
        <span className="loading-orbit" aria-hidden="true" />
        <strong>Đang dựng bức tranh thảo luận…</strong>
        <p>Kết nối bình luận, phản hồi và AI sentiment.</p>
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
      <section className="page-intro">
        <div>
          <span className="section-kicker">Tín hiệu từ comment & reply</span>
          <h2>Người dùng đang nói gì về VinFuture?</h2>
          <p>
            Bình luận và phản hồi là dữ liệu listening chính. Bài cha được lưu
            đầy đủ metadata/ngữ cảnh gồm nguồn, URL, nội dung, tác giả dạng
            name-only, thời gian đăng/thu thập và keyword khớp.
          </p>
        </div>
        <div className="intro-actions">
          <a className="button button-secondary" href="/settings">
            Chỉnh nguồn crawl
          </a>
          <a className="button button-primary" href="/jobs">
            Xem tiến trình
          </a>
        </div>
      </section>

      <DataNotice
        mode={mode}
        message={message}
        lastUpdated={lastUpdated ? `Cập nhật ${lastUpdated}` : undefined}
      />

      <section className="kpi-grid" aria-label="Chỉ số bình luận">
        <article className="metric-card metric-total">
          <span className="metric-label">Comment đã lọc</span>
          <strong>{snapshot.total.toLocaleString("vi-VN")}</strong>
          <p>
            <span>{snapshot.comments.toLocaleString("vi-VN")} bình luận</span>
            <span>{snapshot.replies.toLocaleString("vi-VN")} phản hồi</span>
            <span>{snapshot.posts.toLocaleString("vi-VN")} bài cha</span>
            {snapshot.unknownTime > 0 && (
              <span>
                {snapshot.unknownTime.toLocaleString("vi-VN")} chưa rõ thời gian
              </span>
            )}
            {snapshot.pending > 0 && (
              <span>{snapshot.pending.toLocaleString("vi-VN")} chờ AI</span>
            )}
          </p>
        </article>
        <article className="metric-card metric-positive">
          <span className="metric-label">Tích cực</span>
          <strong>{snapshot.positive.toLocaleString("vi-VN")}</strong>
          <p>{positiveRate}% comment đã phân tích</p>
        </article>
        <article className="metric-card metric-neutral">
          <span className="metric-label">Trung lập</span>
          <strong>{snapshot.neutral.toLocaleString("vi-VN")}</strong>
          <p>{neutralRate}% comment đã phân tích</p>
        </article>
        <article className="metric-card metric-negative">
          <span className="metric-label">Tiêu cực</span>
          <strong>{snapshot.negative.toLocaleString("vi-VN")}</strong>
          <p>{negativeRate}% comment đã phân tích</p>
        </article>
      </section>

      <section className="insight-grid">
        <article className="panel sentiment-panel">
          <div className="panel-heading">
            <div>
              <span className="section-kicker">AI sentiment</span>
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
              <span className="section-kicker">Nhịp thảo luận</span>
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

      <section className="panel active-job-panel">
        <div className="panel-heading">
          <div>
            <span className="section-kicker">Extension nền</span>
            <h3>Job đang hoạt động</h3>
          </div>
          {activeJob && (
            <span className={`job-status status-${activeJob.status}`}>
              <span aria-hidden="true" />
              {activeJob.demo ? "Snapshot minh họa" : activeJob.status}
            </span>
          )}
        </div>
        {activeJob ? (
          <div className="active-job-layout">
            <div>
              <div className="job-step">
                <span>Bước hiện tại</span>
                <strong>{activeJob.step}</strong>
                <p>{activeJob.currentSource}</p>
              </div>
              <ProgressBar
                value={activeJob.progress}
                label="Tiến độ toàn bộ job"
              />
            </div>
            <div className="job-stat-grid">
              <div>
                <span>Post đã quét</span>
                <strong>{activeJob.postsScanned}</strong>
              </div>
              <div>
                <span>Post lưu ngữ cảnh</span>
                <strong>{activeJob.postsMatched}</strong>
              </div>
              <div>
                <span>Comment đã lưu</span>
                <strong>{activeJob.commentsSaved}</strong>
              </div>
              <div>
                <span>AI hoàn tất</span>
                <strong>
                  {activeJob.sentimentDone}/{activeJob.sentimentTotal}
                </strong>
              </div>
            </div>
            <div className="job-heartbeat">
              <span>Heartbeat gần nhất</span>
              <strong>{formatDateTime(activeJob.heartbeatAt)}</strong>
              {activeJob.error && <p className="inline-error">{activeJob.error}</p>}
              <a href="/jobs">Chi tiết job →</a>
            </div>
          </div>
        ) : (
          <EmptyState
            title="Không có job đang chạy"
            description="Chọn group và bắt đầu lấy comment tại trang Thiết lập Facebook."
            action={
              <a className="button button-secondary button-small" href="/settings">
                Mở thiết lập
              </a>
            }
          />
        )}
      </section>

      <section className="panel content-panel">
        <div className="panel-heading content-heading">
          <div>
            <span className="section-kicker">Listening feed</span>
            <h3>Bình luận & phản hồi</h3>
          </div>
          <span className="quiet-badge">{filteredItems.length} kết quả</span>
        </div>

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
              placeholder="Tìm comment, bài cha, nguồn, từ khóa…"
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
          <div className="content-list">
            {filteredItems.map((item) => (
              <article className="content-item" key={item.id}>
                <div className="content-meta">
                  <span className={`platform-pill platform-${item.platform}`}>
                    {item.platform === "facebook"
                      ? "Facebook"
                      : item.platform === "tiktok"
                        ? "TikTok"
                        : "Threads"}
                  </span>
                  <span className="content-kind">
                    {item.parentCommentId ? "Phản hồi" : "Bình luận"}
                  </span>
                  <span className="comment-time-label">Đăng comment</span>
                  {item.commentPublishedAt ? (
                    <time>{formatDateTime(item.commentPublishedAt)}</time>
                  ) : (
                    <span className="time-unknown">Không xác định</span>
                  )}
                  <span
                    className="collected-time"
                    title={`Comment được thu thập lúc ${formatDateTime(item.commentCollectedAt)}`}
                  >
                    Thu thập {formatDateTime(item.commentCollectedAt)}
                  </span>
                  {item.commentTimeParseStatus === "unknown" && (
                    <span className="time-unknown">Timestamp chưa parse</span>
                  )}
                </div>

                <p className="content-copy">{item.content}</p>

                <div className="post-context">
                  <div>
                    <span>Bài cha · {item.source}</span>
                    <strong>{item.postContext}</strong>
                  </div>
                  <div className="post-context-meta">
                    <div className="post-author">
                      <span>Tác giả bài</span>
                      <AuthorBadge
                        name={item.postAuthorName}
                        anonymous={item.postAnonymous}
                      />
                    </div>
                    <span>
                      Đăng bài:{" "}
                      {item.postPublishedAt
                        ? formatDateTime(item.postPublishedAt)
                        : "Không xác định"}
                    </span>
                    <span
                      title={`Bài cha được thu thập lúc ${formatDateTime(item.postCollectedAt)}`}
                    >
                      Thu thập: {formatDateTime(item.postCollectedAt)}
                    </span>
                    {item.postTimeParseStatus === "unknown" && (
                      <span className="time-unknown">Thời gian bài chưa parse</span>
                    )}
                    {item.postUrl && (
                      <a
                        href={item.postUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Mở bài viết cha trong tab mới"
                      >
                        Mở bài cha ↗
                      </a>
                    )}
                  </div>
                </div>

                <div className="content-footer">
                  <div className="content-identity">
                    <AuthorBadge
                      name={item.authorName}
                      anonymous={item.anonymous}
                    />
                    <span className="source-name">
                      {item.parentCommentId
                        ? `Reply · ${item.source}`
                        : item.source}
                    </span>
                  </div>
                  <div className="content-signals">
                    {item.keywords.map((keyword) => (
                      <span className="keyword-chip" key={keyword}>
                        {keyword}
                      </span>
                    ))}
                    {item.sentiment ? (
                      <SentimentBadge
                        sentiment={item.sentiment}
                        confidence={item.confidence}
                      />
                    ) : (
                      <span className="pending-badge">Chờ AI</span>
                    )}
                    {item.sentiment && item.confidence < 0.65 && (
                      <span className="review-badge">Cần xem lại</span>
                    )}
                    {item.originalUrl && (
                      <a
                        className="original-link"
                        href={item.originalUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Mở bình luận gốc trong tab mới"
                      >
                        Bình luận gốc ↗
                      </a>
                    )}
                  </div>
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
