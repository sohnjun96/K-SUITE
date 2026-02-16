const appTextEl = document.getElementById("appText");
const statusEl = document.getElementById("status");

const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");

const promptTplEl = document.getElementById("promptTpl");

const STORAGE_KEYS = {
  token: "ksuiteSharedApiKey",
  appText: "application_text",
  promptTpl: "prompt_template"
};

const DEFAULT_TEMPLATE_PATH = "modules/k-scan/prompts/default.txt";
const DEFAULT_TEMPLATE_FALLBACK = "text1 {출원발명} text2 {인용발명} text3";

let defaultTemplatePromise = null;

function getDefaultTemplate() {
  if (!defaultTemplatePromise) {
    defaultTemplatePromise = fetch(chrome.runtime.getURL(DEFAULT_TEMPLATE_PATH))
      .then((res) => (res.ok ? res.text() : DEFAULT_TEMPLATE_FALLBACK))
      .catch(() => DEFAULT_TEMPLATE_FALLBACK);
  }
  return defaultTemplatePromise;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function isCapturableTab(tab) {
  if (!tab?.id) return false;
  const url = String(tab?.url || "");
  return url.startsWith("http://") || url.startsWith("https://");
}

async function sendRuntimeMessageWithTimeout(payload, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error("백그라운드 응답 시간 초과"));
    }, timeoutMs);

    try {
      chrome.runtime.sendMessage(payload, (resp) => {
        if (done) return;
        done = true;
        clearTimeout(timer);

        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message || "백그라운드 메시지 오류"));
          return;
        }

        resolve(resp);
      });
    } catch (error) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(error);
    }
  });
}

async function getActiveTab() {
  let tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

  if (!tabs || tabs.length === 0 || !tabs[0]?.id) {
    tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  }

  const active = tabs?.[0] || null;
  if (isCapturableTab(active)) return active;

  if (Number.isInteger(active?.windowId)) {
    const sameWindowTabs = await chrome.tabs.query({ windowId: active.windowId });
    const fallback = sameWindowTabs.find(isCapturableTab);
    if (fallback) return fallback;
  }

  return active;
}

async function getSharedToken() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.token);
  return String(data[STORAGE_KEYS.token] || "").trim();
}

async function loadSaved() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.appText,
    STORAGE_KEYS.promptTpl
  ]);

  appTextEl.value = data[STORAGE_KEYS.appText] ?? "";

  const savedTpl = data[STORAGE_KEYS.promptTpl];
  if (typeof savedTpl === "string" && savedTpl.trim()) {
    promptTplEl.value = savedTpl;
  } else {
    promptTplEl.value = await getDefaultTemplate();
  }
}

async function saveNow() {
  const defaultTpl = await getDefaultTemplate();

  await chrome.storage.local.set({
    [STORAGE_KEYS.appText]: appTextEl.value,
    [STORAGE_KEYS.promptTpl]: promptTplEl.value || defaultTpl
  });
}

promptTplEl.addEventListener("input", () => {
  void saveNow();
});

appTextEl.addEventListener("input", () => {
  void saveNow();
});

startBtn.addEventListener("click", async () => {
  await saveNow();

  const token = await getSharedToken();
  const appText = appTextEl.value.trim();

  if (!token) {
    setStatus("공통 API Key가 없습니다. K-SUITE 팝업에서 먼저 저장해 주세요.");
    return;
  }

  if (!appText) {
    setStatus("출원발명 텍스트를 입력해 주세요.");
    return;
  }

  const tab = await getActiveTab();
  if (!tab?.id) {
    setStatus("활성 탭을 찾지 못했습니다.");
    return;
  }

  setStatus("캡처 시작 중...");

  let resp;
  try {
    resp = await sendRuntimeMessageWithTimeout({
      type: "START_CAPTURE",
      tabId: tab.id
    }, 12000);
  } catch (error) {
    const message = error?.message || String(error);
    setStatus(`실패: ${message}`);
    return;
  }

  if (resp?.ok) {
    setStatus("캡처 중... 응답을 기다리는 중입니다.");
  } else if (resp) {
    setStatus(`실패: ${resp?.error ?? "알 수 없는 오류"}`);
  } else {
    setStatus("실패: 백그라운드 응답이 없습니다.");
  }
});

stopBtn.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab?.id) {
    setStatus("활성 탭을 찾지 못했습니다.");
    return;
  }

  setStatus("캡처 중지 요청 중...");

  let resp;
  try {
    resp = await sendRuntimeMessageWithTimeout({
      type: "STOP_CAPTURE",
      tabId: tab.id
    }, 12000);
  } catch (error) {
    const message = error?.message || String(error);
    setStatus(`실패: ${message}`);
    return;
  }

  if (resp?.ok) {
    setStatus("중지했습니다.");
  } else if (resp) {
    setStatus(`실패: ${resp?.error ?? "알 수 없는 오류"}`);
  } else {
    setStatus("실패: 백그라운드 응답이 없습니다.");
  }
});

loadSaved().catch(() => {
  setStatus("저장값을 불러오지 못했습니다.");
});
