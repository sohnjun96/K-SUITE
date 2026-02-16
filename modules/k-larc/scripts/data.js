function ensureMockDemoDataset() {
  if (!settings.mockMode) return;

  let claimsUpdated = false;
  let citationsUpdated = false;

  const nonEmptyClaims = claims.filter(c => String(c?.text || '').trim());
  const sampleClaims = typeof getMockClaimFixtures === 'function'
    ? getMockClaimFixtures()
    : [
      typeof getMockDefaultClaimText === 'function'
        ? getMockDefaultClaimText()
        : 'Mock claim text'
    ];
  const firstSample = String(sampleClaims[0] || '').trim();
  const hasOnlyLegacySingleMockClaim = nonEmptyClaims.length === 1
    && claims.length <= 1
    && String(nonEmptyClaims[0]?.text || '').trim() === firstSample;

  if (nonEmptyClaims.length === 0 || hasOnlyLegacySingleMockClaim) {
    const fallbackClaim = firstSample || 'Mock claim text';
    const seedClaims = sampleClaims
      .map(text => String(text || '').trim())
      .filter(Boolean);
    const normalizedSeedClaims = seedClaims.length > 0 ? seedClaims : [fallbackClaim];

    if (!Array.isArray(claims)) {
      claims = [];
    }

    normalizedSeedClaims.forEach((text, idx) => {
      const existing = claims[idx];
      if (existing && typeof existing === 'object') {
        existing.id = existing.id || (Date.now() + idx);
        existing.name = existing.name || `Claim ${idx + 1}`;
        existing.text = text;
        return;
      }

      claims[idx] = {
        id: Date.now() + idx,
        name: `Claim ${idx + 1}`,
        text
      };
    });
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

function buildMockVerificationMapFromRelevant(relevant) {
  const verifications = {};
  let seq = 0;

  Object.entries(relevant || {}).forEach(([docName, items]) => {
    if (!Array.isArray(items)) return;
    items.forEach(item => {
      const featureId = String(item?.Feature || '').trim();
      if (!featureId) return;
      seq += 1;
      const key = `${featureId}_${docName}`;
      if (!verifications[key]) {
        verifications[key] = seq % 4 === 0 ? 'F' : 'P';
      }
    });
  });

  return verifications;
}

function buildMockStepTimingsSeed(claimIndex = 0) {
  const stepIds = ['A', 'B', 'C', 'D', 'E'];
  const baseDurations = [950, 2800, 1300, 900, 700];
  const offset = Math.max(0, Number(claimIndex) || 0) * 120;
  let cursor = Date.now() - 60000 - offset;
  const timings = {};

  stepIds.forEach((stepId, idx) => {
    const durationMs = baseDurations[idx] + offset;
    timings[stepId] = {
      stepId,
      startedAt: cursor,
      endedAt: cursor + durationMs,
      durationMs,
      status: 'done'
    };
    cursor += durationMs + 180;
  });

  return timings;
}

function buildMockDemoAnalysisResult(claim, claimIndex = 0) {
  const claimText = String(claim?.text || '').trim();
  const claimFeatures = typeof buildMockClaimFeatures === 'function'
    ? buildMockClaimFeatures(claimText)
    : [];
  const baseRelevant = typeof buildMockRelevant === 'function'
    ? buildMockRelevant(claimFeatures, `Seed-${claimIndex + 1}`)
    : {};
  const relevant = typeof mergeRelevantWithPositions === 'function'
    ? mergeRelevantWithPositions({}, baseRelevant)
    : (baseRelevant || {});

  const featureStatus = {};
  (claimFeatures || []).forEach(feature => {
    if (!feature?.Id) return;
    featureStatus[feature.Id] = 'ENTAIL';
  });

  return {
    ClaimFeatures: claimFeatures,
    Relevant: relevant,
    FeatureStatus: featureStatus,
    verifications: buildMockVerificationMapFromRelevant(relevant),
    debug: {
      stepA: { ClaimFeatures: claimFeatures },
      stepB: { seeded: true },
      stepC: { seeded: true, FeatureStatus: featureStatus },
      stepD: { seeded: true },
      stepTimings: buildMockStepTimingsSeed(claimIndex)
    }
  };
}

function ensureMockDemoAnalysisResults() {
  if (!settings.mockMode) return false;

  if (!analysisResults || typeof analysisResults !== 'object' || Array.isArray(analysisResults)) {
    analysisResults = {};
  }

  const nonEmptyClaims = claims.filter(c => String(c?.text || '').trim());
  let changed = false;

  nonEmptyClaims.forEach((claim, index) => {
    const key = claim?.id;
    if (key === null || key === undefined) return;
    const current = analysisResults[key];
    const hasUsableData = !!(
      current
      && typeof current === 'object'
      && !current.error
      && Array.isArray(current.ClaimFeatures)
      && current.ClaimFeatures.length > 0
      && current.Relevant
      && typeof current.Relevant === 'object'
      && Object.keys(current.Relevant).length > 0
    );
    if (hasUsableData) return;

    analysisResults[key] = buildMockDemoAnalysisResult(claim, index);
    changed = true;
  });

  return changed;
}

async function loadSettings() {
  // savedCitations 포함
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
      name: claim.name || `청구항${index + 1}`
    }));
  } else {
    claims = [{ id: Date.now(), name: '청구항 1', text: '' }];
  }
  renderClaims();

  // B. 인용발명 불러오기 및 상태 복구
  if (data.savedCitations && Array.isArray(data.savedCitations)) {
    citations = data.savedCitations;
    renderCitations();

    // *중요*: 대시보드를 닫았을 때 'processing' 상태였던 항목들은
    // 다시 열었을 때도 폴링(상태확인)을 재개해야 함
    citations.forEach(c => {
      if (c.status === 'processing' || c.status === 'uploading') {
        pollStatus(c);
      }
    });
  }

  // Seed mock dataset when mock mode is enabled.
  if (settings.mockMode) {
    ensureMockDemoDataset();
  }

  analysisResults = (data.savedAnalysisResults && typeof data.savedAnalysisResults === 'object')
    ? data.savedAnalysisResults
    : {};

  if (settings.mockMode) {
    const mockResultsSeeded = ensureMockDemoAnalysisResults();
    if (mockResultsSeeded) {
      saveAnalysisResultsToStorage();
    }
  }

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
  const newName = `청구항${claims.length + 1}`;
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
        <button class="btn-remove-claim ${readOnly ? 'hidden' : ''}" data-id="${claim.id}">삭제</button>
      </div>
      <textarea rows="1" placeholder="청구항 내용을 입력해 주세요.." data-id="${claim.id}" ${readOnly ? 'readonly tabindex="-1"' : ''}>${claim.text}</textarea>
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
    <textarea rows="1" placeholder="청구항 내용을 입력해 주세요.." data-id="${claim.id}" ${readOnly ? 'readonly tabindex="-1"' : ''}>${claim.text}</textarea>
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

