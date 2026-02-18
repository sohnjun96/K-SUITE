# K-LARC 5 레이어 판정 시스템 정리

## 1) 문서 범위
- 이 문서는 K-LARC의 `Deep Analysis` 기준 5단계(`A~E`) 판정 파이프라인을 코드/프롬프트 기준으로 정리한다.
- 기준 코드:
`modules/k-larc/scripts/analysis.js:78`,
`modules/k-larc/scripts/utils.js:72`,
`modules/k-larc/scripts/utils.js:317`,
`modules/k-larc/scripts/utils.js:1363`,
`modules/k-larc/scripts/utils.js:1438`,
`modules/k-larc/scripts/render.js:21`,
`modules/k-larc/scripts/state.js:30`

## 2) 전체 흐름 (Deep Analysis)
1. **Layer A (구성요소 분해)**: 청구항을 `ClaimFeatures`로 분해
2. **Layer B (멀티쿼리 RAG)**: 쿼리 생성(B-1) -> 병렬 검색(B-2) -> 근거 병합(B-3)
3. **Layer C (멀티 판정)**: 근거별 `EvidenceDecision(P/F)` + Feature별 `FeatureStatus`
4. **Layer D (리페어)**: 누락/부분일치 Feature 재탐색 후 C 레이어 재판정
5. **Layer E (검증)**: 최종 근거 품질 검증(`caution`/`warning`)

UI 라벨도 동일하게 `A단계: 구성요소`, `B단계: 멀티쿼리 RAG`, `C단계: 멀티판정`, `D단계: 리페어`, `E단계: 검증`으로 표시된다 (`modules/k-larc/scripts/render.js:21`).

## 3) 공통 데이터 구조
- `ClaimFeatures`: `[ { Id: "F1", Description: "..." } ]`
- `Relevant`: `{ "D1": [ { Feature, MatchType, Content, Position } ] }`
- `FeatureStatus`: `{ "F1": "ENTAIL|PARTIAL|NOT_FOUND" }`
- `verifications` (결과 저장용): `{ "F1_D1": "P|F" }` 또는 `{ "F1_D1": { status, reason } }`

`analysisResults[claimId]`의 기본 구조는 `ClaimFeatures`, `Relevant`, `FeatureStatus`, `verifications`, `debug`를 포함한다 (`modules/k-larc/scripts/analysis.js:24`).

## 4) 레이어별 상세

## Layer A - 구성요소 분해
### 역할
- 청구항 텍스트를 인용문헌 대조 가능한 최소 기술 구성요소(`Feature`)로 분해한다.

### 입력
- 앱 입력:
`claim.id`, `claim.text` (`modules/k-larc/scripts/analysis.js:178`)
- 프롬프트 입력 변수:
`claim_id`, `claim_text` (`modules/k-larc/prompts/step_a_features/schema.json`)

### 처리
- `runStepAForClaim`가 `step_a_features` 프롬프트를 호출하고 JSON을 파싱한다 (`modules/k-larc/scripts/analysis.js:384`).

### 출력
- 출력 JSON:
`{ "ClaimFeatures": [ { "Id": "F1", "Description": "..." } ] }`
- 상태 반영:
`analysisResults[claimId].ClaimFeatures` 설정, `Relevant/FeatureStatus/verifications` 초기화 (`modules/k-larc/scripts/analysis.js:179`)

### 관련 프롬프트
- `modules/k-larc/prompts/step_a_features/system.txt`
- `modules/k-larc/prompts/step_a_features/user.txt`
- `modules/k-larc/prompts/step_a_features/schema.json`

## Layer B - 멀티쿼리 RAG
레이어 B는 내부적으로 B-1, B-2, B-3 3단계를 가진다.

### B-1 역할: Feature별 쿼리 생성
- `ClaimFeatures`를 입력으로 Feature별 검색 쿼리 배열 생성.
- 함수:
`runStepBQueryGeneration` (`modules/k-larc/scripts/analysis.js:499`)

