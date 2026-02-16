function ensureMockDemoDataset() {
  if (!settings.mockMode) return;

  let claimsUpdated = false;
  let citationsUpdated = false;

  const nonEmptyClaims = claims.filter(c => String(c?.text || '').trim());
  if (nonEmptyClaims.length === 0) {
    const sampleClaim = typeof getMockDefaultClaimText === 'function'
      ? getMockDefaultClaimText()
      : 'Mock claim text';

    if (!Array.isArray(claims) || claims.length === 0) {
      claims = [{ id: Date.now(), name: 'Claim 1', text: sampleClaim }];
    } else {
      claims[0].text = sampleClaim;
      claims[0].name = claims[0].name || 'Claim 1';
    }
    claimsUpdated = true;
  }

  if (typeof buildMockCitationFixtures === 'function') {
    const fixtures = buildMockCitationFixtures();
    const byName = new Map(
      (citations || []).map(c => [String(c?.name || '').trim().toUpperCase(), c])
    );

    fixtures.forEach((fixture, idx) => {
      const key = String(fixture.name || '').trim().toUpperCase();
      const existing = byName.get(key);

      if (!existing) {
        citations.push({
          id: Date.now() + idx + 1,
          tabId: null,
          name: fixture.name,
          status: 'completed',
          fileId: fixture.fileId,
          title: fixture.title,
          text: fixture.text
        });
        citationsUpdated = true;
        return;
      }

      let changed = false;
      if (!existing.fileId) {
        existing.fileId = fixture.fileId;
        changed = true;
      }
      if (existing.status !== 'completed') {
        existing.status = 'completed';
        changed = true;
      }
      if (!existing.title) {
        existing.title = fixture.title;
        changed = true;
      }

      const currentText = String(existing.text || '').trim();
      const hasJsonLikeText = currentText.startsWith('{') && currentText.includes('"paragraphs"');
      if (!hasJsonLikeText) {
        existing.text = fixture.text;
        changed = true;
      }

      if (changed) citationsUpdated = true;
    });
  }

  if (claimsUpdated) {
    saveClaimsToStorage();
    renderClaims();
  }

  if (citationsUpdated) {
    saveCitationsToStorage();
    renderCitations();
  }
}

