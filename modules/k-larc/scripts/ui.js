function setSortOrder(order) {
  currentSortOrder = order;
  // 정렬 버튼 활성 상태 업데이트
  document.getElementById('btn-sort-by-doc').classList.toggle('active', order === 'doc_then_feature');
  document.getElementById('btn-sort-by-feature').classList.toggle('active', order === 'feature_then_doc');
  // 현재 선택된 청구항 결과 즉시 재렌더
  const claimSelect = document.getElementById('result-claim-select');
  if (claimSelect.value) {
    renderResultTable(parseInt(claimSelect.value, 10));
  }
}

let modalFocusRestoreElement = null;
const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const ANALYSIS_MODE_STORAGE_KEY = 'analysisModeActive';
const ANALYSIS_EXECUTION_MODE_STORAGE_KEY = 'analysisExecutionMode';

function getSavedAnalysisMode() {
  try {
    const saved = localStorage.getItem(ANALYSIS_MODE_STORAGE_KEY);
    if (saved === 'true') return true;
    if (saved === 'false') return false;
  } catch (error) {
    console.warn('Failed to read analysis mode:', error);
  }
  return null;
}

function normalizeAnalysisExecutionMode(mode) {
  return String(mode || '').toLowerCase() === 'quick' ? 'quick' : 'deep';
}

function getSavedAnalysisExecutionMode() {
  try {
    const saved = localStorage.getItem(ANALYSIS_EXECUTION_MODE_STORAGE_KEY);
    if (saved === 'quick' || saved === 'deep') return saved;
  } catch (error) {
    console.warn('Failed to read analysis execution mode:', error);
  }
  return null;
}

function syncAnalysisExecutionModeToggle() {
  const normalized = normalizeAnalysisExecutionMode(analysisExecutionMode);
  const toggle = document.querySelector('.analysis-mode-toggle');
  const deepRadio = document.getElementById('analysis-mode-deep');
  const quickRadio = document.getElementById('analysis-mode-quick');

  if (toggle) {
    toggle.dataset.mode = normalized;
  }
  if (deepRadio) deepRadio.checked = normalized === 'deep';
  if (quickRadio) quickRadio.checked = normalized === 'quick';
}

function setAnalysisExecutionMode(mode, options = {}) {
  const normalized = normalizeAnalysisExecutionMode(mode);
  analysisExecutionMode = normalized;
  syncAnalysisExecutionModeToggle();

  if (options.persist === false) return;
  try {
    localStorage.setItem(ANALYSIS_EXECUTION_MODE_STORAGE_KEY, normalized);
  } catch (error) {
    console.warn('Failed to persist analysis execution mode:', error);
  }
}

function getAnalysisExecutionMode() {
  return normalizeAnalysisExecutionMode(analysisExecutionMode);
}

function restoreAnalysisExecutionMode() {
  const saved = getSavedAnalysisExecutionMode();
  setAnalysisExecutionMode(saved || 'deep', { persist: false });
}

