# K-SUITE

K-SUITE is a Chrome MV3 extension suite for patent workflow support.
It provides a single launcher and shared settings for three modules:
`K-LARC`, `K-Query`, and `K-SCAN`.

## Modules

- `K-LARC`: citation/reference analysis dashboard
  - Quick and Deep analysis modes
  - Step-level debug tabs (A/B/C/D/Quick/Verification/Final)
  - Analysis JSON export
- `K-Query`: claim-to-boolean query generator (side panel)
  - 3-layer pipeline (analysis -> expansion -> assembly/validation)
  - Per-layer rerun and progress/developer logs
- `K-SCAN`: capture-driven similarity check tool
  - Captures `bpService.do` requests via `chrome.debugger`
  - Uses editable prompt template in `modules/k-scan/prompts/default.txt`

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
- sidepanel fallback-tab policy
- shared API key gate path
- shared script loading in app pages

## Troubleshooting

- Extension load error:
  - Make sure you loaded the repository root `manifest.json`.
- API call error:
  - Check `Base URL` and `Shared API Key` in K-SUITE settings.
- Side panel does not open:
  - Use an active `http/https` tab, not browser internal pages.
- Garbled text in local editor/terminal:
  - Force file encoding to `UTF-8`.