### B-1 입력
- `claim_features_json` (`modules/k-larc/prompts/step_b_query/schema.json`)

### B-1 출력
- `{ [featureId]: [query1, query2, ...] }`
- 코드에서 각 Feature의 쿼리 개수를 맞추기 위해 `ensureQueryCount`를 적용한다 (`modules/k-larc/scripts/utils.js:1408`).

### B-2 역할: 병렬 RAG 검색
- 동일 인덱스 쿼리들을 번들로 묶어 병렬 호출.
- 함수:
`runStepBParallelRag` -> `runStepBQueryBundle` (`modules/k-larc/scripts/analysis.js:544`, `modules/k-larc/scripts/analysis.js:663`)

### B-2 입력
- `mapInfo`, `query_index`, `combined_query`, `features_json`
(`modules/k-larc/prompts/step_b_rag/schema.json`)
- 첨부 파일:
`files: buildFileRefs(fileIds)` (LLM 요청 시 포함)

### B-2 출력
- 각 번들 응답:
`{ Relevant: { Dn: [ { Feature, MatchType, Content, Position } ] } }`
- 내부 집계:
`responses[]`, `queriesByIndex[]`, 임시 병합 `mergedRelevant` (`modules/k-larc/scripts/analysis.js:624`)

### B-3 역할: 근거 병합/중복 제거
- 병렬 응답의 중복 근거를 문서+Feature 기준으로 병합.
- 함수:
`runStepBMergeRag` (`modules/k-larc/scripts/analysis.js:633`)

### B-3 입력
- `stepb2_responses_json` (`modules/k-larc/prompts/step_b_merge/schema.json`)

### B-3 출력
- 최종:
`{ Relevant: { Dn: [ { Feature, MatchType, Content, Position } ] } }`
- 저장:
`target.stepBRelevant` (`modules/k-larc/scripts/analysis.js:255`)

### 관련 프롬프트
- `modules/k-larc/prompts/step_b_query/*`
- `modules/k-larc/prompts/step_b_rag/*`
- `modules/k-larc/prompts/step_b_merge/*`

## Layer C - 멀티 판정
### 역할
- B단계 근거를 Feature 기준으로 판정하여:
1) Feature 충족상태(`FeatureStatus`)
2) 근거 채택 여부(`EvidenceDecision: P/F`)
를 동시에 결정한다.

### 입력
- 앱 입력:
`claim`, `claimFeatures`, `stepBMergedRelevant` (`modules/k-larc/scripts/analysis.js:272`)
- 프롬프트 입력 변수:
`claim_id`, `claim_name`, `claim_text`, `claim_features_json`, `stepb_merged_relevant_json`
(`modules/k-larc/prompts/step_c_multijudge/schema.json`)

### 처리
- 먼저 `buildStepCEvidenceBundle`이 각 근거에 `EvidenceId (R0001...)`를 부여 (`modules/k-larc/scripts/analysis.js:688`).
- LLM 출력의 `EvidenceDecision`을 정규화하고 누락된 EvidenceId는 기본 `F` 처리 (`modules/k-larc/scripts/analysis.js:728`).
- `P`로 선택된 근거만 `Relevant`로 재구성 (`modules/k-larc/scripts/analysis.js:740`).

### 출력
- LLM 기대 출력:
`{ "FeatureStatus": {...}, "EvidenceDecision": {...} }`
- 앱 반영 출력:
`target.Relevant`, `target.FeatureStatus`, `target.debug.stepC`
(`modules/k-larc/scripts/analysis.js:272`)

### 관련 프롬프트
- `modules/k-larc/prompts/step_c_multijudge/system.txt`
- `modules/k-larc/prompts/step_c_multijudge/user.txt`
- `modules/k-larc/prompts/step_c_multijudge/schema.json`

## Layer D - 리페어
### 역할
- C단계 이후 `ENTAIL`이 아닌/근거가 없는 Feature를 재탐색해 보강한다.

