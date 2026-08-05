import { ExtensionStorage } from "../shared/storage";
import type { ContentCommand, RunnerRecord } from "../shared/types";
import {
  isAllowedPlatformUrl,
  platformHomeUrl,
  readRunMarker,
  withRunMarker
} from "../content/platform-urls";

export interface ManagedTab {
  id?: number;
  windowId?: number;
  url?: string;
  pendingUrl?: string;
  openerTabId?: number;
  active?: boolean;
  discarded?: boolean;
  frozen?: boolean;
  status?: "loading" | "complete" | "unloaded";
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
  reload(tabId: number): Promise<void>;
  sendMessage(tabId: number, message: ContentCommand): Promise<unknown>;
  injectContentScript(tabId: number): Promise<void>;
}

function chromeTabsPort(): TabsPort {
  const toManaged = (tab: chrome.tabs.Tab): ManagedTab => {
    const managed: ManagedTab = {};
    if (tab.id !== undefined) managed.id = tab.id;
    managed.windowId = tab.windowId;
    if (tab.url !== undefined) managed.url = tab.url;
    if (tab.pendingUrl !== undefined) managed.pendingUrl = tab.pendingUrl;
    if (tab.openerTabId !== undefined) managed.openerTabId = tab.openerTabId;
    managed.active = tab.active;
    managed.discarded = tab.discarded;
    if (tab.frozen !== undefined) managed.frozen = tab.frozen;
    if (tab.status !== undefined) managed.status = tab.status;
    return managed;
  };
  return {
    create: async (properties) => {
      const lastFocused = await chrome.windows.getLastFocused({
        populate: false,
        windowTypes: ["normal"]
      });
      const fallbackWindow =
        lastFocused.id === undefined
          ? (
              await chrome.windows.getAll({
                populate: false,
                windowTypes: ["normal"]
              })
            )[0]
          : undefined;
      const windowId = lastFocused.id ?? fallbackWindow?.id;
      if (windowId === undefined) {
        throw new Error(
          "No normal Chrome window is open for the background crawl tab."
        );
      }
      return toManaged(
        await chrome.tabs.create({
          ...properties,
          windowId,
          active: false
        })
      );
    },
    get: async (tabId) => toManaged(await chrome.tabs.get(tabId)),
    update: async (tabId, properties) => {
      const tab = await chrome.tabs.update(tabId, properties);
      return tab ? toManaged(tab) : undefined;
    },
    remove: async (tabId) => chrome.tabs.remove(tabId),
    reload: async (tabId) => chrome.tabs.reload(tabId),
    sendMessage: async (tabId, message) => chrome.tabs.sendMessage(tabId, message),
    injectContentScript: async (tabId) => {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["assets/content-script.js"]
      });
    }
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function isMissingTabError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /no tab with id|tab not found|invalid tab id/u.test(
      error.message.toLocaleLowerCase("en-US")
    )
  );
}

