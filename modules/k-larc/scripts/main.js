document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings(); // 설정 + 청구항 + 인용발명 로드
  loadTabs();

  const settingsToggle = document.getElementById('btn-settings-toggle');
  const settingsArea = document.querySelector('.settings-area');
  if (settingsToggle) {
    settingsToggle.setAttribute('aria-expanded', 'false');
    settingsToggle.addEventListener('click', () => {
      const isOpen = document.body.classList.toggle('settings-open');
      settingsToggle.setAttribute('aria-expanded', String(isOpen));
    });
  }

  document.addEventListener('click', (e) => {
    if (!settingsArea || !settingsArea.contains(e.target)) {
      document.body.classList.remove('settings-open');
      if (settingsToggle) settingsToggle.setAttribute('aria-expanded', 'false');
    }
  });

  // 버튼 이벤트 리스너 등록
  const tabSelect = document.getElementById('tab-select');
  if (tabSelect) {
    let tabRefreshTimer = null;
    const scheduleLoadTabs = () => {
      if (tabRefreshTimer) {
        clearTimeout(tabRefreshTimer);
      }
      tabRefreshTimer = setTimeout(() => {
        tabRefreshTimer = null;
        loadTabs();
      }, 120);
    };

    tabSelect.addEventListener('focus', scheduleLoadTabs);
    tabSelect.addEventListener('mousedown', scheduleLoadTabs);
    tabSelect.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown') {
        scheduleLoadTabs();
      }
    });
  }
  document.getElementById('btn-add-claim').addEventListener('click', addClaimInput);
  document.getElementById('btn-add-citation').addEventListener('click', addCitationFromTab);
  document.getElementById('btn-analyze').addEventListener('click', runAnalysis);
  document.getElementById('btn-edit-mode').addEventListener('click', () => setAnalysisMode(false));
  document.querySelectorAll('input[name="analysis-execution-mode"]').forEach(input => {
    input.addEventListener('change', (e) => {
      if (!e.target.checked) return;
      setAnalysisExecutionMode(e.target.value);
    });
  });
  if (typeof syncAnalysisExecutionModeToggle === 'function') {
    syncAnalysisExecutionModeToggle();
  }
  const toggleClaimsButton = document.getElementById('btn-toggle-claims-panel');
  if (toggleClaimsButton) {
    toggleClaimsButton.addEventListener('click', () => toggleInputPanelCollapse('claims'));
  }
  const toggleCitationsButton = document.getElementById('btn-toggle-citations-panel');
  if (toggleCitationsButton) {
    toggleCitationsButton.addEventListener('click', () => toggleInputPanelCollapse('citations'));
  }
  const toggleResultButton = document.getElementById('btn-toggle-result-panel');
  if (toggleResultButton) {
    toggleResultButton.addEventListener('click', () => toggleResultPanelCollapse());
    setResultPanelCollapsed(false);
  }
  
  // [추가] 직접 추가 버튼
  document.getElementById('btn-add-direct').addEventListener('click', openDirectAddModal);

  // 모달(미리보기) 닫기 이벤트
  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('preview-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('preview-modal')) closeModal();
  });

  // [추가] 모달(직접 추가) 닫기/저장 이벤트
  document.getElementById('btn-close-direct-modal').addEventListener('click', closeDirectAddModal);
  document.getElementById('btn-cancel-direct-add').addEventListener('click', closeDirectAddModal);
  document.getElementById('btn-save-direct-add').addEventListener('click', handleDirectAdd);
  document.getElementById('direct-add-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('direct-add-modal')) closeDirectAddModal();
  });

  // 결과 필터 변경
  document.getElementById('result-claim-select').addEventListener('change', (e) => {
    selectedResultClaimId = Number.parseInt(e.target.value, 10);
    renderResultTable(selectedResultClaimId);
  });

  // [추가] 정렬 버튼 이벤트
  document.getElementById('btn-sort-by-doc').addEventListener('click', () => setSortOrder('doc_then_feature'));
  document.getElementById('btn-sort-by-feature').addEventListener('click', () => setSortOrder('feature_then_doc'));

  const noticeClaimSelect = document.getElementById('notice-claim-select');
  if (noticeClaimSelect) {
    noticeClaimSelect.addEventListener('change', () => refreshOpinionNoticeCard({ syncClaimSelect: false }));
  }
  const copyNoticeTsvButton = document.getElementById('btn-copy-opinion-notice-tsv');
  if (copyNoticeTsvButton) {
    copyNoticeTsvButton.addEventListener('click', () => {
      copyOpinionNoticeTableAsTsv();
    });
  }
  document.querySelectorAll('input[name=\"notice-claim-type\"]').forEach(input => {
    input.addEventListener('change', (e) => {
      if (!e.target.checked) return;
      refreshOpinionNoticeCard({ syncClaimSelect: false });
    });
  });

  // [추가] 채팅 질문 버튼
  document.getElementById('btn-send-chat').addEventListener('click', sendUserChat);
  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendUserChat();
    }
  });

  // [추가] 검증 아이콘 클릭 시 팝업 이벤트
  document.getElementById('result-tbody').addEventListener('click', (e) => {
    const positionToken = e.target.closest('.position-token');
    if (positionToken) {
      openPositionModal(
        positionToken.dataset.docName,
        positionToken.dataset.paragraphKey,
        positionToken.dataset.relatedContent || ''
      );
      return;
    }

    const icon = e.target.closest('.verification-icon, .verification-flag[data-reason]');
    if (icon) {
      const reason = icon.dataset.reason;
      if (reason) {
        openVerificationModal(reason); // Use custom modal instead of alert
      }
    }
  });

  // [추가] 검증 모달 닫기 이벤트
  document.getElementById('btn-close-verification-modal').addEventListener('click', closeVerificationModal);
  document.getElementById('btn-close-verification-modal-footer').addEventListener('click', closeVerificationModal);
  document.getElementById('verification-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('verification-modal')) closeVerificationModal();
  });

  document.getElementById('btn-close-position-modal').addEventListener('click', closePositionModal);
  document.getElementById('btn-close-position-modal-footer').addEventListener('click', closePositionModal);
  document.getElementById('position-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('position-modal')) closePositionModal();
  });

  // [추가] 검증 모달 내용 복사 이벤트
  document.getElementById('btn-copy-verification-content').addEventListener('click', () => {
    const content = document.getElementById('verification-modal-content').textContent;
    navigator.clipboard.writeText(content).then(() => {
      alert('내용이 클립보드에 복사되었습니다.');
    }).catch(err => {
      console.error('클립보드 복사 실패:', err);
      alert('내용 복사에 실패했습니다.');
    });
  });

  const downloadAnalysisButton = document.getElementById('btn-download-analysis-json');
  if (downloadAnalysisButton) {
    downloadAnalysisButton.addEventListener('click', () => {
      const ok = downloadAnalysisSnapshot();
      if (!ok) return;
      alert('분석 데이터 JSON 다운로드를 시작했습니다.');
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && handleGlobalEscapeKey()) {
      e.preventDefault();
      if (settingsToggle) settingsToggle.setAttribute('aria-expanded', 'false');
      return;
    }

    if (e.key === 'Tab') {
      trapFocusInOpenModal(e);
    }
  });

  const debugPanel = document.querySelector('.debug-panel');
  if (debugPanel) {
    debugPanel.classList.toggle('hidden', !DEV_FLAGS.SHOW_DEBUG_PANEL);
  }

  if (DEV_FLAGS.SHOW_DEBUG_PANEL) {
    initDebugPanel();
    updateDebugExportButtonVisibility();
  }

  refreshOpinionNoticeCard();
});
