"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DataNotice,
  EmptyState,
  ProgressBar,
} from "../components/ui";
import {
  apiRequest,
  asNumber,
  asRecord,
  asString,
  clearActiveJobId,
  formatDateTime,
  formatShortTime,
  readActiveJobId,
  unwrapItems,
} from "../lib/api";

type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled"
  | "needs-login";

type ListeningJob = {
  id: string;
  type: "discover-sources" | "crawl";
  platform: "facebook" | "tiktok" | "threads";
  status: JobStatus;
  step: string;
  currentSource: string;
  progress: number;
  postsScanned: number;
  postsMatched: number;
  commentsSaved: number;
  sentimentDone: number;
  sentimentTotal: number;
  heartbeatAt: string | null;
  createdAt: string | null;
  finishedAt: string | null;
  error: string | null;
  demo?: boolean;
};

type DataMode = "live" | "offline" | "degraded";

const DEMO_JOBS: ListeningJob[] = [
  {
    id: "demo-crawl-0730",
    type: "crawl",
    platform: "facebook",
    status: "running",
    step: "Đang đọc bình luận",
    currentSource: "Cộng đồng Công nghệ Việt",
    progress: 64,
    postsScanned: 186,
    postsMatched: 27,
    commentsSaved: 214,
    sentimentDone: 193,
    sentimentTotal: 241,
    heartbeatAt: "2026-07-30T09:12:42+07:00",
    createdAt: "2026-07-30T08:51:10+07:00",
    finishedAt: null,
    error: null,
    demo: true,
  },
  {
    id: "demo-crawl-0729",
    type: "crawl",
    platform: "facebook",
    status: "completed",
    step: "Hoàn tất",
    currentSource: "4 group đã xử lý",
    progress: 100,
    postsScanned: 342,
    postsMatched: 51,
    commentsSaved: 389,
    sentimentDone: 440,
    sentimentTotal: 440,
    heartbeatAt: "2026-07-29T22:05:28+07:00",
    createdAt: "2026-07-29T20:42:05+07:00",
    finishedAt: "2026-07-29T22:05:28+07:00",
    error: null,
    demo: true,
  },
  {
    id: "demo-discover-0728",
    type: "discover-sources",
    platform: "facebook",
    status: "completed",
    step: "Đã đồng bộ 12 group",
    currentSource: "Danh sách group đã tham gia",
    progress: 100,
    postsScanned: 0,
    postsMatched: 0,
    commentsSaved: 0,
    sentimentDone: 0,
    sentimentTotal: 0,
    heartbeatAt: "2026-07-28T17:18:45+07:00",
    createdAt: "2026-07-28T17:17:21+07:00",
    finishedAt: "2026-07-28T17:18:45+07:00",
    error: null,
    demo: true,
  },
];

function normalizeStatus(value: unknown): JobStatus {
  const status = String(value ?? "queued")
    .toLowerCase()
    .replaceAll("_", "-");
  if (
    [
      "running",
      "in-progress",
      "processing",
      "processing-ai",
      "claimed",
    ].includes(status)
  ) {
    return "running";
  }
  if (["completed", "complete", "success", "succeeded"].includes(status)) {
    return "completed";
  }
  if (["partial", "partially-completed"].includes(status)) return "partial";
  if (["failed", "error"].includes(status)) return "failed";
  if (["cancelled", "canceled"].includes(status)) return "cancelled";
  if (["needs-login", "login-required"].includes(status)) return "needs-login";
  if (status === "interrupted") return "failed";
  return "queued";
}

