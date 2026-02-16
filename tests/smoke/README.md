# K-SUITE Smoke Checks

Run from workspace root:

```powershell
node K-SUITE/tests/smoke/run-smoke.mjs
```

This script verifies:
- shared module registry is loaded
- launcher wiring is generated from registry
- sidepanel fallback tab creation policy is present
- key gate + shared key path is wired
- app pages load shared constants/nav/feedback scripts