async function loadSettings() {
  // savedCitations 키 추가
  const data = await chrome.storage.local.get([
    'webuiBaseUrl',
    'ksuiteSharedApiKey',
    'savedClaims',
    'savedCitations',
    'savedAnalysisResults'
  ]);

  if (data.webuiBaseUrl) {
    settings.url = data.webuiBaseUrl;
    const apiUrlInput = document.getElementById('api-url');
    if (apiUrlInput) {
      apiUrlInput.value = data.webuiBaseUrl;
    }
  }

  const sharedKey = String(
    data.ksuiteSharedApiKey ||
    ''
  ).trim();

  if (sharedKey) {
    const apiKeyInput = document.getElementById('api-key');
    if (apiKeyInput) {
      apiKeyInput.value = sharedKey;
    }
    settings.key = sharedKey;
  }
  settings.mockMode = !!DEV_FLAGS.ENABLE_MOCK_MODE;
  const apiKeyInput = document.getElementById('api-key');
  if (apiKeyInput) {
    apiKeyInput.disabled = settings.mockMode;
  }

  // A. 청구항 불러오기
  if (data.savedClaims && Array.isArray(data.savedClaims) && data.savedClaims.length > 0) {
    // [수정] 기존 데이터 호환성을 위해 name 속성 추가
    claims = data.savedClaims.map((claim, index) => ({
      ...claim,
      name: claim.name || `청구항 ${index + 1}`
    }));
  } else {
    claims = [{ id: Date.now(), name: '청구항 1', text: '' }];
  }
  renderClaims();

  // B. [추가됨] 인용발명 불러오기 및 상태 복구
  if (data.savedCitations && Array.isArray(data.savedCitations)) {
    citations = data.savedCitations;
    renderCitations();

    // *중요*: 대시보드를 닫았을 때 'processing' 상태였던 항목들은
    // 다시 열었을 때 폴링(상태확인)을 재개해야 함.
    citations.forEach(c => {
      if (c.status === 'processing' || c.status === 'uploading') {
        pollStatus(c);
      }
    });
  }

  // C. [추가됨] 분석 결과 불러오기 및 렌더링
  if (settings.mockMode) {
    ensureMockDemoDataset();
  }

  if (data.savedAnalysisResults) {
    analysisResults = data.savedAnalysisResults;
    const resultControls = document.getElementById('result-controls');
    const claimSelect = document.getElementById('result-claim-select');
    const nonEmptyClaims = claims.filter(c => c.text.trim());

    if (Object.keys(analysisResults).length > 0 && nonEmptyClaims.length > 0) {
      resultControls.classList.remove('hidden');
      initializeClaimProgressFromSavedResults(nonEmptyClaims);
      refreshResultClaimSelect(nonEmptyClaims);
      if (claimSelect.options.length > 0) {
        claimSelect.selectedIndex = 0;
        selectedResultClaimId = Number.parseInt(claimSelect.value, 10);
        renderResultTable(selectedResultClaimId);
      }
    }
  } else {
    claimProgressById = {};
  }
  if (DEV_FLAGS.SHOW_DEBUG_PANEL) {
    updateDebugClaimSelect();
    renderDebugContent();
  }
  if (typeof updateDebugExportButtonVisibility === 'function') {
    updateDebugExportButtonVisibility();
  }
  if (typeof restoreAnalysisExecutionMode === 'function') {
    restoreAnalysisExecutionMode();
  } else if (typeof setAnalysisExecutionMode === 'function') {
    setAnalysisExecutionMode('deep', { persist: false });
  }
  const hasSavedAnalysisResults = Object.keys(analysisResults || {}).length > 0;
  const savedMode = typeof getSavedAnalysisMode === 'function' ? getSavedAnalysisMode() : null;
  if (hasSavedAnalysisResults) {
    setAnalysisMode(savedMode === null ? true : savedMode);
  } else {
    setAnalysisMode(false);
  }
}

function saveAnalysisResultsToStorage() {
  chrome.storage.local.set({ savedAnalysisResults: analysisResults });
}

function addClaimInput() {
  const id = Date.now();
  const newName = `청구항 ${claims.length + 1}`;
  claims.push({ id, name: newName, text: '' });
  renderClaims();
  saveClaimsToStorage();
}

function removeClaim(id) {
  if (claims.length <= 1) return; 
  claims = claims.filter(c => c.id !== id);
  renderClaims();
  saveClaimsToStorage();
}

function updateClaimName(id, name) {
  const claim = claims.find(c => c.id === id);
  if (claim) {
    claim.name = name;
    saveClaimsToStorage();
    refreshResultClaimSelect();
  }
}

function updateClaimText(id, text) {
  const claim = claims.find(c => c.id === id);
  if (claim) {
    claim.text = text;
    saveClaimsToStorage();
  }
}

function saveClaimsToStorage() {
  chrome.storage.local.set({ savedClaims: claims });
}

function _renderClaimsLegacy() {
  const container = document.getElementById('claim-list');
  container.innerHTML = '';
  const readOnly = document.body.classList.contains('analysis-active');

  claims.forEach((claim) => {
    const div = document.createElement('div');
    div.className = 'claim-card';
    div.innerHTML = `
      <div class="claim-header">
        <input type="text" class="claim-name-input" value="${claim.name}" data-id="${claim.id}" ${readOnly ? 'readonly tabindex="-1"' : ''}>
        <button class="btn-remove-claim ${readOnly ? 'hidden' : ''}" data-id="${claim.id}">✕ 삭제</button>
      </div>
      <textarea rows="1" placeholder="청구항 내용을 입력하세요..." data-id="${claim.id}" ${readOnly ? 'readonly tabindex="-1"' : ''}>${claim.text}</textarea>
    `;
    container.appendChild(div);

    const textarea = div.querySelector('textarea');
    // 초기 로드 시 높이 조절
    autoResizeTextarea(textarea);
  });

  if (!readOnly) {
    container.querySelectorAll('.claim-name-input').forEach(el => {
      el.addEventListener('input', (e) => updateClaimName(parseInt(e.target.dataset.id), e.target.value));
    });

    container.querySelectorAll('textarea').forEach(el => {
      el.addEventListener('input', (e) => {
        // 높이 자동 조절 및 텍스트 업데이트
        autoResizeTextarea(e.target);
        updateClaimText(parseInt(e.target.dataset.id), e.target.value);
      });
    });

    container.querySelectorAll('.btn-remove-claim').forEach(el => {
      el.addEventListener('click', (e) => removeClaim(parseInt(e.target.dataset.id)));
    });
  }

  if (DEV_FLAGS.SHOW_DEBUG_PANEL) {
    updateDebugClaimSelect();
  }
  updateInputSummary();
}

