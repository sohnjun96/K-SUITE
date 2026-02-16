import { runPipeline } from "../core/orchestrator.js";
import { buildQuery } from "../core/query_builder.js";
import { DEFAULT_NEAR_DISTANCE } from "../core/model_config.js";

const generateButton = document.getElementById("generateBtn");
const clearLogsButton = document.getElementById("clearLogsBtn");
const copyResultButton = document.getElementById("copyResultBtn");
const claimInput = document.getElementById("claimInput");
const claimCount = document.getElementById("claimCount");
const sampleButton = document.getElementById("sampleBtn");
const clearInputButton = document.getElementById("clearInputBtn");
const mockModeButton = document.getElementById("mockModeBtn");
const logDiv = document.getElementById("log");
const devLogDiv = document.getElementById("devLog");
const layerSummary = document.getElementById("layerSummary");
const resultOutput = document.getElementById("result");
const statusRail = document.getElementById("statusRail");
const statusText = document.getElementById("statusText");
const modeBadge = document.getElementById("modeBadge");
const statusSteps = Array.from(document.querySelectorAll(".status-step"));
const rerunButtons = Array.from(document.querySelectorAll("[data-rerun-layer]"));
const logTabButtons = Array.from(document.querySelectorAll("[data-log-tab]"));
const logPanels = Array.from(document.querySelectorAll("[data-log-panel]"));
const infoButtons = Array.from(document.querySelectorAll(".info-btn"));
const infoModal = document.getElementById("infoModal");
const infoModalTitle = document.getElementById("infoModalTitle");
const infoModalBody = document.getElementById("infoModalBody");
const modalCloseTriggers = Array.from(document.querySelectorAll("[data-modal-close]"));
const synonymEditor = document.getElementById("synonymEditor");
const resetEditorButton = document.getElementById("resetEditorBtn");
const breadthSlider = document.getElementById("breadthSlider");
const breadthLabel = document.getElementById("breadthLabel");
const queryPreview = document.getElementById("queryPreview");
const coreSynonymToggle = document.getElementById("coreSynonymToggle");
const coreSynonymState = document.getElementById("coreSynonymState");
const editorNote = document.querySelector("#synonymEditorCard .editor-note");

const summaryItems = new Map();
const stepMap = new Map(statusSteps.map((step) => [step.dataset.layer, step]));
const LAYER_ORDER = ["Layer 1", "Layer 2", "Layer 3"];
const LAYER_LABELS = {
  "Layer 1": "Layer 1 · 분석",
  "Layer 2": "Layer 2 · 확장",
  "Layer 3": "Layer 3 · 조립"
};

let currentLayer = null;
const PANEL_STORAGE_KEY = "sidepanelState";
const PANEL_STORAGE_VERSION = 1;
const MOCK_MODE_DEFAULT = true;
const CORE_SYNONYM_LOCK_DEFAULT = true;
const logEntries = [];
const devEntries = [];
let isRestoring = false;
let stateSaveTimer = null;
let unloadHookAdded = false;
let activeLogTab = "progress";
let currentMode = null;
let lastArtifacts = null;
let lastGeneratedQuery = "";
const selectedSynonymsById = new Map();
const BREADTH_DEFAULT = 40;
let isPipelineRunning = false;
let mockModeEnabled = MOCK_MODE_DEFAULT;
let coreSynonymLockEnabled = CORE_SYNONYM_LOCK_DEFAULT;

const SAMPLE_CLAIM = "제1 면에 배치되는 플렉서블 디스플레이 및 상기 디스플레이의 벤딩을 감지하는 센서부를 포함하는 장치.";
const INFO_CONTENT = {
  layer1: {
    title: "Layer 1 · 분석",
    body: "청구항에서 발명의 핵심 구성/기능을 뽑아 구조화합니다.\n- 핵심 구성요소/기능을 요소로 추출\n- 요소 간 관계(near/close 판단을 위한 단서) 정리\n- 모드 결정: 구성요소 중심(component) vs 결합구조 중심(structure)\n출력: elements + mode + mode_reason"
  },
  layer2: {
    title: "Layer 2 · 확장",
    body: "각 요소에 대한 유의어/약어/영문 표현을 생성하고 정제합니다.\n- 모델별 후보 생성\n- 맥락 적합성 평가 및 노이즈 제거\n- 요소별 최대 6개로 압축\nstructure 모드에서는 관계 표현에 적합한 핵심 용어만 우선 선택"
  },
  layer3: {
    title: "Layer 3 · 조립",
    body: "관계 정보를 반영해 최종 검색식을 조립합니다.\n- close 관계를 우선 NEAR로 결합\n- 나머지 요소는 AND로 결합\n- 불필요한 확장 억제, 전체 키워드 60개 이내 제한\nstructure 모드에서는 결합 관계를 더 강하게 반영"
  },
  ensemble: {
    title: "적응형 앙상블",
    body: "여러 모델 결과를 비교해 신뢰도 높은 후보만 채택합니다.\n- 모델별 성능 점수화\n- 낮은 점수 모델에 피드백 저장\n- 다음 실행에서 자동 보정"
  }
};

function getTimestamp() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function updateClaimMeta() {
  if (!claimInput || !claimCount) return;
  claimCount.textContent = `${claimInput.value.length} chars`;
}

function setMockMode(enabled, { persist = true } = {}) {
  mockModeEnabled = !!enabled;
  if (mockModeButton) {
    mockModeButton.textContent = mockModeEnabled ? "Mock: ON" : "Mock: OFF";
    mockModeButton.setAttribute("aria-pressed", mockModeEnabled ? "true" : "false");
    mockModeButton.dataset.state = mockModeEnabled ? "on" : "off";
  }
  if (persist) scheduleStateSave();
}

