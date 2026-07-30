"use client";

import type { ReactNode } from "react";

export type Sentiment = "positive" | "negative" | "neutral";

const sentimentLabels: Record<Sentiment, string> = {
  positive: "Tích cực",
  negative: "Tiêu cực",
  neutral: "Trung lập",
};

export function SentimentBadge({
  sentiment,
  confidence,
}: {
  sentiment: Sentiment;
  confidence?: number;
}) {
  const needsReview = confidence !== undefined && confidence < 0.65;
  return (
    <span className={`sentiment-badge sentiment-${sentiment}`}>
      <span className="sentiment-indicator" aria-hidden="true" />
      {sentimentLabels[sentiment]}
      {confidence !== undefined && (
        <span className="confidence">
          {Math.round(confidence * 100)}%
        </span>
      )}
      {needsReview && <span className="sr-only">, cần xem lại</span>}
    </span>
  );
}

export function AuthorBadge({
  name,
  anonymous,
}: {
  name?: string | null;
  anonymous: boolean;
}) {
  if (anonymous) {
    return (
      <span className="author-badge is-anonymous" title="Facebook không công khai tên tác giả">
        <span aria-hidden="true">A</span>
        Ẩn danh
      </span>
    );
  }

  if (!name) {
    return (
      <span className="author-badge is-unknown" title="Không xác định được tên tác giả">
        <span aria-hidden="true">?</span>
        Không xác định
      </span>
    );
  }

  const initial = name.trim().charAt(0).toLocaleUpperCase("vi-VN") || "N";
  return (
    <span className="author-badge" title="Chỉ hiển thị tên, không theo dõi hồ sơ">
      <span aria-hidden="true">{initial}</span>
      {name}
    </span>
  );
}

export function DataNotice({
  mode,
  message,
  lastUpdated,
}: {
  mode: "live" | "offline" | "degraded";
  message: string;
  lastUpdated?: string;
}) {
  return (
    <div
      className={`data-notice notice-${mode}`}
      role={mode === "offline" ? "alert" : "status"}
    >
      <span className="notice-symbol" aria-hidden="true">
        {mode === "live" ? "●" : mode === "degraded" ? "!" : "○"}
      </span>
      <div>
        <strong>
          {mode === "live"
            ? "Dữ liệu trực tiếp"
            : mode === "degraded"
              ? "Kết nối chưa đầy đủ"
              : "API đang ngoại tuyến"}
        </strong>
        <span>{message}</span>
      </div>
      {lastUpdated && <time>{lastUpdated}</time>}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-mark" aria-hidden="true">
        ···
      </span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function ProgressBar({
  value,
  label,
}: {
  value: number;
  label: string;
}) {
  const normalized = Math.max(0, Math.min(100, value));
  return (
    <div className="progress-wrap">
      <div className="progress-label">
        <span>{label}</span>
        <strong>{Math.round(normalized)}%</strong>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(normalized)}
      >
        <span style={{ width: `${normalized}%` }} />
      </div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`toggle-row${disabled ? " is-disabled" : ""}`}>
      <span>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
      />
      <span className="toggle-control" aria-hidden="true">
        <span />
      </span>
    </label>
  );
}
