import {
  DEFAULT_WEBUI_BASE_URL,
  SETTINGS_FIELDS,
  FIELD_BY_ID,
  MODULES,
  normalizeFieldValue,
  getMissingRequiredFieldIds,
  getModuleMissingFieldIds
} from "./module-registry.js";

const MESSAGE_TYPES = globalThis.KSUITE_MESSAGE_TYPES;
const STORAGE_KEYS = globalThis.KSUITE_STORAGE_KEYS;
const FALLBACK_SIDEPANEL_HOST_URL =
  globalThis.KSUITE_FALLBACK_SIDEPANEL_HOST_URL || "https://example.com/";

if (!MESSAGE_TYPES || !STORAGE_KEYS) {
  throw new Error("K-SUITE shared constants are not initialized.");
}

const settingsForm = document.getElementById("settingsForm");
const settingsToggleBtn = document.getElementById("settingsToggleBtn");
const settingsCloseBtn = document.getElementById("settingsCloseBtn");
const settingsBackdrop = document.getElementById("settingsBackdrop");
const settingsSheet = document.getElementById("settingsSheet");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
const reloadSettingsBtn = document.getElementById("reloadSettingsBtn");
const settingsStatus = document.getElementById("settingsStatus");

const gateHint = document.getElementById("gateHint");
const moduleGrid = document.getElementById("moduleGrid");
const feedbackToast = document.getElementById("feedbackToast");
const launchStatus = document.getElementById("launchStatus");
const retryLaunchBtn = document.getElementById("retryLaunchBtn");

const state = {
  savedValues: {},
  draftValues: {},
  dirty: false,
  launchInProgress: false,
  lastFailedModuleId: ""
};

function getModuleById(moduleId) {
  return MODULES.find((module) => module.id === moduleId) || null;
}

function toErrorMessage(error) {
  return error?.message || String(error);
}

function setStatus(target, text, tone = "") {
  target.textContent = text;
  target.className = "status";
  if (tone) target.classList.add(tone);
}

function setGateHint(text, tone = "") {
  gateHint.textContent = text;
  gateHint.className = "gate-hint";
  if (tone) gateHint.classList.add(tone);
}

function setLaunchFeedback({ message = "", tone = "", showRetry = false, moduleId = "" } = {}) {
  if (!message) {
    feedbackToast.className = "feedback-toast hidden";
    launchStatus.textContent = "";
    retryLaunchBtn.classList.add("hidden");
    return;
  }

  feedbackToast.className = "feedback-toast";
  if (tone) feedbackToast.classList.add(tone);
  launchStatus.textContent = message;

  if (showRetry) {
    retryLaunchBtn.classList.remove("hidden");
    state.lastFailedModuleId = moduleId || state.lastFailedModuleId;
  } else {
    retryLaunchBtn.classList.add("hidden");
    state.lastFailedModuleId = moduleId || "";
  }
}

function openSettingsSheet() {
  settingsSheet.classList.remove("hidden");
}

function closeSettingsSheet() {
  settingsSheet.classList.add("hidden");
}

function getLaunchTypeLabel(launchType) {
  return launchType === "sidepanel" ? "사이드바" : "풀페이지";
}

function collectFormValues() {
  const values = {};

  SETTINGS_FIELDS.forEach((field) => {
    const input = settingsForm.querySelector(`[data-field-id="${field.id}"]`);
    const normalized = normalizeFieldValue(field, input?.value || "");
    values[field.id] = normalized || field.defaultValue || "";
  });

  return values;
}

