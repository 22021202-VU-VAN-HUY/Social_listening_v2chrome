import type {
  Content,
  ContentStack,
  TDocumentDefinitions,
} from "pdfmake/interfaces";

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
    pending: number;
    positive: number;
    neutral: number;
    negative: number;
  };
  posts: PdfReportPost[];
};

type VirtualFileSystem = Record<string, string>;

const COLORS = {
  red: "#E5092F",
  redDark: "#B50724",
  redSoft: "#FFF0F3",
  ink: "#17171A",
  muted: "#667085",
  line: "#D9DDE5",
  surface: "#F4F6F8",
  positive: "#12845E",
  positiveSoft: "#E8F7F1",
  neutral: "#A46D00",
  neutralSoft: "#FFF6D8",
  negative: "#C52D3A",
  negativeSoft: "#FFECEF",
  pending: "#657084",
  pendingSoft: "#EEF1F5",
  white: "#FFFFFF",
} as const;

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

function sentimentMeta(value: ReportSentiment): {
  label: string;
  color: string;
  background: string;
} {
  if (value === "positive") {
    return {
      label: "Tích cực",
      color: COLORS.positive,
      background: COLORS.positiveSoft,
    };
  }
  if (value === "negative") {
    return {
      label: "Tiêu cực",
      color: COLORS.negative,
      background: COLORS.negativeSoft,
    };
  }
  if (value === "neutral") {
    return {
      label: "Trung lập",
      color: COLORS.neutral,
      background: COLORS.neutralSoft,
    };
  }
  return {
    label: "Chờ AI",
    color: COLORS.pending,
    background: COLORS.pendingSoft,
  };
}

function percent(count: number, total: number): number {
  return total ? Math.round((count / total) * 100) : 0;
}

function metricCell(value: number, label: string): ContentStack {
  return {
    stack: [
      {
        text: value.toLocaleString("vi-VN"),
        color: COLORS.red,
        bold: true,
        fontSize: 17,
      },
      { text: label, color: COLORS.muted, fontSize: 8, margin: [0, 2, 0, 0] },
    ],
    fillColor: COLORS.white,
    margin: [9, 8, 9, 8],
  };
}

function sentimentSummaryRow(
  label: string,
  count: number,
  rate: number,
  color: string,
): Content[] {
  return [
    {
      text: "",
      fillColor: color,
      margin: [3, 7, 3, 7],
    },
    { text: label, bold: true, color: COLORS.ink, margin: [0, 3, 0, 0] },
    {
      text: count.toLocaleString("vi-VN"),
      bold: true,
      alignment: "right",
      margin: [0, 3, 0, 0],
    },
    {
      text: `${rate}%`,
      color: COLORS.muted,
      alignment: "right",
      margin: [0, 3, 0, 0],
    },
  ];
}

