import { callOpenWebUI } from "./api_clients.js";
import { FeedbackManager } from "./feedback_manager.js";
import { loadPrompt, renderPromptPair } from "./prompt_loader.js";
import { parseJsonFromText } from "./json_utils.js";
import { buildQuery } from "./query_builder.js";
import { basicValidate } from "./query_validator.js";
import {
  ANALYST_MODEL,
  JUDGE_MODEL,
  ENSEMBLE_MODELS,
  TEMPERATURES,
  DEFAULT_NEAR_DISTANCE
} from "./model_config.js";

const NOOP = () => {};
const MAX_SYNONYMS = 6;
const MODE_COMPONENT = "component";
const MODE_STRUCTURE = "structure";
const DEFAULT_EXPANSION_PROMPT = `Role: Patent keyword expansion specialist
Task: Provide synonyms, aliases, acronyms, and English terms for the input keyword as JSON only.

Rules:
- Output must be a JSON array only.
- Each item is either a string or {"term": "...", "parts": ["...", "..."], "match": "token|phrase"}.
- Remove duplicates.
- Prefer "token" (or parts) for multi-word terms. Use "phrase" only for fixed expressions that must stay as an exact phrase.
- Avoid generic standalone terms like device/system/method/module/unit/component/element (or 장치/시스템/방법/모듈/유닛/구성/요소) unless they are part of a longer technical term.

Context:
Claim:
{{claim}}

Extracted Elements (JSON):
{{elements_json}}

Mode:
{{mode}}

Keyword:
{{keyword}}

{{feedback_instruction}}`;

const GENERIC_STOP_TERMS = new Set([
  "device",
  "apparatus",
  "system",
  "method",
  "unit",
  "module",
  "part",
  "component",
  "element",
  "structure",
  "mechanism",
  "equipment",
  "machine",
  "process",
  "장치",
  "시스템",
  "방법",
  "유닛",
  "모듈",
  "부",
  "부재",
  "부품",
  "구성",
  "구성요소",
  "요소",
  "기구",
  "장비",
  "설비",
  "기계",
  "프로세스",
  "정보",
  "결과",
  "information",
  "result"
]);

const TRAILING_BLOCK_SUFFIXES = [
  "관리부",
  "입력부",
  "출력부",
  "제어부",
  "검출부",
  "감지부",
  "측정부",
  "진단부",
  "판정부",
  "연산부",
  "처리부",
  "저장부",
  "통신부",
  "표시부",
  "구동부",
  "생성부",
  "수집부",
  "분석부",
  "변환부",
  "보정부",
  "결정부",
  "센싱부",
  "센서부",
  "전원부",
  "충전부",
  "방전부"
];

const TRAILING_GENERIC_SUFFIXES = [
  "부",
  "유닛",
  "모듈",
  "장치",
  "시스템",
  "부재",
  "부품",
  "기구",
  "장비",
  "정보",
  "결과"
];

const TRAILING_SUFFIXES = [...TRAILING_BLOCK_SUFFIXES, ...TRAILING_GENERIC_SUFFIXES].sort(
  (a, b) => b.length - a.length
);

const TRAILING_PARTS = new Set([
  "부",
  "유닛",
  "모듈",
  "장치",
  "시스템",
  "부재",
  "부품",
  "기구",
  "장비",
  "정보",
  "결과"
]);

function normalizeMatch(raw) {
  if (!raw) return null;
  const value = String(raw).trim().toLowerCase();
  if (!value) return null;
  if (value === "phrase" || value === "exact" || value === "quoted") return "phrase";
  if (value === "token" || value === "near" || value === "and") return "token";
  return null;
}

function normalizeTermKey(term) {
  return String(term || "")
    .toLowerCase()
    .replace(/[\s\-_]+/g, "");
}

function stripLeadingQualifiers(term) {
  let value = String(term || "").trim();
  if (!value) return "";
  value = value.replace(/^(?:상기|해당)\s*/g, "");
  value = value.replace(/^제\s*(?:\d+|[일이삼사오육칠팔구십]+)\s*/g, "");
  value = value.replace(/\s+/g, " ").trim();
  return value;
}

function stripTrailingSuffix(term) {
  let value = String(term || "").trim();
  if (!value) return "";
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of TRAILING_SUFFIXES) {
      if (value === suffix) {
        if (suffix.endsWith("부") && suffix.length > 1) {
          value = suffix.slice(0, -1).trim();
          changed = true;
          break;
        }
        return "";
      }
      if (value.endsWith(suffix) && value.length > suffix.length) {
        value = value.slice(0, -suffix.length).trim();
        changed = true;
        break;
      }
    }
  }
  return value.trim();
}