function buildTabSelectPlaceholderOption() {
  const option = document.createElement('option');
  option.value = '';
  option.textContent = '-- Select a tab --';
  return option;
}

function buildMockTabDescriptors() {
  const fixtures = typeof buildMockCitationFixtures === 'function'
    ? buildMockCitationFixtures()
    : [];

  if (fixtures.length > 0) {
    return fixtures.map((fixture, index) => {
      const fallbackDocName = typeof getMockDocNameByIndex === 'function'
        ? getMockDocNameByIndex(index)
        : `D${index + 1}`;
      const docName = String(fixture?.name || fallbackDocName || `D${index + 1}`).trim();
      const title = String(fixture?.title || `Mock Citation ${index + 1}`).trim();
      return {
        value: String(-(index + 1)),
        docName,
        title,
        label: `[MOCK] ${docName} - ${title}`
      };
    });
  }

  const descriptors = [];
  for (let i = 0; i < 5; i += 1) {
    const docName = typeof getMockDocNameByIndex === 'function'
      ? getMockDocNameByIndex(i)
      : `D${i + 1}`;
    descriptors.push({
      value: String(-(i + 1)),
      docName,
      title: `Mock Citation ${i + 1}`,
      label: `[MOCK] ${docName} - Mock Citation ${i + 1}`
    });
  }
  return descriptors;
}

function appendMockTabs(select) {
  if (!settings.mockMode) return 0;

  const mockTabs = buildMockTabDescriptors();
  mockTabs.forEach((mockTab) => {
    const option = document.createElement('option');
    option.value = mockTab.value;
    option.textContent = mockTab.label;
    option.dataset.mock = 'true';
    option.dataset.mockDocName = mockTab.docName;
    option.dataset.mockTitle = mockTab.title;
    select.appendChild(option);
  });

  return mockTabs.length;
}

function appendBrowserTabs(select, tabs) {
  const validTabs = (tabs || []).filter((tab) =>
    tab?.id
    && typeof tab.url === 'string'
    && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))
  );

  validTabs.forEach((tab) => {
    const option = document.createElement('option');
    option.value = String(tab.id);
    const title = String(tab.title || tab.url || '').trim();
    option.textContent = title.length > 80 ? `${title.substring(0, 80)}...` : title;
    select.appendChild(option);
  });

  return validTabs.length;
}

function restoreTabSelection(select, previousValue) {
  if (!previousValue) return;
  const exists = Array.from(select.options).some((option) => option.value === previousValue);
  if (exists) {
    select.value = previousValue;
  }
}

