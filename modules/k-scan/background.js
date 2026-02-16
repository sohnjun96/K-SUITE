const DEFAULT_WEBUI_BASE_URL = "http://10.133.111.32:8080";
const CHAT_COMPLETIONS_PATH = "/api/chat/completions";
const MODEL_NAME = String(globalThis.KSUITE_DEFAULT_LLM_MODEL || "").trim();
if (!MODEL_NAME) {
  throw new Error("K-SUITE default model is not initialized.");
}
const HISTORY_KEY = "bp_history_v1";

let resultWindowId = null;

// tabId -> { attached: boolean }
const attachedTabs = new Map();

// tabId -> Map(requestId -> meta)
const pending = new Map();

// 중복 방지(짧은 시간에 같은 body 반복)
const lastSeenByTab = new Map(); // tabId -> { sig, ts }


const TEMPLATE_KEY = "prompt_template";
const DEFAULT_TEMPLATE_PATH = "modules/k-scan/prompts/default.txt";
const DEFAULT_TEMPLATE_FALLBACK = "text1 {출원발명} text2 {인용발명} text3";
let defaultTemplatePromise = null;

async function getApiUrl() {
  const data = await chrome.storage.local.get(["webuiBaseUrl"]);
  const baseUrl = String(data.webuiBaseUrl || DEFAULT_WEBUI_BASE_URL)
    .trim()
    .replace(/\/+$/, "");
  return `${baseUrl}${CHAT_COMPLETIONS_PATH}`;
}

function getDefaultTemplate() {
  if (!defaultTemplatePromise) {
    defaultTemplatePromise = fetch(chrome.runtime.getURL(DEFAULT_TEMPLATE_PATH))
      .then((res) => (res.ok ? res.text() : DEFAULT_TEMPLATE_FALLBACK))
      .catch(() => DEFAULT_TEMPLATE_FALLBACK);
  }
  return defaultTemplatePromise;
}

// claim 포함 라인만 추출(대소문자 무시)
// - 기본은 "라인 단위" 필터링이다.
// - 필요하면 컨텍스트(앞뒤 N줄)까지 확장할 수도 있다.
function extractClaimOnly(text) {
  const s = (text ?? "").toString();
  if (!s) return "";

  // JSON인 경우에도 결국 문자열에서 "claim" 라인을 뽑는 방식으로 통일
  const lines = s.split(/\r?\n/);
  const picked = lines.filter(line => /claim/i.test(line));
  return picked.join("\n").trim();
}

function extractSecondToken(src) {
  const parts = (src ?? "").toString().split("\u001F");

  const isValid = (s) => s && !/^[\u0000-\u001F]+$/.test(s);
  const firstIdx = parts.findIndex(isValid);
  if (firstIdx === -1) return null;

  const secondIdx = parts.findIndex((v, i) => i > firstIdx && isValid(v));
  return secondIdx !== -1 ? parts[secondIdx] : null;
}


function applyTemplate(tpl, applicationText, citationText) {
  const t = (tpl && tpl.trim()) ? tpl : DEFAULT_TEMPLATE_FALLBACK;
  return t
    .replaceAll("{출원발명}", applicationText ?? "")
    .replaceAll("{인용발명}", citationText ?? "");
}

async function updateHistoryById(id, patch) {
  const data = await chrome.storage.local.get([HISTORY_KEY]);
  const arr = Array.isArray(data[HISTORY_KEY]) ? data[HISTORY_KEY] : [];
  const idx = arr.findIndex(x => x && x.id === id);
  if (idx === -1) return;

  arr[idx] = { ...arr[idx], ...patch };
  await chrome.storage.local.set({ [HISTORY_KEY]: arr });
}

function makeId() {
  // 간단 unique id
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}




function isBpServiceUrl(url) {
  try {
    const u = new URL(url);
    // 핵심: /bpService.do + id 파라미터 존재
    if (!u.pathname.endsWith("/bpService.do")) return false;
    if (!u.searchParams.has("id")) return false;
    return true;
  } catch {
    return false;
  }
}

