// background.js

// 1. 메시지 라우터 수정 (DELETE_FILE 추가)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "OPEN_DASHBOARD") {
    chrome.tabs.create({ url: "modules/k-larc/dashboard.html" });
  } else if (request.type === "GET_TABS") {
    getTabs(sendResponse);
    return true; 
  } else if (request.type === "EXTRACT_AND_UPLOAD") {
    handleExtractAndUpload(request.tabId, request.baseUrl, request.apiKey, sendResponse);
    return true;
  } else if (request.type === "CHECK_STATUS") {
    checkFileStatus(request.fileId, request.baseUrl, request.apiKey, sendResponse);
    return true;
  } else if (request.type === "ANALYZE_CLAIM") {
    analyzeClaim(request.payload, request.baseUrl, request.apiKey, sendResponse);
    return true;
  } 
  // [추가됨] 파일 삭제 요청 처리
  else if (request.type === "DELETE_FILE") {
    deleteFile(request.fileId, request.baseUrl, request.apiKey, sendResponse);
    return true;
  }
  // [추가됨] 직접 텍스트 업로드 요청 처리
  else if (request.type === "DIRECT_UPLOAD") {
    handleDirectUpload(request.text, request.filename, request.baseUrl, request.apiKey, sendResponse);
    return true;
  }
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: "modules/k-larc/dashboard.html" });
});

function getTabs(sendResponse) {
  chrome.tabs.query({}, (tabs) => {
    const validTabs = tabs.filter(t => t.url && (t.url.startsWith('http') || t.url.startsWith('https')));
    sendResponse(validTabs);
  });
}


function extractPatentData(html) {
  /* --------------------------------------------------------------
     1) 헬퍼 : 태그 제거·공백 정규화·전각→반각 변환
   -------------------------------------------------------------- */
  const stripTags = str =>
    str.replace(/<[^>]*>/g, ' ')   // 모든 HTML 태그 → 공백
       .replace(/\s+/g, ' ')      // 연속 공백 → 하나
       .trim();

  // 전각 숫자(０‑９) → 반각(0‑9)
  const toHalfWidth = s =>
    s.replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));

  /* --------------------------------------------------------------
     2) KR‑문단 : <small>&lt;0010&gt;</small>  →  <td …word‑break:break-all>
   -------------------------------------------------------------- */
  const paragraphs = {};

  const krParaRe =
    /<td[^>]*>\s*<small>\s*&lt;(\d{4,})&gt;\s*<\/small>\s*<\/td>\s*<td[^>]*\bword-break\s*:\s*break-all[^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = krParaRe.exec(html)) !== null) {
    const key = `[${m[1]}]`;                // "[0010]"
    const txt = stripTags(m[2]);
    if (txt) paragraphs[key] = txt;
  }

  /* --------------------------------------------------------------
     3) 모든 <div> 를 순서대로 배열에 담는다.
        (JP 문단·청구항은 모두 <div> 형태이므로 여기서 처리)
   -------------------------------------------------------------- */
  const divRe = /<div[^>]*>([\s\S]*?)<\/div>/gi;
  const divs = [];
  while ((m = divRe.exec(html)) !== null) {
    divs.push(m[1]);                         // 안쪽 HTML 그대로 보관
  }

  /* --------------------------------------------------------------
     4) 순차적으로 <div> 를 살펴 문단과 청구항을 구분해서 추출
   -------------------------------------------------------------- */
  const claims = {};

  for (let i = 0; i < divs.length - 1; i++) {
    const cur = divs[i];

    /* ---------- 청구항 (KR·JP 모두) ---------- */
    if (/(청구항|請求項)/.test(cur)) {               // 청구항 헤더
      const numMatch = cur.match(/([0-9０-９]{1,4})/); // 번호 (반각·전각 모두)
      if (numMatch) {
        const claimNo = toHalfWidth(numMatch[1]);      // "３" → "3"
        const body = stripTags(divs[i + 1]);          // 다음 <div> 가 본문
        if (body) claims[`청구항 ${claimNo}`] = body;
      }
      continue;   // 청구항은 여기서 마무리 → 문단으로 잡히지 않게 함
    }

    /* ---------- JP 문단 (청구항이 아니고 번호가 4자리 이상) ---------- */
    // (예: <div>【<script …>　０００３】</div> 뒤에 내용이 옴)
    const paraNumMatch = cur.match(/([0-9０-９]{4,})/);
    if (paraNumMatch) {
      const num = toHalfWidth(paraNumMatch[1]);      // 전각→반각
      const key = `[${num}]`;
      if (!(key in paragraphs)) {                    // 이미 KR에서 잡힌 건 제외
        const txt = stripTags(divs[i + 1]);           // 바로 뒤 <div> 내용
        if (txt) paragraphs[key] = txt;
      }
    }
  }

  /* --------------------------------------------------------------
     5) 결과 반환
   -------------------------------------------------------------- */
  return { paragraphs, claims };
}


