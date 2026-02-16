function ensureAnalysisDebugContainer(result) {
  if (!result || typeof result !== 'object') return {};
  if (!result.debug || typeof result.debug !== 'object' || Array.isArray(result.debug)) {
    result.debug = {};
  }
  return result.debug;
}

function ensureStepTimingsContainer(result) {
  const debug = ensureAnalysisDebugContainer(result);
  if (!debug.stepTimings || typeof debug.stepTimings !== 'object' || Array.isArray(debug.stepTimings)) {
    debug.stepTimings = {};
  }
  return debug.stepTimings;
}

function ensureClaimAnalysisResult(claimId) {
  const current = analysisResults?.[claimId];
  if (!current || typeof current !== 'object') {
    analysisResults[claimId] = {
      ClaimFeatures: [],
      Relevant: {},
      FeatureStatus: {},
      verifications: {},
      debug: {}
    };
  } else {
    current.ClaimFeatures = Array.isArray(current.ClaimFeatures) ? current.ClaimFeatures : [];
    current.Relevant = current.Relevant && typeof current.Relevant === 'object' ? current.Relevant : {};
    current.FeatureStatus = current.FeatureStatus && typeof current.FeatureStatus === 'object' ? current.FeatureStatus : {};
    current.verifications = current.verifications && typeof current.verifications === 'object' ? current.verifications : {};
    ensureAnalysisDebugContainer(current);
  }
  return analysisResults[claimId];
}

function startStepTiming(result, stepId) {
  const timings = ensureStepTimingsContainer(result);
  const now = Date.now();
  const previous = timings[stepId] && typeof timings[stepId] === 'object' ? timings[stepId] : {};
  timings[stepId] = {
    ...previous,
    stepId,
    startedAt: now,
    endedAt: null,
    durationMs: null,
    status: 'active'
  };
}

function finishStepTiming(result, stepId, status = 'done') {
  const timings = ensureStepTimingsContainer(result);
  const now = Date.now();
  const current = timings[stepId] && typeof timings[stepId] === 'object' ? timings[stepId] : {};
  const startedAt = Number.isFinite(current.startedAt) ? current.startedAt : now;
  timings[stepId] = {
    ...current,
    stepId,
    startedAt,
    endedAt: now,
    durationMs: Math.max(0, now - startedAt),
    status
  };
}

function markStepTimingSkipped(result, stepId) {
  const timings = ensureStepTimingsContainer(result);
  const now = Date.now();
  timings[stepId] = {
    stepId,
    startedAt: now,
    endedAt: now,
    durationMs: 0,
    status: 'skipped'
  };
}

