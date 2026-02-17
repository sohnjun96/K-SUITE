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


  // Keep step details in the empty-state area and hide top text.
  text.textContent = '';
  text.classList.add('hidden');
  indicator.innerHTML = '';

  const stepLabels = {
    A: 'A\uB2E8\uACC4: \uAD6C\uC131\uC694\uC18C',
    B: 'B\uB2E8\uACC4: \uBA40\uD2F0\uCFFC\uB9AC RAG',
    C: 'C\uB2E8\uACC4: \uBA40\uD2F0\uD310\uC815',
    D: 'D\uB2E8\uACC4: \uB9AC\uD398\uC5B4',
    E: 'E\uB2E8\uACC4: \uAC80\uC99D'
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
    label.textContent = stepLabels[stepId] || `${stepId}\uB2E8\uACC4`;

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

function getFeatureOrderValue(featureId) {
  const matched = String(featureId || '').match(/\d+/);
  if (!matched) return Number.MAX_SAFE_INTEGER;
  return Number.parseInt(matched[0], 10);
}

function sortClaimFeaturesForSummary(claimFeatures) {
  return [...(claimFeatures || [])].sort((a, b) => {
    const aOrder = getFeatureOrderValue(a?.Id);
    const bOrder = getFeatureOrderValue(b?.Id);
    if (aOrder !== bOrder) return aOrder - bOrder;
    return String(a?.Id || '').localeCompare(String(b?.Id || ''), 'ko');
  });
}

function getDocLabelOrderValue(docLabel) {
  const matched = String(docLabel || '').match(/^D(\d+)$/i);
  if (!matched) return Number.MAX_SAFE_INTEGER;
  return Number.parseInt(matched[1], 10);
}

function getSummaryDocLabel(docName, fallbackIndex) {
  const raw = String(docName || '').trim();
  if (!raw) return `D${fallbackIndex + 1}`;

  const dMatch = raw.match(/^D\s*0*(\d+)$/i);
  if (dMatch) return `D${Number.parseInt(dMatch[1], 10)}`;

  const numMatch = raw.match(/(\d+)/);
  if (numMatch) return `D${Number.parseInt(numMatch[1], 10)}`;

  return `D${fallbackIndex + 1}`;
}

function sortDocNamesForSummary(docNames) {
  const mapped = (docNames || []).map((docName, index) => ({
    docName,
    fallbackIndex: index,
    label: getSummaryDocLabel(docName, index)
  }));

  mapped.sort((a, b) => {
    const aOrder = getDocLabelOrderValue(a.label);
    const bOrder = getDocLabelOrderValue(b.label);
    if (aOrder !== bOrder) return aOrder - bOrder;
    return String(a.docName || '').localeCompare(String(b.docName || ''), 'ko');
  });

  return mapped;
}

function getFeatureDocSummaryStatus(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { label: '-', className: 'is-none' };
  }

  const hasExplicit = entries.some(entry =>
    getMatchTypePresentation(entry?.MatchType).matchClass === 'match-explicit'
  );
  if (hasExplicit) {
    return { label: MATCH_LABEL_EXPLICIT, className: 'is-explicit' };
  }

  const hasEquivalent = entries.some(entry =>
    getMatchTypePresentation(entry?.MatchType).matchClass === 'match-equivalent'
  );
  if (hasEquivalent) {
    return { label: MATCH_LABEL_EQUIVALENT, className: 'is-equivalent' };
  }

  return { label: '-', className: 'is-none' };
}