function buildClaimCardElement(claim, readOnly) {
  if (readOnly) {
    const content = document.createElement('div');
    content.className = 'claim-readonly-content';
    const text = (claim.text || '').trim();
    content.textContent = text || '(청구항 내용이 없습니다.)';
    return content;
  }

  const div = document.createElement('div');
  div.className = 'claim-card';
  div.innerHTML = `
    <div class="claim-header">
      <input type="text" class="claim-name-input" value="${claim.name}" data-id="${claim.id}" ${readOnly ? 'readonly tabindex="-1"' : ''}>
      <button class="btn-remove-claim ${readOnly ? 'hidden' : ''}" data-id="${claim.id}">삭제</button>
    </div>
    <textarea rows="1" placeholder="청구항 내용을 입력하세요..." data-id="${claim.id}" ${readOnly ? 'readonly tabindex="-1"' : ''}>${claim.text}</textarea>
  `;

  const textarea = div.querySelector('textarea');
  autoResizeTextarea(textarea);
  return div;
}

function renderClaims() {
  const container = document.getElementById('claim-list');
  container.innerHTML = '';
  const readOnly = document.body.classList.contains('analysis-active');
  const headerSelect = document.getElementById('claim-view-select-header');

  let claimsToRender = claims;
  if (readOnly) {
    if (!selectedClaimPreviewId || !claims.some(c => c.id === selectedClaimPreviewId)) {
      selectedClaimPreviewId = claims[0]?.id || null;
    }

    if (headerSelect) {
      headerSelect.innerHTML = '';
      claims.forEach(claim => {
        const option = document.createElement('option');
        option.value = String(claim.id);
        option.textContent = claim.name;
        headerSelect.appendChild(option);
      });

      if (selectedClaimPreviewId) {
        headerSelect.value = String(selectedClaimPreviewId);
      }

      if (!headerSelect.dataset.bound) {
        headerSelect.addEventListener('change', (e) => {
          selectedClaimPreviewId = parseInt(e.target.value, 10);
          renderClaims();
        });
        headerSelect.dataset.bound = 'true';
      }
    }

    const selectedClaim = claims.find(c => c.id === selectedClaimPreviewId);
    claimsToRender = selectedClaim ? [selectedClaim] : [];
  } else {
    selectedClaimPreviewId = null;
    if (headerSelect) {
      headerSelect.innerHTML = '';
    }
  }

  claimsToRender.forEach(claim => {
    container.appendChild(buildClaimCardElement(claim, readOnly));
  });

  if (!readOnly) {
    container.querySelectorAll('.claim-name-input').forEach(el => {
      el.addEventListener('input', (e) => updateClaimName(parseInt(e.target.dataset.id, 10), e.target.value));
    });

    container.querySelectorAll('textarea').forEach(el => {
      el.addEventListener('input', (e) => {
        autoResizeTextarea(e.target);
        updateClaimText(parseInt(e.target.dataset.id, 10), e.target.value);
      });
    });

    container.querySelectorAll('.btn-remove-claim').forEach(el => {
      el.addEventListener('click', (e) => removeClaim(parseInt(e.target.dataset.id, 10)));
    });
  }

  if (DEV_FLAGS.SHOW_DEBUG_PANEL) {
    updateDebugClaimSelect();
  }
  updateInputSummary();
}