function formatAnalysisElapsedText(elapsedMs) {
  const totalSeconds = Math.floor(Math.max(0, elapsedMs) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = value => String(value).padStart(2, '0');
  if (hours > 0) {
    return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${pad(seconds)}s`;
  }
  return `${seconds}s`;
}

function renderAnalysisElapsedTime() {
  const button = document.getElementById('btn-analyze');
  if (!button || !analysisStartedAt) return;

  const elapsedText = formatAnalysisElapsedText(Date.now() - analysisStartedAt);
  button.innerHTML = `Running analysis... (${elapsedText})`;

}

function setAnalyzeButtonState(isRunning) {
  const button = document.getElementById('btn-analyze');
  if (!button) return;

  if (!button.dataset.defaultHtml) {
    button.dataset.defaultHtml = button.innerHTML;
  }

  button.disabled = !!isRunning;
  button.classList.toggle('is-loading', !!isRunning);

  if (isRunning) {
    analysisStartedAt = Date.now();
    if (analysisElapsedTimerId) {
      clearInterval(analysisElapsedTimerId);
    }
    renderAnalysisElapsedTime();
    analysisElapsedTimerId = window.setInterval(renderAnalysisElapsedTime, 1000);
    button.setAttribute('aria-busy', 'true');
  } else {
    if (analysisElapsedTimerId) {
      clearInterval(analysisElapsedTimerId);
      analysisElapsedTimerId = null;
    }
    analysisStartedAt = null;
    button.innerHTML = button.dataset.defaultHtml;
    button.removeAttribute('aria-busy');

  }

  const editButton = document.getElementById('btn-edit-mode');
  if (editButton) {
    editButton.disabled = !!isRunning;
  }

  document.querySelectorAll('input[name="analysis-execution-mode"]').forEach(input => {
    input.disabled = !!isRunning;
  });
}

function getFocusableElements(container) {
  if (!container) return [];
  return [...container.querySelectorAll(FOCUSABLE_SELECTOR)]
    .filter(el => el.getClientRects().length > 0 || el === document.activeElement);
}

function openDialogModal(modalId, focusSelector) {
  const modal = document.getElementById(modalId);
  if (!modal) return;

  modalFocusRestoreElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');

  const preferred = focusSelector ? modal.querySelector(focusSelector) : null;
  const focusables = getFocusableElements(modal);
  const target = preferred || focusables[0] || modal;
  if (target && typeof target.focus === 'function') {
    target.focus();
  }
}

function closeDialogModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;

  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');

  if (modalFocusRestoreElement && document.contains(modalFocusRestoreElement)) {
    modalFocusRestoreElement.focus();
  }
  modalFocusRestoreElement = null;
}

function getOpenModalElement() {
  return document.querySelector('.modal-overlay:not(.hidden)');
}

function trapFocusInOpenModal(event) {
  const modal = getOpenModalElement();
  if (!modal || event.key !== 'Tab') return;

  const focusables = getFocusableElements(modal);
  if (focusables.length === 0) return;

  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;

  if (event.shiftKey) {
    if (active === first || !modal.contains(active)) {
      event.preventDefault();
      last.focus();
    }
    return;
  }

  if (active === last || !modal.contains(active)) {
    event.preventDefault();
    first.focus();
  }
}

function closeTopModal() {
  const positionModal = document.getElementById('position-modal');
  if (positionModal && !positionModal.classList.contains('hidden')) {
    closePositionModal();
    return true;
  }

  const verificationModal = document.getElementById('verification-modal');
  if (verificationModal && !verificationModal.classList.contains('hidden')) {
    closeVerificationModal();
    return true;
  }

  const directAddModal = document.getElementById('direct-add-modal');
  if (directAddModal && !directAddModal.classList.contains('hidden')) {
    closeDirectAddModal();
    return true;
  }

  const previewModal = document.getElementById('preview-modal');
  if (previewModal && !previewModal.classList.contains('hidden')) {
    closeModal();
    return true;
  }

  return false;
}

function handleGlobalEscapeKey() {
  if (closeTopModal()) return true;

  if (document.body.classList.contains('settings-open')) {
    document.body.classList.remove('settings-open');
    return true;
  }

  return false;
}

function normalizeSummaryText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function truncateSummaryText(text, maxLength = 36) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 3))}...`;
}

function buildClaimHeaderSummary() {
  const total = claims.length;
  const filled = claims.filter(c => normalizeSummaryText(c.text)).length;
  if (total === 0) return 'No claims added';

  const previews = claims.map(claim => {
    const text = normalizeSummaryText(claim.text) || '(No content)';
    return `${claim.name}: ${truncateSummaryText(text, 28)}`;
  });

  return `${filled}/${total} filled | ${previews.join(' | ')}`;
}

function buildCitationHeaderSummary() {
  const total = citations.length;
  const completed = citations.filter(c => c.status === 'completed').length;
  if (total === 0) return 'No references added';

  const titles = citations
    .map(c => truncateSummaryText(normalizeSummaryText(c.title || c.name || c.url || ''), 28))
    .filter(Boolean);
  const titleSummary = titles.length > 0 ? titles.join(' | ') : 'No title/url';

  return `${completed}/${total} completed | ${titleSummary}`;
}

function updateInputPanelHeaders() {
  const claimsTitle = document.getElementById('claims-panel-title');
  if (claimsTitle) {
    claimsTitle.textContent = `청구항 (${claims.length})`;
  }

  const citationsTitle = document.getElementById('citations-panel-title');
  if (citationsTitle) {
    citationsTitle.textContent = `인용발명 (${citations.length})`;
  }

  const claimMeta = document.getElementById('claims-panel-meta');
  if (claimMeta) {
    const summary = buildClaimHeaderSummary();
    claimMeta.textContent = summary;
    claimMeta.title = summary;
  }

  const citationMeta = document.getElementById('citations-panel-meta');
  if (citationMeta) {
    const summary = buildCitationHeaderSummary();
    citationMeta.textContent = summary;
    citationMeta.title = summary;
  }
}

function getInputPanelElement(panelType) {
  const panelId = panelType === 'claims' ? 'claims-panel' : 'citations-panel';
  return document.getElementById(panelId);
}

function getInputPanelToggleButton(panelType) {
  const buttonId = panelType === 'claims' ? 'btn-toggle-claims-panel' : 'btn-toggle-citations-panel';
  return document.getElementById(buttonId);
}

function setInputPanelCollapsed(panelType, collapsed) {
  const panel = getInputPanelElement(panelType);
  if (!panel) return;

  panel.classList.toggle('panel-collapsed', !!collapsed);

  const toggleButton = getInputPanelToggleButton(panelType);
  if (toggleButton) {
    toggleButton.setAttribute('aria-expanded', String(!collapsed));
    toggleButton.setAttribute('title', collapsed ? 'Expand panel' : 'Collapse panel');
  }
}

function toggleInputPanelCollapse(panelType) {
  if (!document.body.classList.contains('analysis-active')) return;

  const panel = getInputPanelElement(panelType);
  if (!panel) return;

  const collapsed = panel.classList.contains('panel-collapsed');
  setInputPanelCollapsed(panelType, !collapsed);
}

function setResultPanelCollapsed(collapsed) {
  const panel = document.getElementById('analysis-result-panel') || document.querySelector('.result-panel');
  if (!panel) return;

  panel.classList.toggle('panel-collapsed', !!collapsed);

  const toggleButton = document.getElementById('btn-toggle-result-panel');
  if (toggleButton) {
    toggleButton.setAttribute('aria-expanded', String(!collapsed));
    toggleButton.setAttribute('title', collapsed ? 'Expand panel' : 'Collapse panel');
  }
}

function toggleResultPanelCollapse() {
  const panel = document.getElementById('analysis-result-panel') || document.querySelector('.result-panel');
  if (!panel) return;

  const collapsed = panel.classList.contains('panel-collapsed');
  setResultPanelCollapsed(!collapsed);
}

function syncInputPanelLayoutForMode(active) {
  setInputPanelCollapsed('claims', !!active);
  setInputPanelCollapsed('citations', !!active);
}

function getDefaultClaimStepMap() {
  return ANALYSIS_STEPS.reduce((acc, step) => {
    acc[step] = 'pending';
    return acc;
  }, {});
}

function getClaimProgress(claimId) {
  if (claimId === null || claimId === undefined) return null;
  return claimProgressById[String(claimId)] || null;
}

function ensureClaimProgressEntry(claimId, claimName = '') {
  const key = String(claimId);
  if (!claimProgressById[key]) {
    claimProgressById[key] = {
      claimId,
      claimName,
      status: 'pending',
      currentStep: null,
      stepMessage: '',
      steps: getDefaultClaimStepMap(),
      updatedAt: Date.now()
    };
  }

  if (claimName && !claimProgressById[key].claimName) {
    claimProgressById[key].claimName = claimName;
  }
  return claimProgressById[key];
}

function initializeClaimProgress(claimList) {
  claimProgressById = {};
  (claimList || []).forEach((claim, index) => {
    const entry = ensureClaimProgressEntry(claim.id, claim.name || `Claim ${index + 1}`);
    entry.order = index + 1;
  });
  refreshResultClaimSelect(claimList);
}

function initializeClaimProgressFromSavedResults(claimList) {
  claimProgressById = {};
  (claimList || []).forEach((claim, index) => {
    const entry = ensureClaimProgressEntry(claim.id, claim.name || `Claim ${index + 1}`);
    entry.order = index + 1;
    const result = analysisResults?.[claim.id];
    if (!result) return;

    if (result.error) {
      entry.status = 'error';
      entry.currentStep = 'E';
      entry.stepMessage = result.error;
      entry.steps.E = 'error';
      return;
    }

    entry.status = 'done';
    entry.currentStep = 'E';
    entry.stepMessage = 'Completed';
    ANALYSIS_STEPS.forEach(step => {
      entry.steps[step] = 'done';
    });
  });
  refreshResultClaimSelect(claimList);
}

function renderSelectedClaimResultIfVisible(claimId) {
  const selectedValue = Number.parseInt(document.getElementById('result-claim-select')?.value || '', 10);
  const selectedId = Number.isFinite(selectedResultClaimId) ? selectedResultClaimId : selectedValue;
  if (!Number.isFinite(selectedId)) return;
  if (String(selectedId) !== String(claimId)) return;
  renderResultTable(selectedId);
}

function setClaimStepState(claimId, stepId, state, stepMessage = '') {
  const claim = claims.find(c => String(c.id) === String(claimId));
  const progress = ensureClaimProgressEntry(claimId, claim?.name || '');
  progress.steps[stepId] = state;

  if (state === 'active') {
    progress.status = 'running';
    progress.currentStep = stepId;
  } else if (state === 'error') {
    progress.status = 'error';
    progress.currentStep = stepId;
  } else if (state === 'done') {
    const hasAnyActive = ANALYSIS_STEPS.some(step => progress.steps[step] === 'active');
    if (!hasAnyActive) {
      const nextPending = ANALYSIS_STEPS.find(step => progress.steps[step] === 'pending');
      progress.currentStep = nextPending || stepId;
    }
    if (progress.status === 'pending') {
      progress.status = 'running';
    }
  }

  if (stepMessage) {
    progress.stepMessage = stepMessage;
  }

  progress.updatedAt = Date.now();
  refreshResultClaimSelect();
  renderSelectedClaimResultIfVisible(claimId);
}

function setClaimProgressStatus(claimId, status, stepMessage = '') {
  const claim = claims.find(c => String(c.id) === String(claimId));
  const progress = ensureClaimProgressEntry(claimId, claim?.name || '');
  progress.status = status;

  if (status === 'done') {
    ANALYSIS_STEPS.forEach(step => {
      if (progress.steps[step] !== 'error') {
        progress.steps[step] = 'done';
      }
    });
    progress.currentStep = 'E';
  }

  if (stepMessage) {
    progress.stepMessage = stepMessage;
  }

  progress.updatedAt = Date.now();
  refreshResultClaimSelect();
  renderSelectedClaimResultIfVisible(claimId);
}

function setClaimProgressMessage(claimId, message) {
  const claim = claims.find(c => String(c.id) === String(claimId));
  const progress = ensureClaimProgressEntry(claimId, claim?.name || '');
  progress.stepMessage = message || '';
  progress.updatedAt = Date.now();
  renderSelectedClaimResultIfVisible(claimId);
}

function getClaimProgressTag(progress) {
  if (!progress) return 'Pending';
  if (progress.status === 'done') return 'Completed';
  if (progress.status === 'error') return 'Error';
  if (progress.status === 'running') return `Running ${progress.currentStep || '-'}`;
  return 'Pending';
}

function refreshResultClaimSelect(claimList = claims.filter(c => (c.text || '').trim())) {
  const claimSelect = document.getElementById('result-claim-select');
  if (!claimSelect) return;

  const previous = Number.isFinite(selectedResultClaimId)
    ? selectedResultClaimId
    : Number.parseInt(claimSelect.value || '', 10);

  claimSelect.innerHTML = '';
  (claimList || []).forEach(claim => {
    const option = document.createElement('option');
    const progress = getClaimProgress(claim.id);
    option.value = String(claim.id);
    option.textContent = `${claim.name} [${getClaimProgressTag(progress)}]`;
    claimSelect.appendChild(option);
  });

  if (claimSelect.options.length === 0) {
    selectedResultClaimId = null;
    return;
  }

  const existsPrevious = Number.isFinite(previous)
    && (claimList || []).some(claim => String(claim.id) === String(previous));
  const nextId = existsPrevious ? previous : Number.parseInt(claimSelect.options[0].value, 10);
  selectedResultClaimId = nextId;
  claimSelect.value = String(nextId);
}

function showProgress(stepLabel, index, total, claimName) {
  const emptyState = document.querySelector('.result-panel .empty-state');
  if (!emptyState) return;
  const countText = total ? `(${index}/${total})` : '';
  const nameText = claimName ? ` ${claimName}` : '';
  const detail = `${countText}${nameText}`.trim();
  emptyState.style.display = 'block';
  emptyState.innerHTML = detail
    ? `${stepLabel} in progress...<br>${detail}`
    : `${stepLabel} in progress...`;
}

function showParallelProgress(stepLabel, meta, featureId, done, total) {
  const emptyState = document.querySelector('.result-panel .empty-state');
  if (!emptyState) return;
  const countText = meta?.totalClaims ? `(${meta.claimIndex}/${meta.totalClaims})` : '';
  const nameText = meta?.claimName ? ` ${meta.claimName}` : '';
  const featureLabel = featureId && String(featureId).startsWith('Q') ? 'Primary claim' : 'Element';
  const featureText = featureId ? ` ${featureLabel} ${featureId}` : '';
  const progressText = total ? ` ${done}/${total}` : '';
  const detail = `${countText}${nameText}${featureText}${progressText}`.trim();
  emptyState.style.display = 'block';
  emptyState.innerHTML = detail
    ? `${stepLabel} in progress...<br>${detail}`
    : `${stepLabel} in progress...`;
}

const DEBUG_TREE_OPEN_MODE = {
  AUTO: 'auto',
  ALL: 'all',
  NONE: 'none'
};

const DEBUG_TAB_SEQUENCE = ['stepA', 'stepB', 'stepC', 'stepD', 'quick', 'verification', 'final'];
const DEBUG_STEP_SEQUENCE = ['A', 'B', 'C', 'D', 'E'];

const debugUiState = {
  searchTerm: '',
  treeOpenMode: DEBUG_TREE_OPEN_MODE.AUTO,
  stepBSelectionByClaim: {}
};

function hasDownloadableAnalysisSnapshot() {
  return Object.keys(analysisResults || {}).length > 0;
}

function updateDebugExportButtonVisibility() {
  const downloadButton = document.getElementById('btn-download-analysis-json');
  if (!downloadButton) return;

  const shouldShow = !!DEV_FLAGS.SHOW_DEBUG_PANEL
    && !isAnalysisRunning
    && hasDownloadableAnalysisSnapshot();

  downloadButton.classList.toggle('hidden', !shouldShow);
  downloadButton.disabled = !shouldShow;
}

function initDebugPanel() {
  const claimSelect = document.getElementById('debug-claim-select');
  if (claimSelect) {
    claimSelect.addEventListener('change', (e) => {
      debugState.claimId = parseInt(e.target.value, 10);
      renderDebugContent();
    });
  }

  document.querySelectorAll('.debug-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const tabId = e.currentTarget.dataset.tab;
      setActiveDebugTab(tabId);
      renderDebugContent();
    });
  });

  const searchInput = document.getElementById('debug-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      debugUiState.searchTerm = normalizeDebugSearchTerm(e.target.value);
      renderDebugContent();
    });
  }

  const expandAllButton = document.getElementById('btn-debug-expand-all');
  if (expandAllButton) {
    expandAllButton.addEventListener('click', () => {
      debugUiState.treeOpenMode = DEBUG_TREE_OPEN_MODE.ALL;
      renderDebugContent();
    });
  }

  const collapseAllButton = document.getElementById('btn-debug-collapse-all');
  if (collapseAllButton) {
    collapseAllButton.addEventListener('click', () => {
      debugUiState.treeOpenMode = DEBUG_TREE_OPEN_MODE.NONE;
      renderDebugContent();
    });
  }

  ensureDebugTabStructure();
  updateDebugClaimSelect();
  updateDebugExportButtonVisibility();
  renderDebugContent();
}

