# K-SUITE

K-SUITE is a Chrome MV3 extension suite for patent workflow support.
It provides a single launcher and shared settings for three modules:
`K-LARC`, `K-Query`, and `K-SCAN`.

## Recent Updates

- Unified prompt-file loading strategy (system/user prompts from prompt folders)
- Encoding guard and model-name hardcoding removal in runtime paths
- K-LARC debug UX improvements:
  - step-by-step timing in debug flow
  - richer mock data and analysis summary table enhancements
  - position modal now shows both summary and source text
- K-LARC citation upload pipeline enhancements:
  - added `PDF 추가` flow with local PDF parsing (`pdf.js`) and upload support
  - added sentinel-based citation text packaging:
    - format: `⟪0012⟫ ... ⟪/0012⟫` (4-digit fixed width)
    - XML: paragraph keys first, then claims, in sequential sentinel order
    - Direct/Non-XML tab input: sentence-aware chunking around 400 chars
    - PDF: section/page-aware extraction + sentence-aware chunking around 400 chars
  - chunk-size policy centralized in `modules/k-larc/scripts/state.js`
  - position display policy:
    - result table uses sentinel key view
    - detail/meta view includes page/section metadata for PDF evidence
    - opinion-notice evidence view shows page/section labels for PDF entries
- K-LARC prompt policy update:
  - prompts now explicitly allow both opening and closing sentinels for position lookup
- K-Query improvements:
  - mock mode added
  - core-synonym toggle support in synonym editor
  - side panel launch available on most tabs (except extension settings pages)
- K-SCAN stability and policy updates:
  - stronger START/STOP timeout/error handling
  - clearer guidance when launched from unsupported contexts

## Modules

- `K-LARC`: citation/reference analysis dashboard
  - Quick and Deep analysis modes
  - Step-level debug tabs (A/B/C/D/Quick/Verification/Final)
  - Step elapsed-time display in debug mode
  - Claim-element summary and comparison views
  - Tab/Direct/PDF citation ingestion with sentinel-based position tracking
  - Analysis JSON export
- `K-Query`: claim-to-boolean query generator (side panel)
  - 3-layer pipeline (analysis -> expansion -> assembly/validation)
  - Per-layer rerun and progress/developer logs
  - Mock mode and synonym controls
- `K-SCAN`: capture-driven similarity check tool
  - Captures `bpService.do` requests via `chrome.debugger`
  - Uses editable prompt template in `modules/k-scan/prompts/default.txt`
  - Timeout-guarded background messaging for start/stop capture

## Repository Layout

```text
.
|-- manifest.json
|-- service-worker.js
|-- suite/               # unified launcher UI and shared constants
|-- modules/
|   |-- k-larc/
|   |-- k-query/
|   `-- k-scan/
`-- tests/smoke/         # integration smoke checks
```

## Quick Start

1. Open `chrome://extensions` in Chrome.
2. Enable Developer Mode.
3. Click "Load unpacked".
4. Select this repository root (where `manifest.json` exists).
5. Open K-SUITE popup and save:
   - `OpenWebUI Base URL` (default: `http://10.133.111.32:8080`)
   - `Shared API Key / Token`
6. Launch a module from the K-SUITE home popup.

## Tab Launch Policy

- `K-Query`
  - Can open in side panel from general tabs.
  - Blocked on browser extension settings tabs
    (`chrome://extensions`, `edge://extensions`).
- `K-SCAN`
  - Must run on capturable web tabs (`http/https`) for capture.
  - When attempted from K-LARC dashboard context, launcher warns to open from a KOMPASS tab.
- `K-LARC`
  - Works as standalone dashboard page with integrated analysis/debug panels.

## Runtime Requirements

- Chrome with Manifest V3 support
- OpenWebUI-compatible endpoint:
  - `POST {webuiBaseUrl}/api/chat/completions`
- Available model IDs in your OpenWebUI instance
  - Example config: `modules/k-query/src/core/model_config.js`

## Prompt Customization

- K-LARC prompts: `modules/k-larc/prompts/*.txt`
- K-Query prompts: `modules/k-query/prompts/layer_*/`
- K-SCAN template: `modules/k-scan/prompts/default.txt`

You can tune behavior by editing prompt text files without changing JS code.

## Smoke Test

Run from repository root:

```powershell
node tests/smoke/run-smoke.mjs
```

This verifies:
- shared module registry wiring
- launcher generation and routing
- module-specific sidepanel/tab policy
- shared API key gate path
- shared script loading in app pages

## Troubleshooting

- Extension load error:
  - Make sure you loaded the repository root `manifest.json`.
- API call error:
  - Check `Base URL` and `Shared API Key` in K-SUITE settings.
- Side panel does not open:
  - `K-Query`: avoid extension settings pages (`chrome://extensions`, `edge://extensions`).
  - `K-SCAN`: use an active KOMPASS tab and ensure target tab is `http/https`.
- `K-SCAN` shows `실패: 백그라운드 응답 시간 초과`:
  - Reload the extension and retry capture.
  - Confirm the active tab is capturable and not a browser internal page.
  - Check service worker/background console for runtime errors.
- Garbled text in local editor/terminal:
  - Force file encoding to `UTF-8`.
