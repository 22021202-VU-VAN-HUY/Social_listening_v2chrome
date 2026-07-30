import { describe, expect, it } from "vitest";
import { BackendApiClient } from "../src/backend/api-client";
import { JobRunner } from "../src/background/job-runner";
import { ExtensionStorage, type LocalStoragePort } from "../src/shared/storage";
import type { RunnerRecord } from "../src/shared/types";
import {
  TabLeaseManager,
  type ManagedTab,
  type TabsPort
} from "../src/background/tab-lease-manager";

class MemoryStorage implements LocalStoragePort {
  public readonly data: Record<string, unknown> = {};

  public async get(keys: string | string[]): Promise<Record<string, unknown>> {
    const requested = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(
      requested.filter((key) => key in this.data).map((key) => [key, this.data[key]])
    );
  }

  public async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.data, items);
  }

  public async remove(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      delete this.data[key];
    }
  }
}

class FakeTabs implements TabsPort {
  public createCalls = 0;
  public readonly removed: number[] = [];
  public readonly tabs = new Map<number, ManagedTab>();
  private nextId = 10;
  private assignedRunId: string | null = null;

  public async create(properties: { url: string; active: boolean }): Promise<ManagedTab> {
    this.createCalls += 1;
    const tab = { id: this.nextId++, url: properties.url };
    this.tabs.set(tab.id, tab);
    expect(properties.active).toBe(false);
    return tab;
  }

  public async get(tabId: number): Promise<ManagedTab> {
    const tab = this.tabs.get(tabId);
    if (!tab) throw new Error(`No tab with id: ${String(tabId)}`);
    return tab;
  }

  public async update(
    tabId: number,
    properties: { url?: string; active?: boolean; autoDiscardable?: boolean }
  ): Promise<ManagedTab> {
    const tab = await this.get(tabId);
    if (properties.url) tab.url = properties.url;
    expect(properties.active).not.toBe(true);
    this.tabs.set(tabId, tab);
    return tab;
  }

  public async remove(tabId: number): Promise<void> {
    this.removed.push(tabId);
    this.tabs.delete(tabId);
  }

  public async sendMessage(
    _tabId: number,
    message: { type: string; runId?: string }
  ): Promise<unknown> {
    if (message.type === "ASSIGN_RUN") this.assignedRunId = message.runId ?? null;
    if (message.type === "GET_OWNERSHIP") {
      return { ok: true, result: { runId: this.assignedRunId } };
    }
    return { ok: true, result: { runId: this.assignedRunId } };
  }
}

function runnerRecord(): RunnerRecord {
  const now = new Date().toISOString();
  return {
    jobId: "job-12345678",
    runId: "run-12345678",
    phase: "claiming",
    startedAt: now,
    updatedAt: now
  };
}

describe("TabLeaseManager", () => {
  it("serializes concurrent opens into exactly one inactive owned tab", async () => {
    const memory = new MemoryStorage();
    const storage = new ExtensionStorage(memory);
    const fakeTabs = new FakeTabs();
    const manager = new TabLeaseManager(
      storage,
      fakeTabs,
      (runId) => `chrome-extension://test/runner.html#run=${runId}`
    );
    const record = runnerRecord();
    await storage.saveRunner(record);

    const ids = await Promise.all([
      manager.ensureOwnedTab(record.jobId, record.runId),
      manager.ensureOwnedTab(record.jobId, record.runId),
      manager.ensureOwnedTab(record.jobId, record.runId)
    ]);

    expect(new Set(ids).size).toBe(1);
    expect(fakeTabs.createCalls).toBe(1);
    const tab = await fakeTabs.get(ids[0] as number);
    expect(tab.url).toContain("https://www.facebook.com/");
    expect(tab.url).toContain("__listening_social_run=run-12345678");
  });

  it("closes only the verified extension-owned tab and leaves user tabs alone", async () => {
    const memory = new MemoryStorage();
    const storage = new ExtensionStorage(memory);
    const fakeTabs = new FakeTabs();
    const manager = new TabLeaseManager(
      storage,
      fakeTabs,
      (runId) => `chrome-extension://test/runner.html#run=${runId}`
    );
    const record = runnerRecord();
    await storage.saveRunner(record);
    const ownedId = await manager.ensureOwnedTab(record.jobId, record.runId);
    await manager.waitUntilReady(ownedId, record.runId);
    fakeTabs.tabs.set(99, {
      id: 99,
      url: "https://www.facebook.com/groups/user-opened/"
    });

    expect(await manager.cleanupOwnedTab(record.jobId, record.runId)).toBe(true);
    expect(fakeTabs.removed).toEqual([ownedId]);
    expect(fakeTabs.tabs.has(99)).toBe(true);
  });

  it("retains an unverified tab reference and retries cleanup without closing a user tab", async () => {
    const memory = new MemoryStorage();
    const storage = new ExtensionStorage(memory);
    const fakeTabs = new FakeTabs();
    const manager = new TabLeaseManager(
      storage,
      fakeTabs,
      (runId) => `chrome-extension://test/runner.html#run=${runId}`
    );
    const record: RunnerRecord = {
      ...runnerRecord(),
      phase: "failed",
      tabId: 77
    };
    await storage.saveRunner(record);
    fakeTabs.tabs.set(77, {
      id: 77,
      url: "https://www.facebook.com/groups/user-opened/"
    });
    fakeTabs.tabs.set(99, {
      id: 99,
      url: "https://www.facebook.com/groups/another-user-tab/"
    });
    const runner = new JobRunner(
      storage,
      new BackendApiClient(storage),
      manager
    );

    expect(await runner.cancel(record.jobId)).toBe(true);
    expect(fakeTabs.removed).toEqual([]);
    expect(fakeTabs.tabs.has(77)).toBe(true);
    expect(fakeTabs.tabs.has(99)).toBe(true);
    expect(await storage.getRunner()).toMatchObject({
      runId: record.runId,
      tabId: 77,
      phase: "cleanup",
      lastErrorCode: "TAB_OWNERSHIP_UNVERIFIED"
    });

    const retained = fakeTabs.tabs.get(77);
    if (!retained) throw new Error("Expected retained tab.");
    retained.url =
      "https://www.facebook.com/#__listening_social_run=run-12345678";
    await runner.reconcile();

    expect(fakeTabs.removed).toEqual([77]);
    expect(fakeTabs.tabs.has(99)).toBe(true);
    expect(await storage.getRunner()).toBeNull();
  });

  it("rejects another job attempting to use the current runner record", async () => {
    const memory = new MemoryStorage();
    const storage = new ExtensionStorage(memory);
    const manager = new TabLeaseManager(
      storage,
      new FakeTabs(),
      (runId) => `chrome-extension://test/runner.html#run=${runId}`
    );
    const record = runnerRecord();
    await storage.saveRunner(record);

    await expect(
      manager.ensureOwnedTab("job-other-1234", "run-other-1234")
    ).rejects.toThrow(/another job/u);
  });
});