function setActiveDebugTab(tabId) {
  const normalizedTabId = DEBUG_TAB_SEQUENCE.includes(tabId) ? tabId : 'stepA';
  debugState.tab = normalizedTabId;

  document.querySelectorAll('.debug-tab').forEach(tab => {
    const isActive = tab.dataset.tab === normalizedTabId;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function ensureDebugTabStructure() {
  document.querySelectorAll('.debug-tab').forEach(tab => {
    if (tab.dataset.structured === 'true') return;

    const baseLabel = tab.textContent.trim();
    tab.dataset.baseLabel = baseLabel;
    tab.textContent = '';

    const label = document.createElement('span');
    label.className = 'debug-tab-label';
    label.textContent = baseLabel;

    const badge = document.createElement('span');
    badge.className = 'debug-tab-badge none';
    badge.textContent = 'NONE';

    tab.appendChild(label);
    tab.appendChild(badge);
    tab.dataset.structured = 'true';
  });
}

function updateDebugClaimSelect() {
  const claimSelect = document.getElementById('debug-claim-select');
  if (!claimSelect) return;

  const claimIds = Object.keys(analysisResults || {});
  claimSelect.innerHTML = '';

  if (claimIds.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '(디버그 데이터 없음)';
    claimSelect.appendChild(option);
    debugState.claimId = null;
    updateDebugLastUpdatedText(null);
    updateDebugExportButtonVisibility();
    return;
  }

  const claimMap = new Map(claims.map(c => [String(c.id), c]));
  claimIds.forEach(id => {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = claimMap.get(String(id))?.name || `청구항${id}`;
    claimSelect.appendChild(option);
  });

  if (!debugState.claimId || !claimIds.includes(String(debugState.claimId))) {
    debugState.claimId = parseInt(claimIds[0], 10);
  }

  claimSelect.value = String(debugState.claimId);
  updateDebugExportButtonVisibility();
}

function renderDebugContent() {
  const content = document.getElementById('debug-content');
  const queryList = document.getElementById('debug-query-list');
  const debugMain = document.getElementById('debug-main');

  if (!content) return;

  const claimId = debugState.claimId;
  const result = claimId === null || claimId === undefined
    ? null
    : (analysisResults?.[claimId] || analysisResults?.[String(claimId)] || null);

  if (!result) {
    if (debugMain) debugMain.classList.remove('debug-stepb-active');
    if (queryList) {
      queryList.classList.add('hidden');
      queryList.innerHTML = '';
    }
    hideDebugDetailHeader();
    updateDebugTabBadges(null);
    renderDebugClaimSummary(null, null);
    renderDebugEmptyState('No debug data available.');
    return;
  }

  updateDebugTabBadges(result);
  renderDebugClaimSummary(claimId, result);

  if (debugState.tab === 'stepB') {
    renderStepBView(result, claimId);
    return;
  }

  if (debugMain) debugMain.classList.remove('debug-stepb-active');
  if (queryList) {
    queryList.classList.add('hidden');
    queryList.innerHTML = '';
  }
  hideDebugDetailHeader();

  let payload = null;
  switch (debugState.tab) {
    case 'stepA':
      payload = result.debug?.stepA || { ClaimFeatures: result.ClaimFeatures || [] };
      break;
    case 'stepC':
      payload = result.debug?.stepC || null;
      break;
    case 'stepD':
      payload = result.debug?.stepD || null;
      break;
    case 'quick':
      payload = result.debug?.quick || (result.debug?.quickError ? { quickError: result.debug.quickError } : null);
      break;
    case 'verification':
      payload = result.verifications || null;
      break;
    case 'final':
      payload = {
        ClaimFeatures: result.ClaimFeatures || [],
        Relevant: result.Relevant || {},
        FeatureStatus: result.FeatureStatus || {}
      };
      break;
    default:
      payload = null;
  }

  renderDebugPayload(payload, { emptyMessage: '선택한 탭의 디버그 데이터가 없습니다.' });
}

function renderStepBView(result, claimId) {
  const debugMain = document.getElementById('debug-main');
  const queryList = document.getElementById('debug-query-list');
  if (!queryList) return;

  if (debugMain) debugMain.classList.add('debug-stepb-active');
  queryList.classList.remove('hidden');
  queryList.innerHTML = '';

  const allEntries = buildStepBEntries(result?.debug?.stepB);
  if (allEntries.length === 0) {
    hideDebugDetailHeader();
    renderDebugEmptyState('B 단계의 디버그 데이터가 없습니다.');
    const empty = document.createElement('div');
    empty.className = 'debug-empty-state';
    empty.textContent = '분석된 쿼리 항목이 없습니다.';
    queryList.appendChild(empty);
    return;
  }

  const filteredEntries = allEntries.filter(entry => isStepBEntryMatchedBySearch(entry, debugUiState.searchTerm));
  if (filteredEntries.length === 0) {
    hideDebugDetailHeader();
    renderDebugPayload(null, { emptyMessage: '검색 조건에 맞는 B 단계 항목이 없습니다.' });
    const noMatch = document.createElement('div');
    noMatch.className = 'debug-empty-state';
    noMatch.textContent = '검색 조건에 맞는 B 단계 항목이 없습니다.';
    queryList.appendChild(noMatch);
    return;
  }

  const claimKey = String(claimId);
  let selectedKey = debugUiState.stepBSelectionByClaim[claimKey];
  if (!filteredEntries.some(entry => entry.key === selectedKey)) {
    selectedKey = filteredEntries[0].key;
  }
  debugUiState.stepBSelectionByClaim[claimKey] = selectedKey;

  filteredEntries.forEach(entry => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `debug-query-row ${entry.key === selectedKey ? 'active' : ''}`;

    const title = document.createElement('div');
    title.className = 'debug-query-row-title';

    const titleText = document.createElement('span');
    titleText.textContent = entry.label;

    const status = document.createElement('span');
    status.className = `debug-query-status ${entry.ok ? 'ok' : 'err'}`;
    status.textContent = entry.ok ? 'OK' : 'ERR';

    title.appendChild(titleText);
    title.appendChild(status);
    row.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'debug-query-row-meta';
    meta.textContent = entry.summary || '(요약 정보 없음)';
    row.appendChild(meta);

    row.addEventListener('click', () => {
      debugUiState.stepBSelectionByClaim[claimKey] = entry.key;
      renderDebugContent();
    });

    queryList.appendChild(row);
  });

  const selectedEntry = filteredEntries.find(entry => entry.key === selectedKey) || filteredEntries[0];
  showDebugDetailHeader(selectedEntry.label, selectedEntry.summary || '-');
  renderDebugPayload(selectedEntry.payload, { emptyMessage: '선택된 B 단계 항목에 payload가 없습니다.' });
}

function buildStepBEntries(stepB) {
  if (!stepB || !stepB.responses) return [];

  const entries = [];

  if (stepB.merge) {
    entries.push({
      key: 'merge',
      kind: 'merge',
      label: 'B-3 Merge',
      summary: 'Merged output across all query bundles.',
      ok: true,
      payload: stepB.merge
    });
  }

  const responses = stepB.responses || {};
  if (Array.isArray(responses)) {
    const queriesByIndex = Array.isArray(stepB.queriesByIndex) ? stepB.queriesByIndex : [];

    responses.forEach((entry, idx) => {
      const queryIndex = Number.isFinite(entry?.queryIndex) ? entry.queryIndex : (idx + 1);
      const bundle = queriesByIndex[idx] || entry?.queries || [];
      const summary = formatStepBBundleSummary(bundle);

      entries.push({
        key: `bundle-${queryIndex}`,
        kind: 'bundle',
        label: `쿼리세트${queryIndex}`,
        summary: summary || '(요약 정보 없음)',
        ok: !!entry?.ok,
        payload: entry?.ok
          ? (entry.result || null)
          : {
            queryIndex,
            error: entry?.error || '요청 처리 중 오류',
            queries: bundle
          }
      });
    });

    return entries;
  }

  const queriesByFeature = stepB.queries || {};

  Object.entries(responses || {}).forEach(([featureId, featureResponses]) => {
    const responseList = Array.isArray(featureResponses) ? featureResponses : [];
    const featureQueries = Array.isArray(queriesByFeature[featureId]) ? queriesByFeature[featureId] : [];

    responseList.forEach((entry, idx) => {
      const queryText = featureQueries[idx] || entry?.query || '';
      entries.push({
        key: `feature-${featureId}-${idx + 1}`,
        kind: 'feature',
        label: `${featureId} / Query ${idx + 1}`,
        summary: queryText || '(요약 정보 없음)',
        ok: !!entry?.ok,
        payload: entry?.ok
          ? (entry.result || null)
          : {
            featureId,
            queryIndex: idx + 1,
            error: entry?.error || '요청 처리 중 오류',
            query: queryText
          }
      });
    });
  });

  return entries;
}

function formatStepBBundleSummary(bundle) {
  if (!Array.isArray(bundle) || bundle.length === 0) return '';

  return bundle
    .map(item => {
      const featureId = String(item?.Feature || item?.Id || '').trim();
      const queryText = String(item?.Query || item?.query || '').trim();
      if (!featureId && !queryText) return '';
      return featureId ? `${featureId}: ${queryText}` : queryText;
    })
    .filter(Boolean)
    .join(' | ');
}

function isStepBEntryMatchedBySearch(entry, searchTerm) {
  if (!searchTerm) return true;

  const preview = buildDebugSearchPreview(entry.payload, 1200);
  const source = `${entry.label} ${entry.summary || ''} ${preview}`.toLowerCase();
  return source.includes(searchTerm);
}

function buildDebugSearchPreview(value, maxLength = 1200) {
  try {
    const raw = JSON.stringify(value);
    if (!raw) return '';
    return raw.length > maxLength ? raw.slice(0, maxLength) : raw;
  } catch (_error) {
    return String(value || '');
  }
}

function updateDebugTabBadges(result) {
  ensureDebugTabStructure();
  const claimId = debugState.claimId;
  const progress = claimId === null || claimId === undefined
    ? null
    : claimProgressById?.[String(claimId)] || null;
  const updatedText = formatDebugTimestamp(progress?.updatedAt || null);

  document.querySelectorAll('.debug-tab').forEach(tab => {
    const tabId = tab.dataset.tab;
    const badge = tab.querySelector('.debug-tab-badge');
    if (!badge) return;

    const metrics = getDebugTabMetrics(tabId, result);
    badge.className = `debug-tab-badge ${metrics.badgeClass}`;
    badge.textContent = metrics.badgeText;
    tab.classList.toggle('has-error', metrics.errorCount > 0);
    tab.title = `${metrics.title} / 최종 업데이트: ${updatedText}`;
  });
}

function getDebugTabMetrics(tabId, result) {
  if (!result) {
    return {
      hasData: false,
      errorCount: 0,
      badgeClass: 'none',
      badgeText: 'NONE',
      title: '디버그 데이터 없음'
    };
  }

  const debug = result.debug || {};
  let hasData = false;
  let errorCount = 0;

  switch (tabId) {
    case 'stepA':
      hasData = !!debug.stepA || Array.isArray(result.ClaimFeatures) && result.ClaimFeatures.length > 0;
      errorCount = debug.stepAError ? 1 : 0;
      break;
    case 'stepB': {
      const stepBEntries = buildStepBEntries(debug.stepB).filter(entry => entry.kind !== 'merge');
      hasData = stepBEntries.length > 0;
      const responseErrorCount = stepBEntries.filter(entry => !entry.ok).length;
      errorCount = (debug.stepBError ? 1 : 0) + responseErrorCount;
      break;
    }
    case 'stepC':
      hasData = !!debug.stepC;
      errorCount = debug.stepCError ? 1 : 0;
      break;
    case 'stepD':
      hasData = !!debug.stepD;
      errorCount = debug.stepDError ? 1 : 0;
      break;
    case 'quick':
      hasData = !!debug.quick || !!debug.quickError;
      errorCount = debug.quickError ? 1 : 0;
      break;
    case 'verification':
      hasData = Object.keys(result.verifications || {}).length > 0;
      errorCount = 0;
      break;
    case 'final':
      hasData = (result.ClaimFeatures || []).length > 0
        || Object.keys(result.Relevant || {}).length > 0
        || Object.keys(result.FeatureStatus || {}).length > 0;
      errorCount = result.error ? 1 : 0;
      break;
    default:
      hasData = false;
      errorCount = 0;
  }

  let badgeClass = 'none';
  let badgeText = 'NONE';
  if (errorCount > 0) {
    badgeClass = 'err';
    badgeText = `ERR ${errorCount}`;
  } else if (hasData) {
    badgeClass = 'ok';
    badgeText = 'OK';
  }

  const title = errorCount > 0
    ? `디버그 데이터 ${hasData ? '존재' : '없음'} / 오류 수: ${errorCount}`
    : `디버그 데이터 ${hasData ? '존재' : '없음'}`;

  return {
    hasData,
    errorCount,
    badgeClass,
    badgeText,
    title
  };
}

function renderDebugClaimSummary(claimId, result) {
  const summaryBox = document.getElementById('debug-claim-summary');
  if (!summaryBox) return;

  if (claimId === null || claimId === undefined || !result) {
    summaryBox.classList.add('hidden');
    summaryBox.innerHTML = '';
    updateDebugLastUpdatedText(null);
    return;
  }

  const claim = claims.find(item => String(item.id) === String(claimId));
  const claimName = claim?.name || `Claim ${claimId}`;
  const modeLabel = isQuickDebugResult(result) ? 'Quick' : 'Deep';
  const progress = claimProgressById?.[String(claimId)] || null;
  const updatedText = formatDebugTimestamp(progress?.updatedAt || null);

  summaryBox.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'debug-claim-summary-head';

  const title = document.createElement('div');
  title.className = 'debug-claim-summary-title';
  title.textContent = `${claimName} | ${modeLabel} mode`;

  const meta = document.createElement('div');
  meta.className = 'debug-claim-summary-meta';
  meta.textContent = `Updated ${updatedText}`;

  head.appendChild(title);
  head.appendChild(meta);

  const steps = document.createElement('div');
  steps.className = 'debug-claim-step-row';

  DEBUG_STEP_SEQUENCE.forEach(stepId => {
    const state = getDebugStepState(claimId, result, stepId);
    const durationMs = getDebugStepDurationMs(result, stepId);
    const durationText = formatDebugStepDuration(durationMs);
    const chip = document.createElement('span');
    chip.className = `debug-claim-step-chip ${state}`;
    chip.textContent = durationText
      ? `${stepId}: ${formatDebugStepStateLabel(state)} | ${durationText}`
      : `${stepId}: ${formatDebugStepStateLabel(state)}`;
    steps.appendChild(chip);
  });

  summaryBox.appendChild(head);
  summaryBox.appendChild(steps);
  summaryBox.classList.remove('hidden');

  updateDebugLastUpdatedText(claimId);
}

function isQuickDebugResult(result) {
  return !!(result?.debug?.quick || result?.debug?.quickError);
}

function getDebugStepTiming(result, stepId) {
  const timings = result?.debug?.stepTimings;
  if (!timings || typeof timings !== 'object' || Array.isArray(timings)) return null;

  const timing = timings[stepId];
  if (!timing || typeof timing !== 'object' || Array.isArray(timing)) return null;

  return timing;
}

function normalizeDebugStepTimingStatus(result, stepId) {
  const status = String(getDebugStepTiming(result, stepId)?.status || '').trim().toLowerCase();
  if (
    status === 'active'
    || status === 'done'
    || status === 'error'
    || status === 'pending'
    || status === 'skipped'
  ) {
    return status;
  }
  return null;
}

function getDebugStepDurationMs(result, stepId) {
  const timing = getDebugStepTiming(result, stepId);
  if (!timing) return null;

  if (Number.isFinite(timing.durationMs) && timing.durationMs >= 0) {
    return timing.durationMs;
  }

  if (timing.status === 'active' && Number.isFinite(timing.startedAt)) {
    return Math.max(0, Date.now() - timing.startedAt);
  }

  return null;
}

function formatDebugStepDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;

  const seconds = durationMs / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;

  const roundedSeconds = Math.round(seconds);
  const minutes = Math.floor(roundedSeconds / 60);
  const remainSeconds = roundedSeconds % 60;
  return `${minutes}m ${String(remainSeconds).padStart(2, '0')}s`;
}

function getDebugStepState(claimId, result, stepId) {
  const progress = claimProgressById?.[String(claimId)] || null;
  const progressState = progress?.steps?.[stepId];
  const timingStatus = normalizeDebugStepTimingStatus(result, stepId);

  if (stepId === 'D' && (result?.debug?.stepD?.skipped || timingStatus === 'skipped')) {
    return 'skipped';
  }

  if (progressState === 'active' || progressState === 'done' || progressState === 'error' || progressState === 'pending') {
    return progressState;
  }

  if (timingStatus) {
    return timingStatus;
  }

  const debug = result?.debug || {};
  const isQuick = isQuickDebugResult(result);

  switch (stepId) {
    case 'A':
      if (debug.stepAError || debug.quickError) return 'error';
      if (debug.stepA || isQuick) return 'done';
      return 'pending';
    case 'B':
      if (debug.stepBError) return 'error';
      if (debug.stepB || isQuick) return 'done';
      return 'pending';
    case 'C':
      if (debug.stepCError) return 'error';
      if (debug.stepC || isQuick) return 'done';
      return 'pending';
    case 'D':
      if (debug.stepDError) return 'error';
      if (debug.stepD?.skipped) return 'skipped';
      if (debug.stepD || isQuick) return 'done';
      return 'pending';
    case 'E':
      if (debug.stepEError) return 'error';
      if (Object.keys(result?.verifications || {}).length > 0 || isQuick) return 'done';
      return 'pending';
    default:
      return 'pending';
  }
}

function formatDebugStepStateLabel(state) {
  switch (state) {
    case 'done':
      return 'Completed';
    case 'active':
      return 'Running';
    case 'error':
      return 'Error';
    case 'skipped':
      return 'Skipped';
    default:
      return 'Pending';
  }
}

function updateDebugLastUpdatedText(claimId) {
  const target = document.getElementById('debug-last-updated');
  if (!target) return;

  if (claimId === null || claimId === undefined) {
    target.textContent = 'Last updated: -';
    return;
  }

  const progress = claimProgressById?.[String(claimId)] || null;
  const updatedText = formatDebugTimestamp(progress?.updatedAt || null);
  target.textContent = `Last updated: ${updatedText}`;
}

function formatDebugTimestamp(timestamp) {
  if (!timestamp) return '-';

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '-';

  return date.toLocaleString();
}

function showDebugDetailHeader(titleText, metaText) {
  const header = document.getElementById('debug-detail-header');
  const title = document.getElementById('debug-detail-title');
  const meta = document.getElementById('debug-detail-meta');

  if (!header || !title || !meta) return;

  title.textContent = titleText || '';
  meta.textContent = metaText || '';
  header.classList.remove('hidden');
}

function hideDebugDetailHeader() {
  const header = document.getElementById('debug-detail-header');
  const title = document.getElementById('debug-detail-title');
  const meta = document.getElementById('debug-detail-meta');

  if (title) title.textContent = '';
  if (meta) meta.textContent = '';
  if (header) header.classList.add('hidden');
}

function renderDebugPayload(payload, options = {}) {
  const content = document.getElementById('debug-content');
  if (!content) return;

  content.innerHTML = '';

  if (payload === null || payload === undefined) {
    renderDebugEmptyState(options.emptyMessage || '표시할 payload가 없습니다.');
    return;
  }

  const searchTerm = debugUiState.searchTerm;
  const tree = document.createElement('div');
  tree.className = 'debug-tree';

  let matchedCount = 0;

  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      if (appendDebugTreeLeaf(tree, '(array)', [], '$', searchTerm)) {
        matchedCount += 1;
      }
    } else {
      payload.forEach((item, idx) => {
        const path = buildDebugPath('$', String(idx), true);
        if (appendDebugTreeNode(tree, `[${idx}]`, item, path, 0, searchTerm)) {
          matchedCount += 1;
        }
      });
    }
  } else if (payload && typeof payload === 'object') {
    const entries = Object.entries(payload);
    if (entries.length === 0) {
      if (appendDebugTreeLeaf(tree, '(object)', {}, '$', searchTerm)) {
        matchedCount += 1;
      }
    } else {
      entries.forEach(([key, value]) => {
        const path = buildDebugPath('$', key, false);
        if (appendDebugTreeNode(tree, key, value, path, 0, searchTerm)) {
          matchedCount += 1;
        }
      });
    }
  } else {
    if (appendDebugTreeLeaf(tree, '(value)', payload, '$', searchTerm)) {
      matchedCount += 1;
    }
  }

  if (matchedCount === 0) {
    const noMatch = document.createElement('div');
    noMatch.className = 'debug-tree-no-match';
    noMatch.textContent = searchTerm
      ? '검색 조건에 일치하는 key/path/value가 없습니다.'
      : (options.emptyMessage || '표시할 payload가 없습니다.');
    content.appendChild(noMatch);
    return;
  }

  content.appendChild(tree);
}

