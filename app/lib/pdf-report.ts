export type ReportSentiment = "positive" | "negative" | "neutral" | null;

export type PdfReportComment = {
  author: string;
  text: string;
  sentiment: ReportSentiment;
  confidence: number;
  publishedAt: string | null;
  depth: number;
};

export type PdfReportPost = {
  id: string;
  platform: string;
  source: string;
  author: string;
  text: string;
  sentiment: ReportSentiment;
  confidence: number;
  publishedAt: string | null;
  collectedAt: string | null;
  url: string | null;
  keywords: string[];
  comments: PdfReportComment[];
};

export type SocialListeningPdfReport = {
  generatedAt: string;
  totals: {
    posts: number;
    comments: number;
    replies: number;
    pending: number;
    positive: number;
    neutral: number;
    negative: number;
  };
  posts: PdfReportPost[];
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function formatDate(value: string | null): string {
  if (!value) return "Không xác định thời gian";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(date);
}

function sentimentText(value: ReportSentiment): string {
  if (value === "positive") return "Tích cực";
  if (value === "negative") return "Tiêu cực";
  if (value === "neutral") return "Trung lập";
  return "Chờ AI";
}

function sentimentClass(value: ReportSentiment): string {
  return value ?? "pending";
}

function sentimentBadge(
  value: ReportSentiment,
  confidence: number,
): string {
  const score = value ? ` <small>${Math.round(confidence * 100)}%</small>` : "";
  return `<span class="sentiment sentiment-${sentimentClass(value)}"><i></i>${sentimentText(value)}${score}</span>`;
}

function authorInitial(author: string): string {
  return escapeHtml(author.trim().charAt(0).toLocaleUpperCase("vi-VN") || "?");
}

function percent(count: number, total: number): number {
  return total ? Math.round((count / total) * 100) : 0;
}

function commentHtml(comment: PdfReportComment): string {
  const depth = Math.min(Math.max(comment.depth, 0), 8);
  return `
    <div class="comment${depth ? " is-reply" : ""}" style="--indent:${depth * 24}px;--print-indent:${depth * 18}px">
      <span class="avatar comment-avatar">${authorInitial(comment.author)}</span>
      <div class="comment-main">
        <div class="comment-row">
          <div class="comment-bubble">
            <strong>${escapeHtml(comment.author)}</strong>
            <p>${escapeHtml(comment.text)}</p>
          </div>
          ${sentimentBadge(comment.sentiment, comment.confidence)}
        </div>
        <div class="comment-meta">
          <span>${depth ? `Phản hồi bậc ${depth}` : "Bình luận"}</span>
          <span>${escapeHtml(formatDate(comment.publishedAt))}</span>
        </div>
      </div>
    </div>`;
}

function postHtml(post: PdfReportPost, index: number): string {
  const originalUrl = safeUrl(post.url);
  const keywordHtml = post.keywords.length
    ? post.keywords
        .map((keyword) => `<span class="keyword">${escapeHtml(keyword)}</span>`)
        .join("")
    : '<span class="keyword muted">Chưa xác định</span>';
  const comments = post.comments.length
    ? post.comments.map(commentHtml).join("")
    : '<p class="empty-comments">Chưa có comment/reply được lưu cho bài post này.</p>';

  return `
    <article class="post-card">
      <header class="post-header">
        <span class="avatar">${authorInitial(post.author)}</span>
        <div class="post-identity">
          <strong>${escapeHtml(post.author)}</strong>
          <span>${escapeHtml(post.source)} · ${escapeHtml(formatDate(post.publishedAt))} · ●</span>
        </div>
        <span class="platform">${escapeHtml(post.platform)}</span>
        ${sentimentBadge(post.sentiment, post.confidence)}
      </header>
      <div class="post-number">Bài post ${index + 1}</div>
      <p class="post-copy">${escapeHtml(post.text)}</p>
      <div class="post-details">
        <div class="keywords"><b>Bắt được keyword</b>${keywordHtml}</div>
        <div class="post-time">Thu thập ${escapeHtml(formatDate(post.collectedAt))}</div>
        ${originalUrl ? `<a href="${escapeHtml(originalUrl)}">Mở bài viết gốc ↗</a>` : ""}
      </div>
      <div class="comment-summary">
        <span>${post.comments.length.toLocaleString("vi-VN")} bình luận và phản hồi</span>
        <span>Chỉ đọc · Không tương tác</span>
      </div>
      <div class="comments">${comments}</div>
    </article>`;
}

export function buildSocialListeningPrintHtml(
  report: SocialListeningPdfReport,
): string {
  const analyzed =
    report.totals.positive + report.totals.neutral + report.totals.negative;
  const positiveRate = percent(report.totals.positive, analyzed);
  const neutralRate = percent(report.totals.neutral, analyzed);
  const negativeRate = analyzed
    ? Math.max(0, 100 - positiveRate - neutralRate)
    : 0;
  const postCards = report.posts.length
    ? report.posts.map(postHtml).join("")
    : '<div class="empty-report">Chưa có bài post để xuất báo cáo.</div>';

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Báo cáo Social Listening - VinSmart Future</title>
  <style>
    :root{--red:#eb0a2a;--red-soft:#fff0f3;--ink:#17171a;--muted:#69696f;--line:#e5e5e7;--surface:#f6f6f7;--positive:#15996b;--neutral:#d99a16;--negative:#df3f49;--pending:#7b8494}
    *{box-sizing:border-box}
    html,body{margin:0;background:#eef0f3;color:var(--ink);font-family:Arial,"Segoe UI",sans-serif;font-size:12px;line-height:1.45;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{padding:24px}
    .report{width:min(960px,100%);margin:auto}
    .report-hero{background:linear-gradient(135deg,var(--red),#ef4750);color:#fff;border-radius:18px;padding:24px 28px;display:flex;justify-content:space-between;gap:20px;box-shadow:0 12px 28px rgba(226,35,42,.18)}
    .eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:9px;font-weight:800;opacity:.86}
    h1{font-size:26px;line-height:1.1;margin:5px 0}.hero-copy{margin:0;opacity:.9}.generated{text-align:right;white-space:nowrap;align-self:flex-end;font-size:10px}
    .summary-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0}
    .metric{background:#fff;border:1px solid var(--line);border-radius:13px;padding:13px 15px}.metric b{display:block;color:var(--red);font-size:22px}.metric span{color:var(--muted)}
    .sentiment-panel{background:#fff;border:1px solid var(--line);border-radius:16px;padding:17px 18px;margin-bottom:18px}
    .section-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:13px}.section-heading h2{font-size:16px;margin:0}.section-heading span{color:var(--muted)}
    .sentiment-layout{display:grid;grid-template-columns:140px 1fr;gap:22px;align-items:center}.donut{width:126px;height:126px;border-radius:50%;background:conic-gradient(var(--positive) 0 ${positiveRate}%,var(--neutral) ${positiveRate}% ${positiveRate + neutralRate}%,var(--negative) ${positiveRate + neutralRate}% 100%);display:grid;place-items:center}.donut:after{content:"${analyzed}";display:grid;place-items:center;width:78px;height:78px;border-radius:50%;background:#fff;font-size:22px;font-weight:800;color:var(--ink)}
    .legend{display:grid;gap:8px}.legend-row{display:grid;grid-template-columns:12px 1fr auto auto;gap:9px;align-items:center;padding:8px 10px;background:var(--surface);border-radius:9px}.dot{width:10px;height:10px;border-radius:50%}.positive .dot{background:var(--positive)}.neutral .dot{background:var(--neutral)}.negative .dot{background:var(--negative)}.legend-row small{color:var(--muted);min-width:34px;text-align:right}
    .feed-title{display:flex;justify-content:space-between;align-items:flex-end;margin:20px 0 10px}.feed-title h2{font-size:18px;margin:0}.feed-title span{color:var(--muted)}
    .post-card{background:#fff;border:1px solid #dfe2e7;border-radius:15px;margin:0 0 16px;overflow:hidden;box-shadow:0 3px 12px rgba(16,24,40,.06)}
    .post-header{display:flex;align-items:center;gap:10px;padding:15px 16px 8px;break-inside:avoid}.avatar{width:40px;height:40px;flex:0 0 40px;border-radius:50%;background:linear-gradient(145deg,#eb0a2a,#ff4058);color:#fff;display:grid;place-items:center;font-weight:800;font-size:16px}.comment-avatar{width:32px;height:32px;flex-basis:32px;font-size:12px}
    .post-identity{min-width:0;flex:1}.post-identity strong{display:block;font-size:13px}.post-identity span{display:block;color:var(--muted);font-size:10px}.platform{border:1px solid #cbd5e1;background:#f8fafc;border-radius:999px;padding:4px 8px;text-transform:capitalize;font-size:9px;color:#475467}
    .sentiment{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:4px 8px;font-size:9px;font-weight:800;white-space:nowrap}.sentiment i{width:7px;height:7px;border-radius:50%}.sentiment small{font-size:8px;opacity:.8}.sentiment-positive{color:#087851;background:#eafaf3}.sentiment-positive i{background:var(--positive)}.sentiment-neutral{color:#925f00;background:#fff7df}.sentiment-neutral i{background:var(--neutral)}.sentiment-negative{color:#b4232d;background:#fff0f1}.sentiment-negative i{background:var(--negative)}.sentiment-pending{color:#596273;background:#f0f2f5}.sentiment-pending i{background:var(--pending)}
    .post-number{padding:2px 16px;color:var(--red);font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.post-copy{font-size:13px;white-space:pre-wrap;margin:7px 16px 12px}.post-details{border-top:1px solid #f0f1f3;padding:10px 16px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:var(--muted);font-size:9px}.keywords{display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-right:auto}.keyword{color:#a3131b;background:var(--red-soft);border:1px solid #ffcdd0;border-radius:999px;padding:3px 7px}.keyword.muted{color:var(--muted);background:#f2f4f7;border-color:#e5e7eb}.post-details a{color:var(--red);text-decoration:none;font-weight:700}
    .comment-summary{display:flex;justify-content:space-between;padding:9px 16px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);color:var(--muted);font-size:9px}.comments{padding:9px 16px 13px}.comment{display:flex;gap:8px;margin:7px 0 7px var(--indent);break-inside:avoid}.comment-main{min-width:0;flex:1}.comment-row{display:flex;align-items:flex-start;gap:8px}.comment-bubble{background:#f0f2f5;border-radius:13px;padding:7px 10px;min-width:0;flex:1}.comment-bubble strong{font-size:10px}.comment-bubble p{margin:2px 0 0;font-size:11px;white-space:pre-wrap}.comment-meta{display:flex;gap:10px;color:var(--muted);font-size:8px;padding:3px 8px}.empty-comments,.empty-report{color:var(--muted);font-style:italic;padding:12px 16px}
    .report-footer{text-align:center;color:var(--muted);font-size:9px;padding:8px 0 24px}
    @media print{
      @page{size:A4 portrait;margin:11mm}
      html,body{background:#fff;font-size:10px}body{padding:0}.report{width:100%;max-width:none}
      .report-hero{border-radius:12px;box-shadow:none;padding:18px 20px}.summary-grid{gap:7px;margin:10px 0}.metric{padding:9px 11px}.metric b{font-size:18px}
      .sentiment-panel{padding:13px 14px;margin-bottom:12px}.sentiment-layout{grid-template-columns:110px 1fr}.donut{width:98px;height:98px}.donut:after{width:62px;height:62px;font-size:18px}
      .feed-title{margin:14px 0 8px}.post-card{box-shadow:none;margin-bottom:11px}.post-header{padding-top:11px}.avatar{width:34px;height:34px;flex-basis:34px}.comment-avatar{width:27px;height:27px;flex-basis:27px}.post-copy{font-size:11px}.comment{margin-left:var(--print-indent)}
      a{color:inherit}.post-card,.sentiment-panel,.metric{print-color-adjust:exact;-webkit-print-color-adjust:exact}.comment,.post-header,.post-details,.comment-summary{break-inside:avoid}
    }
  </style>
</head>
<body>
  <main class="report">
    <header class="report-hero">
      <div><div class="eyebrow">Social Listening</div><h1>VinSmart Future</h1><p class="hero-copy">Báo cáo cơ cấu sắc thái và toàn bộ bài post</p></div>
      <div class="generated">Xuất lúc<br><b>${escapeHtml(formatDate(report.generatedAt))}</b></div>
    </header>
    <section class="summary-grid">
      <div class="metric"><b>${report.totals.posts.toLocaleString("vi-VN")}</b><span>Bài post</span></div>
      <div class="metric"><b>${report.totals.comments.toLocaleString("vi-VN")}</b><span>Bình luận</span></div>
      <div class="metric"><b>${report.totals.replies.toLocaleString("vi-VN")}</b><span>Phản hồi</span></div>
      <div class="metric"><b>${report.totals.pending.toLocaleString("vi-VN")}</b><span>Chờ AI</span></div>
    </section>
    <section class="sentiment-panel">
      <div class="section-heading"><h2>Cơ cấu sắc thái comment</h2><span>${analyzed.toLocaleString("vi-VN")} mẫu đã phân tích</span></div>
      <div class="sentiment-layout">
        <div class="donut" aria-label="${positiveRate}% tích cực, ${neutralRate}% trung lập, ${negativeRate}% tiêu cực"></div>
        <div class="legend">
          <div class="legend-row positive"><i class="dot"></i><span>Tích cực</span><b>${report.totals.positive.toLocaleString("vi-VN")}</b><small>${positiveRate}%</small></div>
          <div class="legend-row neutral"><i class="dot"></i><span>Trung lập</span><b>${report.totals.neutral.toLocaleString("vi-VN")}</b><small>${neutralRate}%</small></div>
          <div class="legend-row negative"><i class="dot"></i><span>Tiêu cực</span><b>${report.totals.negative.toLocaleString("vi-VN")}</b><small>${negativeRate}%</small></div>
        </div>
      </div>
    </section>
    <div class="feed-title"><h2>Toàn bộ bài post</h2><span>${report.posts.length.toLocaleString("vi-VN")} bài · ${report.totals.comments + report.totals.replies} comment/reply</span></div>
    <section class="feed">${postCards}</section>
    <footer class="report-footer">Social Listening · VinSmart Future · Bản in chỉ đọc</footer>
  </main>
</body>
</html>`;
}

export function openSocialListeningPrintWindow(): Window | null {
  const printWindow = window.open("", "social-listening-vsf-report");
  if (!printWindow) return null;
  printWindow.document.open();
  printWindow.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Đang tạo báo cáo…</title></head><body style="font-family:Arial,sans-serif;padding:32px;color:#172033"><h2>Đang tải toàn bộ bài post…</h2><p>Vui lòng giữ cửa sổ này mở.</p></body></html>`);
  printWindow.document.close();
  return printWindow;
}

export async function printSocialListeningReport(
  report: SocialListeningPdfReport,
  printWindow: Window,
): Promise<void> {
  printWindow.document.open();
  printWindow.document.write(buildSocialListeningPrintHtml(report));
  printWindow.document.close();
  await printWindow.document.fonts.ready;
  printWindow.focus();
  window.setTimeout(() => printWindow.print(), 250);
}
