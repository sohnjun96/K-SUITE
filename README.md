# K-SUITE

K-SUITE는 특허 업무 지원을 위한 Chrome MV3 확장 프로그램 모음입니다.  
단일 런처와 공통 설정(서버 URL, API 키)을 기반으로 아래 3개 모듈을 통합 제공합니다.

- `K-LARC`: 인용발명 근거 분석 대시보드
- `K-Query`: 청구항 기반 불리언 검색식 생성기(사이드패널)
- `K-SCAN`: 캡처 기반 유사도 점검 도구

## 문서 목적

이 README는 다음 내용을 제공합니다.

- 설치 및 초기 설정 방법
- 모듈별 기능과 실행 흐름
- 주요 디렉터리 구조
- 프롬프트 커스터마이징 포인트
- 테스트/운영/문제 해결 가이드

## 빠른 시작

1. Chrome에서 `chrome://extensions`를 엽니다.
2. 우측 상단 `개발자 모드`를 켭니다.
3. `압축해제된 확장 프로그램을 로드`를 클릭합니다.
4. 이 저장소 루트(`manifest.json`이 있는 위치)를 선택합니다.
5. K-SUITE 팝업을 열고 공통 설정을 저장합니다.
   - `OpenWebUI Base URL` (기본: `http://10.133.111.32:8080`)
   - `Shared API Key / Token`
6. 홈 런처에서 원하는 모듈을 실행합니다.

## 모듈 개요

## 1) K-LARC

인용발명(문헌)과 청구항을 대응시켜 근거를 추출·판정·검증하는 분석 모듈입니다.

주요 기능:

- Quick/Deep 분석 모드
- 단계별 디버그 탭(`A/B/C/D/Quick/Verification/Final`)
- 결과 테이블 + 구성요소 요약 매트릭스
- 인용발명 입력 경로 3종:
  - 브라우저 탭 추출
  - PDF 업로드
  - 직접 텍스트 입력
- Position 추적을 위한 센티넬 기반 원문 패키징
  - 형식: `⟪0012⟫ ... ⟪/0012⟫` (4자리 고정)
- 분석 결과 JSON 내보내기

상세 기술 문서:

- [K-LARC 5 레이어 판정 시스템](modules/k-larc/docs/k-larc-5-layer-judgment-system.md)
- [K-LARC 인용발명 전처리 프로세스](modules/k-larc/docs/k-larc-citation-preprocessing-process.md)

## 2) K-Query

청구항을 검색 가능한 불리언 질의로 변환하는 사이드패널 모듈입니다.

주요 기능:

- 3-레이어 파이프라인
  - 분석(analysis)
  - 확장(expansion)
  - 조립/검증(assembly/validation)
- 레이어별 재실행과 진행 로그 확인
- 동의어 편집 및 코어 동의어 토글
- 도메인 사전 관리(UI)
  - 검색/정렬
  - JSON import/export
  - 항목 편집/복사/삭제
- 강화된 쿼리 검증
  - 연산자 위치/그룹핑 검사
  - 따옴표/괄호 균형 검사
  - `<near/n>` 형식 및 범위 검사
- 결과 export
  - 질의 텍스트(`.txt`)
  - 번들 JSON(`.json`)

## 3) K-SCAN

요청 캡처 기반으로 유사도 점검을 수행하는 모듈입니다.

주요 기능:

- `chrome.debugger` 기반 `bpService.do` 요청 캡처
- START/STOP 타임아웃 가드
- 미지원 컨텍스트 실행 시 안내 메시지
- 프롬프트 템플릿 기반 동작
  - `modules/k-scan/prompts/default.txt`

## K-LARC 실행 흐름(요약)

Deep 모드 기준:

1. A단계: 청구항 구성요소 분해(`ClaimFeatures`)
2. B단계: 멀티쿼리 RAG 근거 수집/병합
3. C단계: 멀티 판정(`FeatureStatus`, `EvidenceDecision`)
4. D단계: 누락/부분일치 리페어
5. E단계: 근거 검증(`caution`/`warning`)

Quick 모드는 단일 요청으로 Feature/Relevant/Status/Verification을 생성하는 축약 경로입니다.

## K-LARC 인용발명 입력/전처리(요약)