async function migrateLegacySharedApiKeyIfNeeded() {
  const [
    localData,
    syncData
  ] = await Promise.all([
    chrome.storage.local.get([
      STORAGE_KEYS.SHARED_API_KEY,
      STORAGE_KEYS.LEGACY_WEBUI_API_KEY,
      STORAGE_KEYS.LEGACY_USER_TOKEN
    ]),
    chrome.storage.sync.get([STORAGE_KEYS.LEGACY_SYNC_API_KEY])
  ]);

  const removeLocalKeys = [];
  const removeSyncKeys = [];

  const currentShared = String(localData[STORAGE_KEYS.SHARED_API_KEY] || "").trim();
  if (currentShared) {
    if (localData[STORAGE_KEYS.LEGACY_WEBUI_API_KEY]) {
      removeLocalKeys.push(STORAGE_KEYS.LEGACY_WEBUI_API_KEY);
    }
    if (localData[STORAGE_KEYS.LEGACY_USER_TOKEN]) {
      removeLocalKeys.push(STORAGE_KEYS.LEGACY_USER_TOKEN);
    }
    if (syncData[STORAGE_KEYS.LEGACY_SYNC_API_KEY]) {
      removeSyncKeys.push(STORAGE_KEYS.LEGACY_SYNC_API_KEY);
    }
    if (removeLocalKeys.length > 0) {
      await chrome.storage.local.remove([...new Set(removeLocalKeys)]);
    }
    if (removeSyncKeys.length > 0) {
      await chrome.storage.sync.remove([...new Set(removeSyncKeys)]);
    }
    return currentShared;
  }

  const migratedShared = String(
    localData[STORAGE_KEYS.LEGACY_WEBUI_API_KEY] ||
    localData[STORAGE_KEYS.LEGACY_USER_TOKEN] ||
    syncData[STORAGE_KEYS.LEGACY_SYNC_API_KEY] ||
    ""
  ).trim();
  if (!migratedShared) {
    return "";
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.SHARED_API_KEY]: migratedShared
  });
  await chrome.storage.local.remove([
    STORAGE_KEYS.LEGACY_WEBUI_API_KEY,
    STORAGE_KEYS.LEGACY_USER_TOKEN
  ]);
  await chrome.storage.sync.remove([STORAGE_KEYS.LEGACY_SYNC_API_KEY]);
  return migratedShared;
}

async function loadSavedValues() {
  const migratedShared = await migrateLegacySharedApiKeyIfNeeded();
  const localData = await chrome.storage.local.get([
    "webuiBaseUrl",
    STORAGE_KEYS.SHARED_API_KEY
  ]);

  const sharedKeyRaw = localData[STORAGE_KEYS.SHARED_API_KEY] || migratedShared || "";

  return {
    webuiBaseUrl:
      normalizeFieldValue(FIELD_BY_ID.webuiBaseUrl, localData.webuiBaseUrl) || DEFAULT_WEBUI_BASE_URL,
    sharedApiKey: normalizeFieldValue(FIELD_BY_ID.sharedApiKey, sharedKeyRaw)
  };
}

function buildFieldInput(field, value) {
  const input = document.createElement("input");
  input.dataset.fieldId = field.id;
  input.id = `field-${field.id}`;
  input.type = field.type === "password" ? "password" : field.type === "url" ? "url" : "text";
  input.placeholder = field.placeholder || "";
  input.value = value || "";
  input.autocomplete = "off";

  input.addEventListener("input", () => {
    state.draftValues[field.id] = normalizeFieldValue(field, input.value);
    state.dirty = true;
    updateGateUI();
  });

  return input;
}

function renderSettingsForm() {
  settingsForm.innerHTML = "";

  SETTINGS_FIELDS.forEach((field) => {
    const wrapper = document.createElement("div");
    wrapper.className = "field";

    const label = document.createElement("label");
    label.setAttribute("for", `field-${field.id}`);
    label.textContent = field.label;

    const input = buildFieldInput(field, state.draftValues[field.id]);
    wrapper.appendChild(label);
    wrapper.appendChild(input);

    if (field.helpText) {
      const help = document.createElement("div");
      help.className = "field-help";
      help.textContent = field.helpText;
      wrapper.appendChild(help);
    }

    settingsForm.appendChild(wrapper);
  });
}

function renderModuleCards() {
  moduleGrid.innerHTML = "";

  MODULES.forEach((module) => {
    const moduleMissing = getModuleMissingFieldIds(module, state.savedValues);
    const ready = moduleMissing.length === 0;

    const card = document.createElement("button");
    card.type = "button";
    card.className = `module-card ${ready ? "ready" : "blocked"}`;
    if (state.launchInProgress) card.classList.add("busy");
    card.disabled = !ready || state.launchInProgress;

    const head = document.createElement("div");
    head.className = "module-head";

    const title = document.createElement("span");
    title.className = "module-title";
    title.textContent = module.title;

    const chip = document.createElement("span");
    chip.className = "module-chip";
    chip.textContent = getLaunchTypeLabel(module.launchType);

    head.appendChild(title);
    head.appendChild(chip);

    const desc = document.createElement("p");
    desc.className = "module-desc";
    desc.textContent = module.description;

    const foot = document.createElement("div");
    foot.className = "module-foot";

    const launchType = document.createElement("span");
    launchType.className = "launch-type";
    launchType.textContent =
      module.launchType === "sidepanel" ? "현재 탭에 사이드바로 열림" : "기존 탭 전환 또는 새 탭 열기";

    const cta = document.createElement("span");
    cta.className = "launch-cta";
    cta.textContent = ready ? "열기" : "설정 필요";

    foot.appendChild(launchType);
    foot.appendChild(cta);

    card.appendChild(head);
    card.appendChild(desc);
    card.appendChild(foot);

    card.addEventListener("click", () => {
      void launchModule(module.id);
    });

    moduleGrid.appendChild(card);
  });
}