function refreshCoreSynonymUiState() {
  if (coreSynonymToggle instanceof HTMLInputElement) {
    coreSynonymToggle.checked = coreSynonymLockEnabled;
  }
  if (coreSynonymState) {
    coreSynonymState.textContent = coreSynonymLockEnabled ? "ON" : "OFF";
  }
  if (editorNote) {
    editorNote.textContent = coreSynonymLockEnabled
      ? "Core synonym lock is ON. Base term is always included."
      : "Core synonym lock is OFF. Base term can be disabled.";
  }
}

function setCoreSynonymLock(enabled, { persist = true, rebuild = true } = {}) {
  coreSynonymLockEnabled = !!enabled;
  refreshCoreSynonymUiState();
  if (persist) scheduleStateSave();
  if (rebuild && lastArtifacts) {
    applyEditorSelectionToQuery();
    renderSynonymEditor();
  }
}
function setModeBadge(mode) {
  currentMode = mode || null;
  if (!modeBadge) return;
  if (!mode) {
    modeBadge.textContent = "모드: 자동";
    modeBadge.dataset.mode = "auto";
    scheduleStateSave();
    return;
  }
  const label = mode === "structure" ? "결합구조" : "구성요소";
  modeBadge.textContent = `모드: ${label}`;
  modeBadge.dataset.mode = mode;
  scheduleStateSave();
}

function parseModeFromMessage(message) {
  if (!message) return null;
  if (message.includes("구조")) return "structure";
  if (message.includes("구성요소") || message.includes("구성 요소")) return "component";
  return null;
}

function setActiveLogTab(tabKey, { persist = true } = {}) {
  if (!tabKey) return;
  activeLogTab = tabKey;
  logTabButtons.forEach((button) => {
    const isActive = button.dataset.logTab === tabKey;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  logPanels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.logPanel === tabKey);
  });
  if (persist) scheduleStateSave();
}

function openInfoModal(key) {
  if (!infoModal || !infoModalTitle || !infoModalBody) return;
  const info = INFO_CONTENT[key];
  if (!info) return;
  infoModalTitle.textContent = info.title;
  infoModalBody.textContent = info.body;
  infoModal.classList.remove("is-hidden");
}

function closeInfoModal() {
  if (!infoModal) return;
  infoModal.classList.add("is-hidden");
}


function scheduleStateSave() {
  if (isRestoring) return;
  if (stateSaveTimer) clearTimeout(stateSaveTimer);
  stateSaveTimer = setTimeout(() => {
    stateSaveTimer = null;
    persistPanelState();
  }, 200);
}

function flushPanelState() {
  if (stateSaveTimer) {
    clearTimeout(stateSaveTimer);
    stateSaveTimer = null;
  }
  persistPanelState();
}

function buildStatusSnapshot() {
  const steps = {};
  LAYER_ORDER.forEach((layer) => {
    steps[layer] = stepMap.get(layer)?.dataset.state || "idle";
  });
  return {
    overallState: statusRail?.dataset.state || "idle",
    statusText: statusText?.textContent || "",
    steps,
    currentLayer,
    mode: currentMode
  };
}

function applyStatusSnapshot(snapshot) {
  if (!snapshot) return;
  if (statusRail && snapshot.overallState) statusRail.dataset.state = snapshot.overallState;
  if (statusText && typeof snapshot.statusText === "string") statusText.textContent = snapshot.statusText;
  if (snapshot.steps && typeof snapshot.steps === "object") {
    LAYER_ORDER.forEach((layer) => {
      if (snapshot.steps[layer]) setStepState(layer, snapshot.steps[layer]);
    });
  }
  currentLayer = snapshot.currentLayer || null;
  if (snapshot.mode) setModeBadge(snapshot.mode);
}

async function persistPanelState() {
  if (isRestoring) return;
  const snapshot = {
    version: PANEL_STORAGE_VERSION,
    claimText: claimInput?.value || "",
    resultText: resultOutput?.value || "",
    logs: logEntries,
    devEntries,
    status: buildStatusSnapshot(),
    activeLogTab,
    mockModeEnabled,
    coreSynonymLockEnabled,
    breadthValue: getBreadthValue()
  };

  try {
    await chrome.storage.local.set({ [PANEL_STORAGE_KEY]: snapshot });
  } catch {
    // Ignore storage errors.
  }
}

async function restorePanelState() {
  const wasRestoring = isRestoring;
  isRestoring = true;
  try {
    const data = await chrome.storage.local.get(PANEL_STORAGE_KEY);
    const snapshot = data[PANEL_STORAGE_KEY];
    if (!snapshot || snapshot.version !== PANEL_STORAGE_VERSION) return false;

    clearLogs({ persist: false });
    if (typeof snapshot.mockModeEnabled === "boolean") {
      setMockMode(snapshot.mockModeEnabled, { persist: false });
    } else {
      setMockMode(MOCK_MODE_DEFAULT, { persist: false });
    }
    if (typeof snapshot.coreSynonymLockEnabled === "boolean") {
      setCoreSynonymLock(snapshot.coreSynonymLockEnabled, { persist: false, rebuild: false });
    } else {
      setCoreSynonymLock(CORE_SYNONYM_LOCK_DEFAULT, { persist: false, rebuild: false });
    }
    if (typeof snapshot.claimText === "string") claimInput.value = snapshot.claimText;
    if (typeof snapshot.resultText === "string") resultOutput.value = snapshot.resultText;
    updateClaimMeta();

    if (Array.isArray(snapshot.logs)) {
      snapshot.logs.forEach((entry) => {
        if (entry && typeof entry.message === "string") {
          appendProgressLine(entry.message, entry.timestamp);
        }
      });
    }

    if (Array.isArray(snapshot.devEntries)) {
      snapshot.devEntries.forEach((entry) => {
        if (!entry || typeof entry !== "object") return;
        appendDevItem(entry);
        updateLayerSummary(entry);
      });
    }

    applyStatusSnapshot(snapshot.status);
    if (snapshot.activeLogTab) {
      setActiveLogTab(snapshot.activeLogTab, { persist: false });
    }
    if (breadthSlider && Number.isFinite(snapshot.breadthValue)) {
      breadthSlider.value = String(snapshot.breadthValue);
      updateBreadthLabel(snapshot.breadthValue);
    }
    return true;
  } catch {
    return false;
  } finally {
    isRestoring = wasRestoring;
  }
}

