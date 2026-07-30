import { canonicalGroupUrl } from "../content/facebook-urls";
import type {
  CrawlKeyword,
  CrawlLimits,
  CrawlSource,
  CrawlTask,
  JobKind,
  JobSnapshot,
  MatchMode
} from "../shared/types";

const DEFAULT_LIMITS: CrawlLimits = {
  maxGroups: 50,
  maxScrollRounds: 30,
  maxPostsPerGroup: 300,
  maxCommentsPerPost: 500,
  maxCommentExpandRounds: 40,
  mutationWaitMs: 1_200
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function inferKind(raw: Record<string, unknown>): JobKind {
  const candidate = (
    stringValue(raw["kind"]) ??
    stringValue(raw["jobKind"]) ??
    stringValue(raw["jobType"]) ??
    stringValue(raw["type"]) ??
    ""
  ).toLocaleLowerCase("en-US");
  if (candidate.includes("discover") || candidate.includes("group_sync")) {
    return "discover_groups";
  }
  const hasSources =
    Array.isArray(raw["sources"]) && (raw["sources"] as unknown[]).length > 0;
  const hasKeywords =
    Array.isArray(raw["keywords"]) && (raw["keywords"] as unknown[]).length > 0;
  return candidate.length === 0 && !hasSources && !hasKeywords
    ? "discover_groups"
    : "crawl_content";
}

function parseMatchMode(value: unknown, keyword: string): MatchMode {
  if (value === "whole_word" || value === "contains_phrase") {
    return value;
  }
  return keyword.toLocaleLowerCase("en-US") === "vsf"
    ? "whole_word"
    : "contains_phrase";
}

function parseKeywords(value: unknown): CrawlKeyword[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const result: CrawlKeyword[] = [];
  for (const entry of value) {
    const candidate = typeof entry === "string" ? { value: entry } : record(entry);
    const keyword =
      stringValue(candidate["value"]) ??
      stringValue(candidate["keyword"]) ??
      stringValue(candidate["text"]);
    const enabled = candidate["enabled"];
    if (!keyword || enabled === false) continue;

    const dedupeKey = keyword.normalize("NFKC").toLocaleLowerCase("vi-VN");
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const parsed: CrawlKeyword = {
      value: keyword.slice(0, 160),
      matchMode: parseMatchMode(candidate["matchMode"], keyword)
    };
    const id =
      stringValue(candidate["id"]) ??
      stringValue(candidate["keywordId"]) ??
      stringValue(candidate["uuid"]);
    if (id) parsed.id = id.slice(0, 128);
    result.push(parsed);
  }
  return result;
}

function parseSources(value: unknown): CrawlSource[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: CrawlSource[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const candidate = record(entry);
    const externalId =
      stringValue(candidate["externalId"]) ??
      stringValue(candidate["sourceExternalId"]) ??
      stringValue(candidate["platformSourceId"]) ??
      stringValue(candidate["id"]);
    const rawUrl =
      stringValue(candidate["url"]) ?? stringValue(candidate["canonicalUrl"]);
    const safeUrl = rawUrl ? canonicalGroupUrl(rawUrl) : null;
    if (!externalId || !safeUrl) {
      continue;
    }
    if (seen.has(externalId)) continue;
    seen.add(externalId);

    const source: CrawlSource = {
      externalId: externalId.slice(0, 200),
      name:
        stringValue(candidate["name"])?.slice(0, 300) ??
        stringValue(candidate["sourceName"])?.slice(0, 300) ??
        externalId.slice(0, 200),
      url: safeUrl
    };
    const id = stringValue(candidate["id"]) ?? stringValue(candidate["sourceId"]);
    if (id) source.id = id.slice(0, 128);
    result.push(source);
  }
  return result;
}

function parseTasks(value: unknown): CrawlTask[] {
  if (!Array.isArray(value)) return [];
  const tasks: CrawlTask[] = [];
  for (const entry of value) {
    const candidate = record(entry);
    const id = stringValue(candidate["id"]) ?? stringValue(candidate["taskId"]);
    if (!id) continue;
    tasks.push({
      id: id.slice(0, 128),
      sourceId:
        stringValue(candidate["sourceId"])?.slice(0, 128) ?? null,
      keywordId:
        stringValue(candidate["keywordId"])?.slice(0, 128) ?? null
    });
  }
  return tasks;
}

function parseIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function normalizeJobSnapshot(value: unknown): JobSnapshot {
  const raw = record(value);
  const settings = record(raw["settings"]);
  const limitsRaw = record(raw["limits"]);
  const sources = parseSources(raw["sources"] ?? raw["groups"] ?? raw["tasks"]);
  const keywords = parseKeywords(raw["keywords"] ?? settings["keywords"]);

  return {
    kind: inferKind(raw),
    sources,
    keywords,
    tasks: parseTasks(raw["tasks"]),
    windowStartUtc: parseIsoDate(
      raw["windowStartUtc"] ?? settings["windowStartUtc"]
    ),
    windowEndUtc: parseIsoDate(raw["windowEndUtc"] ?? settings["windowEndUtc"]),
    crawlComments:
      raw["crawlComments"] !== false && settings["crawlComments"] !== false,
    limits: {
      maxGroups: boundedInteger(
        limitsRaw["maxGroups"] ?? limitsRaw["maxSourcesPerJob"],
        DEFAULT_LIMITS.maxGroups,
        1,
        500
      ),
      maxScrollRounds: boundedInteger(
        limitsRaw["maxScrollRounds"],
        DEFAULT_LIMITS.maxScrollRounds,
        1,
        100
      ),
      maxPostsPerGroup: boundedInteger(
        limitsRaw["maxPostsPerGroup"] ?? limitsRaw["maxPostsPerSource"],
        DEFAULT_LIMITS.maxPostsPerGroup,
        1,
        1_000
      ),
      maxCommentsPerPost: boundedInteger(
        limitsRaw["maxCommentsPerPost"],
        DEFAULT_LIMITS.maxCommentsPerPost,
        1,
        2_000
      ),
      maxCommentExpandRounds: boundedInteger(
        limitsRaw["maxCommentExpandRounds"],
        DEFAULT_LIMITS.maxCommentExpandRounds,
        1,
        100
      ),
      mutationWaitMs: boundedInteger(
        limitsRaw["mutationWaitMs"],
        DEFAULT_LIMITS.mutationWaitMs,
        250,
        10_000
      )
    }
  };
}

export function assertCommentListeningSnapshot(snapshot: JobSnapshot): void {
  if (snapshot.kind === "crawl_content" && snapshot.crawlComments !== true) {
    throw new Error(
      "Comment-only listening requires crawlComments=true; post-only jobs are rejected."
    );
  }
  if (snapshot.kind !== "crawl_content") return;

  for (const source of snapshot.sources) {
    for (const keyword of snapshot.keywords) {
      const hasTask = snapshot.tasks.some(
        (task) =>
          task.id.length > 0 &&
          task.sourceId === (source.id ?? null) &&
          task.keywordId === (keyword.id ?? null)
      );
      if (!hasTask) {
        throw new Error(
          `Comment crawl snapshot is missing a task for source ${source.externalId} and keyword ${keyword.value}.`
        );
      }
    }
  }
}