function updateGateUI() {
  const missing = getMissingRequiredFieldIds(state.savedValues);

  if (missing.length === 0) {
    setGateHint("모듈 카드를 눌러 바로 실행하세요.");
  } else {
    setGateHint("공통 API Key 저장 후 모듈을 실행할 수 있습니다.", "warn");
  }

  if (state.dirty) {
    setStatus(settingsStatus, "저장되지 않은 변경사항이 있습니다.", "warn");
  }

  renderModuleCards();
}

async function persistSettings(showSuccessMessage = true) {
  const values = collectFormValues();
  const missing = getMissingRequiredFieldIds(values);

  if (missing.length > 0) {
    const labels = missing.map((fieldId) => FIELD_BY_ID[fieldId]?.label || fieldId);
    setStatus(settingsStatus, `저장 실패: ${labels.join(", ")} 입력이 필요합니다.`, "error");
    return false;
  }

  const baseUrl = values.webuiBaseUrl || DEFAULT_WEBUI_BASE_URL;
  const sharedApiKey = values.sharedApiKey;

  try {
    await chrome.storage.local.set({
      webuiBaseUrl: baseUrl,
      [STORAGE_KEYS.SHARED_API_KEY]: sharedApiKey
    });
    await chrome.storage.local.remove([
      STORAGE_KEYS.LEGACY_WEBUI_API_KEY,
      STORAGE_KEYS.LEGACY_USER_TOKEN
    ]);
    await chrome.storage.sync.remove([STORAGE_KEYS.LEGACY_SYNC_API_KEY]);

    state.savedValues = { ...values, webuiBaseUrl: baseUrl };
    state.draftValues = { ...state.savedValues };
    state.dirty = false;

    if (showSuccessMessage) {
      setStatus(settingsStatus, "설정이 저장되었습니다.", "ok");
    }

    updateGateUI();
    return true;
  } catch (error) {
    setStatus(settingsStatus, `저장 실패: ${toErrorMessage(error)}`, "error");
    return false;
  }
}

async function reloadFromStorage(showMessage = true) {
  try {
    const loaded = await loadSavedValues();
    state.savedValues = { ...loaded };
    state.draftValues = { ...loaded };
    state.dirty = false;

    renderSettingsForm();
    updateGateUI();

    if (showMessage) {
      setStatus(settingsStatus, "저장된 설정을 불러왔습니다.", "ok");
    }
  } catch (error) {
    setStatus(settingsStatus, `불러오기 실패: ${toErrorMessage(error)}`, "error");
  }
}

function isSidePanelCompatibleTabUrl(url) {
  if (typeof url !== "string") return false;
  return url.startsWith("http://") || url.startsWith("https://");
}

async function createFallbackSidePanelTab() {
  const created = await chrome.tabs.create({
    url: FALLBACK_SIDEPANEL_HOST_URL,
    active: true
  });
  if (!Number.isInteger(created?.id)) {
    throw new Error("사이드바를 열 탭을 찾지 못했습니다.");
  }
  return created.id;
}

async function getActiveTabId(requireSidePanelCompatible = false) {
  let tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

  if (!tabs || tabs.length === 0 || !tabs[0]?.id) {
    tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  }

  const activeTab = tabs?.[0];
  const tabId = activeTab?.id;

  if (Number.isInteger(tabId) && (!requireSidePanelCompatible || isSidePanelCompatibleTabUrl(activeTab?.url))) {
    return tabId;
  }

  if (requireSidePanelCompatible && Number.isInteger(activeTab?.windowId)) {
    const sameWindowTabs = await chrome.tabs.query({ windowId: activeTab.windowId });
    const candidate = sameWindowTabs.find((tab) =>
      Number.isInteger(tab?.id) && isSidePanelCompatibleTabUrl(tab?.url)
    );
    if (candidate?.id) return candidate.id;

    const allTabs = await chrome.tabs.query({});
    const fallback = allTabs.find((tab) =>
      Number.isInteger(tab?.id) && isSidePanelCompatibleTabUrl(tab?.url)
    );
    if (fallback?.id) return fallback.id;

    return createFallbackSidePanelTab();
  }

  if (!Number.isInteger(tabId)) {
    throw new Error("활성 탭을 찾지 못했습니다.");
  }

  return tabId;
}