function trimParts(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return undefined;
  let trimmed = parts.slice();
  let changed = true;
  while (trimmed.length > 0 && changed) {
    changed = false;
    if (trimmed.length >= 2) {
      const combo = `${trimmed[trimmed.length - 2]}${trimmed[trimmed.length - 1]}`;
      if (TRAILING_BLOCK_SUFFIXES.includes(combo)) {
        trimmed = trimmed.slice(0, -2);
        changed = true;
        continue;
      }
    }
    const last = trimmed[trimmed.length - 1];
    if (TRAILING_PARTS.has(last)) {
      trimmed = trimmed.slice(0, -1);
      changed = true;
    }
  }
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeElements(raw) {
  const rawList = Array.isArray(raw?.elements)
    ? raw.elements
    : Array.isArray(raw?.keywords)
      ? raw.keywords
      : Array.isArray(raw)
        ? raw
        : [];

  const elements = [];
  const usedIds = new Set();

  const seenKeys = new Set();

  rawList.forEach((item, index) => {
    const termRaw = typeof item === "string" ? item : item?.term || item?.keyword || item?.text;
    const cleanedTerm = stripTrailingSuffix(stripLeadingQualifiers(termRaw));
    if (!cleanedTerm || typeof cleanedTerm !== "string") return;

    let id = typeof item === "object" && item?.id ? String(item.id).trim() : String.fromCharCode(65 + index);
    if (!id) id = String.fromCharCode(65 + index);
    if (usedIds.has(id)) id = `${id}${index}`;
    usedIds.add(id);

    const typeRaw = typeof item === "object" ? item?.type : null;
    const parts = Array.isArray(item?.parts)
      ? item.parts
        .filter((part) => typeof part === "string" && part.trim())
        .map((part) => stripLeadingQualifiers(part))
        .filter(Boolean)
      : undefined;
    const trimmedParts = trimParts(parts);
    const type = trimmedParts && trimmedParts.length > 0 ? "compound" : typeRaw === "compound" ? "compound" : "single";

    const key = normalizeTermKey(cleanedTerm);
    if (seenKeys.has(key)) {
      const existing = elements.find((element) => normalizeTermKey(element.term) === key);
      if (existing && (!existing.parts || existing.parts.length === 0) && Array.isArray(trimmedParts) && trimmedParts.length > 0) {
        existing.parts = trimmedParts;
        existing.type = "compound";
      }
      return;
    }
    seenKeys.add(key);

    if (GENERIC_STOP_TERMS.has(key)) return;

    elements.push({ id, term: cleanedTerm.trim(), type, parts: trimmedParts });
  });

  return elements;
}

function normalizeRelations(raw, elements) {
  const rawList = Array.isArray(raw?.relations)
    ? raw.relations
    : Array.isArray(raw)
      ? raw
      : [];

  const termToId = new Map(elements.map((element) => [element.term, element.id]));
  const elementIds = new Set(elements.map((element) => element.id));

  return rawList
    .map((rel) => {
      if (!rel || typeof rel !== "object") return null;

      let source = rel.source ?? rel.from;
      let target = rel.target ?? rel.to;
      if (!source && Array.isArray(rel.pair)) {
        source = rel.pair[0];
        target = rel.pair[1];
      }

      if (termToId.has(source)) source = termToId.get(source);
      if (termToId.has(target)) target = termToId.get(target);

      const distanceRaw = rel.distance ?? rel.logic ?? rel.relation ?? rel.type;
      let distance = "co-exist";
      if (typeof distanceRaw === "string") {
        const lowered = distanceRaw.toLowerCase();
        if (lowered.includes("near") || lowered.includes("close")) distance = "close";
        if (lowered.includes("co")) distance = "co-exist";
      }

      let near = rel.near ?? rel.distanceValue ?? rel.window;
      const nearNumber = Number.parseInt(near, 10);
      if (Number.isFinite(nearNumber)) near = nearNumber;
      if (!Number.isFinite(nearNumber) && Number.isFinite(Number.parseInt(distanceRaw, 10))) {
        distance = "close";
        near = Number.parseInt(distanceRaw, 10);
      }

      if (!elementIds.has(source) || !elementIds.has(target)) return null;

      return { source, target, distance, near };
    })
    .filter(Boolean);
}

function normalizeSynonymItems(rawList) {
  if (!Array.isArray(rawList)) return [];
  const items = [];

  for (const entry of rawList) {
    if (typeof entry === "string") {
      const term = entry.trim();
      if (term) items.push({ term });
      continue;
    }

    if (entry && typeof entry.term === "string") {
      const term = entry.term.trim();
      if (!term) continue;
      const parts = Array.isArray(entry.parts) ? entry.parts.filter((part) => typeof part === "string" && part.trim()) : undefined;
      const match = normalizeMatch(entry.match ?? entry.match_type ?? entry.matchType ?? (entry.phrase === true ? "phrase" : null));
      items.push({ term, parts, match });
    }
  }

  return items;
}

function ensureBaseTerm(items, element) {
  const seen = new Set(items.map((item) => item.term.toLowerCase()));
  const baseTerm = element.term;
  if (!seen.has(baseTerm.toLowerCase())) {
    items.push({ term: baseTerm, parts: element.parts });
  }
  return items;
}

function filterGenericSynonyms(items, element) {
  const baseKey = normalizeTermKey(element?.term);
  return items.filter((item) => {
    if (!item?.term) return false;
    const key = normalizeTermKey(item.term);
    if (key === baseKey) return true;
    return !GENERIC_STOP_TERMS.has(key);
  });
}

function limitSynonymList(items, element, maxCount) {
  const normalized = normalizeSynonymItems(items);
  const baseTerm = element.term;
  const baseLower = baseTerm.toLowerCase();
  let list = normalized;
  let baseIndex = list.findIndex((item) => item.term.toLowerCase() === baseLower);
  if (baseIndex === -1) {
    list = [...list, { term: baseTerm, parts: element.parts }];
    baseIndex = list.length - 1;
  }
  if (list.length <= maxCount) return list;
  const limited = list.slice(0, maxCount);
  if (baseIndex >= maxCount) {
    limited[maxCount - 1] = list[baseIndex];
  }
  return limited;
}

function mergeSynonymLists(lists, element) {
  const merged = [];
  for (const list of lists) {
    merged.push(...normalizeSynonymItems(list));
  }
  return ensureBaseTerm(merged, element);
}

function parseSynonymList(text) {
  try {
    const parsed = parseJsonFromText(text, "Synonym list");
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.synonyms)) return parsed.synonyms;
    if (Array.isArray(parsed?.terms)) return parsed.terms;
    if (Array.isArray(parsed?.best_synonyms)) return parsed.best_synonyms;
  } catch {
    // Ignore parse errors and fall back to empty list.
  }
  return [];
}