function commentContent(comment: PdfReportComment): Content {
  const depth = Math.min(Math.max(comment.depth, 0), 8);
  const sentiment = sentimentMeta(comment.sentiment);
  const score = comment.sentiment
    ? ` · ${Math.round(comment.confidence * 100)}%`
    : "";

  return {
    margin: [depth * 14, 3, 0, 3],
    unbreakable: true,
    table: {
      widths: ["*"],
      body: [
        [
          {
            stack: [
              {
                columns: [
                  {
                    width: "*",
                    text: comment.author || "Không xác định",
                    bold: true,
                    fontSize: 8.5,
                    color: COLORS.ink,
                  },
                  {
                    width: "auto",
                    text: `${sentiment.label}${score}`,
                    bold: true,
                    fontSize: 7.5,
                    color: sentiment.color,
                  },
                ],
              },
              {
                text: comment.text,
                fontSize: 8.5,
                color: COLORS.ink,
                margin: [0, 3, 0, 3],
              },
              {
                text: `${depth ? `Phản hồi bậc ${depth}` : "Bình luận"} · ${formatDate(comment.publishedAt)}`,
                fontSize: 6.8,
                color: COLORS.muted,
              },
            ],
            fillColor: depth ? "#F8F9FB" : COLORS.surface,
            margin: [8, 6, 8, 6],
          },
        ],
      ],
    },
    layout: {
      hLineColor: () => COLORS.line,
      vLineColor: () => COLORS.line,
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
  };
}

function postContent(post: PdfReportPost, index: number): Content[] {
  const sentiment = sentimentMeta(post.sentiment);
  const score = post.sentiment
    ? ` · ${Math.round(post.confidence * 100)}%`
    : "";
  const originalUrl = safeUrl(post.url);
  const keywords = post.keywords.length
    ? post.keywords.join(" · ")
    : "Chưa xác định";
  const comments: Content[] = post.comments.length
    ? post.comments.map(commentContent)
    : [
        {
          text: "Chưa có comment/reply được lưu cho bài post này.",
          italics: true,
          color: COLORS.muted,
          fontSize: 8,
          margin: [0, 6, 0, 3],
        },
      ];

  const header: Content = {
    headlineLevel: 1,
    unbreakable: true,
    table: {
      widths: ["*", "auto"],
      body: [
        [
          {
            stack: [
              {
                text: `BÀI POST ${index + 1} · ${post.platform.toLocaleUpperCase("vi-VN")}`,
                color: COLORS.red,
                bold: true,
                fontSize: 7.5,
                characterSpacing: 0.5,
              },
              {
                text: post.author || "Không xác định",
                bold: true,
                fontSize: 11,
                margin: [0, 3, 0, 1],
              },
              {
                text: `${post.source} · ${formatDate(post.publishedAt)}`,
                color: COLORS.muted,
                fontSize: 7.5,
              },
            ],
            margin: [10, 8, 6, 8],
          },
          {
            stack: [
              {
                text: `${sentiment.label}${score}`,
                color: sentiment.color,
                bold: true,
                fontSize: 8,
                alignment: "right",
              },
              {
                text: `${post.comments.length.toLocaleString("vi-VN")} bình luận`,
                color: COLORS.muted,
                fontSize: 7,
                alignment: "right",
                margin: [0, 4, 0, 0],
              },
            ],
            fillColor: sentiment.background,
            margin: [9, 11, 9, 11],
          },
        ],
      ],
    },
    layout: {
      hLineColor: () => COLORS.line,
      vLineColor: () => COLORS.line,
      hLineWidth: () => 0.6,
      vLineWidth: () => 0.6,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
    margin: [0, index ? 12 : 4, 0, 0],
  };

  return [
    header,
    {
      stack: [
        { text: post.text, fontSize: 9.5, color: COLORS.ink },
        {
          text: `Keyword: ${keywords}`,
          color: COLORS.redDark,
          fontSize: 7.5,
          bold: true,
          margin: [0, 7, 0, 0],
        },
        {
          text: `Thu thập: ${formatDate(post.collectedAt)}`,
          color: COLORS.muted,
          fontSize: 7,
          margin: [0, 3, 0, 0],
        },
        ...(originalUrl
          ? [
              {
                text: "Mở bài viết gốc",
                link: originalUrl,
                color: COLORS.red,
                decoration: "underline" as const,
                fontSize: 7.5,
                margin: [0, 4, 0, 0] as [number, number, number, number],
              },
            ]
          : []),
      ],
      margin: [10, 9, 10, 7],
    },
    {
      text: "BÌNH LUẬN VÀ PHẢN HỒI",
      bold: true,
      color: COLORS.muted,
      fontSize: 7,
      characterSpacing: 0.5,
      margin: [10, 4, 10, 2],
    },
    { stack: comments, margin: [10, 0, 10, 8] },
  ];
}

export function buildSocialListeningPdfDefinition(
  report: SocialListeningPdfReport,
): TDocumentDefinitions {
  const analyzed =
    report.totals.positive + report.totals.neutral + report.totals.negative;
  const positiveRate = percent(report.totals.positive, analyzed);
  const neutralRate = percent(report.totals.neutral, analyzed);
  const negativeRate = analyzed
    ? Math.max(0, 100 - positiveRate - neutralRate)
    : 0;
  const postContentItems = report.posts.flatMap(postContent);

  return {
    pageSize: "A4",
    pageMargins: [34, 34, 34, 38],
    info: {
      title: "Báo cáo Social Listening - VinSmart Future",
      author: "Social Listening",
      subject: "Bài viết, bình luận và phân tích sắc thái",
      keywords: "VinSmart Future, social listening, sentiment",
    },
    defaultStyle: {
      font: "NotoSans",
      fontSize: 9,
      color: COLORS.ink,
      lineHeight: 1.25,
    },
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        {
          text: "Social Listening · VinSmart Future · Báo cáo chỉ đọc",
          color: COLORS.muted,
          fontSize: 7,
        },
        {
          text: `${currentPage}/${pageCount}`,
          alignment: "right",
          color: COLORS.muted,
          fontSize: 7,
        },
      ],
      margin: [34, 10, 34, 0],
    }),
    pageBreakBefore: (
      currentNode,
      followingNodesOnPage,
      _nodesOnNextPage,
      previousNodesOnPage,
    ) =>
      currentNode.headlineLevel === 1 &&
      previousNodesOnPage.length > 0 &&
      followingNodesOnPage.length < 2,
    content: [
      {
        table: {
          widths: ["*", 118],
          body: [
            [
              {
                stack: [
                  {
                    text: "SOCIAL LISTENING",
                    fontSize: 8,
                    bold: true,
                    color: "#FFD8DF",
                    characterSpacing: 1.2,
                  },
                  {
                    text: "VinSmart Future",
                    fontSize: 23,
                    bold: true,
                    color: COLORS.white,
                    margin: [0, 4, 0, 3],
                  },
                  {
                    text: "Báo cáo sắc thái, bài viết và toàn bộ luồng bình luận",
                    fontSize: 8.5,
                    color: "#FFE8ED",
                  },
                ],
                fillColor: COLORS.red,
                margin: [16, 14, 12, 14],
              },
              {
                stack: [
                  {
                    text: "XUẤT LÚC",
                    fontSize: 7,
                    bold: true,
                    color: "#FFD8DF",
                    alignment: "right",
                  },
                  {
                    text: formatDate(report.generatedAt),
                    fontSize: 9,
                    bold: true,
                    color: COLORS.white,
                    alignment: "right",
                    margin: [0, 5, 0, 0],
                  },
                ],
                fillColor: COLORS.redDark,
                margin: [10, 17, 12, 17],
              },
            ],
          ],
        },
        layout: "noBorders",
        margin: [0, 0, 0, 10],
      },
      {
        table: {
          widths: ["*", "*", "*", "*"],
          body: [
            [
              metricCell(report.totals.posts, "Bài post"),
              metricCell(report.totals.comments, "Bình luận"),
              metricCell(analyzed, "Đã phân tích"),
              metricCell(report.totals.pending, "Chờ AI"),
            ],
          ],
        },
        layout: {
          hLineColor: () => COLORS.line,
          vLineColor: () => COLORS.line,
          hLineWidth: () => 0.6,
          vLineWidth: () => 0.6,
          paddingLeft: () => 0,
          paddingRight: () => 0,
          paddingTop: () => 0,
          paddingBottom: () => 0,
        },
        margin: [0, 0, 0, 10],
      },
      {
        stack: [
          {
            columns: [
              {
                width: "*",
                text: "Cơ cấu sắc thái comment",
                bold: true,
                fontSize: 12,
              },
              {
                width: "auto",
                text: `${analyzed.toLocaleString("vi-VN")} mẫu đã phân tích`,
                color: COLORS.muted,
                fontSize: 7.5,
              },
            ],
          },
          {
            table: {
              widths: [18, "*", 52, 42],
              body: [
                sentimentSummaryRow(
                  "Tích cực",
                  report.totals.positive,
                  positiveRate,
                  COLORS.positive,
                ),
                sentimentSummaryRow(
                  "Trung lập",
                  report.totals.neutral,
                  neutralRate,
                  COLORS.neutral,
                ),
                sentimentSummaryRow(
                  "Tiêu cực",
                  report.totals.negative,
                  negativeRate,
                  COLORS.negative,
                ),
              ],
            },
            layout: {
              hLineColor: () => COLORS.line,
              vLineColor: () => COLORS.line,
              hLineWidth: () => 0.5,
              vLineWidth: () => 0,
              paddingLeft: () => 4,
              paddingRight: () => 4,
              paddingTop: () => 3,
              paddingBottom: () => 3,
            },
            margin: [0, 8, 0, 0],
          },
        ],
        fillColor: COLORS.white,
        margin: [10, 9, 10, 10],
      },
      {
        columns: [
          {
            width: "*",
            text: "Toàn bộ bài post",
            bold: true,
            fontSize: 14,
            margin: [0, 13, 0, 5],
          },
          {
            width: "auto",
            text: `${report.posts.length.toLocaleString("vi-VN")} bài · ${report.totals.comments.toLocaleString("vi-VN")} bình luận`,
            color: COLORS.muted,
            fontSize: 7.5,
            margin: [0, 17, 0, 5],
          },
        ],
      },
      ...(postContentItems.length
        ? postContentItems
        : [
            {
              text: "Chưa có bài post để xuất báo cáo.",
              italics: true,
              color: COLORS.muted,
              margin: [0, 12, 0, 0] as [number, number, number, number],
            },
          ]),
    ],
  };
}