function renderDebugEmptyState(message) {
  const content = document.getElementById('debug-content');
  if (!content) return;

  content.innerHTML = '';
  const empty = document.createElement('div');
  empty.className = 'debug-empty-state';
  empty.textContent = message;
  content.appendChild(empty);
}

function appendDebugTreeNode(container, key, value, path, depth, searchTerm) {
  const type = getDebugValueType(value);

  if (type !== 'object' && type !== 'array') {
    return appendDebugTreeLeaf(container, key, value, path, searchTerm);
  }

  const entries = type === 'array'
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value || {});

  const childContainer = document.createElement('div');
  childContainer.className = 'debug-tree-children';

  let childMatchCount = 0;
  entries.forEach(([childKey, childValue]) => {
    const childPath = buildDebugPath(path, childKey, type === 'array');
    const childLabel = type === 'array' ? `[${childKey}]` : childKey;
    if (appendDebugTreeNode(childContainer, childLabel, childValue, childPath, depth + 1, searchTerm)) {
      childMatchCount += 1;
    }
  });

  const selfSource = `${String(key)} ${path} ${type}`.toLowerCase();
  const selfMatch = !searchTerm || selfSource.includes(searchTerm);
  if (searchTerm && !selfMatch && childMatchCount === 0) {
    return false;
  }

  if (entries.length === 0) {
    appendDebugTreeLeaf(
      childContainer,
      '(empty)',
      type === 'array' ? [] : {},
      path,
      searchTerm,
      { force: true }
    );
  }

  const branch = document.createElement('details');
  branch.className = 'debug-tree-branch';
  branch.open = shouldOpenDebugBranch(depth, searchTerm);

  const summary = document.createElement('summary');
  summary.className = 'debug-tree-summary';

  const summaryMain = document.createElement('div');
  summaryMain.className = 'debug-tree-summary-main';

  const keyEl = document.createElement('span');
  keyEl.className = 'debug-tree-key';
  keyEl.textContent = key;

  const pathEl = document.createElement('span');
  pathEl.className = 'debug-tree-path';
  pathEl.textContent = path;

  const typeEl = document.createElement('span');
  typeEl.className = 'debug-tree-type';
  typeEl.textContent = type === 'array' ? `arr(${entries.length})` : `obj(${entries.length})`;

  summaryMain.appendChild(keyEl);
  summaryMain.appendChild(pathEl);
  summaryMain.appendChild(typeEl);

  const copyButton = createDebugCopyButton(path);

  summary.appendChild(summaryMain);
  summary.appendChild(copyButton);

  branch.appendChild(summary);
  branch.appendChild(childContainer);

  container.appendChild(branch);
  return true;
}