async function runAnalysis() {
  const resultControls = document.getElementById('result-controls');
  const claimSelect = document.getElementById('result-claim-select');
  const summaryBox = document.getElementById('claim-summary-box');
  const table = document.getElementById('analysis-table');
  const emptyState = document.querySelector('.result-panel .empty-state');

  if (isAnalysisRunning) return;

  if (settings.mockMode && typeof ensureMockDemoDataset === 'function') {
    ensureMockDemoDataset();
  }

  const validFiles = citations.filter(c => c.status === 'completed').map(c => c.fileId);
  const nonEmptyClaims = claims.filter(c => c.text.trim());
  if (nonEmptyClaims.length === 0) return alert('분석할 청구항이 없습니다.');
  if (validFiles.length === 0) return alert('업로드 완료된 인용발명이 없습니다.');
  if (!settings.mockMode && !settings.key) return alert('API Key가 필요합니다.');

  isAnalysisRunning = true;
  setAnalyzeButtonState(true);
  if (typeof updateDebugExportButtonVisibility === 'function') {
    updateDebugExportButtonVisibility();
  }

  try {
    const executionMode = typeof getAnalysisExecutionMode === 'function'
      ? getAnalysisExecutionMode()
      : (analysisExecutionMode || 'deep');
    const modeLabel = executionMode === 'quick' ? 'Quick Analysis' : 'Deep Analysis';

    localStorage.setItem('analysisLastRunAt', new Date().toISOString());
    localStorage.setItem('analysisLastStep', `${modeLabel} start`);
    setAnalysisMode(true);

    analysisResults = {};
    claimSelect.innerHTML = '';
    summaryBox.classList.add('hidden');
    table.classList.add('hidden');
    emptyState.style.display = 'block';
    emptyState.innerHTML = '분석을 시작합니다...<br>잠시만 기다려주세요.';
    resultControls.classList.remove('hidden');

    initializeClaimProgress(nonEmptyClaims);
    refreshResultClaimSelect(nonEmptyClaims);
    if (claimSelect.options.length > 0) {
      claimSelect.selectedIndex = 0;
      selectedResultClaimId = Number.parseInt(claimSelect.value, 10);
      renderResultTable(selectedResultClaimId);
    }

    const mapInfo = citations.map(c => `${c.name}: ${c.title}`).join('\n');
    const totalClaims = nonEmptyClaims.length;

    for (const [index, claim] of nonEmptyClaims.entries()) {
      const claimLabel = `(${index + 1}/${totalClaims}) ${claim.name}`;
      localStorage.setItem('analysisLastStep', `${modeLabel} running ${claimLabel}`);
      setClaimProgressStatus(claim.id, 'running', `대기열 등록 ${claimLabel}`);

      if (executionMode === 'quick') {
        const quickTarget = ensureClaimAnalysisResult(claim.id);
        startStepTiming(quickTarget, 'A');
        setClaimStepState(claim.id, 'A', 'active', `Quick analysis running ${claimLabel}`);
        try {
          const quick = await runQuickAnalysisForClaim(claim, mapInfo, validFiles);
          quickTarget.ClaimFeatures = quick.claimFeatures || [];
          quickTarget.Relevant = quick.relevant || {};
          quickTarget.FeatureStatus = quick.featureStatus || {};
          quickTarget.verifications = quick.verifications || {};
          quickTarget.debug = quickTarget.debug || {};
          quickTarget.debug.quick = quick.debug || null;
          finishStepTiming(quickTarget, 'A', 'done');
          ['B', 'C', 'D', 'E'].forEach(stepId => markStepTimingSkipped(quickTarget, stepId));
          setClaimStepState(claim.id, 'A', 'done', `Quick analysis done ${claimLabel}`);
          ['B', 'C', 'D', 'E'].forEach(stepId => setClaimStepState(claim.id, stepId, 'done'));
          setClaimProgressStatus(claim.id, 'done', `Done ${claimLabel}`);
        } catch (e) {
          quickTarget.error = e.message;
          quickTarget.debug = quickTarget.debug || {};
          quickTarget.debug.quickError = e.message;
          finishStepTiming(quickTarget, 'A', 'error');
          setClaimStepState(claim.id, 'A', 'error', `Quick analysis failed: ${e.message}`);
          setClaimProgressStatus(claim.id, 'error', `Analysis stopped: ${e.message}`);
          saveAnalysisResultsToStorage();
          continue;
        }

        if (DEV_FLAGS.SHOW_DEBUG_PANEL) {
          updateDebugClaimSelect();
          renderDebugContent();
        }
        saveAnalysisResultsToStorage();
        continue;
      }

      const target = ensureClaimAnalysisResult(claim.id);
      // Step A
      startStepTiming(target, 'A');
      setClaimStepState(claim.id, 'A', 'active', `A단계 진행 중 ${claimLabel}`);
      try {
        const stepA = await runStepAForClaim(claim);
        target.ClaimFeatures = stepA?.ClaimFeatures || [];
        target.Relevant = {};
        target.FeatureStatus = {};
        target.verifications = {};
        target.error = null;
        target.debug = target.debug || {};
        target.debug.stepA = stepA;
        finishStepTiming(target, 'A', 'done');
        setClaimStepState(claim.id, 'A', 'done', `A단계 완료 ${claimLabel}`);
      } catch (e) {
        target.error = e.message;
        target.debug = target.debug || {};
        target.debug.stepAError = e.message;
        finishStepTiming(target, 'A', 'error');
        setClaimStepState(claim.id, 'A', 'error', `A단계 실패: ${e.message}`);
        setClaimProgressStatus(claim.id, 'error', `Analysis stopped: ${e.message}`);
        saveAnalysisResultsToStorage();
        continue;
      }

      if (!target || target.error) {
        setClaimProgressStatus(claim.id, 'error', target?.error || 'Unknown error');
        saveAnalysisResultsToStorage();
        continue;
      }

      // Step B
      startStepTiming(target, 'B');
      setClaimStepState(claim.id, 'B', 'active', `B단계 진행 중 ${claimLabel}`);
      try {
        setClaimProgressMessage(claim.id, `B-1 쿼리 생성 중 ${claimLabel}`);
        const stepBQueries = await runStepBQueryGeneration(target.ClaimFeatures);
        const plannedBundles = getStepBQueryBundleCount(target.ClaimFeatures, stepBQueries);

        setClaimProgressMessage(
          claim.id,
          `B-1 완료 | B-2 멀티쿼리 RAG 시작 (총 ${plannedBundles}건 전송 예정)`
        );

        const stepB2 = await runStepBParallelRag(
          target.ClaimFeatures,
          stepBQueries,
          mapInfo,
          validFiles,
          {
            claimName: claim.name,
            claimIndex: index + 1,
            totalClaims,
            useLegacyProgress: false,
            onBundleProgress: ({ sent, total, returned, succeeded, failed }) => {
              setClaimProgressMessage(
                claim.id,
                `B-2 멀티쿼리 RAG 진행 중 | 전송 ${sent}/${total}, 응답 ${returned}/${total}, 성공 ${succeeded}, 실패 ${failed}`
              );
            }
          }
        );

        const receivedCount = stepB2.responses?.length || 0;
        const successCount = (stepB2.responses || []).filter(entry => entry?.ok).length;
        const failedCount = receivedCount - successCount;

        setClaimProgressMessage(
          claim.id,
          `B-2 완료 | B-3 병합 진행 중 (응답 ${receivedCount}/${plannedBundles}, 성공 ${successCount}, 실패 ${failedCount})`
        );
        const stepB3 = await runStepBMergeRag(stepB2.responses || []);
        target.debug = target.debug || {};
        target.debug.stepB = {
          queries: stepBQueries,
          queriesByIndex: stepB2.queriesByIndex,
          responses: stepB2.responses,
          merge: stepB3.debug || null
        };
        target.stepBRelevant = stepB3.relevant || {};
        finishStepTiming(target, 'B', 'done');
        setClaimStepState(claim.id, 'B', 'done', `B단계 완료 ${claimLabel}`);
      } catch (e) {
        target.error = e.message;
        target.debug = target.debug || {};
        target.debug.stepBError = e.message;
        finishStepTiming(target, 'B', 'error');
        setClaimStepState(claim.id, 'B', 'error', `B단계 실패: ${e.message}`);
        setClaimProgressStatus(claim.id, 'error', `Analysis stopped: ${e.message}`);
        saveAnalysisResultsToStorage();
        continue;
      }

      // Step C
      startStepTiming(target, 'C');
      setClaimStepState(claim.id, 'C', 'active', `C단계 진행 중 ${claimLabel}`);
      try {
        const stepBMergedRelevant = target.stepBRelevant || {};
        const stepC = await runStepCForClaim(claim, target.ClaimFeatures, stepBMergedRelevant);
        target.Relevant = stepC.relevant || {};
        target.FeatureStatus = stepC.featureStatus || {};
        target.debug = target.debug || {};
        target.debug.stepC = stepC.debug;
        finishStepTiming(target, 'C', 'done');
        setClaimStepState(claim.id, 'C', 'done', `C단계 완료 ${claimLabel}`);
      } catch (e) {
        target.error = e.message;
        target.debug = target.debug || {};
        target.debug.stepCError = e.message;
        finishStepTiming(target, 'C', 'error');
        setClaimStepState(claim.id, 'C', 'error', `C단계 실패: ${e.message}`);
        setClaimProgressStatus(claim.id, 'error', `Analysis stopped: ${e.message}`);
        saveAnalysisResultsToStorage();
        continue;
      }

      // Step D
      startStepTiming(target, 'D');
      setClaimStepState(claim.id, 'D', 'active', `D단계 진행 중 ${claimLabel}`);
      const missing = getMissingFeatures(target.ClaimFeatures, target.FeatureStatus, target.Relevant);
      if (missing.length === 0) {
        target.debug = target.debug || {};
        target.debug.stepD = { skipped: true };
        markStepTimingSkipped(target, 'D');
        setClaimStepState(claim.id, 'D', 'done', 'D단계 건너뜀 (누락 구성요소 없음)');
      } else {
        try {
          const stepD = await runStepDForClaim(claim, missing, mapInfo, validFiles, target);
          const missingFeatureIds = missing.map(feature => feature.Id);
          const stepDCandidates = filterRelevantByFeatureIds(stepD.relevant || {}, missingFeatureIds);

          let stepDReview = null;
          if (hasAnyRelevantEntry(stepDCandidates)) {
            stepDReview = await runStepCForClaim(claim, missing, stepDCandidates);
            target.Relevant = mergeRelevant(target.Relevant, stepDReview.relevant || {});
          }

          missing.forEach(feature => {
            const reviewedStatus = stepDReview?.featureStatus?.[feature.Id];
            if (reviewedStatus) {
              target.FeatureStatus[feature.Id] = reviewedStatus;
            }
          });

          target.debug = target.debug || {};
          target.debug.stepD = {
            repair: stepD.debug || null,
            reviewByStepC: stepDReview?.debug || null,
            acceptedRelevant: stepDReview?.relevant || {}
          };
          finishStepTiming(target, 'D', 'done');
          setClaimStepState(claim.id, 'D', 'done', `D단계 완료 ${claimLabel}`);
        } catch (e) {
          target.debug = target.debug || {};
          target.debug.stepDError = e.message;
          finishStepTiming(target, 'D', 'error');
          setClaimStepState(claim.id, 'D', 'error', `D단계 실패: ${e.message}`);
        }
      }

      // Step E
      startStepTiming(target, 'E');
      setClaimStepState(claim.id, 'E', 'active', `E단계 진행 중 ${claimLabel}`);
      try {
        await runVerificationStage([claim], validFiles, mapInfo);
        finishStepTiming(target, 'E', 'done');
      } catch (e) {
        target.error = e.message;
        target.debug = target.debug || {};
        target.debug.stepEError = e.message;
        finishStepTiming(target, 'E', 'error');
        throw e;
      }
      setClaimStepState(claim.id, 'E', 'done', `E단계 완료 ${claimLabel}`);
      setClaimProgressStatus(claim.id, 'done', `완료 ${claimLabel}`);

      if (DEV_FLAGS.SHOW_DEBUG_PANEL) {
        updateDebugClaimSelect();
        renderDebugContent();
      }
      saveAnalysisResultsToStorage();
    }

    localStorage.setItem('analysisLastStep', `${modeLabel} done`);
    if (claimSelect.options.length > 0) {
      if (!claimSelect.value) {
        claimSelect.selectedIndex = 0;
      }
      selectedResultClaimId = Number.parseInt(claimSelect.value, 10);
      renderResultTable(selectedResultClaimId);
    }

    if (DEV_FLAGS.SHOW_DEBUG_PANEL) {
      updateDebugClaimSelect();
      renderDebugContent();
    }

    saveAnalysisResultsToStorage();
  } catch (error) {
    console.error('분석 실행 중 오류:', error);
    alert(`분석 중 오류가 발생했습니다: ${error?.message || error}`);
  } finally {
    isAnalysisRunning = false;
    setAnalyzeButtonState(false);
    if (typeof updateDebugExportButtonVisibility === 'function') {
      updateDebugExportButtonVisibility();
    }
  }
}