// 2. [핵심 수정] XML 프레임 우선 추출 로직
async function handleExtractAndUpload(tabId, baseUrl, apiKey, sendResponse) {
  try {
    // A. 스크립트 주입 (모든 프레임 정보 수집)
    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const url = location.href;
        const contentType = document.contentType;
        const isXml = url.endsWith('.xml') || (contentType && contentType.includes('xml'));

        let rawXml = null;
        let text = "";

        if (isXml) {
          rawXml = new XMLSerializer().serializeToString(document);
        } else {
          const clone = document.body.cloneNode(true);
          clone.querySelectorAll('script,style,noscript,nav,header,footer,iframe')
               .forEach(e => e.remove());
          text = clone.innerText;
        }

        const cleanText = text.replace(/\s+/g, ' ').trim();

        return {
          url,
          isXml,
          length: isXml ? rawXml.length : cleanText.length,
          text: isXml ? rawXml : cleanText,
          rawXml: isXml ? rawXml : null   // 필요 시 사용
        };
      }
    });

    if (!injectionResults || injectionResults.length === 0) {
      throw new Error("페이지 내용을 읽을 수 없습니다.");
    }

    // B. [핵심] 가장 중요한 프레임 선별 (Filtering)
    const frames = injectionResults.map(r => r.result);
    
    // 전략 1: 명시적인 XML 프레임이 있는지 찾는다. (내용이 너무 짧으면 무시 - 50자 이상)
    let targetFrame = frames.find(f => f.isXml && f.length > 50);

    // 전략 2: XML이 없다면, 텍스트 길이가 가장 긴 프레임(본문)을 선택한다.
    if (!targetFrame) {
      // 길이 순 내림차순 정렬
      frames.sort((a, b) => b.length - a.length);
      if (frames.length > 0 && frames[0].length > 50) {
        targetFrame = frames[0];
      }
    }

    if (!targetFrame) {
      throw new Error("유효한 텍스트 내용을 찾지 못했습니다 (빈 문서).");
    }

    console.log(targetFrame.rawXml);

    const finalTitle = targetFrame.isXml ? "[XML] " : "";
    
    // C. 파일 업로드 준비
    const tab = await chrome.tabs.get(tabId);
    
    // 파일명 생성
    const safeTitle = tab.title.replace(/[^a-zA-Z0-9가-힣\s]/g, "").substring(0, 20);
    const filename = `ref_${tabId}_${safeTitle}_${Date.now()}.txt`;

    const jsonStr = JSON.stringify(extractPatentData(targetFrame.rawXml), null,2);
    
    // 다국어(UTF-8) 지원 Blob
    const blob = new Blob([jsonStr], { type: 'text/plain; charset=utf-8' });
    const formData = new FormData();
    formData.append('file', blob, filename);

    // D. 업로드 요청
    const uploadUrl = `${baseUrl.replace(/\/$/, '')}/api/v1/files/?process=true&process_in_background=true`;
    
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Upload Failed (${response.status}): ${errText}`);
    }

    const data = await response.json();
    
    // ID 추출 (구조 대응)
    const fileId = data.id || (data.data && data.data.id);
    if (!fileId) throw new Error("서버 응답에 File ID가 없습니다.");

    sendResponse({ 
      ok: true, 
      fileId: fileId, 
      title: finalTitle + tab.title,
      text: jsonStr // 선별된 텍스트만 미리보기로 전달
    });

  } catch (error) {
    console.error("Extract/Upload Error:", error);
    sendResponse({ ok: false, error: error.message });
  }
}

// 3. 상태 폴링 (Check Status) - 수정 없음
async function checkFileStatus(fileId, baseUrl, apiKey, sendResponse) {
  try {
    const statusUrl = `${baseUrl.replace(/\/$/, '')}/api/v1/files/${fileId}`;
    const response = await fetch(statusUrl, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    if (!response.ok) throw new Error("Status check failed");
    const json = await response.json();

    let isCompleted = false;
    let isFailed = false;

    // data.status 확인
    if (json.data && json.data.status) {
      if (json.data.status === true || json.data.status === 'processed' || json.data.status === 'completed') isCompleted = true;
      else if (json.data.status === 'failed' || json.data.status === 'error') isFailed = true;
    }
    else if (json.data && json.data.content) isCompleted = true;
    else if (json.meta && json.meta.processed) isCompleted = true;

    let finalStatus = 'processing';
    if (isCompleted) finalStatus = 'completed';
    if (isFailed) finalStatus = 'failed';

    sendResponse({ ok: true, status: finalStatus });

  } catch (e) {
    sendResponse({ ok: false, error: e.message });
  }
}

// 4. 분석 요청 (LLM) - 수정 없음
async function analyzeClaim(payload, baseUrl, apiKey, sendResponse) {
  try {
    const chatUrl = `${baseUrl.replace(/\/$/, '')}/api/chat/completions`;

    const response = await fetch(chatUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Analysis Failed (${response.status}): ${errText}`);
    }

    const data = await response.json();
    sendResponse({ ok: true, data: data });

  } catch (e) {
    sendResponse({ ok: false, error: e.message });
  }
}

