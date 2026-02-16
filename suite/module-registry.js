const DEFAULT_WEBUI_BASE_URL_FALLBACK = "http://10.133.111.32:8080";

const SETTINGS_FIELDS_FALLBACK = Object.freeze([
  {
    id: "webuiBaseUrl",
    label: "OpenWebUI Base URL",
    type: "url",
    placeholder: DEFAULT_WEBUI_BASE_URL_FALLBACK,
    required: false,
    defaultValue: DEFAULT_WEBUI_BASE_URL_FALLBACK,
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

const MODULES_FALLBACK = Object.freeze([
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

export const DEFAULT_WEBUI_BASE_URL =
  globalThis.KSUITE_DEFAULT_WEBUI_BASE_URL || DEFAULT_WEBUI_BASE_URL_FALLBACK;

export const SETTINGS_FIELDS =
  globalThis.KSUITE_SETTINGS_FIELDS || SETTINGS_FIELDS_FALLBACK;

export const MODULES =
  globalThis.KSUITE_MODULES || MODULES_FALLBACK;

export const FIELD_BY_ID = Object.freeze(
  Object.fromEntries(SETTINGS_FIELDS.map((field) => [field.id, field]))
);

export const REQUIRED_FIELD_IDS = Object.freeze(
  SETTINGS_FIELDS.filter((field) => field.required).map((field) => field.id)
);

export function normalizeFieldValue(field, rawValue) {
  const value = typeof rawValue === "string" ? rawValue : "";
  if (field.type === "url") {
    return value.trim().replace(/\/+$/, "");
  }
  return value.trim();
}

export function isFieldFilled(field, value) {
  if (!field || !field.required) return true;
  return String(value || "").trim().length > 0;
}

export function getMissingRequiredFieldIds(values) {
  return REQUIRED_FIELD_IDS.filter((fieldId) => {
    const field = FIELD_BY_ID[fieldId];
    return !isFieldFilled(field, values[fieldId]);
  });
}

export function getModuleMissingFieldIds(module, values) {
  const requiredIds = Array.isArray(module?.requiredSettingIds)
    ? module.requiredSettingIds
    : REQUIRED_FIELD_IDS;

  return requiredIds.filter((fieldId) => {
    const field = FIELD_BY_ID[fieldId];
    return !isFieldFilled(field, values[fieldId]);
  });
}
