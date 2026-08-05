import type { Transaction } from "./db.js";
import {
  facebookPostExternalIdFromUrl,
  sanitizeFacebookContentUrl,
  sanitizeThreadsContentUrl,
  threadsPostExternalIdFromUrl,
} from "./privacy.js";

type WebPlatform = "facebook" | "threads";

function canonicalPostIdentity(
  platform: WebPlatform,
  rawUrl: string,
): { canonicalUrl: string; externalId: string } {
  if (platform === "threads") {
    const canonicalUrl = sanitizeThreadsContentUrl(rawUrl);
    if (!canonicalUrl) throw new Error("Threads post URL is required");
    return {
      canonicalUrl,
      externalId: threadsPostExternalIdFromUrl(canonicalUrl),
    };
  }

  const canonicalUrl = sanitizeFacebookContentUrl(rawUrl);
  if (!canonicalUrl) throw new Error("Facebook post URL is required");
  return {
    canonicalUrl,
    externalId: facebookPostExternalIdFromUrl(canonicalUrl),
  };
}

export async function findPreviouslySeenPostUrls(
  transaction: Transaction,
  input: {
    workspaceId: string;
    jobId: string;
    platform: WebPlatform;
    urls: string[];
  },
): Promise<string[]> {
  const candidates = input.urls.map((url) => ({
    requestedUrl: url,
    ...canonicalPostIdentity(input.platform, url),
  }));
  const externalIds = [
    ...new Set(candidates.map((candidate) => candidate.externalId)),
  ];
  const result = await transaction.query<{ external_id: string }>(
    `
      SELECT external_id
      FROM posts
      WHERE workspace_id = $1
        AND platform = $2
        AND external_id = ANY($3::text[])
        AND first_seen_job_id IS DISTINCT FROM $4
    `,
    [input.workspaceId, input.platform, externalIds, input.jobId],
  );
  const knownExternalIds = new Set(
    result.rows.map((row) => row.external_id),
  );

  return [
    ...new Set(
      candidates
        .filter((candidate) => knownExternalIds.has(candidate.externalId))
        .map((candidate) => candidate.requestedUrl),
    ),
  ];
}
