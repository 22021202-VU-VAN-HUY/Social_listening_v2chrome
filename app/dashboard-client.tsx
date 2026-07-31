"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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

function orderCommentThread(
  comments: CommentItem[],
): Array<{ item: CommentItem; depth: number }> {
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

  const ordered: Array<{ item: CommentItem; depth: number }> = [];
  const visited = new Set<string>();
  const append = (comment: CommentItem, depth: number) => {
    if (visited.has(comment.id)) return;
    visited.add(comment.id);
    ordered.push({ item: comment, depth: Math.min(depth, 2) });
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
  const [analyzingAll, setAnalyzingAll] = useState(false);
  const [analysisNotice, setAnalysisNotice] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
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
        setSnapshot(buildSnapshot([]));
        setMode("offline");
        setMessage(
          "API chưa phản hồi. Không hiển thị số liệu giả; hãy chạy Docker backend rồi tải lại.",
        );
        setActiveJob(null);
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
            ? `Đã gửi ${queued.toLocaleString("vi-VN")} bình luận sang AI. Kết quả sẽ tự cập nhật.`
            : asString(result.message) ||
              "Đã gửi toàn bộ bình luận sang AI. Kết quả sẽ tự cập nhật.",
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
              {activeJob.status}
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
          <div className="content-heading-actions">
            <span className="quiet-badge">
              {groupedPosts.length} bài · {filteredItems.length} bình luận
            </span>
            <button
              className="button button-primary analyze-all-button"
              type="button"
              onClick={() => void analyzeAll()}
              disabled={analyzingAll || snapshot.total === 0}
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
          <div className="facebook-feed">
            {groupedPosts.map(({ key, post, keywords, comments }) => (
              <article className="facebook-post-card" key={key}>
                <header className="facebook-post-header">
                  <span
                    className={`facebook-avatar${post.postAnonymous ? " is-anonymous" : ""}`}
                    aria-hidden="true"
                  >
                    {authorInitial(post.postAuthorName, post.postAnonymous)}
                  </span>
                  <div className="facebook-post-identity">
                    <strong>
                      {authorLabel(post.postAuthorName, post.postAnonymous)}
                    </strong>
                    <span>
                      {post.source} ·{" "}
                      {post.postPublishedAt
                        ? formatDateTime(post.postPublishedAt)
                        : "Không xác định thời gian"}{" "}
                      · <span aria-label="Công khai">●</span>
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
                  <span className="facebook-more" aria-hidden="true">
                    •••
                  </span>
                </header>

                <p className="facebook-post-copy">{post.postContext}</p>

                <div className="facebook-post-meta">
                  <div className="facebook-keywords">
                    <span>Bắt được keyword</span>
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
                    <span
                      title={`Bài được thu thập lúc ${formatDateTime(post.postCollectedAt)}`}
                    >
                      Thu thập {formatDateTime(post.postCollectedAt)}
                    </span>
                    {post.postTimeParseStatus === "unknown" && (
                      <span className="time-unknown">Thời gian chưa parse</span>
                    )}
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
                  <span>{comments.length} bình luận và phản hồi</span>
                  <span>Chỉ đọc · Không tương tác</span>
                </div>

                <div className="facebook-comments">
                  {comments.map(({ item, depth }) => (
                    <div
                      className={`facebook-comment${depth ? " is-reply" : ""}`}
                      style={
                        depth
                          ? { marginLeft: `${Math.min(depth, 2) * 34}px` }
                          : undefined
                      }
                      key={item.id}
                    >
                      <span
                        className={`facebook-avatar facebook-comment-avatar${item.anonymous ? " is-anonymous" : ""}`}
                        aria-hidden="true"
                      >
                        {authorInitial(item.authorName, item.anonymous)}
                      </span>
                      <div className="facebook-comment-body">
                        <div className="facebook-comment-line">
                          <div className="facebook-comment-bubble">
                            <strong>
                              {authorLabel(item.authorName, item.anonymous)}
                            </strong>
                            <p>{item.content}</p>
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
                          <span>{depth ? "Phản hồi" : "Bình luận"}</span>
                          <time>
                            {item.commentPublishedAt
                              ? formatDateTime(item.commentPublishedAt)
                              : "Không xác định thời gian"}
                          </time>
                          {item.commentTimeParseStatus === "unknown" && (
                            <span className="time-warning">
                              Timestamp chưa parse
                            </span>
                          )}
                          <span
                            title={`Thu thập lúc ${formatDateTime(item.commentCollectedAt)}`}
                          >
                            Thu thập {formatDateTime(item.commentCollectedAt)}
                          </span>
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
                  ))}
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
