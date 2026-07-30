import { BackendApiClient } from "../backend/api-client";
import { isAllowedExternalSender, isSafeJobId } from "../shared/config";
import { ExtensionStorage } from "../shared/storage";
import { JobRunner } from "./job-runner";
import { TabLeaseManager } from "./tab-lease-manager";

const HEARTBEAT_ALARM = "listening-social-heartbeat";

const storage = new ExtensionStorage();
const api = new BackendApiClient(storage);
const tabs = new TabLeaseManager(storage);
const runner = new JobRunner(storage, api, tabs);

async function initialize(): Promise<void> {
  await storage.hardenAccess();
  await storage.getConnection();
  await chrome.alarms.create(HEARTBEAT_ALARM, {
    periodInMinutes: 0.5
  });
  await runner.reconcile();
}

chrome.runtime.onInstalled.addListener(() => {
  void initialize();
});

chrome.runtime.onStartup.addListener(() => {
  void initialize();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) {
    void runner.reconcile();
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  const child: { id?: number; openerTabId?: number } = {};
  if (tab.id !== undefined) child.id = tab.id;
  if (tab.openerTabId !== undefined) child.openerTabId = tab.openerTabId;
  void runner.onUnexpectedChild(child);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void runner.onTabRemoved(tabId);
});

chrome.runtime.onMessageExternal.addListener(
  (message: unknown, sender, sendResponse) => {
    if (!isAllowedExternalSender(sender.url)) {
      sendResponse({ ok: false, error: "origin_not_allowed" });
      return false;
    }
    if (!message || typeof message !== "object") {
      sendResponse({ ok: false, error: "invalid_message" });
      return false;
    }

    const request = message as Record<string, unknown>;
    const type = request["type"];
    if (type === "START_JOB" && isSafeJobId(request["jobId"])) {
      void runner
        .startJob(request["jobId"])
        .then((result) => sendResponse({ ok: true, result }))
        .catch((error: unknown) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message.slice(0, 200) : "start_failed"
          })
        );
      return true;
    }
    if (
      type === "CANCEL_JOB" &&
      (request["jobId"] === undefined || isSafeJobId(request["jobId"]))
    ) {
      void runner
        .cancel(
          typeof request["jobId"] === "string" ? request["jobId"] : undefined
        )
        .then((cancelled) => sendResponse({ ok: true, cancelled }))
        .catch((error: unknown) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message.slice(0, 200) : "cancel_failed"
          })
        );
      return true;
    }
    if (type === "GET_EXTENSION_STATUS") {
      void runner
        .getPopupStatus()
        .then((status) => sendResponse({ ok: true, status }))
        .catch(() => sendResponse({ ok: false, error: "status_failed" }));
      return true;
    }

    sendResponse({ ok: false, error: "unsupported_message" });
    return false;
  }
);

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message !== "object") {
    return false;
  }
  const request = message as Record<string, unknown>;
  switch (request["type"]) {
    case "POPUP_GET_STATUS":
      void runner
        .getPopupStatus()
        .then((status) => sendResponse({ ok: true, status }))
        .catch(() => sendResponse({ ok: false, error: "status_failed" }));
      return true;
    case "PAIRING_UPDATED":
      void runner
        .reconcile()
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false, error: "heartbeat_failed" }));
      return true;
    case "UNPAIR":
      void runner
        .unpair()
        .then(() => sendResponse({ ok: true }))
        .catch((error: unknown) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message.slice(0, 200) : "unpair_failed"
          })
        );
      return true;
    default:
      return false;
  }
});

void initialize();