function loadTabs() {
  const select = document.getElementById('tab-select');
  if (!select) return;

  const previousValue = select.value;
  select.innerHTML = '';
  select.appendChild(buildTabSelectPlaceholderOption());

  const mockCount = appendMockTabs(select);

  if (!chrome?.tabs?.query) {
    if (mockCount === 0) {
      const unavailable = document.createElement('option');
      unavailable.value = '';
      unavailable.disabled = true;
      unavailable.textContent = '(Browser tabs unavailable)';
      select.appendChild(unavailable);
    }
    restoreTabSelection(select, previousValue);
    return;
  }

  chrome.tabs.query({ currentWindow: true }, (tabs) => {
    if (chrome.runtime.lastError) {
      console.warn('Tab query failed:', chrome.runtime.lastError.message);
      if (mockCount === 0) {
        const failed = document.createElement('option');
        failed.value = '';
        failed.disabled = true;
        failed.textContent = '(Unable to load tabs)';
        select.appendChild(failed);
      }
      restoreTabSelection(select, previousValue);
      return;
    }

    const browserTabCount = appendBrowserTabs(select, tabs);
    if (browserTabCount === 0 && mockCount === 0) {
      const empty = document.createElement('option');
      empty.value = '';
      empty.disabled = true;
      empty.textContent = '(No HTTP(S) tabs found)';
      select.appendChild(empty);
    }

    restoreTabSelection(select, previousValue);
  });
}
async function addCitationFromTab() {
  const select = document.getElementById('tab-select');
  const selectedOption = select?.options?.[select.selectedIndex];
  const tabId = Number.parseInt(select?.value || '', 10);
  if (!Number.isFinite(tabId)) {
    alert('Please select a tab first.');
    return;
  }

  const isMockSelection = selectedOption?.dataset?.mock === 'true';

  const existing = citations.find(c => c.tabId === tabId);
  if (existing) {
    if (!confirm(`'${existing.name}' already exists. Add it again?`)) return;
  }

  const citationId = Date.now();
  const citationObj = {
    id: citationId,
    tabId,
    name: isMockSelection
      ? (selectedOption?.dataset?.mockDocName || `D${citations.length + 1}`)
      : `Citation ${citations.length + 1}`,
    status: 'uploading',
    fileId: null,
    title: 'Loading...',
    text: ''
  };

  citations.push(citationObj);
  renderCitations();
  saveCitationsToStorage();

  if (settings.mockMode) {
    setTimeout(() => {
      const target = citations.find(c => c.id === citationId);
      if (!target) return;

      const selectedTitle = selectedOption?.dataset?.mockTitle
        || selectedOption?.textContent
        || `Tab ID: ${tabId}`;
      const mockDocName = selectedOption?.dataset?.mockDocName
        || (typeof getMockDocNameByIndex === 'function'
          ? getMockDocNameByIndex(citations.length - 1)
          : `D${(citations.length % 3) + 1}`);
      const mockPayload = typeof buildMockCitationPayload === 'function'
        ? buildMockCitationPayload(mockDocName, selectedTitle)
        : { paragraphs: {}, claims: {} };

      target.name = mockDocName;
      target.fileId = `mock-file-${mockDocName.toLowerCase()}-${citationId}`;
      target.title = selectedTitle;
      target.status = 'completed';
      target.text = JSON.stringify(mockPayload, null, 2);

      renderCitations();
      saveCitationsToStorage();
    }, 450);
    return;
  }

  chrome.runtime.sendMessage({
    type: 'EXTRACT_AND_UPLOAD',
    tabId,
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
      saveCitationsToStorage();
      pollStatus(target);
    } else {
      target.status = 'failed';
      target.error = response.error;
      renderCitations();
      saveCitationsToStorage();
      alert(`Upload failed: ${response.error}`);
    }
  });
}
function pollStatus(citation) {
  // 이미 완료됐거나 실패한 상태면 재시도하지 않음
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
          clearInterval(interval); // 중요: 루프 종료
        } 
        else if (res.status === 'failed') {
          // 실패 처리
          currentCitation.status = 'failed';
          saveCitationsToStorage();
          renderCitations();
          clearInterval(interval); // 중요: 루프 종료
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
  
  // 2. 서버 파일 삭제 요청 (fileId가 있는 경우)
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
        // 서버 삭제 실패여도 UI에서는 제거하는 편이 UX상 자연스럽다.
      }
    });
  }

  // 3. UI 및 로컬 데이터에서 제거
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
    list.innerHTML = '<li class="empty-placeholder" style="list-style:none; padding:20px; text-align:center; color:#888;">분석할 탭을 선택하고 추가해 주세요.</li>';
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
    content.textContent = '현재 파일을 처리 중입니다. 잠시 후 다시 시도해 주세요.';
  } else if (citation.text) {
    const MAX_LENGTH = 20000;
    const displayUserInfo = citation.text.length > MAX_LENGTH 
      ? citation.text.substring(0, MAX_LENGTH) + '\n\n... (텍스트가 너무 길어 생략됨)'
      : citation.text;
    content.textContent = displayUserInfo;
  } else {
    content.textContent = '(추출된 텍스트가 없습니다)';
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
    alert('문서 이름과 내용을 모두 입력해 주세요.');
    return;
  }
  
  const citationId = Date.now();
  const citationObj = { 
    id: citationId,
    tabId: null, // 직접 추가는 tabId가 없음
    name: name, 
    status: 'uploading', 
    fileId: null,
    title: name, // 제목은 이름으로 설정
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



