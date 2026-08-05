import type { SafePostDto } from "./types";

export interface MergedPostResult {
  post: SafePostDto;
  hasNewKeywordHit: boolean;
}

export function claimPostForCommentCrawl(
  crawledPostExternalIds: Set<string>,
  externalId: string
): boolean {
  if (crawledPostExternalIds.has(externalId)) return false;
  crawledPostExternalIds.add(externalId);
  return true;
}

export function excludePreviouslySeenPosts(
  posts: SafePostDto[],
  knownUrls: ReadonlySet<string>
): { posts: SafePostDto[]; skipped: number } {
  const unseenPosts = posts.filter((post) => !knownUrls.has(post.url));
  return {
    posts: unseenPosts,
    skipped: posts.length - unseenPosts.length
  };
}

/**
 * A post can appear in multiple Facebook group-search result pages. Preserve
 * every server keyword ID while keeping one canonical parent-post record.
 */
export function mergePostKeywordHits(
  existing: SafePostDto,
  incoming: SafePostDto
): MergedPostResult {
  if (existing.externalId !== incoming.externalId) {
    throw new Error("Cannot merge different Facebook posts.");
  }
  const previous = new Set(existing.matchedKeywordIds);
  const matchedKeywordIds = [
    ...new Set([...existing.matchedKeywordIds, ...incoming.matchedKeywordIds])
  ];
  return {
    post: {
      ...existing,
      ...incoming,
      matchedKeywordIds
    },
    hasNewKeywordHit: matchedKeywordIds.some((id) => !previous.has(id))
  };
}