function saveCitationsToStorage() {
  chrome.storage.local.set({ savedCitations: citations });
}

function loadTabs() {
  const select = document.getElementById('tab-select');
  if (!select) return;

  const previousValue = select.value;
  select.innerHTML = '<option value="">-- 분석할 탭을 선택 --</option>';

  chrome.tabs.query({}, (tabs) => {
    if (chrome.runtime.lastError) {
      console.warn('Tab query failed:', chrome.runtime.lastError.message);
      return;
    }

    const validTabs = (tabs || []).filter((tab) =>
      tab?.id &&
      typeof tab.url === 'string' &&
      (tab.url.startsWith('http://') || tab.url.startsWith('https://'))
    );

    validTabs.forEach((tab) => {
      const option = document.createElement('option');
      option.value = tab.id;
      const title = String(tab.title || tab.url || '').trim();
      option.textContent = title.length > 60 ? `${title.substring(0, 60)}...` : title;
      select.appendChild(option);
    });

    if (previousValue && Array.from(select.options).some((opt) => opt.value === previousValue)) {
      select.value = previousValue;
    }
  });
}

async function addCitationFromTab() {
  const select = document.getElementById('tab-select');
  const tabId = parseInt(select.value);
  if (!tabId) {
    alert('먼저 탭을 선택해주세요.');
    return;
  }

  // 중복 체크 (탭 ID 기준) - 필요 시 해제 가능
  // 이미 업로드된 파일이 있어도 탭이 같으면 경고
  const existing = citations.find(c => c.tabId === tabId);
  if (existing) {
    if(!confirm(`'${existing.name}'으로 이미 추가된 탭입니다. 다시 추가하시겠습니까?`)) return;
  }

  const citationId = Date.now();
  const citationObj = { 
    id: citationId, 
    tabId: tabId, 
    name: `인용발명 ${citations.length + 1}`, 
    status: 'uploading', 
    fileId: null,
    title: 'Loading...',
    text: '' 
  };
  
  citations.push(citationObj);
  renderCitations();
  saveCitationsToStorage(); // 1. 추가 즉시 저장

  if (settings.mockMode) {
    setTimeout(() => {
      const target = citations.find(c => c.id === citationId);
      if (!target) return;
      const selectedTitle = select.options[select.selectedIndex]?.textContent || `Tab ID: ${tabId}`;
      const mockDocName = typeof getMockDocNameByIndex === 'function'
        ? getMockDocNameByIndex(citations.length - 1)
        : `D${(citations.length % 3) + 1}`;
      const mockPayload = typeof buildMockCitationPayload === 'function'
        ? buildMockCitationPayload(mockDocName, selectedTitle)
        : { paragraphs: {}, claims: {} };
      target.name = mockDocName;
      target.fileId = `mock-file-${mockDocName.toLowerCase()}-${citationId}`;
      target.title = selectedTitle;
      target.text = `[Mock 업로드 문서]\n${selectedTitle}\n\n이 텍스트는 네트워크 없이 UI 테스트를 위해 생성되었습니다.`;
      target.status = 'completed';
      target.text = JSON.stringify(mockPayload, null, 2);
      renderCitations();
      saveCitationsToStorage();
    }, 450);
    return;
  }

  chrome.runtime.sendMessage({ 
    type: 'EXTRACT_AND_UPLOAD', 
    tabId: tabId, 
    baseUrl: settings.url, 
    apiKey: settings.key 
  }, (response) => {
    
    const target = citations.find(c => c.id === citationId);
    if (!target) return; 

    if (response.ok) {
      target.fileId = response.fileId;
      target.title = response.title;
      target.text = response.text;
      target.status = 'processing';
      
      renderCitations();
      saveCitationsToStorage(); // 2. 업로드 성공 후 정보 업데이트 저장
      pollStatus(target);
    } else {
      target.status = 'failed';
      target.error = response.error;
      renderCitations();
      saveCitationsToStorage(); // 3. 실패 상태 저장
      alert(`업로드 실패: ${response.error}`);
    }
  });
}

