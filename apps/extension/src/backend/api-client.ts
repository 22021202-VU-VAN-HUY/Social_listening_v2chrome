import { normalizeApiBaseUrl } from "../shared/config";
import { assertPrivacySafePayload } from "../shared/privacy";
import type {
  ClaimResponse,
  ContentBatch,
  CrawlCheckpoint,
  ExtensionPresenceStatus,
  HeartbeatResponse,
  IngestBatch,
  JobSnapshot,
  PairResponse,
  ProgressCounters,
  SourcesBatch,
  StoredConnection
} from "../shared/types";
import { EXTENSION_VERSION } from "../shared/types";
import { ExtensionStorage } from "../shared/storage";
import { normalizeJobSnapshot } from "./snapshot";

export class ApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  token?: string;
  idempotencyKey?: string;
  timeoutMs?: number;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ApiError(`Invalid ${name} in API response.`, 502, "INVALID_RESPONSE", false);
  }
  return value;
}

function requireNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ApiError(`Invalid ${name} in API response.`, 502, "INVALID_RESPONSE", false);
  }
  return value;
}

async function sha256Json(value: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export class BackendApiClient {
  public constructor(private readonly storage: ExtensionStorage) {}

  private async request<T>(
    apiBaseUrl: string,
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);

    try {
      if (options.body !== undefined) {
        assertPrivacySafePayload(options.body);
      }

      const headers = new Headers({ Accept: "application/json" });
      if (options.body !== undefined) headers.set("Content-Type", "application/json");
      if (options.token) headers.set("Authorization", `Bearer ${options.token}`);
      if (options.idempotencyKey)
        headers.set("Idempotency-Key", options.idempotencyKey);
      headers.set("X-Extension-Version", EXTENSION_VERSION);

      const requestInit: RequestInit = {
        method: options.method ?? "GET",
        headers,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        signal: controller.signal
      };
      if (options.body !== undefined) {
        requestInit.body = JSON.stringify(options.body);
      }
      const response = await fetch(
        `${normalizeApiBaseUrl(apiBaseUrl)}${path}`,
        requestInit
      );

      const raw = await response.text();
      let payload: unknown = null;
      if (raw.length > 0) {
        try {
          payload = JSON.parse(raw) as unknown;
        } catch {
          throw new ApiError(
            "Backend trả về dữ liệu không hợp lệ.",
            response.status,
            "INVALID_JSON",
            response.status >= 500
          );
        }
      }

      if (!response.ok) {
        const details =
          payload && typeof payload === "object"
            ? (payload as Record<string, unknown>)
            : {};
        const nestedError =
          details["error"] && typeof details["error"] === "object"
            ? (details["error"] as Record<string, unknown>)
            : {};
        const message =
          typeof details["message"] === "string"
            ? details["message"].slice(0, 300)
            : typeof nestedError["message"] === "string"
              ? nestedError["message"].slice(0, 300)
            : `Backend request failed (${String(response.status)}).`;
        const code =
          typeof details["code"] === "string"
            ? details["code"].slice(0, 80)
            : typeof nestedError["code"] === "string"
              ? nestedError["code"].slice(0, 80)
            : `HTTP_${String(response.status)}`;
        throw new ApiError(
          message,
          response.status,
          code,
          response.status === 408 ||
            response.status === 425 ||
            response.status === 429 ||
            response.status >= 500
        );
      }

      return payload as T;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ApiError("Backend timeout.", 0, "NETWORK_TIMEOUT", true);
      }
      throw new ApiError(
        error instanceof Error ? error.message : "Network request failed.",
        0,
        "NETWORK_ERROR",
        true
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async requirePaired(): Promise<Required<
    Pick<StoredConnection, "apiBaseUrl" | "installationId" | "deviceId" | "deviceToken">
  > &
    StoredConnection> {
    const connection = await this.storage.getConnection();
    if (!connection.deviceId || !connection.deviceToken) {
      throw new ApiError("Extension chưa được ghép.", 401, "NOT_PAIRED", false);
    }
    return connection as Required<
      Pick<StoredConnection, "apiBaseUrl" | "installationId" | "deviceId" | "deviceToken">
    > &
      StoredConnection;
  }

  public async pair(apiBaseUrl: string, code: string): Promise<PairResponse> {
    const connection = await this.storage.getConnection();
    const raw = await this.request<Record<string, unknown>>(
      apiBaseUrl,
      "/api/v1/extension/pair",
      {
        method: "POST",
        body: {
          code: code.trim(),
          installationId: connection.installationId,
          extensionVersion: EXTENSION_VERSION
        }
      }
    );

    const result: PairResponse = {
      deviceId: requireString(raw["deviceId"], "deviceId"),
      deviceToken: requireString(raw["deviceToken"], "deviceToken"),
      workspaceId: requireString(raw["workspaceId"], "workspaceId")
    };

    await this.storage.saveConnection({
      apiBaseUrl: normalizeApiBaseUrl(apiBaseUrl),
      installationId: connection.installationId,
      deviceId: result.deviceId,
      deviceToken: result.deviceToken,
      workspaceId: result.workspaceId,
      pairedAt: new Date().toISOString()
    });
    return result;
  }

  public async heartbeat(input: {
    status: Exclude<ExtensionPresenceStatus, "offline">;
    jobId?: string;
    leaseToken?: string;
    fencingToken?: number;
  }): Promise<HeartbeatResponse> {
    const connection = await this.requirePaired();
    const body: Record<string, unknown> = {
      deviceId: connection.deviceId,
      extensionVersion: EXTENSION_VERSION,
      status: input.status
    };
    if (input.jobId) body["jobId"] = input.jobId;
    if (input.leaseToken) body["leaseToken"] = input.leaseToken;
    if (input.fencingToken !== undefined)
      body["fencingToken"] = input.fencingToken;

    const raw = await this.request<Record<string, unknown>>(
      connection.apiBaseUrl,
      "/api/v1/extension/heartbeat",
      {
        method: "POST",
        token: connection.deviceToken,
        body
      }
    );

    const response: HeartbeatResponse = {
      serverTime: requireString(raw["serverTime"], "serverTime"),
      cancelRequested: raw["cancelRequested"] === true
    };
    if (typeof raw["leaseExpiresAt"] === "string")
      response.leaseExpiresAt = raw["leaseExpiresAt"];
    if (typeof raw["availableJobId"] === "string")
      response.availableJobId = raw["availableJobId"];
    return response;
  }

  public async claim(jobId: string): Promise<ClaimResponse> {
    const connection = await this.requirePaired();
    const raw = await this.request<Record<string, unknown>>(
      connection.apiBaseUrl,
      `/api/v1/extension/jobs/${encodeURIComponent(jobId)}/claim`,
      {
        method: "POST",
        token: connection.deviceToken,
        body: {
          deviceId: connection.deviceId,
          extensionVersion: EXTENSION_VERSION
        }
      }
    );

    const snapshot = normalizeJobSnapshot(raw["snapshot"]);
    return {
      jobId: requireString(raw["jobId"], "jobId"),
      leaseToken: requireString(raw["leaseToken"], "leaseToken"),
      fencingToken: requireNumber(raw["fencingToken"], "fencingToken"),
      leaseExpiresAt: requireString(raw["leaseExpiresAt"], "leaseExpiresAt"),
      snapshot
    };
  }

  public async uploadSources(input: {
    jobId: string;
    leaseToken: string;
    fencingToken: number;
    checkpoint?: CrawlCheckpoint;
    sources: SourcesBatch["sources"];
    idempotencyKey: string;
  }): Promise<void> {
    const connection = await this.requirePaired();
    const dataToHash = { sources: input.sources, checkpoint: input.checkpoint };
    const batch: SourcesBatch = {
      deviceId: connection.deviceId,
      leaseToken: input.leaseToken,
      fencingToken: input.fencingToken,
      kind: "sources",
      checksum: await sha256Json(dataToHash),
      sources: input.sources
    };
    if (input.checkpoint) batch.checkpoint = input.checkpoint;
    await this.uploadBatch(input.jobId, batch, input.idempotencyKey, connection);
  }

  public async uploadContent(input: {
    jobId: string;
    leaseToken: string;
    fencingToken: number;
    taskId: string;
    checkpoint?: CrawlCheckpoint;
    posts?: ContentBatch["posts"];
    comments?: ContentBatch["comments"];
    idempotencyKey: string;
  }): Promise<void> {
    const connection = await this.requirePaired();
    const dataToHash = {
      taskId: input.taskId,
      checkpoint: input.checkpoint,
      posts: input.posts,
      comments: input.comments
    };
    const batch: ContentBatch = {
      deviceId: connection.deviceId,
      leaseToken: input.leaseToken,
      fencingToken: input.fencingToken,
      kind: "content",
      checksum: await sha256Json(dataToHash),
      taskId: input.taskId,
      posts: input.posts ?? [],
      comments: input.comments ?? []
    };
    if (input.checkpoint) batch.checkpoint = input.checkpoint;
    await this.uploadBatch(input.jobId, batch, input.idempotencyKey, connection);
  }

  private async uploadBatch(
    jobId: string,
    batch: IngestBatch,
    idempotencyKey: string,
    connection: Required<Pick<StoredConnection, "apiBaseUrl" | "deviceToken">>
  ): Promise<void> {
    assertPrivacySafePayload(batch);
    await this.request(
      connection.apiBaseUrl,
      `/api/v1/extension/jobs/${encodeURIComponent(jobId)}/batches`,
      {
        method: "POST",
        token: connection.deviceToken,
        idempotencyKey,
        body: batch,
        timeoutMs: 30_000
      }
    );
  }

  public async event(input: {
    jobId: string;
    leaseToken: string;
    fencingToken: number;
    level: "info" | "warn" | "error";
    type: string;
    payload?: Record<string, unknown>;
    progress?: ProgressCounters;
    taskId?: string;
  }): Promise<void> {
    const connection = await this.requirePaired();
    const body: Record<string, unknown> = {
      deviceId: connection.deviceId,
      leaseToken: input.leaseToken,
      fencingToken: input.fencingToken,
      level: input.level,
      type: input.type
    };
    if (input.payload) body["payload"] = input.payload;
    if (input.progress) body["progress"] = input.progress;
    if (input.taskId) body["taskId"] = input.taskId;

    await this.request(
      connection.apiBaseUrl,
      `/api/v1/extension/jobs/${encodeURIComponent(input.jobId)}/events`,
      {
        method: "POST",
        token: connection.deviceToken,
        body
      }
    );
  }

  public async complete(input: {
    jobId: string;
    leaseToken: string;
    fencingToken: number;
    outcome: "crawl_complete" | "partial";
    coverageStatus?: "complete" | "partial" | "unknown";
    partialReason?: string;
    progress?: ProgressCounters;
  }): Promise<void> {
    const connection = await this.requirePaired();
    const body: Record<string, unknown> = {
      deviceId: connection.deviceId,
      leaseToken: input.leaseToken,
      fencingToken: input.fencingToken,
      outcome: input.outcome
    };
    if (input.coverageStatus) body["coverageStatus"] = input.coverageStatus;
    if (input.partialReason)
      body["partialReason"] = input.partialReason.slice(0, 300);
    if (input.progress) body["progress"] = input.progress;

    await this.request(
      connection.apiBaseUrl,
      `/api/v1/extension/jobs/${encodeURIComponent(input.jobId)}/complete`,
      {
        method: "POST",
        token: connection.deviceToken,
        body
      }
    );
  }

  public async fail(input: {
    jobId: string;
    leaseToken: string;
    fencingToken: number;
    status: "failed" | "needs_login" | "interrupted";
    code: string;
    message: string;
    retryable: boolean;
  }): Promise<void> {
    const connection = await this.requirePaired();
    await this.request(
      connection.apiBaseUrl,
      `/api/v1/extension/jobs/${encodeURIComponent(input.jobId)}/fail`,
      {
        method: "POST",
        token: connection.deviceToken,
        body: {
          deviceId: connection.deviceId,
          leaseToken: input.leaseToken,
          fencingToken: input.fencingToken,
          status: input.status,
          code: input.code.slice(0, 80),
          message: input.message.slice(0, 300),
          retryable: input.retryable
        }
      }
    );
  }
}

export type { JobSnapshot };