function setStepState(layerKey, state) {
  const step = stepMap.get(layerKey);
  if (!step) return;
  step.dataset.state = state;
}

function setOverallStatus(state, text) {
  if (!statusRail || !statusText) return;
  statusRail.dataset.state = state;
  statusText.textContent = text;
  scheduleStateSave();
}

function updateRerunButtonsState() {
  if (!rerunButtons || rerunButtons.length === 0) return;
  rerunButtons.forEach((button) => {
    const layer = button.dataset.rerunLayer;
    let disabled = isPipelineRunning;
    if (layer === "Layer 2" || layer === "Layer 3") {
      disabled = disabled || !lastArtifacts || !Array.isArray(lastArtifacts.elements);
    }
    if (layer === "Layer 3") {
      disabled = disabled || !lastArtifacts?.synonymsById || Object.keys(lastArtifacts.synonymsById).length === 0;
    }
    button.disabled = disabled;
  });
}

function resetPipelineStatus() {
  currentLayer = null;
  LAYER_ORDER.forEach((layer) => setStepState(layer, "idle"));
  setOverallStatus("idle", "대기 중");
  setModeBadge(null);
}

function updatePipelineStatus(layerKey) {
  const index = LAYER_ORDER.indexOf(layerKey);
  if (index === -1) return;

  currentLayer = layerKey;
  LAYER_ORDER.forEach((layer, idx) => {
    if (idx < index) {
      setStepState(layer, "done");
    } else if (idx === index) {
      setStepState(layer, "active");
    } else {
      setStepState(layer, "idle");
    }
  });

  const label = LAYER_LABELS[layerKey] || layerKey;
  setOverallStatus("running", `${label} 진행 중`);
}

function finalizePipelineStatus() {
  LAYER_ORDER.forEach((layer) => setStepState(layer, "done"));
  setOverallStatus("done", "완료");
  currentLayer = null;
}

function failPipelineStatus() {
  if (currentLayer) setStepState(currentLayer, "error");
  setOverallStatus("error", "오류 발생");
}

function normalizeLayer(layer) {
  if (!layer) return null;
  if (layer.startsWith("Layer 1")) return "Layer 1";
  if (layer.startsWith("Layer 2")) return "Layer 2";
  if (layer.startsWith("Layer 3")) return "Layer 3";
  return null;
}

function extractLayerKey(message) {
  if (!message) return null;
  const normalized = message.toLowerCase();
  if (normalized.includes("layer 1") || normalized.includes("레이어 1")) return "Layer 1";
  if (normalized.includes("layer 2") || normalized.includes("레이어 2")) return "Layer 2";
  if (normalized.includes("layer 3") || normalized.includes("레이어 3")) return "Layer 3";
  return null;
}

function appendProgressLine(message, timestamp = getTimestamp()) {
  if (!message) return;
  const line = document.createElement("div");
  line.className = "log-line";
  line.textContent = `[${timestamp}] ${message}`;
  logDiv.appendChild(line);
  logDiv.scrollTop = logDiv.scrollHeight;
  logEntries.push({ message, timestamp });
  scheduleStateSave();
}

function appendDevItem({ layer, stage, label, model, content, timestamp }) {
  const item = document.createElement("details");
  item.className = "dev-item";
  if (stage) item.dataset.stage = stage;

  const summary = document.createElement("summary");
  const parts = [];
  if (layer) parts.push(layer);
  if (label) parts.push(label);
  if (stage) parts.push(stage);
  if (model) parts.push(`model: ${model}`);
  const timeLabel = timestamp || getTimestamp();
  summary.textContent = `[${timeLabel}] ${parts.join(" | ")}`;

  const pre = document.createElement("pre");
  if (typeof content === "string") {
    pre.textContent = content;
  } else {
    pre.textContent = JSON.stringify(content, null, 2);
  }

  item.appendChild(summary);
  item.appendChild(pre);
  devLogDiv.appendChild(item);
  devLogDiv.scrollTop = devLogDiv.scrollHeight;
  devEntries.push({ layer, stage, label, model, content, timestamp: timeLabel });
  scheduleStateSave();
}

function clearLogs({ persist = true, keepArtifacts = false } = {}) {
  logDiv.innerHTML = "";
  devLogDiv.innerHTML = "";
  layerSummary.innerHTML = "";
  summaryItems.clear();
  logEntries.length = 0;
  devEntries.length = 0;
  resetPipelineStatus();
  if (!keepArtifacts) {
    lastArtifacts = null;
    lastGeneratedQuery = "";
    selectedSynonymsById.clear();
    renderSynonymEditor();
    if (breadthSlider) breadthSlider.disabled = true;
    renderQueryPreview();
  } else {
    updateRerunButtonsState();
  }
  if (persist) scheduleStateSave();
}