function pollStatus(citation) {
  // 이미 완료되었거나 실패한 상태면 재실행 방지
  if (citation.status === 'completed' || citation.status === 'failed') return;

  if (settings.mockMode) {
    setTimeout(() => {
      const currentCitation = citations.find(c => c.id === citation.id);
      if (!currentCitation) return;
      currentCitation.status = 'completed';
      if (!currentCitation.fileId) {
        currentCitation.fileId = `mock-file-${currentCitation.id}`;
      }
      saveCitationsToStorage();
      renderCitations();
    }, 400);
    return;
  }

  const interval = setInterval(() => {
    // 1. 사용자가 목록에서 삭제했으면 폴링 중단
    const currentCitation = citations.find(c => c.id === citation.id);
    if (!currentCitation) {
      clearInterval(interval);
      return;
    }

    // 2. 상태 확인 요청
    chrome.runtime.sendMessage({ 
      type: 'CHECK_STATUS', 
      fileId: citation.fileId,
      baseUrl: settings.url,
      apiKey: settings.key
    }, (res) => {
      
      // 3. 응답 처리
      if (res.ok) {
        console.log(`[Polling] ${citation.name}:`, res.status); // 콘솔에서 상태 확인 가능

        if (res.status === 'completed') {
          // 성공 처리
          currentCitation.status = 'completed';
          saveCitationsToStorage();
          renderCitations();
          clearInterval(interval); // ★ 중요: 루프 종료
        } 
        else if (res.status === 'failed') {
          // 실패 처리
          currentCitation.status = 'failed';
          saveCitationsToStorage();
          renderCitations();
          clearInterval(interval); // ★ 중요: 루프 종료
        }
        // processing 인 경우 아무것도 하지 않고 다음 틱 대기
      } else {
        // 네트워크 에러 등이 발생했을 때
        console.warn('Polling error response:', res.error);
        
        // (선택사항) 연속 에러 시 중단 로직을 넣을 수도 있으나, 
        // 일시적 네트워크 오류일 수 있으므로 보통은 유지합니다.
      }
    });
  }, 3000); // 3초 간격
}

function removeCitation(id) {
  // 1. 삭제 대상 찾기
  const targetIndex = citations.findIndex(c => c.id === id);
  if (targetIndex === -1) return;
  
  const target = citations[targetIndex];

  if (!confirm(`'${target.name}'을(를) 삭제하시겠습니까?\n(서버에 업로드된 파일도 함께 삭제됩니다)`)) return;
  
  // 2. [추가됨] 서버 파일 삭제 요청 (fileId가 있는 경우)
  if (target.fileId && settings.key) {
    console.log(`Deleting file from server: ${target.fileId}`);
    
    chrome.runtime.sendMessage({
      type: 'DELETE_FILE',
      fileId: target.fileId,
      baseUrl: settings.url,
      apiKey: settings.key
    }, (response) => {
      if (response && response.ok) {
        console.log(`File deleted successfully: ${target.fileId}`);
      } else {
        console.warn(`Failed to delete file on server: ${response?.error}`);
        // 서버 삭제 실패해도 UI에서는 지우는 것이 UX상 자연스러움
      }
    });
  }

  // 3. UI 및 로컬 데이터에서 삭제
  citations.splice(targetIndex, 1);
  
  // 이름 재정렬 (D1, D2...)
  citations.forEach((c, index) => {
    c.name = `인용발명 ${index + 1}`;
  });
  
  renderCitations();
  saveCitationsToStorage();
}