async function runStepAForClaim(claim) {
  const promptPair = await renderLarcPromptPair('stepAFeatures', {
    claim_id: claim.id,
    claim_text: claim.text
  });
  const payload = {
    model: resolveLarcModelName(),
    messages: promptPair.messages
  };

  const response = await sendLLMRequest(payload);
  if (response.ok && response.data && response.data.choices) {
    const content = response.data.choices[0].message.content;
    return safeJsonParse(content);
  }
  throw new Error(response.error || 'A단계 실패');
}

function normalizeQuickVerificationFlag(value) {
  const text = String(value || '').trim().toUpperCase();
  if (!text) return null;
  if (text === 'P' || text === 'PASS' || text === 'TRUE') return 'P';
  if (text === 'F' || text === 'FAIL' || text === 'FALSE') return 'F';
  return null;
}

function buildQuickVerificationFlags(rawVerification, rawRelevant, normalizedRelevant) {
  const flags = {};

  Object.entries(rawVerification || {}).forEach(([key, rawValue]) => {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) return;
    const value = rawValue && typeof rawValue === 'object'
      ? (rawValue.flag || rawValue.status || rawValue.label || rawValue.result || rawValue.verification)
      : rawValue;
    const flag = normalizeQuickVerificationFlag(value);
    if (!flag) return;
    flags[normalizedKey] = flag;
  });

  Object.entries(rawRelevant || {}).forEach(([docName, items]) => {
    if (!Array.isArray(items)) return;
    items.forEach(item => {
      const featureId = String(item?.Feature || '').trim();
      if (!featureId) return;
      const flag = normalizeQuickVerificationFlag(
        item?.Verification || item?.verification || item?.Verify || item?.verify
      );
      if (!flag) return;
      flags[`${featureId}_${docName}`] = flag;
    });
  });

  if (Object.keys(flags).length === 0) {
    Object.entries(normalizedRelevant || {}).forEach(([docName, items]) => {
      if (!Array.isArray(items)) return;
      items.forEach(item => {
        const featureId = String(item?.Feature || '').trim();
        if (!featureId) return;
        flags[`${featureId}_${docName}`] = 'F';
      });
    });
  }

  return flags;
}