function parseJsonFromResponse(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue to extraction attempts.
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // Continue.
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch {
      // Continue.
    }
  }

  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    try {
      return JSON.parse(trimmed.slice(firstBracket, lastBracket + 1));
    } catch {
      // Ignore.
    }
  }

  return null;
}

function updateBreadthLabel(value = null) {
  if (!breadthLabel || !breadthSlider) return;
  const raw = value ?? Number.parseInt(breadthSlider.value, 10);
  const normalized = Number.isFinite(raw) ? raw : BREADTH_DEFAULT;
  let label = "보통";
  if (normalized <= 30) label = "넓게";
  if (normalized >= 70) label = "좁게";
  breadthLabel.textContent = label;
}

function getBreadthValue() {
  if (!breadthSlider) return BREADTH_DEFAULT;
  const value = Number.parseInt(breadthSlider.value, 10);
  return Number.isFinite(value) ? value : BREADTH_DEFAULT;
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeMatchValue(raw) {
  if (!raw) return null;
  const value = String(raw).trim().toLowerCase();
  if (!value) return null;
  if (value === "phrase" || value === "exact" || value === "quoted") return "phrase";
  if (value === "token" || value === "near" || value === "and") return "token";
  return null;
}

function sanitizeTerm(term) {
  return String(term || "").replace(/\"/g, "").replace(/\s+/g, " ").trim();
}

function normalizeParts(parts) {
  if (!Array.isArray(parts)) return [];
  return parts.map((part) => sanitizeTerm(part)).filter(Boolean);
}

function formatSynonymForPreview(item, element) {
  const resolved = typeof item === "string" ? { term: item } : item || {};
  const term = sanitizeTerm(resolved.term || "");
  if (!term) return null;
  const match = normalizeMatchValue(resolved.match);
  const parts = normalizeParts(resolved.parts);

  if (match === "phrase") {
    return `"${term}"`;
  }

  if (parts.length > 0) {
    return parts.join("+");
  }

  if (element?.type === "compound" && Array.isArray(element.parts) && element.parts.length > 0 && term === element.term) {
    return element.parts.map((part) => sanitizeTerm(part)).filter(Boolean).join("+");
  }

  if (/\s/.test(term)) {
    return term.split(/\s+/).join("+");
  }

  return term;
}

function buildGroupForPreview(element, synonyms) {
  const formatted = [];
  const seen = new Set();
  (synonyms || []).forEach((item) => {
    const value = formatSynonymForPreview(item, element);
    if (!value || seen.has(value)) return;
    seen.add(value);
    formatted.push(value);
  });

  if (formatted.length === 0) return "";
  if (formatted.length === 1) return `(${formatted[0]})`;
  return `(${formatted.join(" | ")})`;
}

function normalizeNearValue(value, fallback) {
  if (Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const num = Number.parseInt(value, 10);
    if (Number.isFinite(num)) return num;
  }
  return fallback;
}

function getGroupColorClass(index) {
  const palette = ["hl-color-1", "hl-color-2", "hl-color-3", "hl-color-4", "hl-color-5", "hl-color-6", "hl-color-7", "hl-color-8"];
  return palette[index % palette.length];
}

function formatSynonymItem(item) {
  if (typeof item === "string") return item;
  if (item && typeof item.term === "string") {
    if (Array.isArray(item.parts) && item.parts.length > 0) {
      return `${item.term} (parts: ${item.parts.join("+")})`;
    }
    return item.term;
  }
  return JSON.stringify(item);
}

function normalizeSynonymKey(item) {
  if (typeof item === "string") {
    return item.trim().toLowerCase();
  }
  if (!item || typeof item !== "object") return "";
  const term = String(item.term || "").trim().toLowerCase();
  const parts = Array.isArray(item.parts) ? item.parts.map((part) => String(part || "").trim().toLowerCase()) : [];
  const match = item.match ? String(item.match).trim().toLowerCase() : "";
  return JSON.stringify({ term, parts, match });
}

function normalizeTermKey(term) {
  return String(term || "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-_]+/g, "");
}

function isBaseSynonym(item, element) {
  if (!element?.term) return false;
  const term = typeof item === "string" ? item : item?.term;
  if (!term) return false;
  return normalizeTermKey(term) === normalizeTermKey(element.term);
}

function formatSynonymDisplay(item) {
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object") return "";
  const term = item.term || "";
  if (Array.isArray(item.parts) && item.parts.length > 0) {
    return `${term} (${item.parts.join("+")})`;
  }
  return term || "";
}

function relaxPhraseMatch(item, relax) {
  if (!relax || !item || typeof item !== "object") return item;
  const matchValue = String(item.match || "").toLowerCase();
  if (matchValue !== "phrase") return item;
  const { match, ...rest } = item;
  return { ...rest };
}

function applyBreadthToSynonyms(items, element, breadthValue, { forceBase = true } = {}) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const ratio = 1 - Math.min(Math.max(breadthValue, 0), 100) / 100;
  const keepCount = Math.min(items.length, Math.max(1, Math.round(items.length * ratio)));
  const relaxPhrase = breadthValue <= 30;
  const kept = [];
  const hasBase = forceBase && items.some((item) => isBaseSynonym(item, element));
  if (hasBase) {
    const baseItem = items.find((item) => isBaseSynonym(item, element));
    if (baseItem) kept.push(baseItem);
  }
  for (const item of items) {
    if (kept.length >= keepCount) break;
    if (forceBase && isBaseSynonym(item, element)) continue;
    kept.push(item);
  }
  return kept.map((item) => relaxPhraseMatch(item, relaxPhrase));
}

function resetEditorSelection() {
  selectedSynonymsById.clear();
  if (!lastArtifacts) return;
  lastArtifacts.elements.forEach((element) => {
    const synonyms = lastArtifacts.synonymsById?.[element.id] || [];
    const set = new Set();
    synonyms.forEach((item) => {
      const key = normalizeSynonymKey(item);
      if (key) set.add(key);
    });
    selectedSynonymsById.set(element.id, set);
  });
}

function buildFilteredSynonymsById() {
  if (!lastArtifacts) return {};
  const breadthValue = getBreadthValue();
  const filteredSynonymsById = {};
  lastArtifacts.elements.forEach((element) => {
    const synonyms = lastArtifacts.synonymsById?.[element.id] || [];
    const selected = selectedSynonymsById.get(element.id) || new Set();
    const pool = synonyms.filter((item) => {
      const key = normalizeSynonymKey(item);
      if (!key) return false;
      if (isBaseSynonym(item, element)) {
        return coreSynonymLockEnabled || selected.has(key);
      }
      return selected.has(key);
    });
    filteredSynonymsById[element.id] = applyBreadthToSynonyms(pool, element, breadthValue, {
      forceBase: coreSynonymLockEnabled
    });
  });
  return filteredSynonymsById;
}

function applyEditorSelectionToQuery() {
  if (!lastArtifacts) return;
  const filteredSynonymsById = buildFilteredSynonymsById();
  const rebuilt = buildQuery({
    elements: lastArtifacts.elements,
    relations: Array.isArray(lastArtifacts.relations) ? lastArtifacts.relations : [],
    synonymsById: filteredSynonymsById,
    nearDistance: DEFAULT_NEAR_DISTANCE
  });
  resultOutput.value = rebuilt;
  scheduleStateSave();
  renderQueryPreview();
}

function handleSynonymToggle(event) {
  const checkbox = event.target;
  if (!(checkbox instanceof HTMLInputElement)) return;
  const elementId = checkbox.dataset.elementId;
  const synKey = checkbox.dataset.synKey;
  if (!elementId || !synKey) return;
  const current = selectedSynonymsById.get(elementId) || new Set();
  if (checkbox.checked) {
    current.add(synKey);
  } else {
    current.delete(synKey);
  }
  selectedSynonymsById.set(elementId, current);
  applyEditorSelectionToQuery();
  renderSynonymEditor();
}

function selectAllSynonyms(elementId) {
  if (!lastArtifacts) return;
  const synonyms = lastArtifacts.synonymsById?.[elementId] || [];
  const set = new Set();
  synonyms.forEach((item) => {
    const key = normalizeSynonymKey(item);
    if (key) set.add(key);
  });
  selectedSynonymsById.set(elementId, set);
  applyEditorSelectionToQuery();
  renderSynonymEditor();
}

function clearSynonyms(elementId) {
  selectedSynonymsById.set(elementId, new Set());
  applyEditorSelectionToQuery();
  renderSynonymEditor();
}

function renderSynonymEditor() {
  if (!synonymEditor) return;
  synonymEditor.innerHTML = "";
  if (resetEditorButton) resetEditorButton.disabled = !lastArtifacts || isPipelineRunning;
  if (breadthSlider) breadthSlider.disabled = !lastArtifacts || isPipelineRunning;
  updateRerunButtonsState();

  if (!lastArtifacts || !Array.isArray(lastArtifacts.elements) || lastArtifacts.elements.length === 0) {
    const empty = document.createElement("div");
    empty.className = "synonym-empty";
    empty.textContent = "검색식 생성 후 표시됩니다.";
    synonymEditor.appendChild(empty);
    return;
  }

  const disableInputs = isPipelineRunning;
  lastArtifacts.elements.forEach((element) => {
    const synonyms = lastArtifacts.synonymsById?.[element.id] || [];
    const selected = selectedSynonymsById.get(element.id) || new Set();
    const totalCount = synonyms.length;
    const selectedCount = synonyms.filter((item) => {
      const key = normalizeSynonymKey(item);
      if (!key) return false;
      if (isBaseSynonym(item, element)) {
        return coreSynonymLockEnabled || selected.has(key);
      }
      return selected.has(key);
    }).length;

    const row = document.createElement("div");
    row.className = "synonym-row";

    const head = document.createElement("div");
    head.className = "synonym-head";

    const title = document.createElement("div");
    title.className = "synonym-title";
    title.textContent = `${element.id || "?"} · ${element.term || ""}`;

    const meta = document.createElement("div");
    meta.className = "synonym-meta";
    meta.textContent = `선택 ${selectedCount}/${totalCount}`;

    const actions = document.createElement("div");
    actions.className = "synonym-actions";

    const selectAllBtn = document.createElement("button");
    selectAllBtn.type = "button";
    selectAllBtn.className = "btn ghost tiny";
    selectAllBtn.textContent = "전체 선택";
    selectAllBtn.disabled = disableInputs;
    selectAllBtn.addEventListener("click", () => selectAllSynonyms(element.id));

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "btn ghost tiny";
    clearBtn.textContent = "모두 해제";
    clearBtn.disabled = disableInputs;
    clearBtn.addEventListener("click", () => clearSynonyms(element.id));

    actions.appendChild(selectAllBtn);
    actions.appendChild(clearBtn);

    head.appendChild(title);
    head.appendChild(meta);
    head.appendChild(actions);

    const list = document.createElement("div");
    list.className = "synonym-list";

    if (synonyms.length === 0) {
      const empty = document.createElement("div");
      empty.className = "synonym-empty";
      empty.textContent = "유의어 없음";
      list.appendChild(empty);
    } else {
      synonyms.forEach((item) => {
        const key = normalizeSynonymKey(item);
        if (!key) return;
        const isBase = isBaseSynonym(item, element);
        const isForcedBase = isBase && coreSynonymLockEnabled;
        const label = document.createElement("label");
        label.className = `synonym-chip${isForcedBase ? " is-disabled" : ""}`;

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = isForcedBase ? true : selected.has(key);
        checkbox.disabled = isForcedBase || disableInputs;
        checkbox.dataset.elementId = element.id;
        checkbox.dataset.synKey = key;
        checkbox.addEventListener("change", handleSynonymToggle);

        const text = document.createElement("span");
        text.textContent = formatSynonymDisplay(item);

        label.appendChild(checkbox);
        label.appendChild(text);

        if (isBase) {
          const pill = document.createElement("span");
          pill.className = "synonym-pill";
          pill.textContent = coreSynonymLockEnabled ? "required" : "core";
          label.appendChild(pill);
        } else if (item && typeof item === "object" && String(item.match || "").toLowerCase() === "phrase") {
          const pill = document.createElement("span");
          pill.className = "synonym-pill";
          pill.textContent = "phrase";
          label.appendChild(pill);
        }

        list.appendChild(label);
      });
    }

    row.appendChild(head);
    row.appendChild(list);
    synonymEditor.appendChild(row);
  });
}

function renderQueryPreview() {
  if (!queryPreview) return;
  if (!lastArtifacts || !Array.isArray(lastArtifacts.elements) || lastArtifacts.elements.length === 0) {
    queryPreview.textContent = "검색식 생성 후 표시됩니다.";
    queryPreview.classList.add("is-empty");
    return;
  }

  const filteredSynonymsById = buildFilteredSynonymsById();
  const groupById = {};
  lastArtifacts.elements.forEach((element, index) => {
    const synonyms = filteredSynonymsById[element.id] || [];
    const group = buildGroupForPreview(element, synonyms);
    if (group) {
      groupById[element.id] = {
        text: group,
        colorClass: getGroupColorClass(index),
        label: element.term || element.id
      };
    }
  });

  const closeRelations = (lastArtifacts.relations || []).filter((rel) => rel.distance === "close");
  const usedIds = new Set();
  const parts = [];

  closeRelations.forEach((rel) => {
    const left = groupById[rel.source];
    const right = groupById[rel.target];
    if (!left || !right) return;
    usedIds.add(rel.source);
    usedIds.add(rel.target);
    const nearValue = normalizeNearValue(rel.near, DEFAULT_NEAR_DISTANCE);
    parts.push({ type: "near", left, right, nearValue });
  });

  lastArtifacts.elements.forEach((element) => {
    if (usedIds.has(element.id)) return;
    const group = groupById[element.id];
    if (group) parts.push({ type: "group", group });
  });

  if (parts.length === 0) {
    queryPreview.textContent = "미리보기용 그룹이 없습니다.";
    queryPreview.classList.add("is-empty");
    return;
  }

  const htmlParts = [];
  parts.forEach((part, index) => {
    if (index > 0) {
      htmlParts.push('<span class="query-operator"> &amp; </span>');
    }
    if (part.type === "group") {
      const safeGroup = escapeHtml(part.group.text);
      const safeLabel = escapeHtml(part.group.label);
      htmlParts.push(`<span class="hl-group ${part.group.colorClass}" title="${safeLabel}">${safeGroup}</span>`);
      return;
    }
    if (part.type === "near") {
      const leftGroup = `<span class="hl-group ${part.left.colorClass}" title="${escapeHtml(part.left.label)}">${escapeHtml(part.left.text)}</span>`;
      const rightGroup = `<span class="hl-group ${part.right.colorClass}" title="${escapeHtml(part.right.label)}">${escapeHtml(part.right.text)}</span>`;
      const nearToken = `<span class="query-operator"> &lt;near/${part.nearValue}&gt; </span>`;
      htmlParts.push(`${leftGroup}${nearToken}${rightGroup}`);
    }
  });

  queryPreview.classList.remove("is-empty");
  queryPreview.innerHTML = htmlParts.join("");
}

function buildSummaryContent(parsed, fallbackText) {
  if (Array.isArray(parsed)) {
    return {
      type: "list",
      items: parsed.map(formatSynonymItem)
    };
  }

  if (parsed && typeof parsed === "object") {
    if (Array.isArray(parsed.elements)) {
      return {
        type: "list",
        items: parsed.elements.map((element) => {
          const parts = Array.isArray(element.parts) ? ` (parts: ${element.parts.join("+")})` : "";
          return `${element.id || "?"}: ${element.term || ""}${element.type ? ` [${element.type}]` : ""}${parts}`;
        })
      };
    }

    if (Array.isArray(parsed.relations)) {
      return {
        type: "list",
        items: parsed.relations.map((rel) => {
          const near = rel.near ? `, near=${rel.near}` : "";
          return `${rel.source || "?"} -> ${rel.target || "?"} (${rel.distance || "co-exist"}${near})`;
        })
      };
    }

    const synonyms = parsed.best_synonyms || parsed.synonyms || parsed.terms;
    if (Array.isArray(synonyms)) {
      const items = synonyms.map(formatSynonymItem);
      if (parsed.scores && typeof parsed.scores === "object") {
        const scorePairs = Object.entries(parsed.scores).map(([key, value]) => `${key}=${value}`);
        if (scorePairs.length > 0) items.push(`scores: ${scorePairs.join(", ")}`);
      }
      return {
        type: "list",
        items
      };
    }

    if (typeof parsed.final_query === "string") {
      return { type: "pre", content: parsed.final_query };
    }

    if (typeof parsed.query_structure === "string") {
      return { type: "pre", content: parsed.query_structure };
    }

    return { type: "pre", content: JSON.stringify(parsed, null, 2) };
  }

  return { type: "pre", content: fallbackText || "" };
}

function upsertSummaryCard(key, title, meta, content) {
  let card = summaryItems.get(key);
  if (!card) {
    card = document.createElement("div");
    card.className = "summary-card";
    summaryItems.set(key, card);
  }

  card.innerHTML = "";

  const heading = document.createElement("div");
  heading.className = "summary-title";
  heading.textContent = title;

  const metaLine = document.createElement("div");
  metaLine.className = "summary-meta";
  metaLine.textContent = meta;

  card.appendChild(heading);
  card.appendChild(metaLine);

  if (content.type === "list") {
    const list = document.createElement("ul");
    list.className = "summary-list";
    content.items.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      list.appendChild(li);
    });
    card.appendChild(list);
  } else {
    const pre = document.createElement("pre");
    pre.className = "summary-pre";
    pre.textContent = content.content;
    card.appendChild(pre);
  }

  layerSummary.appendChild(card);
  layerSummary.scrollTop = layerSummary.scrollHeight;
}

