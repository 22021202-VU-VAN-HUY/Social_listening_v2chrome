import { afterEach, describe, expect, it, vi } from "vitest";
import { BackendApiClient } from "../src/backend/api-client";
import { ExtensionStorage, type LocalStoragePort } from "../src/shared/storage";
import type {
  SafeCommentDto,
  SafePostDto
} from "../src/shared/types";

class MemoryStorage implements LocalStoragePort {
  private readonly values: Record<string, unknown> = {};

  public async get(keys: string | string[]): Promise<Record<string, unknown>> {
    const list = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(
      list.filter((key) => key in this.values).map((key) => [key, this.values[key]])
    );
  }

  public async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, items);
  }

  public async remove(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      delete this.values[key];
    }
  }
}

function parentPost(): SafePostDto {
  return {
    externalId: "post-123",
    sourceExternalId: "group-456",
    url: "https://www.facebook.com/groups/group-456/posts/post-123/",
    body: "VSF và Vin Future cùng xuất hiện trong bài viết.",
    publishedAt: "2026-07-30T01:00:00.000Z",
    collectedAt: "2026-07-30T03:00:00.000Z",
    timeParseStatus: "parsed",
    matchedKeywordIds: [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222"
    ],
    author: {
      authorName: "Nguyễn An",
      isAnonymous: false,
      authorKind: "real"
    }
  };
}

function comments(): SafeCommentDto[] {
  return [
    {
      externalId: "comment-real",
      postExternalId: "post-123",
      parentCommentExternalId: null,
      url: "https://www.facebook.com/groups/group-456/posts/post-123/?comment_id=comment-real",
      body: "Bình luận thật.",
      publishedAt: "2026-07-30T02:00:00.000Z",
      collectedAt: "2026-07-30T03:00:00.000Z",
      timeParseStatus: "parsed",
      author: {
        authorName: "Trần Bình",
        isAnonymous: false,
        authorKind: "real"
      }
    },
    {
      externalId: "comment-anonymous",
      postExternalId: "post-123",
      parentCommentExternalId: "comment-real",
      url: null,
      body: "Phản hồi ẩn danh.",
      publishedAt: null,
      collectedAt: "2026-07-30T03:00:00.000Z",
      timeParseStatus: "unknown",
      author: {
        authorName: null,
        isAnonymous: true,
        authorKind: "anonymous"
      }
    }
  ];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BackendApiClient content batch", () => {
  it("asks the API which post links were seen before this job", async () => {
    const storage = new ExtensionStorage(new MemoryStorage());
    await storage.saveConnection({
      apiBaseUrl: "http://localhost:8787",
      installationId: "installation-123456789",
      deviceId: "device-123",
      deviceToken: "x".repeat(64)
    });
    const knownUrl = parentPost().url;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ knownUrls: [knownUrl] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new BackendApiClient(storage).findKnownPostUrls({
      jobId: "job-123",
      leaseToken: "l".repeat(64),
      fencingToken: 7,
      urls: [knownUrl, knownUrl]
    });

    expect(result).toEqual(new Set([knownUrl]));
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain("/jobs/job-123/known-posts");
    const payload = JSON.parse(String((init as RequestInit).body)) as {
      urls: string[];
    };
    expect(payload.urls).toEqual([knownUrl]);
  });

  it("uploads full parent-post metadata and privacy-safe comments", async () => {
    const storage = new ExtensionStorage(new MemoryStorage());
    await storage.saveConnection({
      apiBaseUrl: "http://localhost:8787",
      installationId: "installation-123456789",
      deviceId: "device-123",
      deviceToken: "x".repeat(64),
      workspaceId: "workspace-123"
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new BackendApiClient(storage);

    await client.uploadContent({
      jobId: "job-123",
      leaseToken: "l".repeat(64),
      fencingToken: 7,
      taskId: "task-123",
      posts: [parentPost()],
      comments: comments(),
      idempotencyKey: "job-123:content"
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(payload["kind"]).toBe("content");
    expect(payload["taskId"]).toBe("task-123");
    expect(payload["posts"]).toEqual([parentPost()]);
    expect(payload["comments"]).toEqual(comments());
    expect(JSON.stringify(payload)).not.toContain("profileUrl");
    expect(JSON.stringify(payload)).not.toContain("platformUserId");
    expect(JSON.stringify(payload)).not.toContain("username");
  });

  it("rejects an author identity field before any network write", async () => {
    const storage = new ExtensionStorage(new MemoryStorage());
    await storage.saveConnection({
      apiBaseUrl: "http://localhost:8787",
      installationId: "installation-123456789",
      deviceId: "device-123",
      deviceToken: "x".repeat(64)
    });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const unsafePost = parentPost() as SafePostDto & {
      author: SafePostDto["author"] & { profileUrl: string };
    };
    unsafePost.author.profileUrl = "https://www.facebook.com/profile.php?id=1";

    await expect(
      new BackendApiClient(storage).uploadContent({
        jobId: "job-123",
        leaseToken: "l".repeat(64),
        fencingToken: 7,
        taskId: "task-123",
        posts: [unsafePost],
        comments: [],
        idempotencyKey: "job-123:unsafe"
      })
    ).rejects.toThrow(/Privacy-forbidden key/u);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