async function applyContextFilter({
  element,
  synonyms,
  claim,
  elementsJson,
  mode,
  reportDev
}) {
  const promptPair = await renderPromptPair("layer2ContextFilter", {
    keyword: element.term,
    claim,
    elements_json: elementsJson,
    mode,
    synonyms_json: synonyms
  });

  reportDev({
    layer: "Layer 2-C",
    stage: "request",
    label: `Context Filter: ${element.term}`,
    model: JUDGE_MODEL,
    content: {
      system: promptPair.system,
      user: promptPair.user
    }
  });

  try {
    const response = await callOpenWebUI(
      promptPair.messages,
      JUDGE_MODEL,
      TEMPERATURES.evaluation
    );

    reportDev({
      layer: "Layer 2-C",
      stage: "response",
      label: `Context Filter: ${element.term}`,
      model: JUDGE_MODEL,
      content: response
    });

    const parsed = parseJsonFromText(response, "Layer 2 context filter");
    const keptRaw = Array.isArray(parsed?.kept)
      ? parsed.kept
      : Array.isArray(parsed?.best_synonyms)
        ? parsed.best_synonyms
        : Array.isArray(parsed)
          ? parsed
          : null;

    if (!Array.isArray(keptRaw)) return synonyms;
    const kept = normalizeSynonymItems(keptRaw);
    return kept.length > 0 ? kept : synonyms;
  } catch (error) {
    const message = error?.message || String(error);
    reportDev({
      layer: "Layer 2-C",
      stage: "error",
      label: `Context Filter: ${element.term}`,
      model: JUDGE_MODEL,
      content: message
    });
    return synonyms;
  }
}

function normalizeMode(rawMode) {
  if (!rawMode) return MODE_COMPONENT;
  const value = String(rawMode).trim().toLowerCase();
  if (!value) return MODE_COMPONENT;
  if (
    value.includes("structure")
    || value.includes("relation")
    || value.includes("relational")
    || value.includes("near")
    || value.includes("결합")
    || value.includes("구조")
    || value.includes("관계")
    || value.includes("mode2")
    || value.includes("모드2")
  ) {
    return MODE_STRUCTURE;
  }
  if (
    value.includes("component")
    || value.includes("element")
    || value.includes("part")
    || value.includes("구성")
    || value.includes("요소")
    || value.includes("mode1")
    || value.includes("모드1")
  ) {
    return MODE_COMPONENT;
  }
  return MODE_COMPONENT;
}

function normalizeStartLayer(rawLayer) {
  if (!rawLayer) return "Layer 1";
  if (typeof rawLayer === "number") {
    if (rawLayer <= 1) return "Layer 1";
    if (rawLayer === 2) return "Layer 2";
    return "Layer 3";
  }
  const value = String(rawLayer).trim().toLowerCase();
  if (value.includes("3")) return "Layer 3";
  if (value.includes("2")) return "Layer 2";
  return "Layer 1";
}

function buildModelRoster() {
  return ENSEMBLE_MODELS.map((name, index) => {
    const letter = String.fromCharCode(97 + index);
    return { id: `model_${letter}`, name };
  });
}

