"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DataNotice,
  EmptyState,
} from "../components/ui";
import {
  ApiError,
  apiRequest,
  asBoolean,
  asNumber,
  asRecord,
  asString,
  extractId,
  formatDateTime,
  saveActiveJobId,
  unwrapItems,
} from "../lib/api";

type Platform = "facebook" | "tiktok" | "threads";
type DataMode = "live" | "offline" | "degraded";

type ExtensionStatus = {
  deviceId: string | null;
  state: "unpaired" | "online" | "offline" | "crawling" | "needs-login";
  version: string;
  heartbeatAt: string | null;
  deviceName: string;
  compatible: boolean;
};

type GroupSource = {
  id: string;
  name: string;
  url: string;
  selected: boolean;
  active: boolean;
  discoveredAt: string | null;
  lastError: string | null;
};

type Keyword = {
  id: string;
  value: string;
  enabled: boolean;
  matchType: "whole_word" | "contains_phrase";
};

type CrawlSettings = {
  lookbackDays: 0 | 3 | 7 | 30;
  maxSourcesPerJob: number;
  maxPostsPerSource: number;
  maxCommentsPerPost: number;
  maxRuntimeMinutes: number;
  enabled: boolean;
};

const MIN_EXTENSION_VERSION = [0, 2, 0] as const;

function apiErrorCode(error: ApiError): string {
  const payload = asRecord(error.payload);
  const nested = asRecord(payload.error);
  return asString(payload.code ?? nested.code);
}

function isCompatibleExtensionVersion(value: string): boolean {
  const parts = value
    .split(".")
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return false;
  }
  for (let index = 0; index < MIN_EXTENSION_VERSION.length; index += 1) {
    const current = parts[index] ?? 0;
    const required = MIN_EXTENSION_VERSION[index] ?? 0;
    if (current > required) return true;
    if (current < required) return false;
  }
  return true;
}

const OFFLINE_EXTENSION: ExtensionStatus = {
  deviceId: null,
  state: "offline",
  version: "—",
  heartbeatAt: null,
  deviceName: "Chưa nhận diện",
  compatible: false,
};

function normalizeExtension(value: unknown): ExtensionStatus {
  const firstDevice = unwrapItems(value)[0];
  const record = asRecord(firstDevice ?? value);
  const rawState = asString(
    record.state ?? record.status ?? record.connectionStatus,
    "unpaired",
  )
    .toLowerCase()
    .replaceAll("_", "-");
  let state: ExtensionStatus["state"] = "unpaired";
  if (["online", "connected", "ready", "idle"].includes(rawState)) state = "online";
  if (["offline", "disconnected"].includes(rawState)) state = "offline";
  if (["crawling", "busy", "running"].includes(rawState)) state = "crawling";
  if (["needs-login", "need-login", "login-required"].includes(rawState)) {
    state = "needs-login";
  }
  const version = asString(record.version ?? record.extensionVersion, "—");
  return {
    deviceId: asString(record.id ?? record.deviceId ?? record.device_id) || null,
    state,
    version,
    heartbeatAt:
      asString(
          record.heartbeatAt ??
          record.heartbeat_at ??
          record.lastSeenAt ??
          record.lastHeartbeatAt ??
          record.last_heartbeat_at,
      ) || null,
    deviceName: asString(
      record.deviceName ?? record.device_name ?? record.name,
      "Extension Chrome",
    ),
    compatible: asBoolean(
      record.compatible ?? record.isCompatible ?? record.is_compatible,
      isCompatibleExtensionVersion(version),
    ),
  };
}

function normalizeGroup(value: unknown): GroupSource | null {
  const record = asRecord(value);
  const id = String(record.id ?? record.externalId ?? record.external_id ?? "");
  const name = asString(record.name ?? record.title);
  if (!id || !name) return null;
  return {
    id,
    name,
    url: asString(
      record.url ??
        record.link ??
        record.canonicalUrl ??
        record.canonical_url ??
        record.externalUrl ??
        record.external_url,
    ),
    selected: asBoolean(
      record.selected ?? record.isSelected ?? record.is_selected,
    ),
    active: asBoolean(record.active ?? record.isActive ?? record.is_active, true),
    discoveredAt:
      asString(
        record.discoveredAt ??
          record.discovered_at ??
          record.lastDiscoveredAt ??
          record.last_discovered_at ??
          record.lastSeenAt ??
          record.last_seen_at,
      ) || null,
    lastError:
      asString(
        record.lastError ??
          record.last_error ??
          record.lastCrawlError ??
          record.last_crawl_error ??
          record.error,
      ) || null,
  };
}

