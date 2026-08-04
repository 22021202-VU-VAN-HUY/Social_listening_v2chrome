import { z } from "zod";

const ThreadsSearchItemSchema = z
  .object({
    id: z.string().trim().min(1).max(500),
    text: z.string(),
    timestamp: z.string(),
    permalink: z.string().url(),
    shortcode: z.string().optional(),
    is_reply: z.boolean(),
  })
  .passthrough();

const ThreadsSearchResponseSchema = z
  .object({
    data: z.array(ThreadsSearchItemSchema),
    paging: z
      .object({
        cursors: z
          .object({ after: z.string().optional() })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type ThreadsSearchItem = z.infer<typeof ThreadsSearchItemSchema>;

export interface ThreadsSearchPage {
  items: ThreadsSearchItem[];
  afterCursor: string | null;
}

export class ThreadsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

function safeErrorCode(value: unknown, status: number): string {
  const parsed = z
    .object({ error: z.object({ code: z.union([z.string(), z.number()]).optional() }).optional() })
    .safeParse(value);
  return parsed.success && parsed.data.error?.code !== undefined
    ? `THREADS_API_${String(parsed.data.error.code)}`
    : `THREADS_HTTP_${status}`;
}

export class ThreadsClient {
  constructor(
    private readonly input: {
      baseUrl: string;
      apiVersion: string;
      accessToken: string;
    },
  ) {}

  async searchKeyword(input: {
    query: string;
    since: Date;
    until: Date;
    limit: number;
    afterCursor: string | null;
  }): Promise<ThreadsSearchPage> {
    const url = new URL(
      `${this.input.baseUrl.replace(/\/$/u, "")}/${this.input.apiVersion}/keyword_search`,
    );
    url.searchParams.set("q", input.query);
    url.searchParams.set("search_type", "RECENT");
    url.searchParams.set("search_mode", "KEYWORD");
    url.searchParams.set(
      "fields",
      "id,text,timestamp,permalink,is_reply",
    );
    url.searchParams.set("since", String(Math.floor(input.since.getTime() / 1_000)));
    url.searchParams.set("until", String(Math.floor(input.until.getTime() / 1_000)));
    url.searchParams.set("limit", String(input.limit));
    if (input.afterCursor) url.searchParams.set("after", input.afterCursor);

    const response = await fetch(url, {
      headers: { authorization: `Bearer ${this.input.accessToken}` },
      signal: AbortSignal.timeout(30_000),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ThreadsApiError(
        `Threads keyword search failed with HTTP ${response.status}`,
        response.status,
        safeErrorCode(payload, response.status),
      );
    }
    const parsed = ThreadsSearchResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ThreadsApiError(
        "Threads keyword search returned an invalid response shape",
        response.status,
        "THREADS_INVALID_RESPONSE",
      );
    }
    return {
      items: parsed.data.data,
      afterCursor: parsed.data.paging?.cursors?.after ?? null,
    };
  }
}