function normalizeTs(ts) {
  const d = ts ? new Date(ts) : new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

async function openOrFocusResultWindow() {
  try {
    if (resultWindowId) {
      const w = await chrome.windows.get(resultWindowId);
      if (w?.id) {
        await chrome.windows.update(resultWindowId, { focused: true });
        return;
      }
    }
  } catch {}
  const w = await chrome.windows.create({
    url: chrome.runtime.getURL("modules/k-scan/result.html"),
    type: "popup",
    width: 720,
    height: 780
  });
  resultWindowId = w.id;
}

async function pushHistory(item) {
  const data = await chrome.storage.local.get([HISTORY_KEY]);
  const arr = Array.isArray(data[HISTORY_KEY]) ? data[HISTORY_KEY] : [];
  arr.unshift(item);
  await chrome.storage.local.set({ [HISTORY_KEY]: arr.slice(0, 20) });
}

function extractAssistantText(apiJson) {
  try {
    const c = apiJson?.choices?.[0];
    const content = c?.message?.content;
    if (typeof content === "string") return content;
  } catch {}
  try {
    return JSON.stringify(apiJson, null, 2);
  } catch {
    return String(apiJson);
  }
}

async function callLocalChatApi(token, content) {
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  };
  const body = {
    model: MODEL_NAME,
    messages: [{ role: "user", content }]
  };

  const res = await fetch(await getApiUrl(), {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  const json = await res.json();
  return { status: res.status, ok: res.ok, json };
}

// CDP getResponseBody가 base64를 줄 수도 있으니 텍스트로 최대한 복원
function decodeBody(body, base64Encoded) {
  if (!base64Encoded) return body ?? "";
  try {
    // atob는 binary string을 반환한다
    const bin = atob(body || "");
    // UTF-8 디코딩 시도
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    // 실패하면 원문(base64)을 그대로
    return body ?? "";
  }
}

async function attachDebugger(tabId) {
  const target = { tabId };
  // 이미 붙어있으면 스킵
  if (attachedTabs.get(tabId)?.attached) return;

  await chrome.debugger.attach(target, "1.3");
  attachedTabs.set(tabId, { attached: true });

  // 네트워크 이벤트 활성화
  await chrome.debugger.sendCommand(target, "Network.enable", {
    // 필요시 버퍼/캐시 관련 옵션을 더 줄 수 있음
  });

  // 혹시 캐시가 문제면 아래를 켤 수도 있음(원하면 내가 옵션화해줄게)
  // await chrome.debugger.sendCommand(target, "Network.setCacheDisabled", { cacheDisabled: true });

  if (!pending.has(tabId)) pending.set(tabId, new Map());
}

async function detachDebugger(tabId) {
  const target = { tabId };
  if (!attachedTabs.get(tabId)?.attached) return;



  try {
    await chrome.debugger.detach(target);
  } catch {}
  attachedTabs.delete(tabId);
  pending.delete(tabId);
  lastSeenByTab.delete(tabId);
}

chrome.debugger.onEvent.addListener(async (source, method, params) => {
  const tabId = source?.tabId;
  if (!tabId) return;
  if (!attachedTabs.get(tabId)?.attached) return;

  // requestWillBeSent: bpService.do POST 요청 메타 수집
  if (method === "Network.requestWillBeSent") {
    const requestId = params?.requestId;
    const req = params?.request;
    const url = req?.url;
    if (!requestId || !url) return;

    if (!isBpServiceUrl(url)) return;

    const methodName = req?.method ?? "";
    const payload = req?.postData ?? "";

    const map = pending.get(tabId);
    if (!map) return;

    const prev = map.get(requestId) ?? {};
    map.set(requestId, {
      ...prev,
      url,
      method: methodName,
      payload,
      requestTs: Date.now()
    });
    return;
  }


  // responseReceived에서 URL, 상태 등을 기록해두고
  if (method === "Network.responseReceived") {
    const url = params?.response?.url;
    const requestId = params?.requestId;
    if (!requestId || !url) return;

    if (!isBpServiceUrl(url)) return;

    // DevTools Network에 뜨는 “bpService.do?id=…”만 정확히 추려서 저장
    const map = pending.get(tabId);
    if (!map) return;

    const prev = map.get(requestId) ?? {};
    map.set(requestId, {
      ...prev,
      url,
      status: params.response?.status,
      mime: params.response?.mimeType,
      ts: Date.now()
    });
    return;
  }

  if (method === "Network.loadingFinished") {
    const requestId = params?.requestId;
    if (!requestId) return;

    const meta = pending.get(tabId)?.get(requestId);
    if (!meta) return;

    pending.get(tabId)?.delete(requestId);

    
    const payloadRaw = meta.payload ?? "";
    const applicationNo = extractSecondToken(payloadRaw);

    // 1) 응답 바디 추출
    let bodyText = "";
    try {
      const r = await chrome.debugger.sendCommand(
        { tabId },
        "Network.getResponseBody",
        { requestId }
      );
      bodyText = decodeBody(r?.body, r?.base64Encoded);
    } catch (e) {
      bodyText = `getResponseBody 실패: ${String(e?.message ?? e)}`;
    }

    // 2) claim 포함 부분만 추출
    const citationText = extractClaimOnly(bodyText);

    // 저장된 token/appText/template 불러오기
    const store = await chrome.storage.local.get([
      "ksuiteSharedApiKey",
      "application_text",
      TEMPLATE_KEY
    ]);

    const token = (store.ksuiteSharedApiKey ?? "").trim();
    const appText = (store.application_text ?? "").trim();
    const defaultTpl = await getDefaultTemplate();
    const storedTpl = store[TEMPLATE_KEY];
    const tpl = (typeof storedTpl === "string" && storedTpl.trim())
      ? storedTpl
      : defaultTpl;

    if (!token || !appText) return;

    // 3) claim 포함 내용이 없으면, API 호출 없이 히스토리만 남기고 종료
    if (!citationText) {
      const id = makeId();
      const item = {
        id,
        time: normalizeTs(meta.ts),
        url: meta.url,
        apiOk: false,
        apiStatus: 0,
        response: "claim이 포함된 내용이 없어 API 호출을 생략"
      };
      //await pushHistory(item);
      await openOrFocusResultWindow();
      return;
    }

    // 4) 처리중 항목을 먼저 추가하고 결과창을 즉시 띄움
    const id = makeId();
    const pendingItem = {
      id,
      time: normalizeTs(meta.ts),
      url: meta.url,
      apiOk: null,
      apiStatus: null,

      applicationNo: applicationNo || null,
      payload: payloadRaw,
      response: "처리 중..."
    };

    await pushHistory(pendingItem);
    await openOrFocusResultWindow();

    // 5) 템플릿 적용해서 content 생성
    const content = applyTemplate(tpl, appText, citationText);

    // 6) API 호출은 비동기로 진행하고 완료되면 해당 항목 업데이트
    (async () => {
      let apiResultText = "";
      let apiOk = false;
      let apiStatus = 0;

      try {
        const rr = await callLocalChatApi(token, content);
        apiOk = rr.ok;
        apiStatus = rr.status;
        apiResultText = extractAssistantText(rr.json);
      } catch (e) {
        apiResultText = `API 호출 오류: ${String(e?.message ?? e)}`;
      }

      await updateHistoryById(id, {
        apiOk,
        apiStatus,
        response: apiResultText
      });
    })();

    return;
  }

  // 실패 케이스(원하면 여기서 로깅/히스토리 기록 가능)
  if (method === "Network.loadingFailed") {
    const requestId = params?.requestId;
    if (!requestId) return;
    const meta = pending.get(tabId)?.get(requestId);
    if (meta) pending.get(tabId)?.delete(requestId);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "START_CAPTURE" && msg?.type !== "STOP_CAPTURE") {
    return undefined;
  }

  (async () => {
    if (msg?.type === "START_CAPTURE") {
      const tabId = msg.tabId;
      try {
        await attachDebugger(tabId);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message ?? e) });
      }
      return;
    }

    if (msg?.type === "STOP_CAPTURE") {
      const tabId = msg.tabId;
      try {
        await detachDebugger(tabId);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message ?? e) });
      }
      return;
    }
  })();

  return true;
});

// 탭이 닫히면 자동 detach (안전)
chrome.tabs.onRemoved.addListener((tabId) => {
  if (attachedTabs.get(tabId)?.attached) detachDebugger(tabId);
});