const MOCK_SCENARIO_FIXTURES = [
  {
    id: "display_bending_device",
    title: "Flexible Display Bending Device",
    mode: MODE_STRUCTURE,
    hints: ["display", "flexible", "bend", "bending", "sensor", "디스플레이", "플렉서블", "벤딩"],
    elements: [
      { id: "A", term: "flexible display panel", type: "compound", parts: ["display", "panel"] },
      { id: "B", term: "bending sensing strip", type: "compound", parts: ["bending", "strip"] },
      { id: "C", term: "strain signal converter", type: "compound", parts: ["strain", "converter"] },
      { id: "D", term: "deformation compensation logic", type: "compound", parts: ["deformation", "logic"] },
      { id: "E", term: "touch response stabilizer", type: "compound", parts: ["touch", "stabilizer"] }
    ],
    relations: [
      { source: "A", target: "B", distance: "close", near: 3 },
      { source: "B", target: "C", distance: "close", near: 4 },
      { source: "C", target: "D", distance: "close", near: 4 },
      { source: "D", target: "E", distance: "co-exist" }
    ],
    synonymsById: {
      A: ["bendable display panel", "flex display substrate", { term: "flexible screen panel", match: "token" }],
      B: ["bending detector strip", "curvature sensing line", { term: "bend sensing strip", match: "token" }],
      C: ["strain conversion circuit", "deformation signal converter", { term: "strain converter", match: "token" }],
      D: ["deformation correction logic", "shape compensation controller", { term: "compensation logic", match: "token" }],
      E: ["touch stability controller", "response stabilizing module", { term: "touch stabilizer", match: "token" }]
    }
  },
  {
    id: "ev_thermal_pack",
    title: "EV Battery Thermal Pack",
    mode: MODE_STRUCTURE,
    hints: ["battery", "thermal", "coolant", "cell", "pack", "전지", "배터리", "냉각"],
    elements: [
      { id: "A", term: "battery cell cluster", type: "compound", parts: ["battery", "cell"] },
      { id: "B", term: "coolant circulation channel", type: "compound", parts: ["coolant", "channel"] },
      { id: "C", term: "thermal control valve", type: "compound", parts: ["thermal", "valve"] },
      { id: "D", term: "temperature sensing node", type: "compound", parts: ["temperature", "node"] },
      { id: "E", term: "fault mitigation controller", type: "compound", parts: ["fault", "controller"] }
    ],
    relations: [
      { source: "A", target: "B", distance: "close", near: 3 },
      { source: "B", target: "C", distance: "close", near: 4 },
      { source: "C", target: "D", distance: "close", near: 4 },
      { source: "D", target: "E", distance: "co-exist" }
    ],
    synonymsById: {
      A: ["battery module cluster", "cell array", { term: "battery-cell set", match: "phrase" }],
      B: ["cooling flow channel", "refrigerant passage", { term: "coolant loop", match: "token" }],
      C: ["heat control valve", "thermal regulation valve", { term: "temperature valve", match: "token" }],
      D: ["thermal sensing point", "temperature monitor node", { term: "sensor node", match: "token" }],
      E: ["protection control logic", "fault response controller", { term: "mitigation unit", match: "token" }]
    }
  },
  {
    id: "vision_inspection_line",
    title: "Inline Vision Inspection",
    mode: MODE_COMPONENT,
    hints: ["vision", "camera", "inspection", "defect", "wafer", "이미지", "검사", "불량"],
    elements: [
      { id: "A", term: "line scan camera", type: "compound", parts: ["line", "camera"] },
      { id: "B", term: "illumination adjustment stage", type: "compound", parts: ["illumination", "stage"] },
      { id: "C", term: "defect feature extractor", type: "compound", parts: ["defect", "extractor"] },
      { id: "D", term: "classification inference engine", type: "compound", parts: ["classification", "engine"] },
      { id: "E", term: "reject gate actuator", type: "compound", parts: ["reject", "actuator"] }
    ],
    relations: [
      { source: "A", target: "B", distance: "co-exist" },
      { source: "A", target: "C", distance: "close", near: 5 },
      { source: "C", target: "D", distance: "close", near: 5 },
      { source: "D", target: "E", distance: "close", near: 6 }
    ],
    synonymsById: {
      A: ["inspection camera", "line imaging sensor", { term: "scan camera", match: "token" }],
      B: ["lighting control stage", "illumination tuner", { term: "light adjustment", match: "token" }],
      C: ["defect pattern extractor", "anomaly feature parser", { term: "feature extractor", match: "token" }],
      D: ["classification model runner", "inference classifier", { term: "decision engine", match: "token" }],
      E: ["reject diverter", "sorting gate actuator", { term: "eject gate", match: "token" }]
    }
  },
  {
    id: "robot_path_control",
    title: "Factory Robot Path Control",
    mode: MODE_STRUCTURE,
    hints: ["robot", "path", "trajectory", "factory", "arm", "로봇", "경로", "궤적"],
    elements: [
      { id: "A", term: "joint position sensor", type: "compound", parts: ["joint", "sensor"] },
      { id: "B", term: "trajectory planning unit", type: "compound", parts: ["trajectory", "planning"] },
      { id: "C", term: "collision prediction model", type: "compound", parts: ["collision", "model"] },
      { id: "D", term: "motion command scheduler", type: "compound", parts: ["motion", "scheduler"] },
      { id: "E", term: "servo feedback controller", type: "compound", parts: ["servo", "controller"] }
    ],
    relations: [
      { source: "A", target: "B", distance: "close", near: 3 },
      { source: "B", target: "C", distance: "close", near: 4 },
      { source: "C", target: "D", distance: "close", near: 4 },
      { source: "D", target: "E", distance: "close", near: 5 }
    ],
    synonymsById: {
      A: ["joint angle sensor", "axis position detector", { term: "position sensing", match: "token" }],
      B: ["path planning unit", "trajectory generator", { term: "motion planner", match: "token" }],
      C: ["collision estimator", "interference prediction model", { term: "collision predictor", match: "token" }],
      D: ["command dispatch scheduler", "motion task sequencer", { term: "motion scheduler", match: "token" }],
      E: ["servo control loop", "feedback drive controller", { term: "servo regulator", match: "token" }]
    }
  },
  {
    id: "medical_signal_triage",
    title: "Medical Signal Triage",
    mode: MODE_COMPONENT,
    hints: ["patient", "signal", "ecg", "triage", "diagnosis", "의료", "환자", "진단"],
    elements: [
      { id: "A", term: "biosignal acquisition channel", type: "compound", parts: ["biosignal", "channel"] },
      { id: "B", term: "artifact suppression filter", type: "compound", parts: ["artifact", "filter"] },
      { id: "C", term: "event detection network", type: "compound", parts: ["event", "network"] },
      { id: "D", term: "risk scoring module", type: "compound", parts: ["risk", "scoring"] },
      { id: "E", term: "clinical alert dispatcher", type: "compound", parts: ["clinical", "dispatcher"] }
    ],
    relations: [
      { source: "A", target: "B", distance: "close", near: 4 },
      { source: "B", target: "C", distance: "close", near: 5 },
      { source: "C", target: "D", distance: "co-exist" },
      { source: "D", target: "E", distance: "close", near: 5 }
    ],
    synonymsById: {
      A: ["vital signal input", "biosignal stream channel", { term: "signal acquisition", match: "token" }],
      B: ["noise suppression filter", "artifact removal filter", { term: "signal denoiser", match: "token" }],
      C: ["event recognition network", "abnormality detection model", { term: "event detector", match: "token" }],
      D: ["risk assessment scorer", "severity scoring logic", { term: "risk score module", match: "token" }],
      E: ["alert notification dispatcher", "clinical alarm sender", { term: "alert router", match: "token" }]
    }
  }
];

const MOCK_ELEMENT_FALLBACKS = [
  "signal input module",
  "feature extraction unit",
  "decision logic block",
  "control output module",
  "feedback update unit"
];

function findMockScenarioFromClaim(claim) {
  const text = String(claim || "").trim().toLowerCase();
  if (!text) return MOCK_SCENARIO_FIXTURES[0];
  let bestScenario = null;
  let bestScore = 0;

  for (const scenario of MOCK_SCENARIO_FIXTURES) {
    const hints = Array.isArray(scenario.hints) ? scenario.hints : [];
    let score = 0;
    for (const hint of hints) {
      if (hint && text.includes(String(hint).toLowerCase())) score += 1;
    }
    if (score > bestScore) {
      bestScenario = scenario;
      bestScore = score;
    }
  }

  return bestScenario || MOCK_SCENARIO_FIXTURES[0];
}

