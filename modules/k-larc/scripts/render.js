function renderResultClaimStepIndicator(claimId, data, progress) {
  const card = document.getElementById('result-claim-progress-card');
  const text = document.getElementById('result-claim-progress-text');
  const indicator = document.getElementById('result-claim-step-indicator');
  if (!card || !text || !indicator) return;

  const isCompleted = (progress?.status === 'done') || (!progress && data && !data.error);
  if (isCompleted) {
    indicator.innerHTML = '';
    text.textContent = '';
    card.classList.add('hidden');
    return;
  }

  // 진행 상세 메시지는 empty-state 영역에서만 보여주고, 상단 텍스트는 숨긴다.
  text.textContent = '';
  text.classList.add('hidden');
  indicator.innerHTML = '';

  const stepLabels = {
    A: 'A단계: 구성요소',
    B: 'B단계: 멀티쿼리 RAG',
    C: 'C단계: 멀티-저지',
    D: 'D단계: 리페어',
    E: 'E단계: 검증'
  };

  ANALYSIS_STEPS.forEach(stepId => {
    let stepState = progress?.steps?.[stepId] || 'pending';
    if (data?.error && stepState === 'pending' && progress?.currentStep === stepId) {
      stepState = 'error';
    }

    const item = document.createElement('div');
    item.className = `step-item ${stepState}`;
    item.dataset.step = stepId;

    const dot = document.createElement('span');
    dot.className = 'step-dot';
    dot.textContent = stepId;

    const label = document.createElement('span');
    label.className = 'step-label';
    label.textContent = stepLabels[stepId] || `${stepId}단계`;

    item.appendChild(dot);
    item.appendChild(label);
    indicator.appendChild(item);
  });

  card.classList.remove('hidden');
}

function shouldRenderCompletedResult(data, progress) {
  if (!data || data.error) return false;
  if (!progress) return true;
  return progress.status === 'done';
}

function hasRelevantRows(relevant) {
  return Object.values(relevant || {}).some(items => Array.isArray(items) && items.length > 0);
}

function ensureMockRelevantRows(data) {
  const current = data?.Relevant || {};
  if (!settings?.mockMode) return current;
  if (hasRelevantRows(current)) return current;

  const features = Array.isArray(data?.ClaimFeatures) ? data.ClaimFeatures : [];
  if (features.length === 0) return current;

  const generated = mergeRelevantWithPositions({}, buildMockRelevant(features, 'UI'));
  data.Relevant = generated;
  return generated;
}