function normalizeKeyword(value: unknown): Keyword | null {
  const record = asRecord(value);
  const id = String(record.id ?? "");
  const text = asString(record.value ?? record.keyword ?? record.text);
  if (!id || !text) return null;
  const rawMatch = asString(
    record.matchType ?? record.match_type ?? record.matchMode ?? record.match_mode,
    text.includes(" ") ? "contains_phrase" : "whole_word",
  );
  return {
    id,
    value: text,
    enabled: asBoolean(
      record.enabled ??
        record.isEnabled ??
        record.is_enabled ??
        record.active ??
        record.isActive,
      true,
    ),
    matchType:
      rawMatch === "whole_word" ? "whole_word" : "contains_phrase",
  };
}

function normalizeSettings(value: unknown): CrawlSettings {
  const record = asRecord(value);
  const preset = asString(
    record.lookbackPreset ?? record.lookback_preset,
  );
  const presetDays =
    preset === "today"
      ? 0
      : preset === "3_days"
        ? 3
        : preset === "7_days"
          ? 7
          : preset === "30_days"
            ? 30
            : undefined;
  const rawDays =
    presetDays ??
    asNumber(record.lookbackDays ?? record.lookback_days ?? record.days, 7);
  const lookbackDays: CrawlSettings["lookbackDays"] = [0, 3, 7, 30].includes(
    rawDays,
  )
    ? (rawDays as CrawlSettings["lookbackDays"])
    : 7;
  return {
    lookbackDays,
    maxSourcesPerJob: asNumber(
      record.maxSourcesPerJob ?? record.max_sources_per_job,
      50,
    ),
    maxPostsPerSource: asNumber(
      record.maxPostsPerSource ?? record.max_posts_per_source,
      300,
    ),
    maxCommentsPerPost: asNumber(
      record.maxCommentsPerPost ?? record.max_comments_per_post,
      500,
    ),
    maxRuntimeMinutes: asNumber(
      record.maxRuntimeMinutes ?? record.max_runtime_minutes,
      120,
    ),
    enabled: asBoolean(record.enabled, true),
  };
}

function lookbackPreset(days: CrawlSettings["lookbackDays"]) {
  return days === 0 ? "today" : `${days}_days`;
}

function extensionLabel(state: ExtensionStatus["state"]): string {
  return {
    unpaired: "Chưa ghép",
    online: "Sẵn sàng",
    offline: "Ngoại tuyến",
    crawling: "Đang crawl",
    "needs-login": "Cần đăng nhập",
  }[state];
}