function updateLayerSummary(entry) {
  if (!entry || typeof entry !== "object") return;
  if (entry.stage !== "response" && entry.stage !== "assembly") return;
  const allowedLayers = new Set(["Layer 1", "Layer 2-B", "Layer 3"]);
  if (!allowedLayers.has(entry.layer)) return;

  const key = `${entry.layer || "layer"}:${entry.label || "response"}`;
  const parsed = parseJsonFromResponse(entry.content);
  const titleParts = [entry.layer, entry.label].filter(Boolean);
  const title = titleParts.length > 0 ? titleParts.join(" | ") : "응답";
  const metaParts = [];
  if (entry.model) metaParts.push(`모델: ${entry.model}`);
  if (entry.stage) metaParts.push(`단계: ${entry.stage}`);
  const meta = metaParts.join(" | ") || "";

  const content = buildSummaryContent(parsed, typeof entry.content === "string" ? entry.content : "");
  upsertSummaryCard(key, title, meta, content);
}

function handleArtifact(entry) {
  if (!entry || typeof entry !== "object") return;
  const payload = entry.payload;
  if (!payload || typeof payload !== "object") return;

  const elements = Array.isArray(payload.elements) ? payload.elements : [];
  const relations = Array.isArray(payload.relations) ? payload.relations : [];
  const synonymsById = payload.synonymsById && typeof payload.synonymsById === "object"
    ? payload.synonymsById
    : {};

  if (elements.length === 0 || Object.keys(synonymsById).length === 0) return;

  lastArtifacts = {
    elements,
    relations,
    synonymsById,
    mode: payload.mode || null
  };
  resetEditorSelection();
  updateBreadthLabel();
  renderSynonymEditor();
  renderQueryPreview();
}