function renderResultTable(claimId) {
  const summaryBox = document.getElementById('claim-summary-box');
  const featureList = document.getElementById('claim-features-list');
  const table = document.getElementById('analysis-table');
  const tbody = document.getElementById('result-tbody');
  const emptyState = document.querySelector('.result-panel .empty-state');

  selectedResultClaimId = Number.parseInt(claimId, 10);
  refreshOpinionNoticeCard();

  tbody.innerHTML = '';
  featureList.innerHTML = '';

  const data = analysisResults[claimId];
  const progress = getClaimProgress(claimId);
  renderResultClaimStepIndicator(claimId, data, progress);

  if (!data || data.error || !shouldRenderCompletedResult(data, progress)) {
    summaryBox.classList.add('hidden');
    table.classList.add('hidden');
    emptyState.style.display = 'block';

    if (data?.error) {
      emptyState.innerHTML = `이 청구항 분석 중 오류가 발생했습니다.<br>${data.error}`;
      return;
    }

    const currentStep = progress?.currentStep ? `${progress.currentStep}단계` : '대기 중';
    const message = (progress?.stepMessage || '').trim() || '이 청구항은 대기 중이거나 분석이 진행 중입니다.';
    emptyState.innerHTML = `${currentStep}<br>${message}`;
    return;
  }

  emptyState.style.display = 'none';

  const relevantData = ensureMockRelevantRows(data);
  const claimFeatures = data.ClaimFeatures || [];
  const pastelColors = ['#f0f9ff', '#f0fdf4', '#fefce8', '#fff7ed', '#fdf2f8', '#faf5ff', '#f5f5f4'];

  const mentionedFeatures = new Set();
  Object.values(relevantData).flat().forEach(item => {
    if (item.Feature) {
      mentionedFeatures.add(item.Feature);
    }
  });

  if (claimFeatures.length > 0) {
    summaryBox.classList.remove('hidden');

    claimFeatures.forEach((feat, idx) => {
      const colorIndex = idx % pastelColors.length;
      const bgColor = pastelColors[colorIndex];
      const isMentioned = mentionedFeatures.has(feat.Id);

      const item = document.createElement('div');
      item.className = 'feature-summary-item';
      item.style.backgroundColor = bgColor;
      item.innerHTML = `
        <span class="check-mark">${isMentioned ? '✓' : ''}</span>
        <div class="description"><strong>${feat.Id}</strong>: ${feat.Description}</div>
      `;
      featureList.appendChild(item);
    });
  } else {
    summaryBox.classList.add('hidden');
  }

  table.classList.remove('hidden');
  let hasRow = false;

  if (currentSortOrder === 'doc_then_feature') {
    Object.entries(relevantData).forEach(([docName, items]) => {
      if (!Array.isArray(items) || items.length === 0) return;

      items.sort((a, b) => {
        const aNum = Number((a.Feature || '').match(/\d+/)?.[0] || 0);
        const bNum = Number((b.Feature || '').match(/\d+/)?.[0] || 0);
        return aNum - bNum;
      });

      items.forEach(item => {
        hasRow = true;
        const tr = createTableRow(item, docName, claimId, claimFeatures, pastelColors, data.verifications || {});
        tbody.appendChild(tr);
      });
    });
  } else {
    const featuresMap = new Map();
    Object.entries(relevantData).forEach(([docName, items]) => {
      (items || []).forEach(item => {
        if (!featuresMap.has(item.Feature)) {
          featuresMap.set(item.Feature, []);
        }
        featuresMap.get(item.Feature).push({ ...item, docName });
      });
    });

    const sortedFeatures = [...featuresMap.keys()].sort((a, b) => {
      const aNum = Number((a || '').match(/\d+/)?.[0] || 0);
      const bNum = Number((b || '').match(/\d+/)?.[0] || 0);
      return aNum - bNum;
    });

    sortedFeatures.forEach(featureId => {
      const items = featuresMap.get(featureId);
      items.forEach(item => {
        hasRow = true;
        const tr = createTableRow(item, item.docName, claimId, claimFeatures, pastelColors, data.verifications || {});
        tbody.appendChild(tr);
      });
    });
  }

  if (!hasRow) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px;">매칭된 근거가 없습니다.</td></tr>';
  }
}

function normalizeVerificationFlag(value) {
  const text = String(value || '').trim().toUpperCase();
  if (!text) return null;
  if (text === 'P' || text === 'PASS') return 'P';
  if (text === 'F' || text === 'FAIL') return 'F';
  return null;
}

function escapeHtmlText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeParagraphToken(value) {
  const match = String(value || '').match(/\d{1,6}/);
  if (!match) return null;
  return `[${String(match[0]).padStart(4, '0')}]`;
}

function buildPositionCellHtml(position, docName) {
  const normalized = normalizePositionText(position || '');
  if (!normalized) return '-';

  const markerRe = /\[(\d{1,6})\]/g;
  let html = '';
  let lastIndex = 0;
  let hasMarker = false;
  let match;

  while ((match = markerRe.exec(normalized)) !== null) {
    hasMarker = true;
    html += escapeHtmlText(normalized.slice(lastIndex, match.index));

    const marker = normalizeParagraphToken(match[0]) || match[0];
    html += `<button type="button" class="position-token" data-doc-name="${escapeHtmlText(docName)}" data-paragraph-key="${escapeHtmlText(marker)}" title="${escapeHtmlText(marker)} 문단 보기">${escapeHtmlText(marker)}</button>`;

    lastIndex = match.index + match[0].length;
  }

  html += escapeHtmlText(normalized.slice(lastIndex));
  return hasMarker ? html : escapeHtmlText(normalized);
}

