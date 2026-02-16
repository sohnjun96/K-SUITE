function sanitizeTerm(term) {
  return term.replace(/\"/g, "").replace(/\s+/g, " ").trim();
}

function normalizeMatch(raw) {
  if (!raw) return null;
  const value = String(raw).trim().toLowerCase();
  if (!value) return null;
  if (value === "phrase" || value === "exact" || value === "quoted") return "phrase";
  if (value === "token" || value === "near" || value === "and") return "token";
  return null;
}

function normalizeParts(parts) {
  if (!Array.isArray(parts)) return [];
  return parts.map((part) => sanitizeTerm(part)).filter(Boolean);
}

function formatSynonym(item, element) {
  const resolved = typeof item === "string" ? { term: item } : item || {};
  const term = sanitizeTerm(resolved.term || "");
  if (!term) return null;
  const match = normalizeMatch(resolved.match);
  const parts = normalizeParts(resolved.parts);

  if (match === "phrase") {
    return `"${term}"`;
  }

  if (parts.length > 0) {
    return parts.join("+");
  }

  if (element?.type === "compound" && Array.isArray(element.parts) && element.parts.length > 0 && term === element.term) {
    return element.parts.map((part) => sanitizeTerm(part)).filter(Boolean).join("+");
  }

  if (/\s/.test(term)) {
    return term.split(/\s+/).join("+");
  }

  return term;
}

function buildGroup(element, synonyms) {
  const formatted = [];
  const seen = new Set();

  for (const item of synonyms) {
    const value = formatSynonym(item, element);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    formatted.push(value);
  }

  if (formatted.length === 0) return "";
  if (formatted.length === 1) return `(${formatted[0]})`;
  return `(${formatted.join(" | ")})`;
}

function normalizeNearValue(value, fallback) {
  if (Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const num = Number.parseInt(value, 10);
    if (Number.isFinite(num)) return num;
  }
  return fallback;
}

export function buildQuery({ elements, relations, synonymsById, nearDistance = 3 }) {
  const groupById = {};
  for (const element of elements) {
    const synonyms = synonymsById[element.id] || [];
    const group = buildGroup(element, synonyms);
    if (group) groupById[element.id] = group;
  }

  const closeRelations = (relations || []).filter((rel) => rel.distance === "close");
  const usedIds = new Set();
  const expressionParts = [];

  for (const rel of closeRelations) {
    const left = groupById[rel.source];
    const right = groupById[rel.target];
    if (!left || !right) continue;
    usedIds.add(rel.source);
    usedIds.add(rel.target);
    const nearValue = normalizeNearValue(rel.near, nearDistance);
    expressionParts.push(`(${left} <near/${nearValue}> ${right})`);
  }

  for (const element of elements) {
    if (usedIds.has(element.id)) continue;
    const group = groupById[element.id];
    if (group) expressionParts.push(group);
  }

  if (expressionParts.length === 0) return "";
  if (expressionParts.length === 1) return expressionParts[0];
  return expressionParts.join(" & ");
}