function handleLog(entry) {
  if (typeof entry === "string") {
    appendProgressLine(entry);
    const layerKey = extractLayerKey(entry);
    if (layerKey) updatePipelineStatus(layerKey);
    const mode = parseModeFromMessage(entry);
    if (mode) setModeBadge(mode);
    return;
  }

  if (!entry || typeof entry !== "object") return;

  if (entry.type === "artifact") {
    handleArtifact(entry);
    return;
  }

  if (entry.type === "progress") {
    appendProgressLine(entry.message || "");
    const layerKey = extractLayerKey(entry.message || "");
    if (layerKey) updatePipelineStatus(layerKey);
    const mode = parseModeFromMessage(entry.message || "");
    if (mode) setModeBadge(mode);
    return;
  }

  if (entry.type === "dev") {
    appendDevItem(entry);
    updateLayerSummary(entry);
    if (entry.label === "Pipeline Mode" && entry.content?.mode) {
      setModeBadge(entry.content.mode);
    }
    const normalizedLayer = normalizeLayer(entry.layer);
    if (normalizedLayer) updatePipelineStatus(normalizedLayer);
    return;
  }

  appendProgressLine(JSON.stringify(entry));
}

function setLoading(isLoading) {
  generateButton.disabled = isLoading;
  generateButton.textContent = isLoading ? "생성 중..." : "검색식 생성";
  if (copyResultButton) copyResultButton.disabled = isLoading;
  isPipelineRunning = isLoading;
  if (breadthSlider) breadthSlider.disabled = isLoading || !lastArtifacts;
  if (resetEditorButton) resetEditorButton.disabled = isLoading || !lastArtifacts;
  updateRerunButtonsState();
}

