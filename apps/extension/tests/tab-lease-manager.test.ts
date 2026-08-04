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

  public async create(properties: {
    url: string;
    active: boolean;
    isolatedWindow?: boolean;
  }): Promise<ManagedTab> {
    this.createCalls += 1;
    const tab = {
      id: this.nextId++,
      windowId: 500,
      url: properties.url,
      active: properties.active,
      discarded: false,
      frozen: false
    };
    this.tabs.set(tab.id, tab);
    expect(properties.active).toBe(true);
    expect(properties.isolatedWindow).toBe(true);
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
    if (properties.active !== undefined) tab.active = properties.active;
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

  public async injectContentScript(): Promise<void> {}
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
  it("serializes concurrent opens into one active tab in an isolated runner window", async () => {
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

  it("replaces a throttled or frozen runner tab with a fresh isolated active tab", async () => {
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
    const firstTabId = await manager.ensureOwnedTab(record.jobId, record.runId);
    const firstTab = fakeTabs.tabs.get(firstTabId);
    if (!firstTab) throw new Error("Expected first runner tab.");
    firstTab.active = false;
    firstTab.frozen = true;

    const replacementTabId = await manager.ensureOwnedTab(
      record.jobId,
      record.runId
    );

    expect(replacementTabId).not.toBe(firstTabId);
    expect(fakeTabs.removed).toContain(firstTabId);
    expect(fakeTabs.tabs.get(replacementTabId)).toMatchObject({
      active: true,
      frozen: false
    });
    expect(fakeTabs.createCalls).toBe(2);
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

    expect(await runner.cancel(record.jobId)).toBe(false);
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

  it("treats an owned tab already closed by the user as cancelled and clears its stale reference", async () => {
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
    const tabId = await manager.ensureOwnedTab(record.jobId, record.runId);

    // Simulate Chrome's tab removal happening before the cancel request arrives.
    fakeTabs.tabs.delete(tabId);

    expect(await manager.cleanupOwnedTab(record.jobId, record.runId)).toBe(true);
    expect((await storage.getRunner())?.tabId).toBeUndefined();
    expect(fakeTabs.removed).toEqual([]);
  });

  it("acknowledges a user-closed owned tab only once", async () => {
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
    const tabId = await manager.ensureOwnedTab(record.jobId, record.runId);
    fakeTabs.tabs.delete(tabId);

    expect(await manager.acknowledgeRemovedOwnedTab(tabId)).toMatchObject({
      runId: record.runId
    });
    expect(await manager.acknowledgeRemovedOwnedTab(tabId)).toBeNull();
    expect((await storage.getRunner())?.tabId).toBeUndefined();
  });

  it("recovers repeatedly when Facebook replaces the page and closes the message channel", async () => {
    class RedirectingTabs extends FakeTabs {
      public discoverAttempts = 0;

      public override async sendMessage(
        tabId: number,
        message: { type: string; runId?: string }
      ): Promise<unknown> {
        if (message.type === "DISCOVER_GROUPS") {
          this.discoverAttempts += 1;
          if (this.discoverAttempts <= 3) {
            throw new Error(
              "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received"
            );
          }
          return {
            ok: true,
            result: { sources: [], coverageStatus: "unknown" }
          };
        }
        return super.sendMessage(tabId, message);
      }
    }

    const memory = new MemoryStorage();
    const storage = new ExtensionStorage(memory);
    const fakeTabs = new RedirectingTabs();
    const manager = new TabLeaseManager(
      storage,
      fakeTabs,
      (runId) => `chrome-extension://test/runner.html#run=${runId}`
    );
    const record = runnerRecord();
    await storage.saveRunner(record);
    const tabId = await manager.ensureOwnedTab(record.jobId, record.runId);
    await manager.waitUntilReady(tabId, record.runId);

    const result = await manager.command<{
      sources: unknown[];
      coverageStatus: string;
    }>(tabId, {
      type: "DISCOVER_GROUPS",
      runId: record.runId,
      limits: {
        maxGroups: 100,
        maxScrollRounds: 10,
        mutationWaitMs: 100
      }
    });

    expect(result).toEqual({ sources: [], coverageStatus: "unknown" });
    expect(fakeTabs.discoverAttempts).toBe(4);
    expect(fakeTabs.createCalls).toBe(1);
  });

  it("forwards cancellation to a long-running content command immediately", async () => {
    class CancellationTabs extends FakeTabs {
      public cancelMessages = 0;

      public override async sendMessage(
        tabId: number,
        message: { type: string; runId?: string }
      ): Promise<unknown> {
        if (message.type === "CANCEL_RUN") {
          this.cancelMessages += 1;
        }
        return super.sendMessage(tabId, message);
      }
    }

    const memory = new MemoryStorage();
    const storage = new ExtensionStorage(memory);
    const fakeTabs = new CancellationTabs();
    const manager = new TabLeaseManager(
      storage,
      fakeTabs,
      (runId) => `chrome-extension://test/runner.html#run=${runId}`
    );
    const record = runnerRecord();
    await storage.saveRunner(record);
    const tabId = await manager.ensureOwnedTab(record.jobId, record.runId);
    await manager.waitUntilReady(tabId, record.runId);

    await manager.cancelActiveCommand(tabId, record.runId);

    expect(fakeTabs.cancelMessages).toBe(1);
  });

  it("injects the read-only content runner when a background Facebook tab has no receiver", async () => {
    class InjectionRequiredTabs extends FakeTabs {
      public injections = 0;
      private injected = false;

      public override async injectContentScript(): Promise<void> {
        this.injections += 1;
        this.injected = true;
      }

      public override async sendMessage(
        tabId: number,
        message: { type: string; runId?: string }
      ): Promise<unknown> {
        if (!this.injected) {
          throw new Error("Could not establish connection. Receiving end does not exist.");
        }
        return super.sendMessage(tabId, message);
      }
    }

    const memory = new MemoryStorage();
    const storage = new ExtensionStorage(memory);
    const fakeTabs = new InjectionRequiredTabs();
    const manager = new TabLeaseManager(
      storage,
      fakeTabs,
      (runId) => `chrome-extension://test/runner.html#run=${runId}`
    );
    const record = runnerRecord();
    await storage.saveRunner(record);

    const tabId = await manager.ensureOwnedTab(record.jobId, record.runId);
    await manager.waitUntilReady(tabId, record.runId);

    expect(fakeTabs.injections).toBe(1);
    expect(fakeTabs.createCalls).toBe(1);
  });
});