async function runQuickAnalysisForClaim(claim, mapInfo, fileIds) {
  const quickInput = {
    claimId: claim.id,
    claimName: claim.name,
    claimText: claim.text
  };
  const promptPair = await renderLarcPromptPair('stepQuickAnalysis', {
    mapInfo,
    quick_input_json: quickInput,
    claim_id: claim.id,
    claim_name: claim.name,
    claim_text: claim.text
  });
  const payload = {
    model: resolveLarcModelName(),
    messages: promptPair.messages,
    files: buildFileRefs(fileIds)
  };

  const response = await sendLLMRequest(payload);
  if (response.ok && response.data && response.data.choices) {
    const content = response.data.choices[0].message.content;
    const parsed = safeJsonParse(content) || {};
    const claimFeatures = Array.isArray(parsed.ClaimFeatures) ? parsed.ClaimFeatures : [];
    const rawRelevant = parsed.Relevant || parsed.relevant || {};
    const relevant = mergeRelevantWithPositions({}, rawRelevant);
    const featureStatus = parsed.FeatureStatus || parsed.featureStatus || {};
    const verifications = buildQuickVerificationFlags(
      parsed.Verification || parsed.Verifications || {},
      rawRelevant,
      relevant
    );

    return {
      claimFeatures,
      relevant,
      featureStatus,
      verifications,
      debug: {
        ClaimFeatures: claimFeatures,
        FeatureStatus: featureStatus,
        Verification: verifications
      }
    };
  }
  throw new Error(response.error || 'Quick analysis failed');
}