async function rerunLayer(layerKey) {
  const claim = claimInput.value.trim();
  if (!claim) {
    appendProgressLine("청구항을 입력하세요.");
    return;
  }

  if ((layerKey === "Layer 2" || layerKey === "Layer 3") && !lastArtifacts) {
    appendProgressLine("재실행할 기존 결과가 없습니다.");
    return;
  }

  const options = { startLayer: layerKey, mockMode: mockModeEnabled };
  if (layerKey === "Layer 2" || layerKey === "Layer 3") {
    options.elements = lastArtifacts.elements;
    options.relations = lastArtifacts.relations;
    options.mode = lastArtifacts.mode;
  }
  if (layerKey === "Layer 3") {
    options.synonymsById = buildFilteredSynonymsById();
  }

  clearLogs({ keepArtifacts: true });
  renderQueryPreview();
  setOverallStatus("running", "요청 준비 중");
  setLoading(true);

  try {
    appendProgressLine(`${layerKey} 재실행 시작`);
    const result = await runPipeline(claim, handleLog, options);
    resultOutput.value = result;
    lastGeneratedQuery = result;
    scheduleStateSave();
    renderQueryPreview();
    appendProgressLine("검색식을 생성했습니다.");
    finalizePipelineStatus();
  } catch (error) {
    appendProgressLine(`오류: ${error.message}`);
    failPipelineStatus();
  } finally {
    setLoading(false);
  }
}