/**
 * [추가됨] 서버 파일 삭제 함수
 * DELETE /api/v1/files/{id}
 */
async function deleteFile(fileId, baseUrl, apiKey, sendResponse) {
  try {
    const deleteUrl = `${baseUrl.replace(/\/$/, '')}/api/v1/files/${fileId}`;
    
    const response = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    if (!response.ok) {
      // 404(이미 없음) 등은 성공으로 간주할지 여부는 선택사항이나, 
      // 여기서는 에러 메시지를 반환하여 로그를 남길 수 있게 함
      const errText = await response.text();
      throw new Error(`Delete Failed (${response.status}): ${errText}`);
    }

    const data = await response.json();
    sendResponse({ ok: true, data: data });

  } catch (error) {
    console.error("File Delete Error:", error);
    sendResponse({ ok: false, error: error.message });
  }
}

/**
 * [추가됨] 대시보드에서 직접 입력한 텍스트를 파일로 업로드하는 함수
 */
async function handleDirectUpload(text, filename, baseUrl, apiKey, sendResponse) {
  try {
    // 1. 다국어(UTF-8) 지원 Blob 생성
    const blob = new Blob([text], { type: 'text/plain; charset=utf-8' });
    const formData = new FormData();
    formData.append('file', blob, filename);

    // 2. 업로드 요청
    const uploadUrl = `${baseUrl.replace(/\/$/, '')}/api/v1/files/?process=true&process_in_background=true`;
    
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Upload Failed (${response.status}): ${errText}`);
    }

    const data = await response.json();
    
    // 3. File ID 추출
    const fileId = data.id || (data.data && data.data.id);
    if (!fileId) throw new Error("서버 응답에 File ID가 없습니다.");

    // 4. 성공 응답 전송
    sendResponse({ 
      ok: true, 
      fileId: fileId
    });

  } catch (error) {
    console.error("Direct Upload Error:", error);
    sendResponse({ ok: false, error: error.message });
  }
}
