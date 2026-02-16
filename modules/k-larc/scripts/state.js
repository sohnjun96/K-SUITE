/**
 * Patent RAG Analyzer - Dashboard Logic
 * UI 제어, 데이터 관리, Background 통신, 결과 렌더링 담당
 */

// 개발자 전용 실행 플래그 (코드에서만 변경)
const DEV_FLAGS = {
  ENABLE_MOCK_MODE: true,
  SHOW_DEBUG_PANEL: true
};
const DEFAULT_LARC_MODEL = String(globalThis.KSUITE_DEFAULT_LLM_MODEL || "").trim();

// --- 전역 상태 변수 ---
let claims = [];     // 청구항 목록
let citations = [];  // 인용발명 목록 (이제 storage에 영구 저장됨)
let settings = {
  url: 'http://10.133.111.32:8080',
  key: '',
  model: DEFAULT_LARC_MODEL,
  mockMode: DEV_FLAGS.ENABLE_MOCK_MODE
};
//let settings = { url: 'http://127.0.0.1:5000', key: '', model: DEFAULT_LARC_MODEL, mockMode: DEV_FLAGS.ENABLE_MOCK_MODE };
let analysisResults = {}; // { claimId: { ClaimFeatures: [...], Relevant: {...} } }
let currentSortOrder = 'doc_then_feature'; // 'doc_then_feature' or 'feature_then_doc'
let debugState = { claimId: null, tab: 'stepA' };
let isAnalysisRunning = false;
let analysisStartedAt = null;
let analysisElapsedTimerId = null;
let selectedClaimPreviewId = null;
const ANALYSIS_STEPS = ['A', 'B', 'C', 'D', 'E'];
let claimProgressById = {};
let selectedResultClaimId = null;
let analysisExecutionMode = 'deep'; // 'deep' | 'quick'