function appendDebugTreeLeaf(container, key, value, path, searchTerm, options = {}) {
  const type = getDebugValueType(value);
  const valueText = formatDebugLeafValue(value);
  const source = `${String(key)} ${path} ${valueText}`.toLowerCase();

  if (!options.force && searchTerm && !source.includes(searchTerm)) {
    return false;
  }

  const leaf = document.createElement('div');
  leaf.className = 'debug-tree-leaf';

  const main = document.createElement('div');
  main.className = 'debug-tree-leaf-main';

  const keyLine = document.createElement('div');
  keyLine.className = 'debug-tree-summary-main';

  const keyEl = document.createElement('span');
  keyEl.className = 'debug-tree-key';
  keyEl.textContent = key;

  const pathEl = document.createElement('span');
  pathEl.className = 'debug-tree-path';
  pathEl.textContent = path;

  keyLine.appendChild(keyEl);
  keyLine.appendChild(pathEl);

  const valueEl = document.createElement('div');
  valueEl.className = `debug-tree-value type-${type}`;
  valueEl.textContent = valueText;

  main.appendChild(keyLine);
  main.appendChild(valueEl);

  const copyButton = createDebugCopyButton(path);

  leaf.appendChild(main);
  leaf.appendChild(copyButton);

  container.appendChild(leaf);
  return true;
}

