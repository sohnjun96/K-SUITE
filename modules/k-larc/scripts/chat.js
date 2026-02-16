async function sendUserChat() {
  const inputEl = document.getElementById('chat-input');
  const responseArea = document.getElementById('chat-response-area');
  const contentEl = document.getElementById('chat-content');
  const userText = inputEl.value.trim();

  if (!userText) return alert("질문 내용을 입력하세요.");
  
  // 현재 업로드된 파일 확인
  const validFiles = citations.filter(c => c.status === 'completed').map(c => c.fileId);
  const mapInfo = citations.map(c => `${c.name}: ${c.title}`).join('\n');
  if (validFiles.length === 0) return alert("분석 가능한 인용발명 파일이 없습니다.");
  if (!settings.mockMode && !settings.key) return alert("API Key가 필요합니다.");

  // UI 상태 변경
  responseArea.classList.remove('hidden');
  contentEl.innerHTML = "답변 생성 중...";

  if (settings.mockMode) {
    const claimCount = claims.filter(c => c.text && c.text.trim()).length;
    const citationCount = citations.filter(c => c.status === 'completed').length;
    contentEl.textContent = `[Mock 답변]\n현재 연결된 실제 모델 없이 테스트 중입니다.\n\n질문: ${userText}\n입력된 청구항: ${claimCount}개\n완료된 인용발명: ${citationCount}개\n\n실제 모델 연결 후에는 이 영역에 RAG 기반 응답이 표시됩니다.`;
    return;
  }

  // 채팅용 프롬프트
  const baseSystemPrompt = await fetch('prompts/chat_prompt.txt').then(response => response.text());
  const systemPrompt = baseSystemPrompt.replace('{{mapInfo}}', mapInfo);

  const payload = {
    model: "gpt-oss-120b",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userText }
    ],
    files: validFiles.map(id => ({ type: "file", id: id })) // RAG 활성화
  };

  try {
    const response = await new Promise(resolve => {
      chrome.runtime.sendMessage({ 
        type: 'ANALYZE_CLAIM', // 기존 핸들러 재사용 (Chat Completions API 동일)
        payload: payload,
        baseUrl: settings.url, 
        apiKey: settings.key 
      }, resolve);
    });

    if (response.ok && response.data && response.data.choices) {
      const answer = response.data.choices[0].message.content;
      // 줄바꿈 처리 및 간단한 마크다운 렌더링 대체 (pre-wrap 사용)
      contentEl.textContent = answer; 
    } else {
      contentEl.textContent = "오류 발생: " + (response.error || "응답 없음");
    }

  } catch (e) {
    console.error(e);
    contentEl.textContent = "통신 오류 발생";
  }
}
