import { BackendApiClient } from "../backend/api-client";
import { ExtensionStorage } from "../shared/storage";
import type { PopupStatus } from "../shared/types";

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing popup element #${id}`);
  return found as T;
}

const storage = new ExtensionStorage();
const api = new BackendApiClient(storage);
const form = element<HTMLFormElement>("settingsForm");
const apiInput = element<HTMLInputElement>("apiBaseUrl");
const pairingInput = element<HTMLInputElement>("pairingCode");
const pairButton = element<HTMLButtonElement>("pairButton");
const unpairButton = element<HTMLButtonElement>("unpairButton");
const refreshButton = element<HTMLButtonElement>("refreshButton");
const message = element<HTMLParagraphElement>("message");

function setMessage(text: string, kind: "normal" | "success" | "error" = "normal"): void {
  message.textContent = text;
  message.className =
    kind === "normal" ? "message" : `message message--${kind}`;
}

function short(value: string | undefined): string {
  if (!value) return "—";
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function render(status: PopupStatus): void {
  apiInput.value = status.apiBaseUrl;
  element("installationId").textContent = short(status.installationId);
  element("jobId").textContent = status.runner ? short(status.runner.jobId) : "Không có";
  element("runnerPhase").textContent = status.runner?.phase ?? "idle";

  const badge = element("statusBadge");
  const labels: Record<PopupStatus["presence"], string> = {
    offline: "Chưa ghép",
    online: "Online",
    running: "Đang crawl",
    needs_login: "Cần đăng nhập"
  };
  badge.textContent = labels[status.presence];
  badge.className = `status status--${status.presence}`;
  pairButton.disabled = status.paired;
  unpairButton.disabled = !status.paired;
  pairingInput.disabled = status.paired;
}

async function loadStatus(): Promise<void> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: "POPUP_GET_STATUS"
    })) as { ok?: boolean; status?: PopupStatus };
    if (!response?.ok || !response.status) {
      throw new Error("Không đọc được trạng thái service worker.");
    }
    render(response.status);
  } catch {
    const connection = await storage.getConnection();
    const fallback: PopupStatus = {
      paired: Boolean(connection.deviceId && connection.deviceToken),
      installationId: connection.installationId,
      apiBaseUrl: connection.apiBaseUrl,
      presence: connection.deviceId ? "online" : "offline"
    };
    if (connection.deviceId) fallback.deviceId = connection.deviceId;
    render(fallback);
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    pairButton.disabled = true;
    setMessage("Đang ghép extension…");
    try {
      const apiBaseUrl = apiInput.value;
      await storage.setApiBaseUrl(apiBaseUrl);
      const code = pairingInput.value.trim();
      if (!code) throw new Error("Hãy nhập mã ghép một lần.");
      await api.pair(apiBaseUrl, code);
      pairingInput.value = "";
      await chrome.runtime.sendMessage({ type: "PAIRING_UPDATED" });
      setMessage("Đã ghép extension thành công.", "success");
      await loadStatus();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Không thể ghép extension.",
        "error"
      );
      pairButton.disabled = false;
    }
  })();
});

unpairButton.addEventListener("click", () => {
  void (async () => {
    unpairButton.disabled = true;
    setMessage("Đang hủy ghép và dọn tab automation…");
    try {
      const response = (await chrome.runtime.sendMessage({
        type: "UNPAIR"
      })) as { ok?: boolean; error?: string };
      if (!response?.ok) throw new Error(response?.error ?? "Hủy ghép thất bại.");
      setMessage("Đã hủy ghép.", "success");
      await loadStatus();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Hủy ghép thất bại.",
        "error"
      );
      unpairButton.disabled = false;
    }
  })();
});

refreshButton.addEventListener("click", () => {
  setMessage("Đang làm mới…");
  void loadStatus().then(() => setMessage(""));
});

void loadStatus();
