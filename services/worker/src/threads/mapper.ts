import { createHash } from "node:crypto";
import type { ThreadsSearchItem } from "./client.js";
import { keywordMatches, matchExcerpt } from "./matcher.js";
import { canonicalThreadsPostUrl } from "./url-policy.js";

export interface ThreadsMappedPost {
  externalId: string;
  canonicalUrl: string;
  body: string;
  publishedAt: Date;
  contentHash: string;
  matchExcerpt: string;
}

export function mapThreadsRootPost(
  item: ThreadsSearchItem,
  input: {
    keyword: string;
    matchMode: "whole_word" | "contains_phrase";
    windowStart: Date;
    windowEnd: Date;
  },
): ThreadsMappedPost | null {
  if (item.is_reply) return null;
  const body = item.text.trim();
  if (!body || body.length > 200_000) return null;
  if (!keywordMatches(body, { value: input.keyword, matchMode: input.matchMode })) {
    return null;
  }
  const publishedAt = new Date(item.timestamp);
  if (
    Number.isNaN(publishedAt.getTime()) ||
    publishedAt < input.windowStart ||
    publishedAt > input.windowEnd
  ) {
    return null;
  }
  const canonicalUrl = canonicalThreadsPostUrl(item.shortcode, item.permalink);
  if (!canonicalUrl) return null;
  return {
    externalId: item.id,
    canonicalUrl,
    body,
    publishedAt,
    contentHash: createHash("sha256").update(body.normalize("NFKC")).digest("hex"),
    matchExcerpt: matchExcerpt(body, input.keyword),
  };
}
