import type { CrawlCheckpoint, JobSnapshot } from "../shared/types";

// Background platform tabs can have their timers throttled heavily by Chrome.
// Content scripts report liveness during every crawl round, so this timeout is
// reserved for a genuinely unresponsive command rather than a slow DOM wait.
export const CRAWL_STALL_TIMEOUT_MS = 180_000;

export function isCrawlStalled(
  lastProgressAt: number,
  now = Date.now(),
  timeoutMs = CRAWL_STALL_TIMEOUT_MS
): boolean {
  return now - lastProgressAt >= timeoutMs;
}

export function checkpointForClaim(snapshot: JobSnapshot): CrawlCheckpoint {
  if (snapshot.kind !== "crawl_content") {
    return { phase: "start", sourceIndex: 0, keywordIndex: 0, postIndex: 0 };
  }

  for (let sourceIndex = 0; sourceIndex < snapshot.sources.length; sourceIndex += 1) {
    const source = snapshot.sources[sourceIndex];
    if (!source) continue;
    for (
      let keywordIndex = 0;
      keywordIndex < snapshot.keywords.length;
      keywordIndex += 1
    ) {
      const keyword = snapshot.keywords[keywordIndex];
      if (!keyword) continue;
      const task = snapshot.tasks.find(
        (candidate) =>
          candidate.sourceId === (source.id ?? null) &&
          candidate.keywordId === (keyword.id ?? null)
      );
      if (task?.state === "completed") continue;

      const saved = task?.checkpoint;
      if (
        saved &&
        saved.sourceIndex === sourceIndex &&
        saved.keywordIndex === keywordIndex
      ) {
        return saved;
      }
      return { phase: "start", sourceIndex, keywordIndex, postIndex: 0 };
    }
  }

  return {
    phase: "done",
    sourceIndex: snapshot.sources.length,
    keywordIndex: 0,
    postIndex: 0
  };
}
