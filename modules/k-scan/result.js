const HISTORY_KEY = "bp_history_v1";

const latestMetaEl = document.getElementById("latestMeta");
const latestBoxEl = document.getElementById("latestBox");
const latestScoreEl = document.getElementById("latestScore");
const tbodyEl = document.getElementById("tbody");
const countEl = document.getElementById("count");
const filter60El = document.getElementById("filter60");

const copyBtn = document.getElementById("copyLatest");
const clearBtn = document.getElementById("clear");

let latest = null;
let filterOnly60 = false;

function parseScoreAndText(response) {
  const s = (response ?? "").toString();

  // "점수 텍스트..." 형태에서 점수 숫자만 추출
  const m = s.match(/^\s*(\d{1,3})(?:\.\d+)?\b/);
  if (!m) return { score: null, text: s.trim() };

  const score = Math.max(0, Math.min(100, Number(m[1])));
  const rest = s.slice(m[0].length).trimStart();
  return { score, text: rest };
}

function classByScore(score) {
  if (typeof score !== "number") return "";
  if (score >= 60 && score <= 100) return "bg-blue";
  if (score >= 40 && score < 60) return "bg-green";
  return "";
}

function render(history) {
  const arr = Array.isArray(history) ? history : [];
  const filtered = filterOnly60
    ? arr.filter((item) => {
        const { score } = parseScoreAndText(item.response ?? "");
        return typeof score === "number" && score >= 60;
      })
    : arr;

  countEl.textContent = filterOnly60
    ? `총 ${filtered.length}개 표시 중 (60점 이상 / 전체 ${arr.length}개)`
    : `총 ${arr.length}개 표시 중`;

  latest = arr[0] ?? null;

  if (!latest) {
    latestMetaEl.textContent = "히스토리 없음";
    latestScoreEl.textContent = "";
    latestBoxEl.classList.remove("bg-green", "bg-blue");
  } else {
    const state =
      latest.apiOk === null ? "대기" :
      latest.apiOk ? "성공" : "실패";

    const appNo = latest.applicationNo ?? "-";

    latestMetaEl.textContent =
`시간: ${latest.time}
출원번호: ${appNo}
상태: ${state}${latest.apiStatus != null ? ` (${latest.apiStatus})` : ""}`;

    const { score } = parseScoreAndText(latest.response ?? "");

    latestScoreEl.textContent = (typeof score === "number") ? String(score) : (latest.response ?? "");
    latestBoxEl.classList.remove("bg-green", "bg-blue");

    const cls = classByScore(score);
    if (cls) latestBoxEl.classList.add(cls);
  }

  tbodyEl.innerHTML = "";

  for (const item of filtered) {
    const { score, text } = parseScoreAndText(item.response ?? "");

    const tr = document.createElement("tr");
    const rowCls = classByScore(score);
    if (rowCls) tr.classList.add(rowCls);

    const tdTime = document.createElement("td");
    tdTime.textContent = item.time ?? "";

    const tdAppNo = document.createElement("td");
    tdAppNo.className = "appNoCell";
    tdAppNo.textContent = item.applicationNo ?? "-";

    const tdScore = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "badge";
    const badgeCls = classByScore(score);
    if (badgeCls) badge.classList.add(badgeCls);

    badge.textContent = (typeof score === "number") ? String(score) : "-";
    tdScore.appendChild(badge);

    const tdContent = document.createElement("td");
    tdContent.className = "contentCell";
    tdContent.textContent = text || "";

    tr.appendChild(tdTime);
    tr.appendChild(tdAppNo);
    tr.appendChild(tdScore);
    tr.appendChild(tdContent);

    tbodyEl.appendChild(tr);
  }
}

async function loadAndRender() {
  const data = await chrome.storage.local.get([HISTORY_KEY]);
  render(data[HISTORY_KEY]);
}

copyBtn.addEventListener("click", async () => {
  const { score } = parseScoreAndText(latest?.response ?? "");
  const text = (typeof score === "number") ? String(score) : "";

  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
});

filter60El?.addEventListener("change", () => {
  filterOnly60 = !!filter60El.checked;
  loadAndRender().catch(() => {});
});

clearBtn.addEventListener("click", async () => {
  await chrome.storage.local.set({ [HISTORY_KEY]: [] });
  await loadAndRender();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[HISTORY_KEY]) loadAndRender().catch(() => {});
});

loadAndRender().catch(() => {});
