import { isFacebookUrl } from "../shared/config";
import { ExtensionStorage } from "../shared/storage";
import type { ContentCommand, RunnerRecord } from "../shared/types";
import {
  FACEBOOK_HOME_URL,
  readRunMarker,
  withRunMarker
} from "../content/facebook-urls";

export interface ManagedTab {
  id?: number;
  url?: string;
  pendingUrl?: string;
  openerTabId?: number;
}

export interface TabsPort {
  create(properties: {
    url: string;
    active: boolean;
  }): Promise<ManagedTab>;
  get(tabId: number): Promise<ManagedTab>;
  update(
    tabId: number,
    properties: {
      url?: string;
      active?: boolean;
      autoDiscardable?: boolean;
    }
  ): Promise<ManagedTab | undefined>;
  remove(tabId: number): Promise<void>;
  sendMessage(tabId: number, message: ContentCommand): Promise<unknown>;
}

function chromeTabsPort(): TabsPort {
  const toManaged = (tab: chrome.tabs.Tab): ManagedTab => {
    const managed: ManagedTab = {};
    if (tab.id !== undefined) managed.id = tab.id;
    if (tab.url !== undefined) managed.url = tab.url;
    if (tab.pendingUrl !== undefined) managed.pendingUrl = tab.pendingUrl;
    if (tab.openerTabId !== undefined) managed.openerTabId = tab.openerTabId;
    return managed;
  };
  return {
    create: async (properties) => toManaged(await chrome.tabs.create(properties)),
    get: async (tabId) => toManaged(await chrome.tabs.get(tabId)),
    update: async (tabId, properties) => {
      const tab = await chrome.tabs.update(tabId, properties);
      return tab ? toManaged(tab) : undefined;
    },
    remove: async (tabId) => chrome.tabs.remove(tabId),
    sendMessage: async (tabId, message) => chrome.tabs.sendMessage(tabId, message)
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isMissingTabError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /no tab with id|tab not found|invalid tab id/u.test(
      error.message.toLocaleLowerCase("en-US")
    )
  );
}

interface ContentEnvelope {
  ok: boolean;
  result?: unknown;
  error?: string;
}

export class TabLeaseManager {
  private serial: Promise<void> = Promise.resolve();

  public constructor(
    private readonly storage: ExtensionStorage,
    private readonly tabs: TabsPort = chromeTabsPort(),
    private readonly runnerUrl: (runId: string) => string = (runId) =>
      `${chrome.runtime.getURL("runner.html")}#run=${encodeURIComponent(runId)}`
  ) {}

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.serial.then(operation, operation);
    this.serial = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private async getTab(tabId: number): Promise<ManagedTab | null> {
    try {
      return await this.tabs.get(tabId);
    } catch (error) {
      if (isMissingTabError(error)) return null;
      throw error;
    }
  }

  private async recordWithoutTab(record: RunnerRecord): Promise<RunnerRecord> {
    const {
      tabId,
      ...withoutTab
    } = record;
    void tabId;
    await this.storage.saveRunner(withoutTab);
    return withoutTab;
  }

  public async ensureOwnedTab(jobId: string, runId: string): Promise<number> {
    return this.exclusive(async () => {
      let record = await this.storage.getRunner();
      if (!record || record.runId !== runId || record.jobId !== jobId) {
        throw new Error("Runner record is missing or belongs to another job.");
      }

      if (record.tabId !== undefined) {
        const existing = await this.getTab(record.tabId);
        if (existing) {
          return record.tabId;
        }
        record = await this.recordWithoutTab(record);
      }

      await this.storage.patchRunner(runId, { phase: "reserving_tab" });
      const placeholder = await this.tabs.create({
        url: this.runnerUrl(runId),
        active: false
      });
      if (placeholder.id === undefined) {
        throw new Error("Chrome did not return the runner tab ID.");
      }

      const tabId = placeholder.id;
      await this.storage.patchRunner(runId, { tabId, phase: "opening_facebook" });
      try {
        await this.tabs.update(tabId, {
          url: withRunMarker(FACEBOOK_HOME_URL, runId),
          active: false,
          autoDiscardable: false
        });
      } catch (error) {
        try {
          await this.tabs.remove(tabId);
        } catch {
          // The tab may already have been removed.
        }
        await this.recordWithoutTab(
          (await this.storage.getRunner()) ?? record
        );
        throw error;
      }
      return tabId;
    });
  }