async function runStepBQueryGeneration(claimFeatures) {
  const promptPair = await renderLarcPromptPair('stepBQuery', {
    claim_features_json: claimFeatures
  });
  const payload = {
    model: resolveLarcModelName(),
    messages: promptPair.messages
  };

  const response = await sendLLMRequest(payload);
  if (response.ok && response.data && response.data.choices) {
    const content = response.data.choices[0].message.content;
    const parsed = safeJsonParse(content);
    const queries = parsed.Queries || parsed;

    const rawByFeature = {};
    let bundleCount = 0;
    (claimFeatures || []).forEach(feature => {
      const list = Array.isArray(queries?.[feature.Id])
        ? queries[feature.Id].filter(q => typeof q === 'string').map(q => q.trim()).filter(Boolean)
        : [];
      rawByFeature[feature.Id] = list;
      bundleCount = Math.max(bundleCount, list.length);
    });

    if (bundleCount < 1) bundleCount = 1;

    const normalized = {};
    (claimFeatures || []).forEach(feature => {
      normalized[feature.Id] = ensureQueryCount(feature, rawByFeature[feature.Id] || [], bundleCount);
    });
    return normalized;
  }
  throw new Error(response.error || 'B-1 실패');
}

function getStepBQueryBundleCount(claimFeatures, queriesByFeature) {
  let bundleCount = 0;
  (claimFeatures || []).forEach(feature => {
    const count = Array.isArray(queriesByFeature?.[feature.Id]) ? queriesByFeature[feature.Id].length : 0;
    bundleCount = Math.max(bundleCount, count);
  });
  return Math.max(1, bundleCount);
}