function renderClaimFeatureSummaryMatrix(featureListEl, claimFeatures, relevantData) {
  if (!featureListEl) return;
  featureListEl.innerHTML = '';

  const rowPastelColors = ['#f0f9ff', '#f0fdf4', '#fefce8', '#fff7ed', '#fdf2f8', '#faf5ff', '#f5f5f4'];
  const sortedFeatures = sortClaimFeaturesForSummary(claimFeatures);
  if (sortedFeatures.length === 0) return;

  let docNames = Object.keys(relevantData || {}).filter(key => Array.isArray(relevantData?.[key]));
  if (docNames.length === 0) {
    const fallbackDocs = (citations || [])
      .filter(citation => citation?.status === 'completed')
      .map((citation, index) => String(citation?.name || citation?.title || `D${index + 1}`).trim())
      .filter(Boolean);
    docNames = fallbackDocs;
  }
  if (docNames.length === 0) {
    docNames = ['D1'];
  }

  const sortedDocs = sortDocNamesForSummary(docNames);

  const table = document.createElement('table');
  table.className = 'feature-summary-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');

  const thFeatureId = document.createElement('th');
  thFeatureId.textContent = '구성';
  headRow.appendChild(thFeatureId);

  const thFeatureSummary = document.createElement('th');
  thFeatureSummary.textContent = '\uAD6C\uC131\uC694\uC18C \uC694\uC57D';
  headRow.appendChild(thFeatureSummary);

  sortedDocs.forEach(docMeta => {
    const th = document.createElement('th');
    th.textContent = docMeta.label;
    const rawDocName = String(docMeta.docName || '').trim();
    if (rawDocName && rawDocName !== docMeta.label) {
      th.title = rawDocName;
    }
    headRow.appendChild(th);
  });

  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  sortedFeatures.forEach((feature, index) => {
    const tr = document.createElement('tr');
    const rowColor = rowPastelColors[index % rowPastelColors.length];
    tr.style.setProperty('--feature-summary-row-bg', rowColor);

    const tdId = document.createElement('td');
    tdId.textContent = feature?.Id || '-';
    tr.appendChild(tdId);

    const tdDesc = document.createElement('td');
    tdDesc.textContent = feature?.Description || '-';
    tr.appendChild(tdDesc);

    sortedDocs.forEach(docMeta => {
      const td = document.createElement('td');
      const entries = getNoticeEntriesForFeature(relevantData, docMeta.docName, feature?.Id);
      const status = getFeatureDocSummaryStatus(entries);
      td.className = `feature-summary-status ${status.className}`;
      td.textContent = status.label;
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  featureListEl.appendChild(table);
}

function renderResultTable(claimId) {
  const summaryBox = document.getElementById('claim-summary-box');
  const featureList = document.getElementById('claim-features-list');
  const summaryTitle = summaryBox?.querySelector('h4');
  const table = document.getElementById('analysis-table');
  const tbody = document.getElementById('result-tbody');
  const emptyState = document.querySelector('.result-panel .empty-state');
  if (summaryTitle) {
    summaryTitle.textContent = '\uAD6C\uC131\uC694\uC18C-\uC778\uC6A9\uBC1C\uBA85 \uC694\uC57D \uD45C';
  }

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
      emptyState.innerHTML = `\uC774 \uCCAD\uAD6C\uD56D \uBD84\uC11D \uC911 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.<br>${data.error}`;
      return;
    }

    const currentStep = progress?.currentStep ? `${progress.currentStep}\uB2E8\uACC4` : '\uB300\uAE30 \uC911';
    const message = (progress?.stepMessage || '').trim() || '\uC774 \uCCAD\uAD6C\uD56D\uC740 \uB300\uAE30 \uC911\uC774\uAC70\uB098 \uBD84\uC11D\uC774 \uC9C4\uD589 \uC911\uC785\uB2C8\uB2E4.';
    emptyState.innerHTML = `${currentStep}<br>${message}`;
    return;
  }

  emptyState.style.display = 'none';

  const relevantData = ensureMockRelevantRows(data);
  const claimFeatures = data.ClaimFeatures || [];
  const pastelColors = ['#f0f9ff', '#f0fdf4', '#fefce8', '#fff7ed', '#fdf2f8', '#faf5ff', '#f5f5f4'];

  if (claimFeatures.length > 0) {
    summaryBox.classList.remove('hidden');
    renderClaimFeatureSummaryMatrix(featureList, claimFeatures, relevantData);
  } else {
    featureList.innerHTML = '';
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
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px;">\uB9E4\uCE6D\uB41C \uADFC\uAC70\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.</td></tr>';
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

function buildPositionCellHtml(position, docName, relatedContent = '') {
  const positionInfo = typeof extractPositionMarkerTokens === 'function'
    ? extractPositionMarkerTokens(position || '')
    : { normalized: normalizePositionText(position || ''), markers: [] };
  const normalized = positionInfo.normalized;
  if (!normalized) return '-';

  const markers = Array.isArray(positionInfo.markers) ? positionInfo.markers : [];
  if (markers.length === 0) {
    return escapeHtmlText(normalized);
  }

  let html = '';
  let lastIndex = 0;

  markers.forEach((token) => {
    html += escapeHtmlText(normalized.slice(lastIndex, token.start));
    const marker = token.marker;
    html += `<button type="button" class="position-token" data-doc-name="${escapeHtmlText(docName)}" data-paragraph-key="${escapeHtmlText(marker)}" data-related-content="${escapeHtmlText(relatedContent)}" title="${escapeHtmlText(marker)} \uBB38\uB2E8 \uBCF4\uAE30">${escapeHtmlText(marker)}</button>`;
    lastIndex = token.end;
  });

  html += escapeHtmlText(normalized.slice(lastIndex));
  return html;
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
      const encodedReason = '\uCC3E\uC740 \uB0B4\uC6A9\uC740 \uC6D0\uBB38 \uBB38\uB2E8\uC744 \uB2E4\uC2DC \uBCF4\uACE0 \uAC80\uC99D\uD574\uBCF4\uC138\uC694.';
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
    <td class="text-sm text-sub">${buildPositionCellHtml(item.Position || '', docName, item.Content || '')}</td>
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
    option.textContent = '(\uACB0\uACFC \uC5C6\uC74C)';
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

function extractRowCellsAsPlainValues(cells) {
  return Array.from(cells).map(cell =>
    sanitizeCellForTsv(cell?.innerText ?? cell?.textContent ?? '')
  );
}

function escapeHtmlForClipboard(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildHtmlTableForClipboard(rows) {
  const body = rows.map(row => {
    const cells = row
      .map(cell => `<td>${escapeHtmlForClipboard(cell).replace(/\n/g, '<br>')}</td>`)
      .join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  return [
    '<table border="1" cellspacing="0" cellpadding="2">',
    '<tbody>',
    body,
    '</tbody>',
    '</table>'
  ].join('');
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
  return lines.join('\r\n');
}

function buildOpinionNoticeClipboardPayload() {
  const table = document.getElementById('opinion-notice-table');
  const tbody = document.getElementById('opinion-notice-tbody');
  if (!table || !tbody || table.classList.contains('hidden')) return null;

  const headerCells = table.querySelectorAll('thead th');
  const bodyRows = tbody.querySelectorAll('tr');
  if (!headerCells.length || !bodyRows.length) return null;

  const rows = [];
  rows.push(extractRowCellsAsPlainValues(headerCells));
  bodyRows.forEach(row => {
    rows.push(extractRowCellsAsPlainValues(row.querySelectorAll('td')));
  });

  const tsv = rows.map(row => row.join('\t')).join('\r\n');
  const html = buildHtmlTableForClipboard(rows);
  return { tsv, html };
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

function writePayloadWithExecCommand(payload) {
  let copied = false;
  const listener = event => {
    if (!event?.clipboardData) return;
    event.preventDefault();
    if (payload?.html) {
      event.clipboardData.setData('text/html', payload.html);
    }
    event.clipboardData.setData('text/plain', payload?.tsv || '');
    copied = true;
  };

  document.addEventListener('copy', listener);
  try {
    document.execCommand('copy');
  } finally {
    document.removeEventListener('copy', listener);
  }

  if (!copied) {
    throw new Error('Failed to write clipboard payload with execCommand');
  }
}

async function writeTablePayloadToClipboard(payload) {
  if (!payload || !payload.tsv) return;

  if (navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem !== 'undefined') {
    const items = {
      'text/plain': new Blob([payload.tsv], { type: 'text/plain' })
    };
    if (payload.html) {
      items['text/html'] = new Blob([payload.html], { type: 'text/html' });
    }
    const item = new ClipboardItem(items);
    await navigator.clipboard.write([item]);
    return;
  }

  if (document.queryCommandSupported && document.queryCommandSupported('copy')) {
    writePayloadWithExecCommand(payload);
    return;
  }

  await writePlainTextToClipboard(payload.tsv);
}

async function copyOpinionNoticeTableAsTsv() {
  const payload = buildOpinionNoticeClipboardPayload();
  if (!payload || !payload.tsv) {
    alert('\uBCF5\uC0AC\uD560 \uD45C \uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.');
    return;
  }

  try {
    await writeTablePayloadToClipboard(payload);
    alert('\uC758\uACAC\uC81C\uCD9C\uD1B5\uC9C0\uC11C \uD45C\uB97C TSV \uD615\uC2DD\uC73C\uB85C \uBCF5\uC0AC\uD588\uC2B5\uB2C8\uB2E4.');
  } catch (error) {
    console.error('Failed to copy opinion notice TSV:', error);
    alert('\uD45C \uBCF5\uC0AC\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.');
  }
}