function normalizeJob(value: unknown): ListeningJob | null {
  const record = asRecord(value);
  const progress = asRecord(record.progress);
  const id = String(record.id ?? record.jobId ?? record.job_id ?? "");
  if (!id) return null;
  const rawType = asString(record.type ?? record.jobType ?? record.job_type, "crawl");
  const platformValue = asString(record.platform, "facebook").toLowerCase();
  const platform: ListeningJob["platform"] =
    platformValue === "tiktok" || platformValue === "threads"
      ? platformValue
      : "facebook";
  const status = normalizeStatus(record.status);
  const tasksTotal = asNumber(progress.tasksTotal ?? progress.tasks_total);
  const tasksDone = asNumber(progress.tasksDone ?? progress.tasks_done);
  const sourcesTotal = asNumber(progress.sourcesTotal ?? progress.sources_total);
  const sourcesDone = asNumber(progress.sourcesDone ?? progress.sources_done);
  const calculatedProgress = tasksTotal
    ? (tasksDone / tasksTotal) * 100
    : sourcesTotal
      ? (sourcesDone / sourcesTotal) * 100
      : status === "completed"
        ? 100
        : 0;

  return {
    id,
    type: rawType.includes("discover") ? "discover-sources" : "crawl",
    platform,
    status,
    step: asString(
      record.step ?? record.currentStep ?? progress.step ?? progress.stage,
      "Đang chờ xử lý",
    ),
    currentSource: asString(
      record.currentSource ??
        record.current_source ??
        progress.currentSource ??
        progress.current_source,
      "Chưa xác định",
    ),
    progress: asNumber(
      record.progressPercent ??
        record.progress_percent ??
        progress.percent ??
        progress.percentage,
      calculatedProgress,
    ),
    postsScanned: asNumber(
      record.postsScanned ??
        record.posts_scanned ??
        progress.postsScanned ??
        progress.posts_scanned,
    ),
    postsMatched: asNumber(
      record.postsMatched ??
        record.posts_matched ??
        progress.postsMatched ??
        progress.posts_matched,
    ),
    commentsSaved: asNumber(
      record.commentsSaved ??
        record.comments_saved ??
        progress.commentsSaved ??
        progress.comments_saved,
    ),
    sentimentDone: asNumber(
      record.sentimentDone ??
        record.sentiment_done ??
        progress.sentimentDone ??
        progress.sentiment_done,
    ),
    sentimentTotal: asNumber(
      record.sentimentTotal ??
        record.sentiment_total ??
        progress.sentimentTotal ??
        progress.sentiment_total,
    ),
    heartbeatAt:
      asString(
        record.heartbeatAt ??
        record.heartbeat_at ??
        progress.heartbeatAt ??
        progress.lastHeartbeatAt ??
        progress.heartbeat_at,
      ) || null,
    createdAt:
      asString(record.createdAt ?? record.created_at ?? record.startedAt) || null,
    finishedAt:
      asString(
        record.finishedAt ??
          record.finished_at ??
          record.completedAt ??
          record.completed_at,
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

function statusLabel(status: JobStatus): string {
  return {
    queued: "Đang chờ",
    running: "Đang chạy",
    completed: "Hoàn tất",
    partial: "Hoàn tất một phần",
    failed: "Thất bại",
    cancelled: "Đã hủy",
    "needs-login": "Cần đăng nhập",
  }[status];
}

function isTerminal(status: JobStatus): boolean {
  return ["completed", "partial", "failed", "cancelled"].includes(status);
}

function duration(job: ListeningJob): string {
  if (!job.createdAt) return "—";
  const start = new Date(job.createdAt).getTime();
  const end = job.finishedAt
    ? new Date(job.finishedAt).getTime()
    : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "—";
  const minutes = Math.max(0, Math.round((end - start) / 60_000));
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  return `${hours} giờ ${minutes % 60} phút`;
}

export function JobsClient() {
  const [jobs, setJobs] = useState<ListeningJob[] | null>(null);
  const [mode, setMode] = useState<DataMode>("live");
  const [notice, setNotice] = useState("Đang kết nối hàng đợi job…");
  const [lastUpdated, setLastUpdated] = useState("");
  const [filter, setFilter] = useState<"all" | JobStatus>("all");
  const [cancelling, setCancelling] = useState("");
  const [feedback, setFeedback] = useState("");
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    const activeId = readActiveJobId();

    try {
      const [listResult, activeResult] = await Promise.allSettled([
        apiRequest<unknown>("/jobs?limit=20"),
        activeId
          ? apiRequest<unknown>(`/jobs/${encodeURIComponent(activeId)}`)
          : Promise.resolve(null),
      ]);

      if (
        listResult.status === "rejected" &&
        (activeResult.status === "rejected" || !activeId)
      ) {
        setJobs(DEMO_JOBS);
        setMode("offline");
        setNotice(
          "API chưa phản hồi. Danh sách dưới đây là lịch sử minh họa, không phải job đang chạy thật.",
        );
      } else {
        const list =
          listResult.status === "fulfilled"
            ? unwrapItems(listResult.value)
                .map(normalizeJob)
                .filter((job): job is ListeningJob => job !== null)
            : [];
        const active =
          activeResult.status === "fulfilled" && activeResult.value
            ? normalizeJob(activeResult.value)
            : null;
        const byId = new Map<string, ListeningJob>();
        if (active) byId.set(active.id, active);
        for (const job of list) byId.set(job.id, job);
        const combined = [...byId.values()].sort((a, b) => {
          const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return bTime - aTime;
        });

        setJobs(combined);
        const degraded =
          listResult.status === "rejected" || activeResult.status === "rejected";
        setMode(degraded ? "degraded" : "live");
        setNotice(
          degraded
            ? "Đọc được job đang hoạt động nhưng lịch sử chưa phản hồi đầy đủ."
            : "Tiến trình được đọc từ API và làm mới mỗi 5 giây.",
        );
        if (active && isTerminal(active.status)) clearActiveJobId(active.id);
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

  const activeJob = useMemo(
    () =>
      jobs?.find((job) => job.status === "running") ??
      jobs?.find((job) => job.status === "queued") ??
      jobs?.find((job) => job.status === "needs-login") ??
      null,
    [jobs],
  );

  const history = useMemo(() => {
    if (!jobs) return [];
    return jobs.filter((job) => {
      if (job.id === activeJob?.id) return false;
      return filter === "all" || job.status === filter;
    });
  }, [activeJob?.id, filter, jobs]);

  async function cancelJob(job: ListeningJob) {
    if (job.demo) {
      setFeedback("Đây là snapshot minh họa nên không có job thật để hủy.");
      return;
    }
    setCancelling(job.id);
    setFeedback("");
    try {
      await apiRequest<unknown>(
        `/jobs/${encodeURIComponent(job.id)}/cancel`,
        { method: "POST", body: JSON.stringify({}) },
      );
      setFeedback("Đã gửi yêu cầu hủy. Extension sẽ đóng tab Facebook an toàn.");
      await refresh();
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Không thể gửi yêu cầu hủy.",
      );
    } finally {
      setCancelling("");
    }
  }

  if (!jobs) {
    return (
      <div className="page-loading" role="status">
        <span className="loading-orbit" aria-hidden="true" />
        <strong>Đang đọc hàng đợi job…</strong>
        <p>Kết nối extension, crawler và bộ phân loại sentiment.</p>
      </div>
    );
  }

  return (
    <div className="page-stack jobs-page">
      <section className="page-intro">
        <div>
          <span className="section-kicker">Pipeline quan sát được</span>
          <h2>Theo dõi từ lúc mở group đến khi AI hoàn tất</h2>
          <p>
            Mỗi job ghi rõ post đã quét, post đã lưu metadata/ngữ cảnh,
            comment/reply đã lưu và nhịp heartbeat từ extension.
          </p>
        </div>
        <a className="button button-primary" href="/settings">
          Tạo job lấy comment
        </a>
      </section>

      <DataNotice
        mode={mode}
        message={notice}
        lastUpdated={lastUpdated ? `Cập nhật ${lastUpdated}` : undefined}
      />

      {feedback && (
        <div className="feedback feedback-info" role="status">
          <span aria-hidden="true">i</span>
          <p>{feedback}</p>
          <button
            type="button"
            onClick={() => setFeedback("")}
            aria-label="Đóng thông báo"
          >
            ×
          </button>
        </div>
      )}

      <section className="panel job-focus-panel">
        <div className="panel-heading">
          <div>
            <span className="section-kicker">Đang hoạt động</span>
            <h3>Job hiện tại</h3>
          </div>
          {activeJob && (
            <span className={`job-status status-${activeJob.status}`}>
              <span aria-hidden="true" />
              {activeJob.demo ? "Snapshot minh họa" : statusLabel(activeJob.status)}
            </span>
          )}
        </div>

        {activeJob ? (
          <>
            <div className="job-focus-head">
              <div className="job-id-block">
                <span>
                  {activeJob.type === "crawl" ? "Facebook crawl" : "Đồng bộ group"}
                </span>
                <strong>{activeJob.id}</strong>
              </div>
              <div className="job-current">
                <span>Bước hiện tại</span>
                <strong>{activeJob.step}</strong>
                <small>{activeJob.currentSource}</small>
              </div>
              <div className="job-clock">
                <span>Đã chạy</span>
                <strong>{duration(activeJob)}</strong>
                <small>
                  Heartbeat {formatDateTime(activeJob.heartbeatAt)}
                </small>
              </div>
            </div>

            <ProgressBar
              value={activeJob.progress}
              label="Tiến độ xử lý toàn bộ job"
            />

            <div className="pipeline">
              {[
                ["Quét post", activeJob.postsScanned, "Đối chiếu từ khóa"],
                ["Lưu post cha", activeJob.postsMatched, "Metadata/ngữ cảnh"],
                ["Lưu comment", activeJob.commentsSaved, "Gồm reply và ẩn danh"],
                [
                  "AI sentiment",
                  activeJob.sentimentDone,
                  `trên ${activeJob.sentimentTotal} nội dung`,
                ],
              ].map(([label, value, description], index) => (
                <div className="pipeline-step" key={String(label)}>
                  <span className="pipeline-index">{index + 1}</span>
                  <span>
                    <small>{label}</small>
                    <strong>{Number(value).toLocaleString("vi-VN")}</strong>
                    <em>{description}</em>
                  </span>
                </div>
              ))}
            </div>

            {activeJob.error && (
              <div className="job-error" role="alert">
                <strong>Lỗi gần nhất</strong>
                <p>{activeJob.error}</p>
              </div>
            )}

            <div className="job-focus-actions">
              <p>
                Tab Facebook được khóa theo lease: tối đa một tab, tự đóng khi
                job hoàn tất, thất bại hoặc bị hủy.
              </p>
              <button
                className="button button-danger"
                type="button"
                onClick={() => void cancelJob(activeJob)}
                disabled={
                  cancelling === activeJob.id ||
                  !["running", "queued", "needs-login"].includes(activeJob.status)
                }
              >
                {cancelling === activeJob.id ? "Đang gửi…" : "Hủy job an toàn"}
              </button>
            </div>
          </>
        ) : (
          <EmptyState
            title="Hàng đợi đang trống"
            description="Chưa có job lấy group hoặc crawl nào đang hoạt động."
            action={
              <a className="button button-secondary button-small" href="/settings">
                Mở thiết lập Facebook
              </a>
            }
          />
        )}
      </section>

      <section className="panel history-panel">
        <div className="panel-heading history-heading">
          <div>
            <span className="section-kicker">Nhật ký gần đây</span>
            <h3>Lịch sử job</h3>
          </div>
          <label>
            <span className="sr-only">Lọc trạng thái job</span>
            <select
              value={filter}
              onChange={(event) =>
                setFilter(event.target.value as "all" | JobStatus)
              }
            >
              <option value="all">Mọi trạng thái</option>
              <option value="completed">Hoàn tất</option>
              <option value="partial">Một phần</option>
              <option value="failed">Thất bại</option>
              <option value="cancelled">Đã hủy</option>
            </select>
          </label>
        </div>

        {history.length ? (
          <div className="job-history-list">
            {history.map((job) => (
              <article className="history-row" key={job.id}>
                <div className="history-type">
                  <span
                    className={`platform-monogram platform-monogram-${job.platform}`}
                    aria-hidden="true"
                  >
                    {job.platform === "facebook"
                      ? "f"
                      : job.platform === "tiktok"
                        ? "t"
                        : "@"}
                  </span>
                  <span>
                    <strong>
                      {job.type === "crawl"
                        ? "Thu thập comment"
                        : "Đồng bộ group"}
                    </strong>
                    <small>{job.id}</small>
                  </span>
                </div>
                <div className="history-created">
                  <span>Bắt đầu</span>
                  <strong>{formatDateTime(job.createdAt)}</strong>
                </div>
                <div className="history-result">
                  <span>Kết quả</span>
                  <strong>
                    {job.type === "crawl"
                      ? `${job.commentsSaved} comment/reply · post cha lưu ngữ cảnh`
                      : job.step}
                  </strong>
                </div>
                <div className="history-duration">
                  <span>Thời lượng</span>
                  <strong>{duration(job)}</strong>
                </div>
                <span className={`job-status status-${job.status}`}>
                  <span aria-hidden="true" />
                  {statusLabel(job.status)}
                </span>
                {job.error && <p className="history-error">{job.error}</p>}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Không có job phù hợp"
            description="Thử đổi bộ lọc hoặc tạo một job crawl mới."
          />
        )}
      </section>
    </div>
  );
}