function inferMockModeFromClaim(claim) {
  const text = String(claim || "").toLowerCase();
  const structureHints = [
    "relation",
    "relational",
    "link",
    "linked",
    "connect",
    "connected",
    "flow",
    "sequence",
    "between",
    "near",
    "\uC5F0\uACB0",
    "\uAD6C\uC870",
    "\uAD00\uACC4",
    "\uBC30\uCE58",
    "\uC778\uC811"
  ];
  if (structureHints.some((hint) => text.includes(hint))) return MODE_STRUCTURE;
  return MODE_COMPONENT;
}

function buildMockElementsFromClaim(claim) {
  const text = String(claim || "").trim();
  const chunks = text
    .split(/[.;\n]/g)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length >= 4);

  const candidates = [];
  chunks.forEach((chunk) => {
    const normalized = chunk
      .replace(/[(){}[\]"]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!normalized) return;
    const words = normalized.split(" ").filter(Boolean);
    const phrase = words.slice(0, 4).join(" ").trim();
    if (!phrase) return;
    if (!candidates.includes(phrase)) candidates.push(phrase);
  });

  let fallbackIndex = 0;
  while (candidates.length < 5) {
    const fallback = MOCK_ELEMENT_FALLBACKS[fallbackIndex % MOCK_ELEMENT_FALLBACKS.length];
    if (!candidates.includes(fallback)) candidates.push(fallback);
    fallbackIndex += 1;
  }

  const raw = candidates.slice(0, 5).map((term, index) => {
    const parts = term.split(/\s+/).filter(Boolean);
    return {
      id: String.fromCharCode(65 + index),
      term,
      type: parts.length >= 2 ? "compound" : "single",
      parts: parts.length >= 2 ? parts.slice(0, 2) : undefined
    };
  });

  return normalizeElements({ elements: raw });
}

function buildMockElementsFromScenario(scenario) {
  if (!scenario || !Array.isArray(scenario.elements)) return [];
  return normalizeElements({ elements: scenario.elements });
}

function buildMockRelations(elements, mode) {
  const distanceNear = mode === MODE_STRUCTURE ? 4 : 6;
  const rawRelations = [];

  for (let i = 0; i < elements.length - 1; i += 1) {
    rawRelations.push({
      source: elements[i].id,
      target: elements[i + 1].id,
      distance: "close",
      near: distanceNear
    });
  }

  if (elements.length >= 3) {
    rawRelations.push({
      source: elements[0].id,
      target: elements[2].id,
      distance: "co-exist"
    });
  }

  return normalizeRelations({ relations: rawRelations }, elements);
}

function buildMockRelationsFromScenario(elements, scenario) {
  if (!scenario || !Array.isArray(scenario.relations)) {
    return buildMockRelations(elements, scenario?.mode || MODE_COMPONENT);
  }
  return normalizeRelations({ relations: scenario.relations }, elements);
}

function buildMockSynonymItems(element, mode) {
  const term = String(element?.term || "").trim();
  if (!term) return [];

  const baseParts = Array.isArray(element?.parts) ? element.parts.filter(Boolean) : [];
  const compactTerm = term.replace(/\s+/g, " ").trim();
  const tokenParts = compactTerm.split(/\s+/).filter(Boolean);
  const tokenPrefix = tokenParts.slice(0, 2).join(" ");
  const modeSuffix = mode === MODE_STRUCTURE ? "linkage" : "operation";

  const rawItems = [
    { term: compactTerm },
    { term: `${compactTerm} module`, match: "token" },
    { term: `${compactTerm} unit`, match: "token" },
    { term: `${compactTerm} ${modeSuffix}`, match: "phrase" }
  ];

  if (baseParts.length > 0) {
    rawItems.push({
      term: compactTerm,
      parts: baseParts,
      match: "token"
    });
  }

  if (tokenPrefix && tokenPrefix !== compactTerm) {
    rawItems.push({ term: tokenPrefix, match: "token" });
  }

  const normalized = normalizeSynonymItems(rawItems);
  const deduped = [];
  const seen = new Set();
  normalized.forEach((item) => {
    const key = normalizeTermKey(item.term);
    if (!key || seen.has(key)) return;
    seen.add(key);
    deduped.push(item);
  });
  return deduped;
}

function normalizeScenarioSynonyms(elements, providedSynonyms) {
  if (!providedSynonyms || typeof providedSynonyms !== "object") return {};
  const byId = new Map(elements.map((element) => [element.id, element]));
  const byKey = new Map(elements.map((element) => [normalizeTermKey(element.term), element]));
  const normalized = {};

  Object.entries(providedSynonyms).forEach(([key, value]) => {
    const idKey = String(key || "").trim();
    let target = byId.get(idKey);
    if (!target) target = byKey.get(normalizeTermKey(idKey));
    if (!target) return;
    normalized[target.id] = normalizeSynonymItems(value);
  });

  return normalized;
}

function buildMockSynonymsById(elements, mode, providedSynonyms = null) {
  const normalizedProvided = normalizeScenarioSynonyms(elements, providedSynonyms);
  const synonymsById = {};
  elements.forEach((element) => {
    const providedItems = normalizedProvided[element.id] || [];
    const generatedItems = buildMockSynonymItems(element, mode);
    const rawItems = providedItems.length > 0
      ? [...providedItems, ...generatedItems]
      : generatedItems;
    const filtered = filterGenericSynonyms(rawItems, element);
    const withBase = ensureBaseTerm(filtered, element);
    synonymsById[element.id] = limitSynonymList(withBase, element, MAX_SYNONYMS);
  });
  return synonymsById;
}

function normalizeProvidedSynonyms(elements, providedSynonyms) {
  const synonymsById = {};
  elements.forEach((element) => {
    const rawList = providedSynonyms?.[element.id] || providedSynonyms?.[element.term] || [];
    const normalized = normalizeSynonymItems(rawList);
    synonymsById[element.id] = ensureBaseTerm(normalized, element);
  });
  return synonymsById;
}

async function runMockPipeline({
  claim,
  options,
  safeReport,
  reportProgress,
  reportDev
}) {
  const scenario = findMockScenarioFromClaim(claim);
  reportProgress("Mock mode: local pipeline enabled.");
  reportDev({
    layer: "Mock",
    stage: "decision",
    label: "Mock Mode",
    model: "mock-local",
    content: { enabled: true, startLayer: options?.startLayer || "Layer 1" }
  });
  reportDev({
    layer: "Mock",
    stage: "decision",
    label: "Mock Dataset",
    model: "mock-local",
    content: { id: scenario.id, title: scenario.title }
  });
  reportProgress(`Mock dataset: ${scenario.title}`);

  const startLayer = normalizeStartLayer(options?.startLayer);
  let elements = [];
  let relations = [];
  let mode = null;

  if (startLayer === "Layer 1") {
    reportProgress("Layer 1: extracting elements...");
    mode = scenario.mode || inferMockModeFromClaim(claim);
    elements = buildMockElementsFromScenario(scenario);
    if (elements.length === 0) {
      elements = buildMockElementsFromClaim(claim);
    }
    if (elements.length === 0) {
      throw new Error("No elements were extracted from the claim.");
    }
    reportDev({
      layer: "Layer 1",
      stage: "response",
      label: "Keyword Extraction",
      model: "mock-local",
      content: { mode, elements }
    });

    reportProgress(`Mode: ${mode === MODE_STRUCTURE ? "structure" : "component"} priority`);
    reportDev({
      layer: "Layer 1",
      stage: "decision",
      label: "Pipeline Mode",
      model: "mock-local",
      content: { mode, raw: mode }
    });
    reportProgress("Layer 1: mapping relations...");
    relations = buildMockRelationsFromScenario(elements, scenario);
    reportDev({
      layer: "Layer 1",
      stage: "response",
      label: "Relation Mapping",
      model: "mock-local",
      content: { relations }
    });
  } else {
    elements = normalizeElements(options?.elements);
    if (elements.length === 0) {
      throw new Error("Elements are required for rerun starting at Layer 2/3.");
    }
    relations = normalizeRelations(options?.relations, elements);
    mode = normalizeMode(options?.mode);
    reportProgress("Layer 1: using cached elements & relations");
    reportProgress(`Mode: ${mode === MODE_STRUCTURE ? "structure" : "component"} priority`);
    reportDev({
      layer: "Layer 1",
      stage: "decision",
      label: "Pipeline Mode",
      model: "mock-local",
      content: { mode, raw: mode }
    });
    reportDev({
      layer: "Layer 1",
      stage: "reuse",
      label: "Cached Elements",
      model: "mock-local",
      content: elements
    });
    reportDev({
      layer: "Layer 1",
      stage: "reuse",
      label: "Cached Relations",
      model: "mock-local",
      content: relations
    });
  }

  let synonymsById = {};
  if (startLayer === "Layer 3") {
    reportProgress("Layer 2: using cached synonyms...");
    if (!options?.synonymsById || typeof options.synonymsById !== "object") {
      throw new Error("Synonyms are required for rerun starting at Layer 3.");
    }
    synonymsById = normalizeProvidedSynonyms(elements, options.synonymsById);
    reportDev({
      layer: "Layer 2",
      stage: "reuse",
      label: "Cached Synonyms",
      model: "mock-local",
      content: synonymsById
    });
  } else {
    reportProgress("Layer 2: expanding synonyms...");
    synonymsById = buildMockSynonymsById(elements, mode, scenario.synonymsById);
    elements.forEach((element) => {
      reportDev({
        layer: "Layer 2-A",
        stage: "response",
        label: `Expansion: ${element.term}`,
        model: "mock-local",
        content: synonymsById[element.id] || []
      });
    });
  }

  safeReport({
    type: "artifact",
    payload: {
      elements,
      relations,
      synonymsById,
      mode
    }
  });

  reportProgress("Layer 3: assembling query...");
  const draftQuery = buildQuery({
    elements,
    relations,
    synonymsById,
    nearDistance: DEFAULT_NEAR_DISTANCE
  });

  reportDev({
    layer: "Layer 3",
    stage: "assembly",
    label: "Fallback Draft",
    model: "mock-local",
    content: draftQuery
  });

  const validation = basicValidate(draftQuery);
  if (!validation.ok) {
    throw new Error(`Query validation failed: ${validation.errors.join(", ")}`);
  }
  return draftQuery;
}

async function requestExpansion(
  element,
  model,
  claim,
  elementsJson,
  mode,
  reportDev
) {
  const feedback = await FeedbackManager.getFeedback(model.name);
  const feedbackInstruction = feedback ? `Feedback: ${feedback}` : "No prior feedback.";
  const promptPair = await renderPromptPair("layer2Expansion", {
    keyword: element.term,
    feedback_instruction: feedbackInstruction,
    claim,
    elements_json: elementsJson,
    mode,
    model_payload: []
  });

  reportDev({
    layer: "Layer 2-A",
    stage: "request",
    label: `Expansion: ${element.term}`,
    model: model.name,
    content: {
      system: promptPair.system,
      user: promptPair.user
    }
  });

  try {
    const response = await callOpenWebUI(
      promptPair.messages,
      model.name,
      TEMPERATURES.expansion
    );

    if (typeof response !== "string" || !response.trim()) {
      reportDev({
        layer: "Layer 2-A",
        stage: "error",
        label: `Expansion: ${element.term}`,
        model: model.name,
        content: "Empty response from model."
      });
      return null;
    }

    reportDev({
      layer: "Layer 2-A",
      stage: "response",
      label: `Expansion: ${element.term}`,
      model: model.name,
      content: response
    });

    return { model, response };
  } catch (error) {
    const message = error?.message || String(error);
    reportDev({
      layer: "Layer 2-A",
      stage: "error",
      label: `Expansion: ${element.term}`,
      model: model.name,
      content: message
    });
    return null;
  }
}

async function expandElement({
  element,
  modelRoster,
  hasContextFilterPrompt,
  claim,
  elementsJson,
  mode,
  reportProgress,
  reportDev
}) {
  reportProgress(`Layer 2: '${element.term}' expansion...`);

  const expansionResults = (await Promise.all(
    modelRoster.map((model) =>
      requestExpansion(
        element,
        model,
        claim,
        elementsJson,
        mode,
        reportDev
      )
    )
  )).filter(Boolean);

  if (expansionResults.length === 0) {
    reportDev({
      layer: "Layer 2-A",
      stage: "error",
      label: `Expansion: ${element.term}`,
      content: "No model responses received."
    });
    return { elementId: element.id, synonyms: ensureBaseTerm([], element) };
  }

  const modelPayload = [];
  const parsedById = {};

  for (const result of expansionResults) {
    const parsed = parseSynonymList(result.response);
    parsedById[result.model.id] = parsed;
    modelPayload.push({
      id: result.model.id,
      name: result.model.name,
      synonyms: parsed,
      raw: result.response
    });
  }

  let bestSynonyms = mergeSynonymLists(Object.values(parsedById), element);
  let scores = {};
  let feedbackMap = {};
  const responsiveModels = expansionResults.map((result) => result.model);

  if (responsiveModels.length > 1) {
    const evalPromptPair = await renderPromptPair("layer2Evaluation", {
      keyword: element.term,
      claim,
      elements_json: elementsJson,
      mode,
      model_payload: modelPayload
    });

    try {
      reportDev({
        layer: "Layer 2-B",
        stage: "request",
        label: `Evaluation: ${element.term}`,
        model: JUDGE_MODEL,
        content: {
          system: evalPromptPair.system,
          user: evalPromptPair.user
        }
      });
      const evaluationResponse = await callOpenWebUI(
        evalPromptPair.messages,
        JUDGE_MODEL,
        TEMPERATURES.evaluation
      );
      reportDev({
        layer: "Layer 2-B",
        stage: "response",
        label: `Evaluation: ${element.term}`,
        model: JUDGE_MODEL,
        content: evaluationResponse
      });
      const evaluation = parseJsonFromText(evaluationResponse, "Layer 2 evaluation");
      if (Array.isArray(evaluation?.best_synonyms)) {
        bestSynonyms = ensureBaseTerm(normalizeSynonymItems(evaluation.best_synonyms), element);
      }
      scores = evaluation?.scores || evaluation?.model_scores || {};
      feedbackMap = evaluation?.feedback || evaluation?.model_feedback || {};
    } catch {
      // Keep the merged synonyms if evaluation fails.
    }
  }

  for (const model of responsiveModels) {
    const score = Number(
      scores?.[model.id]
      ?? scores?.[model.name]
      ?? scores?.[model.name?.toLowerCase?.()]
    );
    const feedback = feedbackMap?.[model.id]
      ?? feedbackMap?.[model.name]
      ?? feedbackMap?.[model.name?.toLowerCase?.()];
    if (Number.isFinite(score) && score < 70 && feedback) {
      await FeedbackManager.saveFeedback(model.name, feedback);
    }
  }

  if (hasContextFilterPrompt) {
    reportProgress(`Layer 2: context filtering '${element.term}'...`);
    bestSynonyms = await applyContextFilter({
      element,
      synonyms: bestSynonyms,
      claim,
      elementsJson,
      mode,
      reportDev
    });
  }

  bestSynonyms = ensureBaseTerm(filterGenericSynonyms(bestSynonyms, element), element);
  bestSynonyms = limitSynonymList(bestSynonyms, element, MAX_SYNONYMS);
  return { elementId: element.id, synonyms: bestSynonyms };
}

export async function runPipeline(claimText, progressCallback = NOOP, options = {}) {
  const report = typeof progressCallback === "function" ? progressCallback : NOOP;
  const safeReport = (payload) => {
    try {
      report(payload);
    } catch {
      // Ignore logging errors.
    }
  };
  const reportProgress = (message) => safeReport(message);
  const reportDev = (payload) => safeReport({ type: "dev", ...payload });
  const claim = claimText?.trim();
  if (!claim) throw new Error("Claim text is required.");
  if (options?.mockMode) {
    return runMockPipeline({
      claim,
      options,
      safeReport,
      reportProgress,
      reportDev
    });
  }

  const startLayer = normalizeStartLayer(options?.startLayer);
  let elements = [];
  let relations = [];
  let mode = null;
  let elementsJson = "";

  if (startLayer === "Layer 1") {
    reportProgress("Layer 1: extracting elements...");
    const extractionPromptPair = await renderPromptPair("layer1Extraction", { claim });
    reportDev({
      layer: "Layer 1",
      stage: "request",
      label: "Keyword Extraction",
      model: ANALYST_MODEL,
      content: {
        system: extractionPromptPair.system,
        user: extractionPromptPair.user
      }
    });
    const extractionResponse = await callOpenWebUI(
      extractionPromptPair.messages,
      ANALYST_MODEL,
      TEMPERATURES.analysis
    );
    reportDev({
      layer: "Layer 1",
      stage: "response",
      label: "Keyword Extraction",
      model: ANALYST_MODEL,
      content: extractionResponse
    });
    const extractionJson = parseJsonFromText(extractionResponse, "Layer 1 extraction");
    elements = normalizeElements(extractionJson);
    if (elements.length === 0) throw new Error("No elements were extracted from the claim.");
    mode = normalizeMode(extractionJson?.mode);
    reportDev({
      layer: "Layer 1",
      stage: "decision",
      label: "Pipeline Mode",
      content: { mode, raw: extractionJson?.mode || null }
    });
    reportProgress(`Mode: ${mode === MODE_STRUCTURE ? "구조" : "구성요소"} 우선`);

    reportProgress("Layer 1: mapping relations...");
    const relationsPromptPair = await renderPromptPair("layer1Relations", {
      claim,
      elements_json: elements
    });
    reportDev({
      layer: "Layer 1",
      stage: "request",
      label: "Relation Mapping",
      model: ANALYST_MODEL,
      content: {
        system: relationsPromptPair.system,
        user: relationsPromptPair.user
      }
    });
    const relationsResponse = await callOpenWebUI(
      relationsPromptPair.messages,
      ANALYST_MODEL,
      TEMPERATURES.analysis
    );
    reportDev({
      layer: "Layer 1",
      stage: "response",
      label: "Relation Mapping",
      model: ANALYST_MODEL,
      content: relationsResponse
    });
    const relationsJson = parseJsonFromText(relationsResponse, "Layer 1 relations");
    relations = normalizeRelations(relationsJson, elements);
    elementsJson = JSON.stringify(elements);
  } else {
    elements = normalizeElements(options?.elements);
    if (elements.length === 0) {
      throw new Error("Elements are required for rerun starting at Layer 2/3.");
    }
    relations = normalizeRelations(options?.relations, elements);
    if (!Array.isArray(relations) || relations.length === 0) {
      reportProgress("Layer 1: using cached elements (relations missing)");
    } else {
      reportProgress("Layer 1: using cached elements & relations");
    }
    mode = normalizeMode(options?.mode);
    elementsJson = JSON.stringify(elements);
    reportDev({
      layer: "Layer 1",
      stage: "reuse",
      label: "Cached Elements",
      content: elements
    });
    reportDev({
      layer: "Layer 1",
      stage: "reuse",
      label: "Cached Relations",
      content: relations
    });
    reportDev({
      layer: "Layer 1",
      stage: "decision",
      label: "Pipeline Mode",
      content: { mode, raw: options?.mode || null, source: "cache" }
    });
    reportProgress(`Mode: ${mode === MODE_STRUCTURE ? "구조" : "구성요소"} 우선`);
  }

  let synonymsById = {};
  if (startLayer === "Layer 3") {
    reportProgress("Layer 2: using cached synonyms...");
    const providedSynonyms = options?.synonymsById;
    if (!providedSynonyms || typeof providedSynonyms !== "object") {
      throw new Error("Synonyms are required for rerun starting at Layer 3.");
    }
    for (const element of elements) {
      const rawList = providedSynonyms[element.id] || providedSynonyms[element.term] || [];
      const normalized = normalizeSynonymItems(rawList);
      synonymsById[element.id] = ensureBaseTerm(normalized, element);
    }
    reportDev({
      layer: "Layer 2",
      stage: "reuse",
      label: "Cached Synonyms",
      content: synonymsById
    });
  } else {
    reportProgress("Layer 2: expanding synonyms...");
    const modelRoster = buildModelRoster();
    let hasContextFilterPrompt = true;
    try {
      await loadPrompt("layer2ContextFilter");
    } catch {
      hasContextFilterPrompt = false;
    }

    const expansionResults = await Promise.all(
      elements.map((element) =>
        expandElement({
          element,
          modelRoster,
          hasContextFilterPrompt,
          claim,
          elementsJson,
          mode,
          reportProgress,
          reportDev
        })
      )
    );

    for (const result of expansionResults) {
      if (result?.elementId) {
        synonymsById[result.elementId] = result.synonyms;
      }
    }
  }

  safeReport({
    type: "artifact",
    payload: {
      elements,
      relations,
      synonymsById,
      mode
    }
  });

  reportProgress("Layer 3: assembling query...");
  const draftQuery = buildQuery({
    elements,
    relations,
    synonymsById,
    nearDistance: DEFAULT_NEAR_DISTANCE
  });

  reportDev({
    layer: "Layer 3",
    stage: "assembly",
    label: "Fallback Draft",
    content: draftQuery
  });

  const assemblyPromptPair = await renderPromptPair("layer3Validation", {
    claim,
    mode,
    synonyms_json: { elements, synonyms_by_id: synonymsById },
    relations_json: relations
  });
  reportDev({
    layer: "Layer 3",
    stage: "request",
    label: "Assembly",
    model: JUDGE_MODEL,
    content: {
      system: assemblyPromptPair.system,
      user: assemblyPromptPair.user
    }
  });
  const assemblyResponse = await callOpenWebUI(
    assemblyPromptPair.messages,
    JUDGE_MODEL,
    TEMPERATURES.validation
  );
  reportDev({
    layer: "Layer 3",
    stage: "response",
    label: "Assembly",
    model: JUDGE_MODEL,
    content: assemblyResponse
  });

  let finalQuery = "";
  try {
    const assemblyJson = parseJsonFromText(assemblyResponse, "Layer 3 assembly");
    if (typeof assemblyJson?.final_query === "string") {
      finalQuery = assemblyJson.final_query.trim();
    } else if (typeof assemblyJson?.query_structure === "string") {
      finalQuery = assemblyJson.query_structure.trim();
    }
  } catch {
    // Ignore parse errors and fall back to draft query.
  }

  if (!finalQuery) finalQuery = draftQuery;

  const validation = basicValidate(finalQuery);
  if (!validation.ok) {
    if (draftQuery && finalQuery !== draftQuery) {
      finalQuery = draftQuery;
    }
    const recheck = basicValidate(finalQuery);
    if (!recheck.ok) {
      throw new Error(`Query validation failed: ${recheck.errors.join(", ")}`);
    }
  }

  return finalQuery;
}