export function isTransientMessageChannelError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    /message channel closed|message port closed|receiving end does not exist|frame with id 0 was removed/u.test(
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
      windowId,
      ...withoutTab
    } = record;
    void tabId;
    void windowId;
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
        if (
          existing &&
          record.windowId !== undefined &&
          existing.windowId === record.windowId &&
          !existing.discarded &&
          !existing.frozen
        ) {
          return record.tabId;
        }
        if (existing) {
          if (!(await this.verifyOwnership(existing, record.tabId, runId))) {
            throw new Error(
              "Cannot replace an unverified platform tab owned by the user."
            );
          }
          await this.tabs.remove(record.tabId);
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
      await this.storage.patchRunner(runId, {
        tabId,
        ...(placeholder.windowId !== undefined
          ? { windowId: placeholder.windowId }
          : {}),
        phase: "opening_platform"
      });
      try {
        const platform = record.snapshot?.platform ?? "facebook";
        await this.tabs.update(tabId, {
          url: withRunMarker(platformHomeUrl(platform), runId),
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
    if (!isAllowedPlatformUrl(targetUrl)) {
      throw new Error("Blocked navigation outside the platform allowlist.");
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
        const before = await this.tabs.get(tabId);
        if (before.discarded || before.frozen) {
          await this.tabs.reload(tabId);
          await delay(250);
          continue;
        }
        const beforeUrl = before.url ?? before.pendingUrl ?? "";
        let ping: ContentEnvelope | null = null;
        try {
          ping = (await this.tabs.sendMessage(tabId, {
            type: "PING"
          })) as ContentEnvelope;
        } catch {
          // Declarative injection can be delayed indefinitely in a throttled
          // background platform tab. Inject the read-only runner explicitly;
          // the content script guards against duplicate registration.
          await this.tabs.injectContentScript(tabId);
          ping = (await this.tabs.sendMessage(tabId, {
            type: "PING"
          })) as ContentEnvelope;
        }
        if (ping?.ok) {
          const assigned = (await this.tabs.sendMessage(tabId, {
            type: "ASSIGN_RUN",
            runId
          })) as ContentEnvelope;
          if (assigned?.ok) {
            // A platform SPA can answer at document_idle and immediately replace the
            // SPA page. Require a short stable interval before starting the
            // longer discovery/crawl command.
            await delay(500);
            const after = await this.tabs.get(tabId);
            const afterUrl = after.url ?? after.pendingUrl ?? "";
            if (
              beforeUrl === afterUrl
            ) {
              const confirmed = (await this.tabs.sendMessage(tabId, {
                type: "PING"
              })) as ContentEnvelope;
              if (confirmed?.ok) return;
            }
            lastError = new Error(
              "The platform replaced the page while the content channel was starting."
            );
            continue;
          }
          lastError = new Error(
            assigned?.error ?? "Platform content ownership assignment failed."
          );
        }
      } catch (error) {
        lastError = error;
      }
      await delay(250);
    }
    throw new Error(
      `Platform content script was not ready: ${
        lastError instanceof Error ? lastError.message : "timeout"
      }`
    );
  }

  public async command<T>(tabId: number, command: ContentCommand): Promise<T> {
    const maxAttempts = 4;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const envelope = (await this.tabs.sendMessage(
          tabId,
          command
        )) as ContentEnvelope;
        if (!envelope || envelope.ok !== true) {
          throw new Error(envelope?.error ?? "Platform content command failed.");
        }
        return envelope.result as T;
      } catch (error) {
        if (
          attempt >= maxAttempts - 1 ||
          !isTransientMessageChannelError(error)
        ) {
          throw error;
        }
        const record = await this.storage.getRunner();
        if (!record?.runId || record.tabId !== tabId) {
          throw error;
        }
        // Platform SPAs occasionally replace the page while a command is starting.
        // Re-establish the read-only content channel, then replay the
        // idempotent command a bounded number of times. Never open a second
        // tab for this recovery.
        await delay(250 * (attempt + 1));
        await this.waitUntilReady(tabId, record.runId);
      }
    }
    throw new Error("Platform content command failed after channel recovery.");
  }

  public async cancelActiveCommand(tabId: number, runId: string): Promise<void> {
    const record = await this.storage.getRunner();
    if (!record || record.runId !== runId || record.tabId !== tabId) {
      return;
    }
    const envelope = (await withTimeout(
      this.tabs.sendMessage(tabId, {
        type: "CANCEL_RUN",
        runId
      }),
      5_000,
      "Platform content cancellation timed out."
    )) as ContentEnvelope;
    if (!envelope?.ok) {
      throw new Error(envelope?.error ?? "Platform content cancellation failed.");
    }
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
    if (!isAllowedPlatformUrl(url)) {
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
        await this.cancelActiveCommand(record.tabId, runId);
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

  public async forceCloseOwnedTab(jobId: string, runId: string): Promise<boolean> {
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

  public async acknowledgeRemovedOwnedTab(
    tabId: number
  ): Promise<RunnerRecord | null> {
    const record = await this.storage.getRunner();
    if (!record || record.tabId !== tabId) return null;
    return this.recordWithoutTab(record);
  }
}
