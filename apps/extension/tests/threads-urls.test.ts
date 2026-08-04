import { describe, expect, it } from "vitest";
import {
  buildThreadsSearchUrl,
  canonicalThreadsPostUrl,
  canonicalThreadsSourceUrl
} from "../src/content/threads-urls";

describe("Threads URL policy", () => {
  it("uses recent web search and strips usernames from stored post URLs", () => {
    expect(buildThreadsSearchUrl("VinSmart Future")).toBe(
      "https://www.threads.com/search?q=VinSmart+Future&serp_type=default&filter=recent"
    );
    expect(
      canonicalThreadsPostUrl(
        "https://www.threads.com/@some.person/post/ABC_def-123?x=1"
      )
    ).toBe("https://www.threads.com/t/ABC_def-123/");
  });

  it("accepts only the managed Threads search source", () => {
    expect(canonicalThreadsSourceUrl("https://threads.com/search?q=x")).toBe(
      "https://www.threads.com/search"
    );
    expect(canonicalThreadsSourceUrl("https://example.com/search")).toBeNull();
  });
});