function createDebugCopyButton(path) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'debug-tree-copy';
  button.textContent = 'Copy path';

  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    copyDebugPath(path, button);
  });

  return button;
}

function copyDebugPath(path, button) {
  if (!path || !navigator?.clipboard?.writeText) return;

  navigator.clipboard.writeText(path)
    .then(() => {
      if (!button) return;
      const previous = button.textContent;
      button.textContent = 'Copied';
      window.setTimeout(() => {
        button.textContent = previous;
      }, 900);
    })
    .catch(error => {
      console.warn('Failed to copy debug path:', error);
    });
}

function shouldOpenDebugBranch(depth, searchTerm) {
  if (searchTerm) return true;

  if (debugUiState.treeOpenMode === DEBUG_TREE_OPEN_MODE.ALL) return true;
  if (debugUiState.treeOpenMode === DEBUG_TREE_OPEN_MODE.NONE) return false;

  return depth <= 0;
}

function normalizeDebugSearchTerm(value) {
  return String(value || '').trim().toLowerCase();
}

function buildDebugPath(parentPath, key, parentIsArray) {
  const normalizedParent = parentPath || '$';
  const normalizedKey = String(key);

  if (parentIsArray) {
    return `${normalizedParent}[${normalizedKey}]`;
  }

  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(normalizedKey)) {
    return `${normalizedParent}.${normalizedKey}`;
  }

  return `${normalizedParent}[${JSON.stringify(normalizedKey)}]`;
}

function getDebugValueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function formatDebugLeafValue(value) {
  const type = getDebugValueType(value);

  switch (type) {
    case 'string':
      return `"${value}"`;
    case 'number':
    case 'boolean':
      return String(value);
    case 'null':
      return 'null';
    case 'array':
      return `Array(${value.length})`;
    case 'object':
      return `Object(${Object.keys(value || {}).length})`;
    case 'undefined':
      return 'undefined';
    default:
      return String(value);
  }
}



function setAnalysisMode(active) {
  const isActive = !!active;
  try {
    localStorage.setItem(ANALYSIS_MODE_STORAGE_KEY, String(isActive));
  } catch (error) {
    console.warn('Failed to persist analysis mode:', error);
  }
  document.body.classList.toggle('analysis-active', isActive);
  if (isActive) {
    document.body.classList.remove('settings-open');
    const settingsToggle = document.getElementById('btn-settings-toggle');
    if (settingsToggle) settingsToggle.setAttribute('aria-expanded', 'false');
  }

  syncInputPanelLayoutForMode(isActive);

  const editButton = document.getElementById('btn-edit-mode');
  if (editButton) {
    editButton.classList.toggle('hidden', !isActive);
  }

  if (typeof renderClaims === 'function') {
    renderClaims();
  }
  if (typeof renderCitations === 'function') {
    renderCitations();
  }

  updateInputSummary();
}

function updateInputSummary() {
  const meta = getAnalysisMeta();
  const claimSummary = document.getElementById('claim-summary-compact');
  if (claimSummary) {
    const totalClaims = claims.length;
    const filledClaims = claims.filter(c => c.text && c.text.trim()).length;
    claimSummary.innerHTML = `
      <div class="summary-title">Claims Summary</div>
      <div class="summary-row">
        <span>Filled claims</span>
        <strong>${filledClaims}/${totalClaims}</strong>
      </div>
      <div class="summary-meta">Last run: ${meta.lastRunText}</div>
      <div class="summary-chips">
        <span class="summary-chip">Total ${totalClaims}</span>
        <span class="summary-chip">Filled ${filledClaims}</span>
      </div>
    `;
  }

  const citationSummary = document.getElementById('citation-summary-compact');
  if (citationSummary) {
    const total = citations.length;
    const completed = citations.filter(c => c.status === 'completed').length;
    const processing = citations.filter(c => c.status === 'processing' || c.status === 'uploading').length;
    const failed = citations.filter(c => c.status === 'failed').length;

    citationSummary.innerHTML = `
      <div class="summary-title">References Summary</div>
      <div class="summary-row">
        <span>Completed references</span>
        <strong>${completed}/${total}</strong>
      </div>
      <div class="summary-meta">Last step: ${meta.stepText}</div>
      <div class="summary-chips">
        <span class="summary-chip">Total ${total}</span>
        <span class="summary-chip">Completed ${completed}</span>
        <span class="summary-chip">In progress ${processing}</span>
        <span class="summary-chip">Failed ${failed}</span>
      </div>
    `;
  }

  updateInputPanelHeaders();
}

function getAnalysisMeta() {
  const lastRun = localStorage.getItem('analysisLastRunAt');
  const lastStep = localStorage.getItem('analysisLastStep');
  const lastRunText = lastRun ? new Date(lastRun).toLocaleString() : 'No run';
  const stepText = lastStep || 'No step';
  return { lastRunText, stepText };
}