function renderCitations() {
  const list = document.getElementById('citation-list');
  list.innerHTML = '';
  const readOnly = document.body.classList.contains('analysis-active');
  
  if (citations.length === 0) {
    list.innerHTML = '<li class="empty-placeholder" style="list-style:none; padding:20px; text-align:center; color:#888;">분석할 탭을 선택하고 추가하세요.</li>';
    return;
  }

  citations.forEach(c => {
    const li = document.createElement('li');
    li.className = 'citation-item';
    li.setAttribute('role', 'button');
    li.setAttribute('tabindex', '0');
    li.setAttribute('aria-label', `${c.name} 미리보기 열기`);
    
    const badgeClass = c.status; 
    
    li.innerHTML = `
      <div class="citation-info">
        <span class="citation-name">${c.name}</span>
        <span class="citation-url" title="${c.title}">${c.title || ('Tab ID: ' + c.tabId)}</span>
      </div>
      <div class="citation-actions">
        <span class="status-badge ${badgeClass}">${c.status}</span>
        ${readOnly ? '' : `
        <button class="btn-delete-citation" title="삭제">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>`}
      </div>
    `;

    li.addEventListener('click', (e) => {
      if (e.target.closest('.btn-delete-citation')) return;
      openModal(c);
    });
    li.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.target.closest('.btn-delete-citation')) return;
      e.preventDefault();
      openModal(c);
    });

    if (!readOnly) {
      const delBtn = li.querySelector('.btn-delete-citation');
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeCitation(c.id);
      });
    }

    list.appendChild(li);
  });
  updateInputSummary();
}

function openModal(citation) {
  const title = document.getElementById('modal-title');
  const content = document.getElementById('modal-text-content');
  
  title.textContent = `${citation.name} 내용 미리보기`;
  
  if (citation.status === 'uploading' || citation.status === 'processing') {
    content.textContent = "현재 파일을 처리 중입니다. 잠시 후 다시 시도해주세요.";
  } else if (citation.text) {
    const MAX_LENGTH = 20000;
    const displayUserInfo = citation.text.length > MAX_LENGTH 
      ? citation.text.substring(0, MAX_LENGTH) + "\n\n... (텍스트가 너무 길어 생략됨)" 
      : citation.text;
    content.textContent = displayUserInfo;
  } else {
    content.textContent = "(추출된 텍스트가 없습니다)";
  }
  
  openDialogModal('preview-modal', '#btn-close-modal');
}

function closeModal() {
  closeDialogModal('preview-modal');
}

function openDirectAddModal() {
  document.getElementById('direct-citation-name').value = `인용발명 ${citations.length + 1}`;
  document.getElementById('direct-citation-content').value = '';
  openDialogModal('direct-add-modal', '#direct-citation-name');
}

function closeDirectAddModal() {
  closeDialogModal('direct-add-modal');
}

function handleDirectAdd() {
  const name = document.getElementById('direct-citation-name').value.trim();
  const text = document.getElementById('direct-citation-content').value.trim();

  if (!name || !text) {
    alert('문서 이름과 내용을 모두 입력해주세요.');
    return;
  }
  
  const citationId = Date.now();
  const citationObj = { 
    id: citationId,
    tabId: null, // 직접 추가는 tabId가 없음
    name: name, 
    status: 'uploading', 
    fileId: null,
    title: name, // 제목을 이름으로 설정
    text: text 
  };
  
  citations.push(citationObj);
  renderCitations();
  saveCitationsToStorage();
  closeDirectAddModal();

  if (settings.mockMode) {
    setTimeout(() => {
      const target = citations.find(c => c.id === citationId);
      if (!target) return;
      target.fileId = `mock-file-${citationId}`;
      target.status = 'completed';
      renderCitations();
      saveCitationsToStorage();
    }, 350);
    return;
  }

  chrome.runtime.sendMessage({ 
    type: 'DIRECT_UPLOAD', 
    text: text,
    filename: `${name.replace(/[^a-zA-Z0-9]/g, "_")}.txt`,
    baseUrl: settings.url, 
    apiKey: settings.key 
  }, (response) => {
    const target = citations.find(c => c.id === citationId);
    if (!target) return; 

    if (response.ok) {
      target.fileId = response.fileId;
      target.status = 'processing';
      renderCitations();
      saveCitationsToStorage();
      pollStatus(target);
    } else {
      target.status = 'failed';
      target.error = response.error;
      renderCitations();
      saveCitationsToStorage();
      alert(`업로드 실패: ${response.error}`);
    }
  });
}
