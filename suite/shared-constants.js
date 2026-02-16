(function initKSuiteSharedConstants(globalScope) {
  const DEFAULT_WEBUI_BASE_URL = "http://10.133.111.32:8080";
  const FALLBACK_SIDEPANEL_HOST_URL = "https://example.com/";
  const DEFAULT_LLM_MODEL = "gpt-oss-120b";

  const MESSAGE_TYPES = Object.freeze({
    LAUNCH_MODULE: "LAUNCH_MODULE"
  });

  const STORAGE_KEYS = Object.freeze({
    SHARED_API_KEY: "ksuiteSharedApiKey",
    LEGACY_WEBUI_API_KEY: "webuiApiKey",
    LEGACY_USER_TOKEN: "user_token",
    LEGACY_SYNC_API_KEY: "apiKey"
  });

  const SETTINGS_FIELDS = Object.freeze([
    {
      id: "webuiBaseUrl",
      label: "OpenWebUI Base URL",
      type: "url",
      placeholder: DEFAULT_WEBUI_BASE_URL,
      required: false,
      defaultValue: DEFAULT_WEBUI_BASE_URL,
      helpText: "비워두면 기본 주소를 사용합니다."
    },
    {
      id: "sharedApiKey",
      label: "공통 API Key / Token",
      type: "password",
      placeholder: "예: sk-...",
      required: true,
      defaultValue: "",
      helpText: "K-LARC / K-Query / K-SCAN에 동일하게 적용됩니다."
    }
  ]);

  const MODULES = Object.freeze([
    {
      id: "k-larc",
      title: "K-LARC",
      description: "청구항-인용발명 비교 분석 대시보드",
      launchType: "tab",
      path: "modules/k-larc/dashboard.html",
      requiredSettingIds: ["sharedApiKey"]
    },
    {
      id: "k-query",
      title: "K-Query",
      description: "검색식 생성 사이드바",
      launchType: "sidepanel",
      path: "modules/k-query/src/sidebar/sidepanel.html",
      requiredSettingIds: ["sharedApiKey"]
    },
    {
      id: "k-scan",
      title: "K-SCAN",
      description: "유사도 분석 사이드바",
      launchType: "sidepanel",
      path: "modules/k-scan/sidepanel.html",
      requiredSettingIds: ["sharedApiKey"]
    }
  ]);

  function buildModuleLaunchers(modules) {
    const source = Array.isArray(modules) ? modules : [];
    return Object.freeze(
      Object.fromEntries(
        source
          .filter((module) => module?.id && module?.path && module?.launchType)
          .map((module) => [
            module.id,
            {
              type: module.launchType,
              path: module.path
            }
          ])
      )
    );
  }

  if (!globalScope.KSUITE_MESSAGE_TYPES) {
    globalScope.KSUITE_MESSAGE_TYPES = MESSAGE_TYPES;
  }

  if (!globalScope.KSUITE_STORAGE_KEYS) {
    globalScope.KSUITE_STORAGE_KEYS = STORAGE_KEYS;
  }

  if (!globalScope.KSUITE_DEFAULT_WEBUI_BASE_URL) {
    globalScope.KSUITE_DEFAULT_WEBUI_BASE_URL = DEFAULT_WEBUI_BASE_URL;
  }

  if (!globalScope.KSUITE_DEFAULT_LLM_MODEL) {
    globalScope.KSUITE_DEFAULT_LLM_MODEL = DEFAULT_LLM_MODEL;
  }

  if (!globalScope.KSUITE_FALLBACK_SIDEPANEL_HOST_URL) {
    globalScope.KSUITE_FALLBACK_SIDEPANEL_HOST_URL = FALLBACK_SIDEPANEL_HOST_URL;
  }

  if (!globalScope.KSUITE_SETTINGS_FIELDS) {
    globalScope.KSUITE_SETTINGS_FIELDS = SETTINGS_FIELDS;
  }

  if (!globalScope.KSUITE_MODULES) {
    globalScope.KSUITE_MODULES = MODULES;
  }

  if (!globalScope.KSUITE_BUILD_MODULE_LAUNCHERS) {
    globalScope.KSUITE_BUILD_MODULE_LAUNCHERS = buildModuleLaunchers;
  }
})(typeof globalThis !== "undefined" ? globalThis : self);