  public async navigate(tabId: number, runId: string, targetUrl: string): Promise<void> {
    if (!isFacebookUrl(targetUrl)) {
      throw new Error("Blocked navigation outside the Facebook allowlist.");
    }
    const record = await this.storage.getRunner();
    if (!record || record.runId !== runId || record.tabId !== tabId) {
      throw new Error("Cannot navigate a tab without current ownership.");
    }
    await this.tabs.update(tabId, {
      url: withRunMarker(targetUrl, runId),
      active: false,
      autoDiscardable: false
    });
  }

  public async waitUntilReady(
    tabId: number,
    runId: string,
    timeoutMs = 30_000
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        const ping = (await this.tabs.sendMessage(tabId, {
          type: "PING"
        })) as ContentEnvelope;
        if (ping?.ok) {
          await this.command(tabId, { type: "ASSIGN_RUN", runId });
          return;
        }
      } catch (error) {
        lastError = error;
      }
      await delay(250);
    }
    throw new Error(
      `Facebook content script was not ready: ${
        lastError instanceof Error ? lastError.message : "timeout"
      }`
    );
  }

  public async command<T>(tabId: number, command: ContentCommand): Promise<T> {
    const envelope = (await this.tabs.sendMessage(
      tabId,
      command
    )) as ContentEnvelope;
    if (!envelope || envelope.ok !== true) {
      throw new Error(envelope?.error ?? "Facebook content command failed.");
    }
    return envelope.result as T;
  }

  private async verifyOwnership(
    tab: ManagedTab,
    tabId: number,
    runId: string
  ): Promise<boolean> {
    const url = tab.url ?? tab.pendingUrl ?? "";
    if (url.startsWith(this.runnerUrl(runId).split("#")[0] ?? "")) {
      return url.includes(encodeURIComponent(runId));
    }
    if (readRunMarker(url) === runId) {
      return true;
    }
    if (!isFacebookUrl(url)) {
      return false;
    }

    try {
      const envelope = (await this.tabs.sendMessage(tabId, {
        type: "GET_OWNERSHIP"
      })) as ContentEnvelope;
      if (!envelope?.ok || !envelope.result || typeof envelope.result !== "object") {
        return false;
      }
      return (envelope.result as { runId?: unknown }).runId === runId;
    } catch {
      return false;
    }
  }

  public async cleanupOwnedTab(jobId: string, runId: string): Promise<boolean> {
    return this.exclusive(async () => {
      const record = await this.storage.getRunner();
      if (
        !record ||
        record.jobId !== jobId ||
        record.runId !== runId ||
        record.tabId === undefined
      ) {
        return false;
      }

      const tab = await this.getTab(record.tabId);
      if (!tab) {
        await this.recordWithoutTab(record);
        return true;
      }
      if (!(await this.verifyOwnership(tab, record.tabId, runId))) {
        return false;
      }

      try {
        await this.command(record.tabId, { type: "CANCEL_RUN", runId });
      } catch {
        // Cleanup must continue even if the page/content script has already gone.
      }
      try {
        await this.tabs.remove(record.tabId);
      } catch (error) {
        if (!isMissingTabError(error)) throw error;
      }
      await this.recordWithoutTab(record);
      return true;
    });
  }

  public async closeUnexpectedChild(tab: ManagedTab): Promise<boolean> {
    if (tab.id === undefined || tab.openerTabId === undefined) return false;
    const record = await this.storage.getRunner();
    if (!record?.tabId || record.tabId !== tab.openerTabId) return false;
    await this.tabs.remove(tab.id);
    return true;
  }

  public async isOwnedTab(tabId: number): Promise<boolean> {
    const record = await this.storage.getRunner();
    return record?.tabId === tabId;
  }
}
