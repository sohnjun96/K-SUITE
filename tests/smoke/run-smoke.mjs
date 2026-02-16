import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const suiteRoot = path.resolve(process.cwd(), "K-SUITE");

function readFile(relativePath) {
  return fs.readFileSync(path.join(suiteRoot, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(suiteRoot, relativePath));
}

function check(condition, message) {
  assert.ok(condition, message);
  process.stdout.write(`PASS  ${message}\n`);
}

function loadSharedConstants() {
  const code = readFile("suite/shared-constants.js");
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(code, sandbox, { filename: "suite/shared-constants.js" });
  return sandbox;
}

function includesAll(filePath, patterns) {
  const source = readFile(filePath);
  return patterns.every((pattern) => source.includes(pattern));
}

function main() {
  process.stdout.write("Running K-SUITE smoke checks...\n");

  const shared = loadSharedConstants();
  const modules = shared.KSUITE_MODULES;
  const settingsFields = shared.KSUITE_SETTINGS_FIELDS;
  const buildLaunchers = shared.KSUITE_BUILD_MODULE_LAUNCHERS;

  check(Array.isArray(modules) && modules.length >= 3, "module registry is loaded");
  check(Array.isArray(settingsFields) && settingsFields.length >= 2, "settings schema is loaded");
  check(typeof buildLaunchers === "function", "launcher builder is loaded");

  const launchers = buildLaunchers(modules);
  modules.forEach((module) => {
    check(typeof module.id === "string" && module.id.length > 0, `module id exists: ${module.id}`);
    check(["tab", "sidepanel"].includes(module.launchType), `module launchType valid: ${module.id}`);
    check(exists(module.path), `module path exists: ${module.path}`);
    check(Boolean(launchers[module.id]), `module launcher generated: ${module.id}`);
  });

  check(
    includesAll("service-worker.js", [
      "KSUITE_BUILD_MODULE_LAUNCHERS",
      "chrome.tabs.create({",
      "FALLBACK_SIDEPANEL_HOST_URL"
    ]),
    "service worker uses registry launcher + sidepanel fallback tab policy"
  );

  check(
    includesAll("suite/app-nav.js", [
      "KSUITE_BUILD_MODULE_LAUNCHERS",
      "renderNav",
      "chrome.tabs.create({",
      "FALLBACK_SIDEPANEL_HOST_URL"
    ]),
    "app navigation uses registry launcher + auto nav render + sidepanel fallback tab policy"
  );

  check(
    includesAll("suite/popup.js", [
      "getModuleMissingFieldIds(module, state.savedValues)",
      "STORAGE_KEYS.SHARED_API_KEY",
      "createFallbackSidePanelTab"
    ]),
    "popup enforces key gate + single shared key + sidepanel fallback tab policy"
  );

  check(
    includesAll("suite/popup.html", ["shared-constants.js"]),
    "popup loads shared constants"
  );
  check(
    includesAll("modules/k-larc/dashboard.html", [
      "../../suite/shared-constants.js",
      "../../suite/shared-feedback.js",
      "../../suite/app-nav.js"
    ]),
    "K-LARC loads shared constants + feedback + app-nav"
  );
  check(
    includesAll("modules/k-query/src/sidebar/sidepanel.html", [
      "../../../../suite/shared-constants.js",
      "../../../../suite/shared-feedback.js",
      "../../../../suite/app-nav.js"
    ]),
    "K-Query loads shared constants + feedback + app-nav"
  );
  check(
    includesAll("modules/k-scan/sidepanel.html", [
      "../../suite/shared-constants.js",
      "../../suite/shared-feedback.js",
      "../../suite/app-nav.js"
    ]),
    "K-SCAN loads shared constants + feedback + app-nav"
  );

  process.stdout.write("All smoke checks passed.\n");
}

try {
  main();
} catch (error) {
  process.stderr.write(`SMOKE CHECK FAILED: ${error.message}\n`);
  process.exitCode = 1;
}