async function runStepBParallelRag(claimFeatures, queriesByFeature, mapInfo, fileIds, progressMeta) {
  if (!claimFeatures || claimFeatures.length === 0) {
    return { relevant: {}, responses: [], queriesByIndex: [] };
  }

  const bundleCount = getStepBQueryBundleCount(claimFeatures, queriesByFeature);

  const normalizedByFeature = {};
  (claimFeatures || []).forEach(feature => {
    normalizedByFeature[feature.Id] = ensureQueryCount(feature, queriesByFeature?.[feature.Id] || [], bundleCount);
  });

  const queriesByIndex = [];
  for (let i = 0; i < bundleCount; i += 1) {
    const bundle = (claimFeatures || []).map(feature => ({
      Id: feature.Id,
      Description: feature.Description,
      Query: normalizedByFeature[feature.Id]?.[i] || ''
    }));
    queriesByIndex.push(bundle);
  }

  const useLegacyProgress = progressMeta?.useLegacyProgress !== false;
  const onBundleProgress = typeof progressMeta?.onBundleProgress === 'function'
    ? progressMeta.onBundleProgress
    : null;

  let completed = 0;
  let succeeded = 0;
  let failed = 0;
  const emitBundleProgress = () => {
    if (!onBundleProgress) return;
    try {
      onBundleProgress({
        sent: queriesByIndex.length,
        total: queriesByIndex.length,
        returned: completed,
        succeeded,
        failed
      });
    } catch (callbackError) {
      console.warn('B-2 progress callback failed:', callbackError);
    }
  };
  if (useLegacyProgress) {
    showParallelProgress('B-2 단계: 멀티쿼리 RAG', progressMeta, 'Q1', completed, queriesByIndex.length);
  }
  emitBundleProgress();

  const dispatchQueryBundle = async (bundle, idx) => {
    try {
      const result = await runStepBQueryBundle(bundle, mapInfo, fileIds, idx + 1);
      succeeded += 1;
      return { queryIndex: idx + 1, ok: true, result };
    } catch (error) {
      failed += 1;
      return { queryIndex: idx + 1, ok: false, error: error?.message || String(error) };
    } finally {
      completed += 1;
      if (useLegacyProgress) {
        showParallelProgress('B-2 단계: 멀티쿼리 RAG', progressMeta, `Q${idx + 1}`, completed, queriesByIndex.length);
      }
      emitBundleProgress();
    }
  };

  const settled = await Promise.all(queriesByIndex.map((bundle, idx) => dispatchQueryBundle(bundle, idx)));

  const responses = settled.map((entry, idx) => {
    const bundle = queriesByIndex[idx] || [];
    const bundleQueries = bundle.map(item => ({
      Feature: item.Id,
      Query: item.Query
    }));
    if (entry.ok) {
      return { queryIndex: entry.queryIndex, ok: true, result: entry.result, queries: bundleQueries };
    }
    return { queryIndex: entry.queryIndex, ok: false, error: entry.error, queries: bundleQueries };
  });

  let mergedRelevant = {};
  responses.forEach(entry => {
    if (!entry.ok) return;
    mergedRelevant = mergeRelevantWithPositions(mergedRelevant, entry.result?.Relevant || {});
  });

  return { relevant: mergedRelevant, responses, queriesByIndex };
}