async function openSidePanel(path) {
  const tabId = await getActiveTabId(true);

  await chrome.sidePanel.setOptions({
    tabId,
    path,
    enabled: true
  });

  await chrome.sidePanel.open({ tabId });
}

function isSameModuleUrl(tabUrl, targetUrl) {
  if (typeof tabUrl !== "string") return false;
  return tabUrl === targetUrl || tabUrl.startsWith(`${targetUrl}?`) || tabUrl.startsWith(`${targetUrl}#`);
}

async function openOrFocusModuleTab(path) {
  const targetUrl = chrome.runtime.getURL(path);
  const tabs = await chrome.tabs.query({});

  const existing = tabs.find((tab) => isSameModuleUrl(tab.url, targetUrl));
  if (existing?.id) {
    if (Number.isInteger(existing.windowId)) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    await chrome.tabs.update(existing.id, { active: true });
    return "focused";
  }

  await chrome.tabs.create({ url: targetUrl });
  return "created";
}

async function launchViaServiceWorker(moduleId) {
  const response = await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.LAUNCH_MODULE,
    moduleId
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Unknown launch error");
  }
}

async function launchModule(moduleId) {
  const module = getModuleById(moduleId);
  if (!module) {
    setLaunchFeedback({ message: `알 수 없는 모듈: ${moduleId}`, tone: "error" });
    return;
  }

  if (state.launchInProgress) {
    setLaunchFeedback({ message: "다른 모듈 실행이 끝난 후 다시 시도해 주세요.", tone: "warn" });
    return;
  }

  const missing = getModuleMissingFieldIds(module, state.savedValues);
  if (missing.length > 0) {
    setLaunchFeedback({ message: "실행 전 공통 API Key를 먼저 저장해 주세요.", tone: "error" });
    openSettingsSheet();
    return;
  }

  state.launchInProgress = true;
  renderModuleCards();
  setLaunchFeedback({ message: `${module.title} 실행 중...`, tone: "loading" });

  try {
    if (module.launchType === "tab") {
      const tabMode = await openOrFocusModuleTab(module.path);
      if (tabMode === "focused") {
        setLaunchFeedback({ message: `${module.title} 기존 탭으로 이동했습니다.`, tone: "ok" });
      } else {
        setLaunchFeedback({ message: `${module.title} 새 탭을 열었습니다.`, tone: "ok" });
      }
      return;
    }

    if (module.launchType === "sidepanel") {
      try {
        await openSidePanel(module.path);
      } catch {
        await launchViaServiceWorker(module.id);
      }
      setLaunchFeedback({ message: `${module.title} 사이드바를 열었습니다.`, tone: "ok" });
      return;
    }

    throw new Error(`지원하지 않는 실행 방식: ${module.launchType}`);
  } catch (error) {
    setLaunchFeedback({
      message: `${module.title} 실행 실패: ${toErrorMessage(error)}`,
      tone: "error",
      showRetry: true,
      moduleId: module.id
    });
  } finally {
    state.launchInProgress = false;
    renderModuleCards();
  }
}

async function initialize() {
  await reloadFromStorage(false);

  if (state.savedValues.sharedApiKey) {
    await persistSettings(false);
  }

  const missing = getMissingRequiredFieldIds(state.savedValues);
  if (missing.length > 0) {
    openSettingsSheet();
    setStatus(settingsStatus, "공통 API Key를 저장하면 모든 모듈이 활성화됩니다.", "warn");
  }

  setLaunchFeedback();
}

settingsToggleBtn.addEventListener("click", () => {
  openSettingsSheet();
});

settingsCloseBtn.addEventListener("click", () => {
  closeSettingsSheet();
});

settingsBackdrop.addEventListener("click", () => {
  closeSettingsSheet();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSettingsSheet();
  }
});

saveSettingsBtn.addEventListener("click", async () => {
  await persistSettings(true);
});

reloadSettingsBtn.addEventListener("click", async () => {
  await reloadFromStorage(true);
});

retryLaunchBtn.addEventListener("click", async () => {
  if (!state.lastFailedModuleId) return;
  await launchModule(state.lastFailedModuleId);
});

initialize();