공통 목표:

- 문서를 검색/검증 가능한 단위로 분할
- 각 단위에 센티넬 ID를 부여
- `payloadText`와 업로드용 평문(`text`)을 함께 보존

입력 경로:

1. 탭 추출(`EXTRACT_AND_UPLOAD`)
2. PDF 전처리(`pdf.js` + 섹션/페이지 인식)
3. 직접 입력(`DIRECT_UPLOAD`)

전처리 결과는 후속 단계의 Position 추적, 검증, 원문 모달 표시에 재사용됩니다.

## 모듈 실행 정책

- `K-LARC`
  - 독립 대시보드 페이지로 실행
- `K-Query`
  - 일반 웹 탭에서 사이드패널 실행 가능
  - 브라우저 내부 확장 설정 페이지는 제한
    - `chrome://extensions`
    - `edge://extensions`
- `K-SCAN`
  - 캡처 가능한 `http/https` 탭 필요
  - K-LARC 대시보드 컨텍스트에서 실행 시 KOMPASS 탭 사용 안내

## 런타임 요구사항

- Chrome (Manifest V3 지원)
- OpenWebUI 호환 API 엔드포인트
  - `POST {webuiBaseUrl}/api/chat/completions`
- 사용 가능한 모델 ID
  - 예시: `modules/k-query/src/core/model_config.js`

## 프롬프트 커스터마이징

코드를 수정하지 않고 프롬프트 파일만 조정해 동작을 튜닝할 수 있습니다.

- K-LARC: `modules/k-larc/prompts/*.txt`
- K-Query: `modules/k-query/prompts/layer_*/`
- K-SCAN: `modules/k-scan/prompts/default.txt`

## 저장소 구조

```text
.
|-- manifest.json
|-- service-worker.js
|-- README.md
|-- suite/                         # 통합 런처 UI 및 공통 상수
|-- modules/
|   |-- k-larc/                    # 인용발명 분석 모듈
|   |-- k-query/                   # 불리언 질의 생성 모듈
|   `-- k-scan/                    # 캡처 기반 유사도 점검 모듈
`-- tests/smoke/                   # 스모크 테스트
```

## 테스트

저장소 루트에서 실행:

```powershell
node tests/smoke/run-smoke.mjs
```

검증 항목:

- 모듈 레지스트리 및 라우팅
- 런처 생성 및 모듈 실행 정책
- 공통 API 키 게이트 경로
- 앱 페이지 공통 스크립트 로딩

## 최근 변경사항 요약

- 프롬프트 파일 로딩 전략 통일(system/user 분리 로드)
- 런타임 인코딩 가드 보강 및 모델명 하드코딩 제거
- K-LARC:
  - 디버그 UX 개선(스텝 타이밍/요약 강화)
  - 센티넬 기반 인용발명 업로드 파이프라인 고도화
  - PDF 전처리 및 Position 표시 메타 강화
  - Position lookup에서 시작/닫는 센티넬 모두 허용
- K-Query:
  - Mock 모드 추가
  - 동의어/검증/도메인 사전 UX 고도화
- K-SCAN:
  - START/STOP 타임아웃/오류 처리 강화

## 문제 해결

## 확장 프로그램이 로드되지 않음

- 루트 `manifest.json`을 선택했는지 확인합니다.
- 기존 설치본이 있다면 제거 후 다시 로드합니다.

## API 호출 실패

- K-SUITE 설정의 `Base URL`, `Shared API Key`를 확인합니다.
- 서버가 OpenWebUI 호환 경로를 제공하는지 확인합니다.

## 사이드패널이 열리지 않음

- `K-Query`: `chrome://extensions`, `edge://extensions` 등 내부 페이지를 피합니다.
- `K-SCAN`: 활성 탭이 `http/https`인지 확인합니다.

## K-SCAN 타임아웃 (`실패: 백그라운드 응답 시간 초과`)

- 확장을 새로고침하고 재시도합니다.
- 현재 탭이 캡처 가능한 탭인지 확인합니다.
- 서비스워커/백그라운드 콘솔 로그를 확인합니다.

## 한글/문자 깨짐

- 파일 인코딩을 `UTF-8`로 고정합니다.