function findParagraphEntriesInRange(paragraphs, start, end) {
  if (!paragraphs || typeof paragraphs !== 'object') return [];
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];

  const byNumber = new Map();
  Object.entries(paragraphs).forEach(([rawKey, rawValue]) => {
    const number = parseParagraphNumberFromKey(rawKey);
    if (!Number.isFinite(number)) return;
    if (number < start || number > end) return;
    const text = String(rawValue || '').trim();
    if (!text) return;
    if (!byNumber.has(number)) {
      byNumber.set(number, {
        key: formatParagraphNumberKey(number) || normalizeParagraphLookupKey(rawKey) || String(rawKey || '').trim(),
        text
      });
    }
  });

  const rows = [];
  for (let number = start; number <= end; number += 1) {
    const hit = byNumber.get(number);
    if (hit) rows.push(hit);
  }
  return rows;
}

function buildParagraphRangeContent(entries, rangeInfo) {
  if (!Array.isArray(entries) || entries.length === 0) return '';

  const lines = entries.map((entry) => `${entry.key}\n${entry.text}`);
  if (!rangeInfo || !rangeInfo.isRange) {
    return lines.join('\n\n');
  }

  const missing = [];
  for (let number = rangeInfo.start; number <= rangeInfo.end; number += 1) {
    const exists = entries.some((entry) => parseParagraphNumberFromKey(entry.key) === number);
    if (!exists) {
      const key = formatParagraphNumberKey(number);
      if (key) missing.push(key);
    }
  }

  if (missing.length > 0) {
    lines.push(`[Missing]\n${missing.join(', ')}`);
  }
  return lines.join('\n\n');
}

function findCitationByDocName(docName) {
  const target = String(docName || '').trim();
  if (!target) return null;

  const matchedByName = citations.find(c => String(c.name || '').trim() === target);
  if (matchedByName) return matchedByName;

  const matchedByTitle = citations.find(c => String(c.title || '').trim() === target);
  if (matchedByTitle) return matchedByTitle;

  const docAlias = target.match(/^D\s*(\d{1,3})$/i);
  if (docAlias) {
    const index = Number.parseInt(docAlias[1], 10) - 1;
    if (Number.isFinite(index) && index >= 0 && index < citations.length) {
      return citations[index];
    }
  }

  return null;
}

function parseCitationParagraphs(citation) {
  if (!citation || typeof citation.text !== 'string') return null;
  let parsed = null;

  try {
    parsed = safeJsonParse(citation.text);
  } catch (_error) {
    return null;
  }

  const paragraphs = parsed?.paragraphs;
  if (!paragraphs || typeof paragraphs !== 'object' || Array.isArray(paragraphs)) {
    return null;
  }
  return paragraphs;
}

function findParagraphTextByKey(paragraphs, paragraphKey) {
  const normalizedKey = normalizeParagraphLookupKey(paragraphKey);
  if (!normalizedKey || !paragraphs) return null;

  if (typeof paragraphs[normalizedKey] === 'string' && paragraphs[normalizedKey].trim()) {
    return { key: normalizedKey, text: paragraphs[normalizedKey].trim() };
  }

  const matchedKey = Object.keys(paragraphs).find(key => normalizeParagraphLookupKey(key) === normalizedKey);
  if (!matchedKey) return null;

  const text = String(paragraphs[matchedKey] || '').trim();
  if (!text) return null;
  return { key: matchedKey, text };
}

function getPositionModalSummaryText(relatedContent) {
  const text = String(relatedContent || '').trim();
  return text || '\uAD00\uB828 \uB0B4\uC6A9\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.';
}

function renderPositionModalBody(summaryText, sourceText) {
  const summaryEl = document.getElementById('position-modal-summary');
  const sourceEl = document.getElementById('position-modal-source');
  if (!summaryEl || !sourceEl) return false;

  summaryEl.textContent = String(summaryText || '').trim() || '\uAD00\uB828 \uB0B4\uC6A9\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.';
  sourceEl.textContent = String(sourceText || '').trim() || '\uC6D0\uBB38 \uB0B4\uC6A9\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.';
  return true;
}

function setPositionModalBody(summaryText, sourceText, fallbackContentEl) {
  const hasStructuredBody = renderPositionModalBody(summaryText, sourceText);
  if (hasStructuredBody) return;

  if (!fallbackContentEl) return;
  const safeSummary = String(summaryText || '').trim() || '\uAD00\uB828 \uB0B4\uC6A9\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.';
  const safeSource = String(sourceText || '').trim() || '\uC6D0\uBB38 \uB0B4\uC6A9\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.';
  fallbackContentEl.textContent = `\uC694\uC57D\uB0B4\uC6A9\n${safeSummary}\n\n\uC6D0\uBB38\n${safeSource}`;
}

function openPositionModal(docName, paragraphKey, relatedContent = '') {
  const titleEl = document.getElementById('position-modal-title');
  const contentEl = document.getElementById('position-modal-content');
  if (!titleEl || !contentEl) return;

  const summaryText = getPositionModalSummaryText(relatedContent);
  const rangeInfo = parseParagraphKeyRange(paragraphKey);
  const normalizedKey = rangeInfo?.label || normalizeParagraphLookupKey(paragraphKey) || String(paragraphKey || '').trim();
  const citation = findCitationByDocName(docName);
  titleEl.textContent = `${docName || 'Document'} ${normalizedKey || ''} paragraph`;

  if (!citation) {
    setPositionModalBody(summaryText, 'Citation document not found.', contentEl);
    openDialogModal('position-modal', '#btn-close-position-modal');
    return;
  }

  const paragraphs = parseCitationParagraphs(citation);
  if (!paragraphs) {
    setPositionModalBody(summaryText, 'This citation does not contain paragraph JSON data.', contentEl);
    openDialogModal('position-modal', '#btn-close-position-modal');
    return;
  }

  if (rangeInfo?.isRange) {
    const entries = findParagraphEntriesInRange(paragraphs, rangeInfo.start, rangeInfo.end);
    if (entries.length === 0) {
      setPositionModalBody(summaryText, `Range ${rangeInfo.label} was not found in source paragraphs.`, contentEl);
      openDialogModal('position-modal', '#btn-close-position-modal');
      return;
    }

    titleEl.textContent = `${docName || citation.name || 'Document'} ${rangeInfo.label} paragraph range`;
    setPositionModalBody(summaryText, buildParagraphRangeContent(entries, rangeInfo), contentEl);
    openDialogModal('position-modal', '#btn-close-position-modal');
    return;
  }

  const found = findParagraphTextByKey(paragraphs, normalizedKey);
  if (!found) {
    setPositionModalBody(summaryText, `${normalizedKey || paragraphKey} paragraph was not found in source paragraphs.`, contentEl);
    openDialogModal('position-modal', '#btn-close-position-modal');
    return;
  }

  titleEl.textContent = `${docName || citation.name || 'Document'} ${found.key} paragraph`;
  setPositionModalBody(summaryText, found.text, contentEl);
  openDialogModal('position-modal', '#btn-close-position-modal');
}
function closePositionModal() {
  closeDialogModal('position-modal');
}

function openVerificationModal(reason) {
  const content = document.getElementById('verification-modal-content');
  
  content.textContent = reason;
  openDialogModal('verification-modal', '#btn-copy-verification-content');
}

function closeVerificationModal() {
  closeDialogModal('verification-modal');
}
