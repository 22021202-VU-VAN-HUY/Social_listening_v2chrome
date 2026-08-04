import { isFacebookUrl } from "../shared/config";
import { isThreadsUrl } from "./threads-urls";

export type WebPlatform = "facebook" | "threads";

export const RUN_MARKER_KEY = "__listening_social_run";

export function isAllowedPlatformUrl(value: string): boolean {
  return isFacebookUrl(value) || isThreadsUrl(value);
}

export function platformHomeUrl(platform: WebPlatform): string {
  return platform === "threads"
    ? "https://www.threads.com/"
    : "https://www.facebook.com/";
}

export function withRunMarker(url: string, runId: string): string {
  if (!isAllowedPlatformUrl(url)) {
    throw new Error("Blocked navigation outside the platform allowlist.");
  }
  const parsed = new URL(url);
  parsed.hash = `${RUN_MARKER_KEY}=${encodeURIComponent(runId)}`;
  return parsed.toString();
}

export function readRunMarker(url: string): string | null {
  try {
    const parsed = new URL(url);
    const hash = parsed.hash.replace(/^#/u, "");
    const params = new URLSearchParams(hash);
    const value = params.get(RUN_MARKER_KEY);
    return value && value.length <= 128 ? value : null;
  } catch {
    return null;
  }
}