async function runStepBMergeRag(stepBResponses) {
  const filtered = (stepBResponses || [])
    .filter(entry => entry && entry.ok && entry.result)
    .map(entry => ({
      queryIndex: entry.queryIndex,
      queries: entry.queries || [],
      Relevant: entry.result?.Relevant || {}
    }));

  if (filtered.length === 0) {
    return { relevant: {}, debug: { skipped: true } };
  }

  const promptPair = await renderLarcPromptPair('stepBMerge', {
    stepb2_responses_json: filtered
  });
  const payload = {
    model: resolveLarcModelName(),
    messages: promptPair.messages
  };

  const response = await sendLLMRequest(payload);
  if (response.ok && response.data && response.data.choices) {
    const content = response.data.choices[0].message.content;
    const parsed = safeJsonParse(content);
    return { relevant: parsed.Relevant || {}, debug: parsed };
  }
  throw new Error(response.error || 'B-3 실패');
}

async function runStepBQueryBundle(featuresWithQueries, mapInfo, fileIds, queryIndex) {
  const combinedQuery = (featuresWithQueries || [])
    .map(item => item.Query)
    .filter(Boolean)
    .join(' | ');
  const promptPair = await renderLarcPromptPair('stepBRag', {
    mapInfo,
    query_index: queryIndex,
    combined_query: combinedQuery,
    features_json: featuresWithQueries
  });
  const payload = {
    model: resolveLarcModelName(),
    messages: promptPair.messages,
    files: buildFileRefs(fileIds)
  };

  const response = await sendLLMRequest(payload);
  if (response.ok && response.data && response.data.choices) {
    const content = response.data.choices[0].message.content;
    return safeJsonParse(content);
  }
  throw new Error(response.error || 'B-2 실패');
}

function buildStepCEvidenceBundle(relevant) {
  const relevantWithEvidenceIds = {};
  const evidenceById = {};
  let seq = 1;

  Object.entries(relevant || {}).forEach(([doc, items]) => {
    if (!Array.isArray(items)) return;
    relevantWithEvidenceIds[doc] = [];

    items.forEach(raw => {
      const item = {
        Feature: (raw?.Feature || '').trim(),
        MatchType: (raw?.MatchType || raw?.matchType || raw?.match_type || '').trim(),
        Content: (raw?.Content || '').trim(),
        Position: (raw?.Position || '').trim()
      };
      if (!item.Feature || !item.MatchType || !item.Content) return;

      const evidenceId = `R${String(seq).padStart(4, '0')}`;
      seq += 1;

      relevantWithEvidenceIds[doc].push({
        EvidenceId: evidenceId,
        ...item
      });
      evidenceById[evidenceId] = { doc, item };
    });
  });

  return { relevantWithEvidenceIds, evidenceById };
}

function normalizeEvidenceDecisionFlag(value) {
  const text = String(value || '').trim().toUpperCase();
  if (!text) return null;
  if (text === 'P' || text === 'PASS') return 'P';
  if (text === 'F' || text === 'FAIL') return 'F';
  return null;
}

function normalizeEvidenceDecisionMap(raw) {
  const normalized = {};
  Object.entries(raw || {}).forEach(([evidenceId, value]) => {
    const id = String(evidenceId || '').trim();
    if (!id) return;
    const flag = normalizeEvidenceDecisionFlag(value);
    if (!flag) return;
    normalized[id] = flag;
  });
  return normalized;
}

function rebuildRelevantFromEvidenceDecision(evidenceById, evidenceDecision) {
  let relevant = {};
  Object.entries(evidenceDecision || {}).forEach(([evidenceId, flag]) => {
    if (flag !== 'P') return;
    const match = evidenceById?.[evidenceId];
    if (!match) return;
    relevant = mergeRelevantWithPositions(relevant, {
      [match.doc]: [match.item]
    });
  });
  return relevant;
}