async function loadPdfMake() {
  const pdfModule = (await import("pdfmake/build/pdfmake")) as typeof import("pdfmake/build/pdfmake") & {
    default?: typeof import("pdfmake/build/pdfmake");
  };
  const pdfMake = pdfModule.default ?? pdfModule;
  const [regular, bold] = await Promise.all([
    fetchFontAsBase64("/fonts/NotoSans-Regular.ttf"),
    fetchFontAsBase64("/fonts/NotoSans-Bold.ttf"),
  ]);
  pdfMake.vfs = {
    "NotoSans-Regular.ttf": regular,
    "NotoSans-Bold.ttf": bold,
  } satisfies VirtualFileSystem;
  pdfMake.fonts = {
    NotoSans: {
      normal: "NotoSans-Regular.ttf",
      bold: "NotoSans-Bold.ttf",
      italics: "NotoSans-Regular.ttf",
      bolditalics: "NotoSans-Bold.ttf",
    },
  };
  return pdfMake;
}

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return window.btoa(binary);
}

async function fetchFontAsBase64(path: string): Promise<string> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Không tải được font tiếng Việt cho PDF (${response.status}).`);
  }
  return bytesToBase64(await response.arrayBuffer());
}

export async function createSocialListeningPdfBlob(
  report: SocialListeningPdfReport,
): Promise<Blob> {
  const pdfMake = await loadPdfMake();
  const definition = buildSocialListeningPdfDefinition(report);
  return new Promise<Blob>((resolve, reject) => {
    try {
      pdfMake.createPdf(definition).getBlob(resolve);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function reportFilename(generatedAt: string): string {
  const date = new Date(generatedAt);
  const valid = Number.isNaN(date.getTime()) ? new Date() : date;
  const stamp = valid
    .toLocaleString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" })
    .replace(" ", "-")
    .replaceAll(":", "");
  return `bao-cao-social-listening-${stamp}.pdf`;
}

export async function downloadSocialListeningPdf(
  report: SocialListeningPdfReport,
): Promise<string> {
  const blob = await createSocialListeningPdfBlob(report);
  const filename = reportFilename(report.generatedAt);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return filename;
}