export function SettingsClient() {
  const [platform, setPlatform] = useState<Platform>("facebook");
  const [mode, setMode] = useState<DataMode>("live");
  const [notice, setNotice] = useState("Đang đọc thiết lập…");
  const [extension, setExtension] =
    useState<ExtensionStatus>(OFFLINE_EXTENSION);
  const [groups, setGroups] = useState<GroupSource[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [settings, setSettings] = useState<CrawlSettings>({
    lookbackDays: 7,
    maxSourcesPerJob: 50,
    maxPostsPerSource: 300,
    maxCommentsPerPost: 500,
    maxRuntimeMinutes: 120,
    enabled: true,
  });
  const [groupQuery, setGroupQuery] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [feedback, setFeedback] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);
  const [pairingCode, setPairingCode] = useState("");
  const [pairingExpiry, setPairingExpiry] = useState("");
  const [discoveryJobId, setDiscoveryJobId] = useState("");

  const loadSettings = useCallback(async () => {
    const activePlatform = platform === "threads" ? "threads" : "facebook";
    const [extensionResult, groupsResult, keywordsResult, settingsResult] =
      await Promise.allSettled([
        apiRequest<unknown>("/extension/status"),
        activePlatform === "facebook"
          ? apiRequest<unknown>("/sources?platform=facebook")
          : Promise.resolve({ items: [] }),
        apiRequest<unknown>(`/keywords?platform=${activePlatform}`),
        apiRequest<unknown>(`/settings/${activePlatform}`),
      ]);

    const successCount = [
      extensionResult,
      groupsResult,
      keywordsResult,
      settingsResult,
    ].filter((result) => result.status === "fulfilled").length;

    if (!successCount) {
      setMode("offline");
      setNotice(
        "Không kết nối được API. Không có dữ liệu giả được hiển thị; hãy chạy Docker backend rồi thử lại.",
      );
      setExtension(OFFLINE_EXTENSION);
      setGroups([]);
      setKeywords([]);
    } else {
      setMode(successCount === 4 ? "live" : "degraded");
      setNotice(
        successCount === 4
          ? "Thiết lập đang đồng bộ trực tiếp với API."
          : `${successCount}/4 nguồn thiết lập đã phản hồi; các phần còn thiếu được để trống.`,
      );
      if (extensionResult.status === "fulfilled") {
        setExtension(normalizeExtension(extensionResult.value));
      }
      if (groupsResult.status === "fulfilled") {
        setGroups(
          unwrapItems(groupsResult.value)
            .map(normalizeGroup)
            .filter((group): group is GroupSource => group !== null),
        );
      }
      if (keywordsResult.status === "fulfilled") {
        setKeywords(
          unwrapItems(keywordsResult.value)
            .map(normalizeKeyword)
            .filter((keyword): keyword is Keyword => keyword !== null),
        );
      }
      if (settingsResult.status === "fulfilled") {
        setSettings(normalizeSettings(settingsResult.value));
      }
    }
  }, [platform]);

  const refreshExtension = useCallback(async () => {
    try {
      const response = await apiRequest<unknown>("/extension/status");
      setExtension(normalizeExtension(response));
    } catch {
      setExtension((current) =>
        current.state === "unpaired"
          ? current
          : { ...current, state: "offline" },
      );
    }
  }, []);

  const refreshDiscoveryJob = useCallback(
    async (jobId: string) => {
      try {
        const [jobResponse, groupsResponse] = await Promise.all([
          apiRequest<unknown>(`/jobs/${encodeURIComponent(jobId)}`),
          apiRequest<unknown>("/sources?platform=facebook"),
        ]);
        const latestGroups = unwrapItems(groupsResponse)
          .map(normalizeGroup)
          .filter((group): group is GroupSource => group !== null);
        setGroups(latestGroups);

        const job = asRecord(jobResponse);
        const progress = asRecord(job.progress);
        const status = asString(job.status, "waiting_extension");
        const sourcesDone = asNumber(
          progress.sourcesDone ?? progress.sources_done,
          latestGroups.length,
        );

        if (status === "completed" || status === "partial") {
          setDiscoveryJobId("");
          setBusyAction("");
          setFeedback({
            type: status === "completed" ? "success" : "info",
            text:
              status === "completed"
                ? `Đã đọc xong ${latestGroups.length} group thật từ Facebook.`
                : `Job hoàn tất một phần; hiện đọc được ${latestGroups.length} group. Xem trang Jobs để biết giới hạn gặp phải.`,
          });
          await loadSettings();
          return;
        }

        if (
          ["failed", "cancelled", "needs_login", "interrupted"].includes(status)
        ) {
          setDiscoveryJobId("");
          setBusyAction("");
          setFeedback({
            type: "error",
            text:
              asString(job.errorMessage ?? job.error_message) ||
              (status === "needs_login"
                ? "Facebook yêu cầu đăng nhập lại. Mở tab Facebook, đăng nhập rồi chạy lại."
                : `Job lấy group dừng ở trạng thái ${status}. Xem trang Jobs để biết chi tiết.`),
          });
          await loadSettings();
          return;
        }

        setFeedback({
          type: "info",
          text:
            status === "waiting_extension"
              ? "Job thật đã được tạo. Đang chờ extension nhận lệnh; heartbeat có thể mất tối đa khoảng 30 giây."
              : `Extension đang đọc danh sách group Facebook… đã nhận ${sourcesDone} group.`,
        });
      } catch (error) {
        setFeedback({
          type: "error",
          text:
            error instanceof Error
              ? `Không đọc được tiến độ job: ${error.message}`
              : "Không đọc được tiến độ job lấy group.",
        });
      }
    },
    [loadSettings],
  );

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadSettings(), 0);
    const interval = window.setInterval(
      () => void refreshExtension(),
      5_000,
    );
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [loadSettings, refreshExtension]);

  useEffect(() => {
    if (!discoveryJobId) return;
    const initial = window.setTimeout(
      () => void refreshDiscoveryJob(discoveryJobId),
      0,
    );
    const interval = window.setInterval(
      () => void refreshDiscoveryJob(discoveryJobId),
      3_000,
    );
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [discoveryJobId, refreshDiscoveryJob]);

  const filteredGroups = useMemo(() => {
    const query = groupQuery.trim().toLocaleLowerCase("vi-VN");
    if (!query) return groups;
    return groups.filter((group) =>
      group.name.toLocaleLowerCase("vi-VN").includes(query),
    );
  }, [groupQuery, groups]);

  const selectedGroupIds = useMemo(
    () => groups.filter((group) => group.selected).map((group) => group.id),
    [groups],
  );
  const enabledKeywords = keywords.filter((keyword) => keyword.enabled);
  const allVisibleSelected =
    filteredGroups.length > 0 &&
    filteredGroups.every((group) => group.selected);
  const canCrawl =
    extension.state === "online" &&
    extension.compatible &&
    (platform === "threads" || selectedGroupIds.length > 0) &&
    enabledKeywords.length > 0;

  function toggleGroup(id: string, selected: boolean) {
    setGroups((current) =>
      current.map((group) =>
        group.id === id ? { ...group, selected } : group,
      ),
    );
  }

  function toggleAllVisible(selected: boolean) {
    const visibleIds = new Set(filteredGroups.map((group) => group.id));
    setGroups((current) =>
      current.map((group) =>
        visibleIds.has(group.id) ? { ...group, selected } : group,
      ),
    );
  }

  async function createPairingCode() {
    setBusyAction("pair");
    setFeedback(null);
    try {
      const response = await apiRequest<unknown>("/extension/pairing-codes", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const record = asRecord(response);
      const code = asString(record.code ?? record.pairingCode ?? record.pairing_code);
      if (!code) throw new Error("API không trả về mã ghép.");
      setPairingCode(code);
      setPairingExpiry(
        asString(record.expiresAt ?? record.expires_at),
      );
      setFeedback({
        type: "success",
        text: "Đã tạo mã. Nhập mã này vào extension trên cùng trình duyệt.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Không thể tạo mã ghép extension.",
      });
    } finally {
      setBusyAction("");
    }
  }

  async function syncGroups() {
    setBusyAction("sync");
    setFeedback(null);
    let jobStarted = false;
    try {
      const extensionResponse = await apiRequest<unknown>("/extension/status");
      const currentExtension = normalizeExtension(extensionResponse);
      setExtension(currentExtension);
      if (!currentExtension.deviceId || currentExtension.state === "unpaired") {
        throw new Error(
          "Chưa ghép extension. Hãy tạo mã ghép, nhập mã trong popup extension rồi thử lại.",
        );
      }
      if (!currentExtension.compatible) {
        throw new Error(
          `Extension ${currentExtension.version} đã cũ. Mở chrome://extensions, bấm Reload cho Social Listening để dùng bản 0.1.6 rồi thử lại.`,
        );
      }
      if (currentExtension.state === "offline") {
        throw new Error(
          "Extension đã ghép nhưng đang offline. Hãy mở Chrome và popup extension, kiểm tra API URL rồi bấm làm mới.",
        );
      }
      if (currentExtension.state === "needs-login") {
        throw new Error(
          "Extension cần đăng nhập Facebook lại trước khi lấy danh sách group.",
        );
      }
      if (currentExtension.state === "crawling") {
        throw new Error(
          "Extension đang chạy một job khác. Hãy chờ job đó kết thúc hoặc hủy tại trang Jobs.",
        );
      }

      const response = await apiRequest<unknown>("/jobs/discover-sources", {
        method: "POST",
        body: JSON.stringify({
          platform: platform === "threads" ? "threads" : "facebook",
          deviceId: currentExtension.deviceId,
        }),
      });
      const jobId = extractId(response);
      if (!jobId) throw new Error("API không trả về ID của job lấy group.");
      saveActiveJobId(jobId);
      setDiscoveryJobId(jobId);
      jobStarted = true;
      setFeedback({
        type: "info",
        text: "Job thật đã được tạo. Đang chờ extension nhận lệnh và mở một tab Facebook nền.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Không thể bắt đầu lấy danh sách group.",
      });
    } finally {
      if (!jobStarted) setBusyAction("");
    }
  }

  async function saveGroups(showFeedback = true) {
    await apiRequest<unknown>("/sources/selection", {
      method: "PUT",
      body: JSON.stringify({
        platform: "facebook",
        sourceIds: selectedGroupIds,
      }),
    });
    if (showFeedback) {
      setFeedback({
        type: "success",
        text: `Đã lưu ${selectedGroupIds.length} group dùng cho các lần crawl sau.`,
      });
    }
  }

  async function handleSaveGroups() {
    setBusyAction("save-groups");
    setFeedback(null);
    try {
      await saveGroups();
    } catch (error) {
      setFeedback({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Không thể lưu lựa chọn group.",
      });
    } finally {
      setBusyAction("");
    }
  }

  async function addKeyword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = keywordInput.trim();
    if (!value) return;
    const normalized = value.toLocaleLowerCase("vi-VN");
    if (
      keywords.some(
        (keyword) =>
          keyword.value.trim().toLocaleLowerCase("vi-VN") === normalized,
      )
    ) {
      setFeedback({ type: "error", text: "Từ khóa này đã tồn tại." });
      return;
    }

    setBusyAction("add-keyword");
    setFeedback(null);
    try {
      const response = await apiRequest<unknown>("/keywords", {
        method: "POST",
        body: JSON.stringify({
          platform: "facebook",
          value,
          active: true,
          matchMode: value.includes(" ") ? "contains_phrase" : "whole_word",
        }),
      });
      const keyword = normalizeKeyword(response);
      if (!keyword) throw new Error("API không trả về từ khóa vừa tạo.");
      setKeywords((current) => [...current, keyword]);
      setKeywordInput("");
      setFeedback({ type: "success", text: `Đã thêm từ khóa “${value}”.` });
    } catch (error) {
      setFeedback({
        type: "error",
        text:
          error instanceof Error ? error.message : "Không thể thêm từ khóa.",
      });
    } finally {
      setBusyAction("");
    }
  }

  async function toggleKeyword(keyword: Keyword, enabled: boolean) {
    setKeywords((current) =>
      current.map((item) =>
        item.id === keyword.id ? { ...item, enabled } : item,
      ),
    );
    try {
      await apiRequest<unknown>(`/keywords/${encodeURIComponent(keyword.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ active: enabled }),
      });
    } catch (error) {
      setKeywords((current) =>
        current.map((item) =>
          item.id === keyword.id ? { ...item, enabled: keyword.enabled } : item,
        ),
      );
      setFeedback({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Không thể cập nhật từ khóa.",
      });
    }
  }

  async function startCrawl() {
    setBusyAction("crawl");
    setFeedback(null);
    try {
      const activePlatform = platform === "threads" ? "threads" : "facebook";
      const settingRequest = apiRequest<unknown>(`/settings/${activePlatform}`, {
          method: "PUT",
          body: JSON.stringify({
            lookbackPreset: lookbackPreset(settings.lookbackDays),
            crawlComments: true,
            maxSourcesPerJob: settings.maxSourcesPerJob,
            maxPostsPerSource: settings.maxPostsPerSource,
            maxCommentsPerPost: settings.maxCommentsPerPost,
            maxRuntimeMinutes: settings.maxRuntimeMinutes,
            enabled: true,
          }),
        });
      await (activePlatform === "facebook"
        ? Promise.all([settingRequest, saveGroups(false)])
        : settingRequest);
      const response = await apiRequest<unknown>("/jobs/crawl", {
        method: "POST",
        body: JSON.stringify({
          platform: activePlatform,
          ...(activePlatform === "facebook"
            ? { sourceIds: selectedGroupIds }
            : { deviceId: extension.deviceId }),
          keywordIds: enabledKeywords.map((keyword) => keyword.id),
          lookbackPreset: lookbackPreset(settings.lookbackDays),
        }),
      });
      const jobId = extractId(response);
      if (!jobId) throw new Error("API không trả về ID của job crawl.");
      saveActiveJobId(jobId);
      setExtension((current) => ({ ...current, state: "crawling" }));
      setFeedback({
        type: "success",
        text: `Job ${activePlatform === "threads" ? "Threads" : "Facebook"} đã được tạo và chỉ lấy bài trong ${
          settings.lookbackDays === 0
            ? "hôm nay"
            : `${settings.lookbackDays} ngày gần đây`
        }. Extension sẽ chỉ mở một tab ${activePlatform === "threads" ? "Threads" : "Facebook"} và tự đóng khi hoàn tất.`,
      });
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        apiErrorCode(error) === "DEVICE_ALREADY_BUSY"
      ) {
        setExtension((current) => ({ ...current, state: "crawling" }));
        setFeedback({
          type: "info",
          text: "Extension đang chạy một job web khác, hệ thống không tạo job trùng. Theo dõi tiến độ tại trang Jobs.",
        });
        return;
      }
      setFeedback({
        type: "error",
        text:
          error instanceof Error ? error.message : "Không thể bắt đầu crawl.",
      });
    } finally {
      setBusyAction("");
    }
  }

  return (
    <div className="page-stack settings-page">
      <section className="page-intro">
        <div>
          <span className="section-kicker">Control plane</span>
          <h2>Chọn đúng nguồn, nghe đúng tín hiệu</h2>
          <p>
            Extension lọc từ khóa rồi lưu metadata/ngữ cảnh bài post cùng bình
            luận và phản hồi trên Facebook hoặc Threads. Hệ thống chỉ đọc và
            cuộn trang, không đăng bài, bình luận, like hay thực hiện tương tác.
          </p>
        </div>
        <div className="privacy-callout">
          <span aria-hidden="true">P</span>
          <p>
            <strong>Tối thiểu hóa dữ liệu cá nhân</strong>
            Chỉ lưu tên hiển thị hoặc trạng thái ẩn danh. Không lưu link hồ sơ.
          </p>
        </div>
      </section>

      <DataNotice mode={mode} message={notice} />

      {feedback && (
        <div
          className={`feedback feedback-${feedback.type}`}
          role={feedback.type === "error" ? "alert" : "status"}
        >
          <span aria-hidden="true">
            {feedback.type === "success"
              ? "✓"
              : feedback.type === "error"
                ? "!"
                : "i"}
          </span>
          <p>{feedback.text}</p>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            aria-label="Đóng thông báo"
          >
            ×
          </button>
        </div>
      )}

      <div className="platform-tabs" role="tablist" aria-label="Nền tảng">
        {(["facebook", "tiktok", "threads"] as Platform[]).map((item) => (
          <button
            type="button"
            role="tab"
            aria-selected={platform === item}
            className={platform === item ? "is-active" : ""}
            onClick={() => setPlatform(item)}
            key={item}
          >
            <span className={`platform-monogram platform-monogram-${item}`}>
              {item === "facebook" ? "f" : item === "tiktok" ? "t" : "@"}
            </span>
            <span>
              <strong>
                {item === "facebook"
                  ? "Facebook"
                  : item === "tiktok"
                    ? "TikTok"
                    : "Threads"}
              </strong>
              <small>{item === "tiktok" ? "Giai đoạn 2" : "MVP đang hoạt động"}</small>
            </span>
          </button>
        ))}
      </div>

      {platform !== "tiktok" ? (
        <div className="settings-layout" role="tabpanel">
          <section className="panel settings-section extension-section">
            <div className="settings-section-heading">
              <div className="section-number">01</div>
              <div>
                <span className="section-kicker">Kết nối trình duyệt</span>
                <h3>{platform === "threads" ? "Threads Extension" : "Facebook Extension"}</h3>
                <p>
                  Extension dùng phiên đăng nhập {platform === "threads" ? "Threads" : "Facebook"}
                  {" "}trên máy của bạn.
                </p>
              </div>
              <span className={`connection-state state-${extension.state}`}>
                <span aria-hidden="true" />
                {extensionLabel(extension.state)}
              </span>
            </div>

            <div className="extension-grid">
              <div>
                <span>Thiết bị</span>
                <strong>{extension.deviceName}</strong>
              </div>
              <div>
                <span>Phiên bản</span>
                <strong>{extension.version}</strong>
              </div>
              <div>
                <span>Heartbeat</span>
                <strong>{formatDateTime(extension.heartbeatAt)}</strong>
              </div>
              <div>
                <span>Tương thích API</span>
                <strong
                  className={
                    !extension.deviceId
                      ? undefined
                      : extension.compatible
                        ? "text-good"
                        : "text-bad"
                  }
                >
                  {!extension.deviceId
                    ? "Chưa kiểm tra"
                    : extension.compatible
                      ? "Sẵn sàng"
                      : "Cần cập nhật"}
                </strong>
              </div>
            </div>

            {extension.deviceId && !extension.compatible && (
              <p className="inline-warning">
                Phiên bản extension hiện tại không tương thích API contract.
                Hãy mở <code>chrome://extensions</code>, bấm Reload cho Social
                Listening để dùng phiên bản 0.2.0 trở lên.
              </p>
            )}

            <div className="section-actions">
              <button
                className="button button-secondary"
                type="button"
                onClick={() => void createPairingCode()}
                disabled={busyAction === "pair"}
              >
                {busyAction === "pair" ? "Đang tạo mã…" : "Tạo mã ghép extension"}
              </button>
              {platform === "facebook" && (
                <button
                  className="button button-primary"
                  type="button"
                  onClick={() => void syncGroups()}
                  disabled={busyAction === "sync"}
                >
                  {busyAction === "sync"
                    ? "Đang lấy group thật…"
                    : "Lấy group đã tham gia"}
                </button>
              )}
            </div>

            {pairingCode && (
              <div className="pairing-code" aria-live="polite">
                <span>Mã ghép một lần</span>
                <strong>{pairingCode}</strong>
                <small>
                  {pairingExpiry
                    ? `Hết hạn ${formatDateTime(pairingExpiry)}`
                    : "Nhập mã trong extension để hoàn tất kết nối."}
                </small>
              </div>
            )}
          </section>

          {platform === "facebook" && (
          <section className="panel settings-section groups-section">
            <div className="settings-section-heading">
              <div className="section-number">02</div>
              <div>
                <span className="section-kicker">Nguồn Facebook</span>
                <h3>Group đã tham gia</h3>
                <p>
                  Extension lọc post trong group được chọn, lưu metadata/ngữ
                  cảnh của post khớp rồi thu thập comment/reply.
                </p>
              </div>
              <span className="selection-counter">
                <strong>{selectedGroupIds.length}</strong>/{groups.length} đã chọn
              </span>
            </div>

            <div className="group-toolbar">
              <label className="search-field">
                <span className="sr-only">Tìm tên group</span>
                <span aria-hidden="true">⌕</span>
                <input
                  value={groupQuery}
                  onChange={(event) => setGroupQuery(event.target.value)}
                  placeholder="Tìm theo tên group…"
                />
              </label>
              <label className="check-all">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={(event) => toggleAllVisible(event.target.checked)}
                  disabled={!filteredGroups.length}
                />
                Chọn tất cả đang hiển thị
              </label>
            </div>

            {filteredGroups.length ? (
              <div className="group-list">
                {filteredGroups.map((group) => (
                  <div className="group-row" key={group.id}>
                    <label
                      className="group-check-cell"
                      aria-label={`Chọn group ${group.name}`}
                    >
                      <input
                        type="checkbox"
                        checked={group.selected}
                        onChange={(event) =>
                          toggleGroup(group.id, event.target.checked)
                        }
                      />
                      <span className="custom-checkbox" aria-hidden="true">
                        ✓
                      </span>
                    </label>
                    <span className="group-main">
                      <strong>{group.name}</strong>
                      <small>
                        Phát hiện {formatDateTime(group.discoveredAt)}
                      </small>
                    </span>
                    <span
                      className={`source-state${group.active ? " is-active" : ""}`}
                    >
                      {group.active ? "Đang hoạt động" : "Tạm dừng"}
                    </span>
                    {group.lastError && (
                      <span className="group-error" title={group.lastError}>
                        Có lỗi gần nhất
                      </span>
                    )}
                    {group.url ? (
                      <a
                        href={group.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        aria-label={`Mở group ${group.name} trong tab mới`}
                      >
                        Mở group ↗
                      </a>
                    ) : (
                      <span className="muted-link">Không có link</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title={groups.length ? "Không tìm thấy group" : "Chưa có group"}
                description={
                  groups.length
                    ? "Thử tìm bằng tên khác."
                    : "Kết nối extension rồi chọn “Lấy group đã tham gia”."
                }
              />
            )}

            <div className="section-actions section-actions-end">
              <span>
                Extension chỉ mở tối đa <strong>1 tab Facebook</strong> và tự
                đóng tab sau khi hoàn tất.
              </span>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => void handleSaveGroups()}
                disabled={busyAction === "save-groups" || !groups.length}
              >
                {busyAction === "save-groups" ? "Đang lưu…" : "Lưu lựa chọn"}
              </button>
            </div>
          </section>
          )}

          <section className="panel settings-section keyword-section">
            <div className="settings-section-heading">
              <div className="section-number">{platform === "threads" ? "02" : "03"}</div>
              <div>
                <span className="section-kicker">Lọc trước khi lưu</span>
                <h3>Từ khóa theo dõi</h3>
                <p>
                  {platform === "threads"
                    ? "Extension mở trang tìm kiếm Threads theo từng từ khóa rồi kiểm tra lại nội dung trên máy trước khi lưu bài và phản hồi."
                    : "Từ khóa được đối chiếu trên bài post. Post khớp được lưu làm metadata/ngữ cảnh đầy đủ cho comment; comment/reply vẫn là dữ liệu listening chính."}
                </p>
              </div>
              <span className="selection-counter">
                <strong>{enabledKeywords.length}</strong> đang bật
              </span>
            </div>

            <div className="keyword-list">
              {keywords.map((keyword) => (
                <div
                  className={`keyword-row${keyword.enabled ? "" : " is-disabled"}`}
                  key={keyword.id}
                >
                  <span className="keyword-value">{keyword.value}</span>
                  <span className="match-type">
                    {keyword.matchType === "whole_word"
                      ? "Khớp nguyên từ"
                      : "Khớp cụm từ"}
                  </span>
                  <label className="mini-switch">
                    <span className="sr-only">
                      {keyword.enabled ? "Tắt" : "Bật"} từ khóa {keyword.value}
                    </span>
                    <input
                      type="checkbox"
                      checked={keyword.enabled}
                      onChange={(event) =>
                        void toggleKeyword(keyword, event.target.checked)
                      }
                    />
                    <span aria-hidden="true" />
                  </label>
                </div>
              ))}
            </div>

            <form className="keyword-form" onSubmit={addKeyword}>
              <label>
                <span>Thêm từ khóa mới</span>
                <input
                  value={keywordInput}
                  onChange={(event) => setKeywordInput(event.target.value)}
                  placeholder="Ví dụ: VinSmart Future"
                  maxLength={100}
                />
              </label>
              <button
                className="button button-secondary"
                type="submit"
                disabled={busyAction === "add-keyword" || !keywordInput.trim()}
              >
                {busyAction === "add-keyword" ? "Đang thêm…" : "Thêm từ khóa"}
              </button>
            </form>
          </section>

          <section className="panel settings-section crawl-section">
            <div className="settings-section-heading">
              <div className="section-number">{platform === "threads" ? "03" : "04"}</div>
              <div>
                <span className="section-kicker">Phạm vi thu thập</span>
                <h3>Thời gian bài post & bình luận</h3>
                <p>
                  {platform === "threads"
                    ? "Áp dụng cho lần tìm bài và phản hồi công khai tiếp theo trên Threads."
                    : "Áp dụng cho lần lấy comment/reply tiếp theo trên các group đã chọn."}
                </p>
              </div>
            </div>

            <fieldset className="lookback-options">
              <legend>Xét bài post được đăng từ</legend>
              {[
                [0, "Hôm nay", "Từ 00:00 đến hiện tại"],
                [3, "3 ngày", "Theo dõi ngắn hạn"],
                [7, "7 ngày", "Khuyến nghị"],
                [30, "30 ngày", "Khối lượng lớn"],
              ].map(([days, label, description]) => (
                <label
                  className={
                    settings.lookbackDays === days ? "is-selected" : ""
                  }
                  key={String(days)}
                >
                  <input
                    type="radio"
                    name="lookback"
                    value={days}
                    checked={settings.lookbackDays === days}
                    onChange={() =>
                      setSettings((current) => ({
                        ...current,
                        lookbackDays: days as CrawlSettings["lookbackDays"],
                      }))
                    }
                  />
                  <strong>{label}</strong>
                  <small>{description}</small>
                </label>
              ))}
            </fieldset>

            <div className="collection-policy" role="note">
              <span aria-hidden="true">C</span>
              <div>
                <strong>{platform === "threads" ? "Thu thập bài và phản hồi công khai" : "Luôn thu thập comment và reply"}</strong>
                <p>
                  {platform === "threads"
                    ? "Collector chỉ cuộn trang tìm kiếm và trang bài viết; không bấm Like, Reply hay Follow. URL được chuẩn hóa để không lưu username. Kết quả phụ thuộc những gì Threads hiển thị cho tài khoản đang đăng nhập."
                    : "Với mỗi post khớp, hệ thống lưu source, URL, body, tên tác giả hoặc trạng thái ẩn danh, thời gian đăng, thời gian thu thập và keyword hits. Comment cũng chỉ lưu tên hiển thị hoặc ẩn danh, không lưu link hồ sơ cá nhân."}
                </p>
              </div>
            </div>

            <div className="crawl-summary">
              <div>
                <span>{platform === "threads" ? "Nguồn" : "Group"}</span>
                <strong>{platform === "threads" ? "Tìm kiếm công khai" : selectedGroupIds.length}</strong>
              </div>
              <div>
                <span>Từ khóa bật</span>
                <strong>{enabledKeywords.length}</strong>
              </div>
              <div>
                <span>Khoảng lấy</span>
                <strong>
                  {settings.lookbackDays === 0
                    ? "Hôm nay"
                    : `${settings.lookbackDays} ngày`}
                </strong>
              </div>
              <div>
                <span>Nội dung</span>
                <strong>Comment + reply</strong>
              </div>
            </div>

            <div className="crawl-action">
              <div>
                <strong>Lấy comment thủ công</strong>
                <p>
                  Job sẽ được cập nhật trên web mỗi 5 giây. Có thể đóng trang này
                  trong khi extension chạy nền.
                </p>
                {!canCrawl && (
                  <span className="validation-message">
                    {platform === "threads"
                      ? "Cần extension 0.2.0+ online, đăng nhập Threads và ít nhất 1 từ khóa đang bật."
                      : "Cần extension online, ít nhất 1 group và 1 từ khóa đang bật."}
                  </span>
                )}
              </div>
              <button
                className="button button-primary button-large"
                type="button"
                onClick={() => void startCrawl()}
                disabled={!canCrawl || busyAction === "crawl"}
              >
                {busyAction === "crawl"
                  ? "Đang tạo job…"
                  : platform === "threads"
                    ? "Bắt đầu tìm trên Threads"
                    : "Bắt đầu lấy comment"}
              </button>
            </div>
          </section>
        </div>
      ) : (
        <section className="panel coming-soon" role="tabpanel">
          <span className="platform-monogram platform-monogram-tiktok">
            t
          </span>
          <span className="section-kicker">Giai đoạn 2</span>
          <h3>TikTok chưa được bật</h3>
          <p>
            Connector cần quyền API chính thức trước khi có thể thu thập dữ liệu.
            Khi được bật, comment/reply vẫn là dữ liệu listening chính; post
            khớp được lưu metadata/ngữ cảnh đầy đủ.
          </p>
          <div className="future-platform-grid">
            <div>
              <span>Trạng thái connector</span>
              <strong>Chưa cấu hình</strong>
            </div>
            <div>
              <span>Chế độ tìm kiếm</span>
              <strong>Keyword search</strong>
            </div>
            <div>
              <span>Từ khóa dùng chung</span>
              <strong>{enabledKeywords.length || 4}</strong>
            </div>
          </div>
          <button className="button button-secondary" type="button" disabled>
            Kiểm tra kết nối
          </button>
        </section>
      )}
    </div>
  );
}