async function runStepCForClaim(claim, claimFeatures, stepBMergedRelevant) {
  const evidenceBundle = buildStepCEvidenceBundle(stepBMergedRelevant || {});
  const promptPair = await renderLarcPromptPair('stepCMultiJudge', {
    claim_id: claim.id,
    claim_name: claim.name,
    claim_text: claim.text,
    claim_features_json: claimFeatures,
    stepb_merged_relevant_json: evidenceBundle.relevantWithEvidenceIds
  });
  const payload = {
    model: resolveLarcModelName(),
    messages: promptPair.messages
  };

  const response = await sendLLMRequest(payload);
  if (response.ok && response.data && response.data.choices) {
    const content = response.data.choices[0].message.content;
    const parsed = safeJsonParse(content) || {};
    const featureStatus = parsed.FeatureStatus || parsed.featureStatus || {};
    const evidenceDecision = normalizeEvidenceDecisionMap(
      parsed.EvidenceDecision || parsed.evidenceDecision || {}
    );
    const allEvidenceDecision = {};
    Object.keys(evidenceBundle.evidenceById || {}).forEach(evidenceId => {
      allEvidenceDecision[evidenceId] = evidenceDecision[evidenceId] || 'F';
    });
    const hasEvidenceDecision = Object.keys(evidenceDecision).length > 0;
    const relevant = hasEvidenceDecision
      ? rebuildRelevantFromEvidenceDecision(evidenceBundle.evidenceById, allEvidenceDecision)
      : (parsed.Relevant || parsed.relevant || {});
    return {
      relevant,
      featureStatus,
      debug: {
        FeatureStatus: featureStatus,
        EvidenceDecision: allEvidenceDecision,
        legacyRelevantFallback: !hasEvidenceDecision
      }
    };
  }
  throw new Error(response.error || 'C단계 실패');
}

function filterRelevantByFeatureIds(relevant, featureIds) {
  const idSet = new Set((featureIds || []).map(String));
  const filtered = {};

  Object.entries(relevant || {}).forEach(([doc, items]) => {
    if (!Array.isArray(items)) return;
    const kept = items.filter(item => idSet.has(String(item?.Feature || '')));
    if (kept.length > 0) {
      filtered[doc] = kept;
    }
  });

  return filtered;
}

function hasAnyRelevantEntry(relevant) {
  return Object.values(relevant || {}).some(items => Array.isArray(items) && items.length > 0);
}

async function runStepDForClaim(claim, missingFeatures, mapInfo, fileIds, target) {
  const promptPair = await renderLarcPromptPair('stepDRepair', {
    mapInfo,
    claim_id: claim.id,
    claim_name: claim.name,
    claim_text: claim.text,
    missing_features_json: missingFeatures,
    current_relevant_json: target.Relevant || {}
  });
  const payload = {
    model: resolveLarcModelName(),
    messages: promptPair.messages,
    files: buildFileRefs(fileIds)
  };

  const response = await sendLLMRequest(payload);
  if (response.ok && response.data && response.data.choices) {
    const content = response.data.choices[0].message.content;
    const parsed = safeJsonParse(content);
    return { relevant: parsed.Relevant || {}, debug: parsed };
  }
  throw new Error(response.error || 'D단계 실패');
}

async function runVerificationStage(claimsToVerify, fileIds, citationMap) {
  const summaryResults = {};
  claimsToVerify.forEach(claim => {
    const result = analysisResults[claim.id];
    if (!result || result.error) return;
    summaryResults[claim.id] = {
      ClaimFeatures: result.ClaimFeatures || [],
      Relevant: result.Relevant || {}
    };
  });

  const allClaimsText = claimsToVerify.map(c => `[청구항 ID: ${c.id}] ${c.name}\n${c.text}`).join('\n\n');

  const promptPair = await renderLarcPromptPair('verification', {
    all_claims_text: allClaimsText,
    citation_map: citationMap,
    summary_results_json: summaryResults
  });

  const payload = {
    model: resolveLarcModelName(),
    messages: promptPair.messages,
    files: buildFileRefs(fileIds)
  };

  try {
    const response = await sendLLMRequest(payload);

    if (response.ok && response.data && response.data.choices) {
      const content = response.data.choices[0].message.content;
      const verificationResult = safeJsonParse(content);

      if (verificationResult.verifications) {
        for (const [key, value] of Object.entries(verificationResult.verifications)) {
          const [claimId, featureId, docName] = key.split('_');
          if (analysisResults[claimId]) {
            if (!analysisResults[claimId].verifications) {
              analysisResults[claimId].verifications = {};
            }
            analysisResults[claimId].verifications[`${featureId}_${docName}`] = value;
          }
        }
      }
    }
  } catch (e) {
    console.error('검증 단계에서 오류 발생:', e);
  }
}