### 입력
- 누락 Feature 추출:
`getMissingFeatures(claimFeatures, featureStatus, relevant)`
(`modules/k-larc/scripts/utils.js:1438`, 호출: `modules/k-larc/scripts/analysis.js:293`)
- 프롬프트 입력 변수:
`mapInfo`, `claim_id`, `claim_name`, `claim_text`, `missing_features_json`, `current_relevant_json`
(`modules/k-larc/prompts/step_d_repair/schema.json`)

### 처리
- `runStepDForClaim`로 대체 쿼리+추가 Relevant 생성 (`modules/k-larc/scripts/analysis.js:815`).
- D 결과 Relevant를 누락 Feature ID만 남기도록 필터링 (`modules/k-larc/scripts/analysis.js:796`).
- 후보가 있으면 C단계를 누락 Feature에 대해 재실행하여 최종 채택분만 병합 (`modules/k-larc/scripts/analysis.js:307`).

### 출력
- LLM 출력(원형):
`{ "Queries": { ... }, "Relevant": { ... } }`
- 앱 반영 출력:
`target.Relevant` 보강, `target.FeatureStatus` 갱신, `target.debug.stepD` 기록

### 관련 프롬프트
- `modules/k-larc/prompts/step_d_repair/system.txt`
- `modules/k-larc/prompts/step_d_repair/user.txt`
- `modules/k-larc/prompts/step_d_repair/schema.json`

## Layer E - 검증
### 역할
- 최종 `Relevant` 항목의 정확성/위치일치/MatchType 적절성을 별도 검증한다.
- 정상 항목은 출력하지 않고 문제 항목만 반환한다.

### 입력
- 앱 입력:
`summaryResults = { claimId: { ClaimFeatures, Relevant } }`
(`modules/k-larc/scripts/analysis.js:840`)
- 프롬프트 입력 변수:
`all_claims_text`, `citation_map`, `summary_results_json`
(`modules/k-larc/prompts/verification/schema.json`)
- 첨부 파일:
문헌 원문 파일들 (`files: buildFileRefs(fileIds)`)

### 처리
- `runVerificationStage`가 `verification` 프롬프트 호출 후,
`CLAIMID_FEATUREID_DOCNAME` 키를 분해해 내부 키 `FEATURE_DOC`로 저장 (`modules/k-larc/scripts/analysis.js:872`).

### 출력
- LLM 출력:
`{ "verifications": { "CLAIMID_FEATUREID_DOCNAME": { "status": "caution|warning", "reason": "..." } } }`
- 앱 반영:
`analysisResults[claimId].verifications["F1_D1"] = { status, reason }`

### 관련 프롬프트
- `modules/k-larc/prompts/verification/system.txt`
- `modules/k-larc/prompts/verification/user.txt`
- `modules/k-larc/prompts/verification/schema.json`

## 5) Quick 모드와 5레이어의 관계
- `quick` 모드에서는 `step_quick_analysis` 1회 호출로 Feature/Relevant/FeatureStatus/Verification을 동시 생성한다 (`modules/k-larc/scripts/analysis.js:451`).
- 이 경우 타이밍 기준으로 A만 수행되고 B~E는 `skipped`로 마킹된다 (`modules/k-larc/scripts/analysis.js:150`).
- 따라서 “5 레이어 판정 시스템”은 `deep` 모드의 표준 파이프라인이며, quick 모드는 축약 실행 경로다.

## 6) 결과적으로 각 레이어가 넘기는 핵심 산출물
1. A -> B: `ClaimFeatures`
2. B -> C: 병합된 `Relevant(stepBRelevant)`
3. C -> D: `FeatureStatus`, 필터링된 `Relevant`
4. D -> E: 보강/재판정 후 `Relevant`, `FeatureStatus`
5. E -> 화면: `verifications`(P/F 또는 caution/warning+reason) 포함 최종 결과 테이블