const MATCH_LABEL_EXPLICIT = '\uB3D9\uC77C';
const MATCH_LABEL_EQUIVALENT = '\uC2E4\uC9C8\uC801 \uB3D9\uC77C';
const MATCH_LABEL_DIFFERENT = '\uCC28\uC774';

function getMatchTypePresentation(rawType) {
  const text = String(rawType || '').trim();
  const normalized = text.toLowerCase();
  const normalizedCompact = normalized.replace(/\s+/g, '');

  if (
    normalized === 'explicit'
    || normalized === 'identical'
    || text === MATCH_LABEL_EXPLICIT
  ) {
    return { matchClass: 'match-explicit', label: MATCH_LABEL_EXPLICIT };
  }
  if (
    normalized === 'equivalent'
    || normalized === 'substantially equivalent'
    || text === MATCH_LABEL_EQUIVALENT
    || normalizedCompact === '\uc2e4\uc9c8\uc801\ub3d9\uc77c'
  ) {
    return { matchClass: 'match-equivalent', label: MATCH_LABEL_EQUIVALENT };
  }

  return { matchClass: 'match-none', label: text || '-' };
}

function createTableRow(item, docName, claimId, claimFeatures, pastelColors, verifications) {
  const tr = document.createElement('tr');

  const featureDef = claimFeatures.find(f => f.Id === item.Feature);
  const featureIndex = claimFeatures.indexOf(featureDef);

  let bgColor = '#ffffff';
  if (featureIndex !== -1) {
    bgColor = pastelColors[featureIndex % pastelColors.length];
  }
  tr.style.backgroundColor = bgColor;

  const match = getMatchTypePresentation(item.MatchType);
  const matchClass = match.matchClass;

  const verificationKey = `${item.Feature}_${docName}`;
  const verificationResult = verifications[verificationKey];
  let verificationCellHtml = '';
  if (verificationResult && typeof verificationResult === 'object') {
    const icon = verificationResult.status === 'warning' ? '!' : '?';
    const encodedReason = String(verificationResult.reason || '').replace(/"/g, '&quot;');
    verificationCellHtml = `
      <div class="verification-cell">
        <span class="verification-icon" data-status="${verificationResult.status}" data-reason="${encodedReason}">
          ${icon}
        </span>
      </div>
    `;
  } else {
    const verificationFlag = normalizeVerificationFlag(verificationResult)
      || normalizeVerificationFlag(item?.Verification || item?.verification || item?.Verify || item?.verify);
    if (verificationFlag === 'P') {
      verificationCellHtml = `
        <div class="verification-cell">
          <span class="verification-flag is-p">P</span>
        </div>
      `;
    } else if (verificationFlag === 'F') {
      const encodedReason = '찾은 내용을 한 번 더 살펴보고 검증해보세요.';
      verificationCellHtml = `
        <div class="verification-cell">
          <span class="verification-flag is-f" data-reason="${encodedReason}">F</span>
        </div>
      `;
    }
  }

  tr.innerHTML = `
    <td class="font-bold">${item.Feature || '-'}</td>
    <td><strong>${docName}</strong></td>
    <td>${item.Content || ''}</td>
    <td class="text-sm text-sub">${buildPositionCellHtml(item.Position || '', docName)}</td>
    <td><span class="match-badge ${matchClass}">${match.label}</span></td>
    <td>${verificationCellHtml}</td>
  `;
  return tr;
}

function getNoticeClaimType() {
  const checked = document.querySelector('input[name="notice-claim-type"]:checked');
  return checked?.value === 'dependent' ? 'dependent' : 'independent';
}

function getAnalyzedClaimsForNotice() {
  return (claims || []).filter(claim => {
    const result = analysisResults?.[claim.id];
    return !!result && !result.error && Array.isArray(result.ClaimFeatures) && result.ClaimFeatures.length > 0;
  });
}

function syncNoticeClaimSelect(preferredClaimId) {
  const select = document.getElementById('notice-claim-select');
  if (!select) return null;

  const analyzedClaims = getAnalyzedClaimsForNotice();
  const previousValue = select.value;
  const preferred = preferredClaimId !== null && preferredClaimId !== undefined
    ? String(preferredClaimId)
    : previousValue;

  select.innerHTML = '';
  if (analyzedClaims.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '(결과 없음)';
    select.appendChild(option);
    select.disabled = true;
    return null;
  }

  analyzedClaims.forEach(claim => {
    const option = document.createElement('option');
    option.value = String(claim.id);
    option.textContent = claim.name || `Claim ${claim.id}`;
    select.appendChild(option);
  });

  select.disabled = false;
  const hasPreferred = analyzedClaims.some(claim => String(claim.id) === String(preferred));
  select.value = hasPreferred ? String(preferred) : String(analyzedClaims[0].id);
  return Number.parseInt(select.value, 10);
}

function findNoticePrimaryDocName(relevant) {
  const keys = Object.keys(relevant || {}).filter(key => Array.isArray(relevant[key]));
  if (keys.length === 0) return null;

  const d1 = keys.find(key => String(key || '').trim().toUpperCase() === 'D1');
  if (d1) return d1;

  const completedCitations = (citations || []).filter(c => c.status === 'completed');
  for (const citation of completedCitations) {
    const candidates = [citation?.name, citation?.title].map(v => String(v || '').trim()).filter(Boolean);
    for (const candidate of candidates) {
      const matched = keys.find(key => String(key || '').trim() === candidate);
      if (matched) return matched;
    }
  }

  return keys[0];
}

function getNoticeEntriesForFeature(relevant, docName, featureId) {
  if (!docName || !relevant) return [];
  const items = Array.isArray(relevant[docName]) ? relevant[docName] : [];
  const targetFeature = String(featureId || '').trim();
  return items.filter(item => String(item?.Feature || '').trim() === targetFeature);
}

function getNoticeRemark(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return MATCH_LABEL_DIFFERENT;

  const hasExplicit = entries.some(entry => getMatchTypePresentation(entry?.MatchType).matchClass === 'match-explicit');
  if (hasExplicit) return MATCH_LABEL_EXPLICIT;

  const hasEquivalent = entries.some(entry => getMatchTypePresentation(entry?.MatchType).matchClass === 'match-equivalent');
  if (hasEquivalent) return MATCH_LABEL_EQUIVALENT;

  return MATCH_LABEL_DIFFERENT;
}

function getNoticeRemarkClass(remark) {
  if (remark === MATCH_LABEL_EXPLICIT) return 'is-explicit';
  if (remark === MATCH_LABEL_EQUIVALENT) return 'is-equivalent';
  return 'is-diff';
}

function formatNoticeEvidence(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return '-';

  return entries.map(entry => {
    const content = escapeHtmlText(entry?.Content || '-');
    const position = normalizePositionText(entry?.Position || '') || '-';
    return `${content} (${escapeHtmlText(position)})`;
  }).join('<br>');
}

function refreshOpinionNoticeCard(options = {}) {
  const emptyState = document.getElementById('opinion-notice-empty');
  const table = document.getElementById('opinion-notice-table');
  const tbody = document.getElementById('opinion-notice-tbody');
  const refHeader = document.getElementById('opinion-notice-ref-header');
  const claimSelect = document.getElementById('notice-claim-select');
  if (!emptyState || !table || !tbody || !refHeader || !claimSelect) return;

  const headerCells = table.querySelectorAll('thead th');
  if (headerCells.length >= 4) {
    headerCells[0].textContent = '\uAD6C\uC131';
    headerCells[1].textContent = '\uCCAD\uAD6C\uD56D \uAD6C\uC131\uC694\uC18C';
    headerCells[3].textContent = '\uBE44\uACE0';
  }

  const shouldSyncClaimSelect = options.syncClaimSelect !== false;
  const selectedClaimId = shouldSyncClaimSelect
    ? syncNoticeClaimSelect(options.preferredClaimId)
    : Number.parseInt(claimSelect.value || '', 10);
  const analyzedClaims = getAnalyzedClaimsForNotice();

  if (analyzedClaims.length === 0 || !Number.isFinite(selectedClaimId)) {
    table.classList.add('hidden');
    emptyState.classList.remove('hidden');
    emptyState.textContent = '\uBD84\uC11D \uACB0\uACFC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.';
    refHeader.textContent = '\uC778\uC6A9\uBC1C\uBA85 1';
    tbody.innerHTML = '';
    return;
  }

  const selectedType = getNoticeClaimType();
  if (selectedType === 'dependent') {
    table.classList.add('hidden');
    emptyState.classList.remove('hidden');
    emptyState.textContent = '\uC885\uC18D\uD56D \uD45C \uC0DD\uC131\uC740 \uB2E4\uC74C \uB2E8\uACC4\uC5D0\uC11C \uD655\uC7A5\uD569\uB2C8\uB2E4.';
    refHeader.textContent = '\uC778\uC6A9\uBC1C\uBA85 1';
    tbody.innerHTML = '';
    return;
  }

  const result = analysisResults?.[selectedClaimId];
  const claimFeatures = Array.isArray(result?.ClaimFeatures) ? result.ClaimFeatures : [];
  const relevant = result?.Relevant || {};
  const primaryDocName = findNoticePrimaryDocName(relevant);

  refHeader.textContent = primaryDocName
    ? `\uC778\uC6A9\uBC1C\uBA85 1 (${primaryDocName})`
    : '\uC778\uC6A9\uBC1C\uBA85 1';

  if (claimFeatures.length === 0) {
    table.classList.add('hidden');
    emptyState.classList.remove('hidden');
    emptyState.textContent = '\uC120\uD0DD\uD55C \uCCAD\uAD6C\uD56D\uC758 \uAD6C\uC131\uC694\uC18C\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.';
    tbody.innerHTML = '';
    return;
  }

  tbody.innerHTML = claimFeatures.map((feature, index) => {
    const entries = getNoticeEntriesForFeature(relevant, primaryDocName, feature?.Id);
    const evidence = formatNoticeEvidence(entries);
    const remark = getNoticeRemark(entries);
    const remarkClass = getNoticeRemarkClass(remark);

    return `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtmlText(feature?.Description || '-')}</td>
        <td>${evidence}</td>
        <td><span class="notice-remark ${remarkClass}">${remark}</span></td>
      </tr>
    `;
  }).join('');

  emptyState.classList.add('hidden');
  table.classList.remove('hidden');
}

function sanitizeCellForTsv(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractRowCellsAsTsvLine(cells) {
  return Array.from(cells)
    .map(cell => sanitizeCellForTsv(cell?.innerText ?? cell?.textContent ?? ''))
    .join('\t');
}

function buildOpinionNoticeTsv() {
  const table = document.getElementById('opinion-notice-table');
  const tbody = document.getElementById('opinion-notice-tbody');
  if (!table || !tbody || table.classList.contains('hidden')) return '';

  const headerCells = table.querySelectorAll('thead th');
  const bodyRows = tbody.querySelectorAll('tr');
  if (!headerCells.length || !bodyRows.length) return '';

  const lines = [];
  lines.push(extractRowCellsAsTsvLine(headerCells));
  bodyRows.forEach(row => {
    lines.push(extractRowCellsAsTsvLine(row.querySelectorAll('td')));
  });
  return lines.join('\n');
}

async function writePlainTextToClipboard(text) {
  if (!text) return;

  if (navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem !== 'undefined') {
    const item = new ClipboardItem({
      'text/plain': new Blob([text], { type: 'text/plain' })
    });
    await navigator.clipboard.write([item]);
    return;
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'readonly');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

async function copyOpinionNoticeTableAsTsv() {
  const tsv = buildOpinionNoticeTsv();
  if (!tsv) {
    alert('복사할 표 데이터가 없습니다.');
    return;
  }

  try {
    await writePlainTextToClipboard(tsv);
    alert('의견제출통지서 표를 TSV 형식으로 복사했습니다.');
  } catch (error) {
    console.error('Failed to copy opinion notice TSV:', error);
    alert('표 복사에 실패했습니다.');
  }
}
