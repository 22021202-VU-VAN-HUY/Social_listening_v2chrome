import { getDefaultApiBaseUrl, normalizeApiBaseUrl } from "./config";
import type { RunnerRecord, StoredConnection } from "./types";

const CONNECTION_KEY = "listeningSocial.connection";
const RUNNER_KEY = "listeningSocial.runner";

export interface LocalStoragePort {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

function chromeLocalStorage(): LocalStoragePort {
  return {
    get: async (keys) => chrome.storage.local.get(keys),
    set: async (items) => chrome.storage.local.set(items),
    remove: async (keys) => chrome.storage.local.remove(keys)
  };
}

export class ExtensionStorage {
  public constructor(private readonly local: LocalStoragePort = chromeLocalStorage()) {}

  public async hardenAccess(): Promise<void> {
    if (chrome.storage.local.setAccessLevel) {
      await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    }
  }

  public async getConnection(): Promise<StoredConnection> {
    const values = await this.local.get(CONNECTION_KEY);
    const candidate = values[CONNECTION_KEY];
    if (!candidate || typeof candidate !== "object") {
      const connection: StoredConnection = {
        apiBaseUrl: getDefaultApiBaseUrl(),
        installationId: crypto.randomUUID()
      };
      await this.saveConnection(connection);
      return connection;
    }

    const value = candidate as Partial<StoredConnection>;
    const connection: StoredConnection = {
      apiBaseUrl:
        typeof value.apiBaseUrl === "string"
          ? normalizeApiBaseUrl(value.apiBaseUrl)
          : getDefaultApiBaseUrl(),
      installationId:
        typeof value.installationId === "string" && value.installationId.length > 0
          ? value.installationId
          : crypto.randomUUID()
    };

    if (typeof value.deviceId === "string") connection.deviceId = value.deviceId;
    if (typeof value.deviceToken === "string") connection.deviceToken = value.deviceToken;
    if (typeof value.workspaceId === "string")
      connection.workspaceId = value.workspaceId;
    if (typeof value.pairedAt === "string") connection.pairedAt = value.pairedAt;

    if (connection.installationId !== value.installationId) {
      await this.saveConnection(connection);
    }
    return connection;
  }

  public async saveConnection(connection: StoredConnection): Promise<void> {
    await this.local.set({ [CONNECTION_KEY]: connection });
  }

  public async setApiBaseUrl(apiBaseUrl: string): Promise<StoredConnection> {
    const connection = await this.getConnection();
    const updated: StoredConnection = {
      ...connection,
      apiBaseUrl: normalizeApiBaseUrl(apiBaseUrl)
    };
    await this.saveConnection(updated);
    return updated;
  }

  public async clearPairing(): Promise<StoredConnection> {
    const current = await this.getConnection();
    const unpaired: StoredConnection = {
      apiBaseUrl: current.apiBaseUrl,
      installationId: current.installationId
    };
    await this.saveConnection(unpaired);
    return unpaired;
  }

  public async getRunner(): Promise<RunnerRecord | null> {
    const values = await this.local.get(RUNNER_KEY);
    const runner = values[RUNNER_KEY];
    if (!runner || typeof runner !== "object") {
      return null;
    }
    return runner as RunnerRecord;
  }

  public async saveRunner(runner: RunnerRecord): Promise<void> {
    await this.local.set({ [RUNNER_KEY]: runner });
  }

  public async patchRunner(
    runId: string,
    patch: Partial<RunnerRecord>
  ): Promise<RunnerRecord> {
    const current = await this.getRunner();
    if (!current || current.runId !== runId) {
      throw new Error("Runner ownership changed.");
    }
    const updated: RunnerRecord = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    await this.saveRunner(updated);
    return updated;
  }

  public async clearRunner(expectedRunId?: string): Promise<void> {
    if (expectedRunId) {
      const current = await this.getRunner();
      if (current && current.runId !== expectedRunId) {
        return;
      }
    }
    await this.local.remove(RUNNER_KEY);
  }
}