async function ensureSharedKeyAvailable() {
  if (mockModeEnabled) return;
  const data = await chrome.storage.local.get("ksuiteSharedApiKey");
  const key = String(data.ksuiteSharedApiKey || "").trim();
  if (!key) {
    appendProgressLine("공통 API 키가 없습니다. K-SUITE 팝업 설정에서 먼저 저장해 주세요.");
  }
}


if (claimInput) {
  claimInput.addEventListener("input", () => {
    updateClaimMeta();
    scheduleStateSave();
  });
}

if (sampleButton && claimInput) {
  sampleButton.addEventListener("click", () => {
    claimInput.value = SAMPLE_CLAIM;
    updateClaimMeta();
    scheduleStateSave();
    claimInput.focus();
  });
}

if (clearInputButton && claimInput) {
  clearInputButton.addEventListener("click", () => {
    claimInput.value = "";
    updateClaimMeta();
    scheduleStateSave();
    claimInput.focus();
  });
}

if (mockModeButton) {
  mockModeButton.addEventListener("click", async () => {
    const next = !mockModeEnabled;
    setMockMode(next);
    appendProgressLine(next ? "Mock mode enabled." : "Mock mode disabled.");
    if (!next) {
      await ensureSharedKeyAvailable();
    }
  });
}

if (coreSynonymToggle instanceof HTMLInputElement) {
  coreSynonymToggle.addEventListener("change", () => {
    setCoreSynonymLock(coreSynonymToggle.checked);
    appendProgressLine(
      coreSynonymLockEnabled
        ? "Core synonym lock enabled: base term forced."
        : "Core synonym lock disabled: base term can be removed."
    );
  });
}

if (logTabButtons.length > 0) {
  logTabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveLogTab(button.dataset.logTab);
    });
  });
}

if (breadthSlider) {
  breadthSlider.addEventListener("input", () => {
    updateBreadthLabel();
    scheduleStateSave();
    if (lastArtifacts) {
      applyEditorSelectionToQuery();
      renderSynonymEditor();
    }
  });
}

if (infoButtons.length > 0) {
  infoButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.infoKey;
      openInfoModal(key);
    });
  });
}

if (modalCloseTriggers.length > 0) {
  modalCloseTriggers.forEach((trigger) => {
    trigger.addEventListener("click", () => {
      closeInfoModal();
    });
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeInfoModal();
});

if (copyResultButton) {
  copyResultButton.addEventListener("click", async () => {
    const text = resultOutput.value.trim();
    if (!text) {
      appendProgressLine("복사할 검색식이 없습니다.");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      appendProgressLine("검색식을 복사했습니다.");
    } catch {
      resultOutput.focus();
      resultOutput.select();
      const success = document.execCommand("copy");
      appendProgressLine(success ? "검색식을 복사했습니다." : "복사에 실패했습니다.");
      resultOutput.setSelectionRange(0, 0);
    }
  });
}

clearLogsButton.addEventListener("click", () => {
  clearLogs();
});

if (rerunButtons.length > 0) {
  rerunButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const layer = button.dataset.rerunLayer;
      if (layer) rerunLayer(layer);
    });
  });
}

if (resetEditorButton) {
  resetEditorButton.addEventListener("click", () => {
    if (!lastArtifacts) return;
    resetEditorSelection();
    renderSynonymEditor();
    if (lastGeneratedQuery) {
      resultOutput.value = lastGeneratedQuery;
      scheduleStateSave();
    } else {
      applyEditorSelectionToQuery();
    }
  });
}

generateButton.addEventListener("click", async () => {
  const claim = claimInput.value.trim();
  if (!claim) {
    appendProgressLine("청구항을 입력하세요.");
    return;
  }

  clearLogs();
  setOverallStatus("running", "요청 준비 중");
  setLoading(true);

  try {
    const result = await runPipeline(claim, handleLog, { mockMode: mockModeEnabled });
    resultOutput.value = result;
    lastGeneratedQuery = result;
    scheduleStateSave();
    renderQueryPreview();
    appendProgressLine("검색식이 생성되었습니다.");
    finalizePipelineStatus();
  } catch (error) {
    appendProgressLine(`오류: ${error.message}`);
    failPipelineStatus();
  } finally {
    setLoading(false);
  }
});

async function initialize() {
  isRestoring = true;
  setMockMode(MOCK_MODE_DEFAULT, { persist: false });
  setCoreSynonymLock(CORE_SYNONYM_LOCK_DEFAULT, { persist: false, rebuild: false });
  await ensureSharedKeyAvailable();
  await restorePanelState();
  isRestoring = false;
  updateClaimMeta();
  updateBreadthLabel();
  if (breadthSlider && !lastArtifacts) {
    breadthSlider.disabled = true;
  }
  renderSynonymEditor();
  renderQueryPreview();
  if (logTabButtons.length > 0) {
    setActiveLogTab(activeLogTab, { persist: false });
  }

  if (!unloadHookAdded) {
    unloadHookAdded = true;
    window.addEventListener("pagehide", flushPanelState);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushPanelState();
    });
  }
}

initialize();
