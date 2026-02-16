function extractFirstJsonCandidate(text) {
  const source = String(text || '');
  const objectStart = source.indexOf('{');
  const arrayStart = source.indexOf('[');

  let start = -1;
  if (objectStart === -1) start = arrayStart;
  else if (arrayStart === -1) start = objectStart;
  else start = Math.min(objectStart, arrayStart);

  if (start === -1) return null;

  const stack = [];
  let inString = false;
  let escaped = false;

  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{' || ch === '[') {
      stack.push(ch);
      continue;
    }

    if (ch === '}' || ch === ']') {
      const last = stack.pop();
      const matched = (last === '{' && ch === '}') || (last === '[' && ch === ']');
      if (!matched) return null;
      if (stack.length === 0) {
        return source.slice(start, i + 1);
      }
    }
  }

  return null;
}

function safeJsonParse(raw) {
  if (typeof raw !== 'string') return raw;
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const candidate = extractFirstJsonCandidate(cleaned);
    if (candidate) {
      return JSON.parse(candidate);
    }
    throw e;
  }
}

const LARC_PROMPT_BUNDLES = Object.freeze({
  chat: {
    system: 'prompts/chat/system.txt',
    user: 'prompts/chat/user.txt',
    schema: 'prompts/chat/schema.json'
  },
  stepAFeatures: {
    system: 'prompts/step_a_features/system.txt',
    user: 'prompts/step_a_features/user.txt',
    schema: 'prompts/step_a_features/schema.json'
  },
  stepQuickAnalysis: {
    system: 'prompts/step_quick_analysis/system.txt',
    user: 'prompts/step_quick_analysis/user.txt',
    schema: 'prompts/step_quick_analysis/schema.json'
  },
  stepBQuery: {
    system: 'prompts/step_b_query/system.txt',
    user: 'prompts/step_b_query/user.txt',
    schema: 'prompts/step_b_query/schema.json'
  },
  stepBMerge: {
    system: 'prompts/step_b_merge/system.txt',
    user: 'prompts/step_b_merge/user.txt',
    schema: 'prompts/step_b_merge/schema.json'
  },
  stepBRag: {
    system: 'prompts/step_b_rag/system.txt',
    user: 'prompts/step_b_rag/user.txt',
    schema: 'prompts/step_b_rag/schema.json'
  },
  stepCMultiJudge: {
    system: 'prompts/step_c_multijudge/system.txt',
    user: 'prompts/step_c_multijudge/user.txt',
    schema: 'prompts/step_c_multijudge/schema.json'
  },
  stepDRepair: {
    system: 'prompts/step_d_repair/system.txt',
    user: 'prompts/step_d_repair/user.txt',
    schema: 'prompts/step_d_repair/schema.json'
  },
  verification: {
    system: 'prompts/verification/system.txt',
    user: 'prompts/verification/user.txt',
    schema: 'prompts/verification/schema.json'
  }
});

const LARC_PROMPT_PLACEHOLDER_REGEX = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;
const larcPromptTextCache = new Map();
const larcPromptSchemaCache = new Map();

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function extractPromptPlaceholders(template) {
  const names = new Set();
  for (const match of String(template || '').matchAll(LARC_PROMPT_PLACEHOLDER_REGEX)) {
    names.add(match[1]);
  }
  return names;
}

function normalizePromptSchema(rawSchema, systemTemplate, userTemplate) {
  const schema = isPlainObject(rawSchema) ? rawSchema : {};
  const required = Array.isArray(schema.required)
    ? [...new Set(schema.required.filter(key => typeof key === 'string' && key.trim()).map(key => key.trim()))]
    : [];
  const optional = isPlainObject(schema.optional) ? { ...schema.optional } : {};
  const types = isPlainObject(schema.types) ? { ...schema.types } : {};

  const placeholders = new Set([
    ...extractPromptPlaceholders(systemTemplate),
    ...extractPromptPlaceholders(userTemplate)
  ]);
  placeholders.forEach((name) => {
    if (!hasOwn(types, name)) {
      types[name] = 'text';
    }
  });

  return { required, optional, types };
}

function hasPromptValue(value) {
  return value !== undefined && value !== null;
}

function formatPromptValue(value, type) {
  if (!hasPromptValue(value)) return '';
  const normalizedType = String(type || 'text').trim().toLowerCase();

  if (normalizedType === 'json') {
    if (typeof value === 'string') return value;
    return JSON.stringify(value, null, 2);
  }

  if (normalizedType === 'list') {
    if (Array.isArray(value)) return value.map(item => String(item ?? '')).join('\n');
    return String(value);
  }

  return String(value);
}

function resolvePromptVariables(schema, variables, promptKey) {
  const safeVariables = isPlainObject(variables) ? variables : {};
  const merged = { ...schema.optional, ...safeVariables };
  const missing = schema.required.filter(name => !hasPromptValue(merged[name]));
  if (missing.length > 0) {
    throw new Error(`Missing required prompt variables for '${promptKey}': ${missing.join(', ')}`);
  }
  return merged;
}

function fillPromptTemplateStrict(template, variables, schema, promptKey, role) {
  const text = String(template || '');
  const rendered = text.replace(LARC_PROMPT_PLACEHOLDER_REGEX, (_, name) => {
    if (!hasOwn(variables, name)) {
      throw new Error(`Unknown placeholder '{{${name}}}' in ${role} prompt for '${promptKey}'`);
    }
    return formatPromptValue(variables[name], schema.types[name]);
  });

  const unresolved = [...rendered.matchAll(LARC_PROMPT_PLACEHOLDER_REGEX)].map(match => match[1]);
  if (unresolved.length > 0) {
    throw new Error(
      `Unresolved placeholders in ${role} prompt for '${promptKey}': ${[...new Set(unresolved)].join(', ')}`
    );
  }

  return rendered;
}

async function loadPromptText(path) {
  if (!path) return null;
  if (larcPromptTextCache.has(path)) return larcPromptTextCache.get(path);

  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load prompt text: ${path}`);
  }

  const text = await response.text();
  larcPromptTextCache.set(path, text);
  return text;
}

async function loadPromptSchema(path) {
  if (!path) return null;
  if (larcPromptSchemaCache.has(path)) return larcPromptSchemaCache.get(path);

  const response = await fetch(path);
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Failed to load prompt schema: ${path}`);
  }

  const parsed = await response.json();
  larcPromptSchemaCache.set(path, parsed);
  return parsed;
}

async function renderLarcPromptPair(promptKey, variables) {
  const bundle = LARC_PROMPT_BUNDLES[promptKey];
  if (!bundle) throw new Error(`Unknown prompt key: ${promptKey}`);

  const systemTemplate = await loadPromptText(bundle.system);
  const userTemplate = await loadPromptText(bundle.user);
  const schema = normalizePromptSchema(await loadPromptSchema(bundle.schema), systemTemplate, userTemplate);
  const resolvedVariables = resolvePromptVariables(schema, variables, promptKey);

  const systemPrompt = fillPromptTemplateStrict(systemTemplate, resolvedVariables, schema, promptKey, 'system');
  const userPrompt = fillPromptTemplateStrict(userTemplate, resolvedVariables, schema, promptKey, 'user');

  return {
    system: systemPrompt,
    user: userPrompt,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  };
}

async function sendLLMRequest(payload) {
  if (settings.mockMode) {
    return await buildMockLLMResponse(payload);
  }

  return await new Promise(resolve => {
    chrome.runtime.sendMessage({
      type: 'ANALYZE_CLAIM',
      payload,
      baseUrl: settings.url,
      apiKey: settings.key
    }, resolve);
  });
}

function mockResponseFromObject(obj) {
  return {
    ok: true,
    data: {
      choices: [
        {
          message: {
            content: JSON.stringify(obj, null, 2)
          }
        }
      ]
    }
  };
}

function extractBetween(text, startMarker, endMarker) {
  const normalizedText = String(text || '').replace(/\r\n/g, '\n');
  const normalizedStart = String(startMarker || '').replace(/\r\n/g, '\n');
  const normalizedEnd = endMarker ? String(endMarker).replace(/\r\n/g, '\n') : '';

  const startIndex = normalizedText.indexOf(normalizedStart);
  if (startIndex === -1) return '';
  const from = startIndex + normalizedStart.length;
  const endIndex = normalizedEnd ? normalizedText.indexOf(normalizedEnd, from) : -1;
  if (endIndex === -1) return normalizedText.slice(from).trim();
  return normalizedText.slice(from, endIndex).trim();
}

const MOCK_DOC_FIXTURE_KEYS = ['D1', 'D2', 'D3'];
const MOCK_PARAGRAPH_KEYS = ['[0010]', '[0012]', '[0015]', '[0020]', '[0024]', '[0030]', '[0035]', '[0040]'];
const MOCK_FEATURE_TEMPLATES = [
  'A sensor module measures an external input signal and outputs sampling data.',
  'A preprocessing unit filters noise from the sampling data and normalizes amplitude.',
  'A feature extractor derives a state vector using frequency and trend components.',
  'A decision unit compares the state vector with reference thresholds for classification.',
  'A control unit adjusts an actuator according to the classification result.',
  'A feedback loop updates control parameters based on a measured output response.'
];

function getMockDocNameByIndex(index) {
  const safeIndex = Number.isFinite(index) ? Math.max(0, index) : 0;
  return MOCK_DOC_FIXTURE_KEYS[safeIndex % MOCK_DOC_FIXTURE_KEYS.length];
}

function getMockDefaultClaimText() {
  return [
    'A system includes a sensor module, preprocessing unit, feature extractor, and decision unit.',
    'The control unit drives an actuator based on a classification result.',
    'A feedback loop updates control parameters using measured output response.'
  ].join(' ');
}

function buildMockParagraphMap(docName) {
  const doc = String(docName || 'D1').trim() || 'D1';
  const variant = doc === 'D1' ? 'baseline architecture'
    : doc === 'D2' ? 'equivalent control flow'
      : 'implementation-level refinement';

  return {
    '[0010]': `${doc} describes a ${variant} with sensor sampling and preprocessing steps.`,
    '[0012]': `${doc} explains noise filtering and normalization before feature extraction.`,
    '[0015]': `${doc} defines feature extraction with frequency-domain and trend-domain vectors.`,
    '[0020]': `${doc} presents threshold-based decision logic for state classification.`,
    '[0024]': `${doc} shows control command generation linked to classification outcomes.`,
    '[0030]': `${doc} states actuator operation under dynamic control parameters.`,
    '[0035]': `${doc} introduces closed-loop feedback from measured output response.`,
    '[0040]': `${doc} updates model coefficients and control gains using feedback history.`
  };
}

function buildMockCitationPayload(docName, title) {
  const doc = String(docName || 'D1').trim() || 'D1';
  return {
    paragraphs: buildMockParagraphMap(doc),
    claims: {
      'Claim 1': `${doc} discloses sensing, classification, and control integration.`,
      'Claim 2': `${doc} discloses adaptive feedback-based parameter tuning.`
    },
    meta: {
      docName: doc,
      title: title || `Mock Citation ${doc}`
    }
  };
}

function buildMockCitationFixtures() {
  return MOCK_DOC_FIXTURE_KEYS.map((docName, idx) => {
    const title = `Mock Citation ${idx + 1}`;
    const payload = buildMockCitationPayload(docName, title);
    return {
      name: docName,
      title,
      fileId: `mock-file-${docName.toLowerCase()}`,
      status: 'completed',
      text: JSON.stringify(payload, null, 2)
    };
  });
}

function getMockDocNames() {
  const docs = citations
    .filter(c => c.status === 'completed')
    .map(c => c.name)
    .filter(Boolean);
  return docs.length > 0 ? docs : ['인용발명 1', '인용발명 2'];
}

function buildMockClaimFeatures(claimText) {
  const normalized = String(claimText || '').replace(/\s+/g, ' ').trim();
  const chunks = normalized
    .split(/[.;\n]/g)
    .map(v => v.trim())
    .filter(v => v.length >= 4);

  const unique = [];
  chunks.forEach(chunk => {
    if (!unique.includes(chunk)) unique.push(chunk);
  });

  const picked = unique.slice(0, 4);
  if (picked.length === 0 && normalized) picked.push(normalized.slice(0, 120));
  if (picked.length === 0) picked.push('핵심 구성요소');

  return picked.map((description, idx) => ({
    Id: `F${idx + 1}`,
    Description: description
  }));
}

function buildMockRelevant(features, labelSuffix) {
  const docs = getMockDocNames();
  const relevant = {};

  (features || []).forEach((feature, idx) => {
    const docName = docs[idx % docs.length];
    if (!relevant[docName]) relevant[docName] = [];

    relevant[docName].push({
      Feature: feature.Id || `F${idx + 1}`,
      MatchType: idx % 2 === 0 ? 'Explicit' : 'Equivalent',
      Content: `${docName}에서 ${feature.Description || '구성요소'} 관련 문장 (${labelSuffix || 'Mock'})`,
      Position: `문단 ${idx + 1}`
    });
  });

  return relevant;
}

// Mock dataset override: richer demo with 6 features, 3 docs, and paragraph positions.
function getMockDocNames() {
  const docs = citations
    .filter(c => c.status === 'completed')
    .map(c => c.name)
    .filter(Boolean);

  const ordered = [...MOCK_DOC_FIXTURE_KEYS, ...docs];
  const unique = [];
  ordered.forEach(name => {
    const normalized = String(name || '').trim();
    if (!normalized) return;
    if (!unique.includes(normalized)) unique.push(normalized);
  });

  return unique.slice(0, 3);
}

function buildMockClaimFeatures(claimText) {
  const normalized = String(claimText || '').replace(/\s+/g, ' ').trim();
  const chunks = normalized
    .split(/[.;\n]/g)
    .map(v => v.trim())
    .filter(v => v.length >= 4);

  const unique = [];
  chunks.forEach(chunk => {
    if (!unique.includes(chunk)) unique.push(chunk);
  });

  const picked = unique.slice(0, 6);
  if (picked.length === 0 && normalized) picked.push(normalized.slice(0, 180));

  let templateIndex = 0;
  while (picked.length < 6) {
    const template = MOCK_FEATURE_TEMPLATES[templateIndex % MOCK_FEATURE_TEMPLATES.length];
    if (!picked.includes(template)) picked.push(template);
    templateIndex += 1;
  }

  return picked.map((description, idx) => ({
    Id: `F${idx + 1}`,
    Description: description
  })).slice(0, 6);
}

function buildMockRelevant(features, labelSuffix) {
  const docs = getMockDocNames();
  const relevant = {};
  const positions = MOCK_PARAGRAPH_KEYS;

  (features || []).forEach((feature, idx) => {
    const primaryDoc = docs[idx % docs.length];
    const secondaryDoc = docs[(idx + 1) % docs.length];
    const primaryPos = positions[idx % positions.length];
    const secondaryStart = positions[(idx + 1) % positions.length];
    const secondaryEnd = positions[(idx + 2) % positions.length];

    if (!relevant[primaryDoc]) relevant[primaryDoc] = [];
    relevant[primaryDoc].push({
      Feature: feature.Id || `F${idx + 1}`,
      MatchType: idx % 2 === 0 ? 'Explicit' : 'Equivalent',
      Content: `${primaryDoc} contains evidence aligned with ${feature.Description || 'feature'} (${labelSuffix || 'Mock'}).`,
      Position: primaryPos
    });

    if (idx % 2 === 1) {
      if (!relevant[secondaryDoc]) relevant[secondaryDoc] = [];
      relevant[secondaryDoc].push({
        Feature: feature.Id || `F${idx + 1}`,
        MatchType: 'Equivalent',
        Content: `${secondaryDoc} provides functionally equivalent support for ${feature.Description || 'feature'} (${labelSuffix || 'Mock'}).`,
        Position: `${secondaryStart}-${secondaryEnd}`
      });
    }
  });

  return relevant;
}

async function buildMockLLMResponse(payload) {
  await new Promise(resolve => setTimeout(resolve, 220));

  try {
    const userMessage = payload?.messages?.find(m => m.role === 'user')?.content || '';

    if (
      userMessage.includes('Claim Features (JSON):') &&
      !userMessage.includes('Step A Claim Features (JSON):')
    ) {
      const block = extractBetween(userMessage, 'Claim Features (JSON):\n');
      const claimFeatures = safeJsonParse(block);
      const queries = {};
      (claimFeatures || []).forEach(feature => {
        const base = [
          feature.Description,
          `${feature.Description} 기능`,
          `${feature.Description} 구조`
        ];
        queries[feature.Id] = ensureQueryCount(feature, base, 6);
      });
      return mockResponseFromObject({ Queries: queries });
    }

    if (userMessage.includes('Query Bundle #')) {
      const block = extractBetween(userMessage, 'Features (JSON):\n');
      const features = safeJsonParse(block);
      return mockResponseFromObject({ Relevant: buildMockRelevant(features, 'B2') });
    }

    if (userMessage.includes('Step B-2 Responses (JSON):')) {
      const block = extractBetween(userMessage, 'Step B-2 Responses (JSON):\n');
      const responses = safeJsonParse(block);
      let merged = {};
      (responses || []).forEach(entry => {
        merged = mergeRelevantWithPositions(merged, entry?.Relevant || {});
      });
      return mockResponseFromObject({ Relevant: merged, mockMerged: true });
    }

    if (userMessage.includes('Quick Mode Input (JSON):')) {
      const quickBlock = extractBetween(userMessage, 'Quick Mode Input (JSON):\n', '\n\nTarget Claim:\n');
      const quickInput = safeJsonParse(quickBlock) || {};
      const claimFeatures = buildMockClaimFeatures(quickInput.claimText || quickInput.claim || '');
      const baseRelevant = buildMockRelevant(claimFeatures, 'Quick');
      const relevant = {};
      const verification = {};

      Object.entries(baseRelevant || {}).forEach(([docName, items]) => {
        if (!Array.isArray(items)) return;
        relevant[docName] = items.map((item, idx) => {
          const flag = idx % 3 === 0 ? 'F' : 'P';
          const key = `${item.Feature}_${docName}`;
          if (verification[key] !== 'F') verification[key] = flag;
          return {
            ...item,
            Verification: flag
          };
        });
      });

      const featureStatus = {};
      claimFeatures.forEach(feature => {
        featureStatus[feature.Id] = 'ENTAIL';
      });

      return mockResponseFromObject({
        ClaimFeatures: claimFeatures,
        FeatureStatus: featureStatus,
        Relevant: relevant,
        Verification: verification
      });
    }

    if (userMessage.includes('Step A Claim Features (JSON):')) {
      const stepBMarker = userMessage.includes('Step B Merged Relevant (JSON):')
        ? 'Step B Merged Relevant (JSON):'
        : 'Step B Output (JSON):';
      const featureBlock = extractBetween(
        userMessage,
        'Step A Claim Features (JSON):\n',
        `\n\n${stepBMarker}`
      );
      const stepBBlock = extractBetween(userMessage, `${stepBMarker}\n`);
      const claimFeatures = safeJsonParse(featureBlock);
      const parsedStepB = safeJsonParse(stepBBlock);
      const stepBMergedRelevant = parsedStepB?.Relevant || parsedStepB || {};
      const featureStatus = {};
      const evidenceDecision = {};

      (claimFeatures || []).forEach(feature => {
        featureStatus[feature.Id] = 'ENTAIL';
      });

      Object.values(stepBMergedRelevant || {}).forEach(items => {
        if (!Array.isArray(items)) return;
        items.forEach(item => {
          const evidenceId = String(item?.EvidenceId || item?.evidenceId || '').trim();
          if (!evidenceId) return;
          evidenceDecision[evidenceId] = 'P';
        });
      });

      return mockResponseFromObject({
        FeatureStatus: featureStatus,
        EvidenceDecision: evidenceDecision,
        mockJudge: true
      });
    }

    if (userMessage.includes('Missing Features (JSON):')) {
      const missingBlock = extractBetween(
        userMessage,
        'Missing Features (JSON):\n',
        '\n\nCurrent Relevant (JSON):'
      );
      const missing = safeJsonParse(missingBlock);
      return mockResponseFromObject({ Relevant: buildMockRelevant(missing, 'D') });
    }

    if (userMessage.includes('**[1차 분석 결과 (JSON)]**')) {
      const summaryBlock = extractBetween(
        userMessage,
        '**[1차 분석 결과 (JSON)]**\n',
        '\n\n**[지시]**'
      );
      const summary = safeJsonParse(summaryBlock);
      const verifications = {};

      const claimIds = Object.keys(summary || {});
      if (claimIds.length > 0) {
        const claimId = claimIds[0];
        const relevant = summary?.[claimId]?.Relevant || {};
        const firstDoc = Object.keys(relevant)[0];
        const firstItem = Array.isArray(relevant[firstDoc]) ? relevant[firstDoc][0] : null;

        if (firstDoc && firstItem?.Feature) {
          verifications[`${claimId}_${firstItem.Feature}_${firstDoc}`] = {
            status: 'caution',
            reason: `[Mock 검증] '${firstItem.Feature}' 항목은 보완 확인이 필요하다는 가정 결과입니다.`
          };
        }
      }

      return mockResponseFromObject({ verifications });
    }

    if (/^\[Claim ID:/.test(userMessage)) {
      const claimText = userMessage.split('\n').slice(1).join('\n').trim();
      return mockResponseFromObject({ ClaimFeatures: buildMockClaimFeatures(claimText) });
    }

    return mockResponseFromObject({ mock: true });
  } catch (error) {
    return { ok: false, error: `Mock 응답 생성 실패: ${error.message}` };
  }
}

function buildFileRefs(fileIds) {
  return fileIds.map(id => ({ type: 'file', id: id }));
}

function makeRelevantKey(item) {
  return [item.Feature, item.MatchType, item.Content, item.Position]
    .map(v => (v || '').trim())
    .join('||');
}

function mergeRelevant(base, extra) {
  const merged = JSON.parse(JSON.stringify(base || {}));
  Object.entries(extra || {}).forEach(([doc, items]) => {
    if (!Array.isArray(items)) return;
    if (!merged[doc]) merged[doc] = [];
    const seen = new Set(merged[doc].map(makeRelevantKey));
    items.forEach(item => {
      const key = makeRelevantKey(item);
      if (!seen.has(key)) {
        merged[doc].push(item);
        seen.add(key);
      }
    });
  });
  return merged;
}

function splitPositions(value) {
  return String(value || '')
    .split(/\s*(?:\||;|,)\s*/g)
    .map(v => v.trim())
    .filter(Boolean);
}

function parseNumericPositionToken(token) {
  const text = String(token || '').trim();
  if (!text) return null;

  const rangeMatch = text.match(
    /^[\[\(<]?\s*(\d{1,6})\s*[\]\)>]?\s*(?:-|~|–|—)\s*[\[\(<]?\s*(\d{1,6})\s*[\]\)>]?$/
  );
  if (rangeMatch) {
    const a = Number.parseInt(rangeMatch[1], 10);
    const b = Number.parseInt(rangeMatch[2], 10);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      return { start: Math.min(a, b), end: Math.max(a, b) };
    }
  }

  const singleMatch = text.match(/^[\[\(<]?\s*(\d{1,6})\s*[\]\)>]?$/);
  if (singleMatch) {
    const value = Number.parseInt(singleMatch[1], 10);
    if (Number.isFinite(value)) {
      return { start: value, end: value };
    }
  }

  return null;
}

function formatNumericPositionRange(start, end) {
  const pad = value => String(value).padStart(4, '0');
  if (start === end) return `[${pad(start)}]`;
  return `[${pad(start)}]-[${pad(end)}]`;
}

function normalizePositionTokens(value) {
  const numericRanges = [];
  const textParts = [];
  const seenText = new Set();

  splitPositions(value).forEach(token => {
    const numeric = parseNumericPositionToken(token);
    if (numeric) {
      numericRanges.push(numeric);
      return;
    }

    if (!seenText.has(token)) {
      seenText.add(token);
      textParts.push(token);
    }
  });

  numericRanges.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return b.end - a.end;
  });

  const compactNumeric = [];
  numericRanges.forEach(range => {
    const last = compactNumeric[compactNumeric.length - 1];
    if (!last) {
      compactNumeric.push(range);
      return;
    }

    const isContained = range.start >= last.start && range.end <= last.end;
    if (isContained) return;
    compactNumeric.push(range);
  });

  const numericText = compactNumeric.map(range => formatNumericPositionRange(range.start, range.end));
  return [...numericText, ...textParts];
}

function normalizePositionText(value) {
  return normalizePositionTokens(value).join(', ');
}

function mergePositionText(a, b) {
  return normalizePositionText(`${a || ''}, ${b || ''}`);
}

function mergeRelevantWithPositions(base, extra) {
  const merged = JSON.parse(JSON.stringify(base || {}));
  Object.entries(extra || {}).forEach(([doc, items]) => {
    if (!Array.isArray(items)) return;
    if (!merged[doc]) merged[doc] = [];
    items.forEach(raw => {
      const item = {
        Feature: (raw.Feature || '').trim(),
        MatchType: (raw.MatchType || raw.matchType || raw.match_type || '').trim(),
        Content: (raw.Content || '').trim(),
        Position: normalizePositionText((raw.Position || '').trim())
      };
      if (!item.Feature || !item.MatchType || !item.Content) return;
      const existing = merged[doc].find(entry =>
        entry.Feature === item.Feature &&
        entry.MatchType === item.MatchType &&
        entry.Content === item.Content
      );
      if (existing) {
        existing.Position = mergePositionText(existing.Position, item.Position);
      } else {
        merged[doc].push(item);
      }
    });
  });
  return merged;
}

function normalizeRelevantForFeature(relevant, featureId) {
  const normalized = {};
  Object.entries(relevant || {}).forEach(([doc, items]) => {
    if (!Array.isArray(items)) return;
    const cleaned = items.map(item => ({
      Feature: item.Feature || featureId,
      MatchType: item.MatchType || item.matchType || item.match_type || '',
      Content: item.Content || '',
      Position: normalizePositionText(item.Position || '')
    }))
    .filter(item => item.Feature === featureId && item.MatchType && item.Content);

    if (cleaned.length > 0) normalized[doc] = cleaned;
  });
  return normalized;
}

function ensureQueryCount(feature, queries, count) {
  const targetCount = Math.max(1, Number(count) || 1);
  const cleaned = (queries || [])
    .filter(q => typeof q === 'string')
    .map(q => q.trim())
    .filter(Boolean);

  const description = feature?.Description || 'feature';
  const fallback = [
    description,
    `functional: ${description}`,
    `structural: ${description}`,
    `synonyms: ${description}`,
    `exclude: ${description}`,
    `summary: ${description}`
  ];

  let i = 0;
  while (cleaned.length < targetCount) {
    const base = fallback[i % fallback.length];
    const candidate = i < fallback.length ? base : `${base} #${i + 1}`;
    if (!cleaned.includes(candidate)) {
      cleaned.push(candidate);
    }
    i += 1;
  }

  return cleaned.slice(0, targetCount);
}

function getMissingFeatures(claimFeatures, featureStatus, relevant) {
  const missing = [];
  (claimFeatures || []).forEach(feature => {
    const status = featureStatus?.[feature.Id];
    if (status && status !== 'ENTAIL') {
      missing.push(feature);
      return;
    }
    if (!status) {
      const hasMatch = Object.values(relevant || {}).some(list =>
        Array.isArray(list) && list.some(item => item.Feature === feature.Id)
      );
      if (!hasMatch) missing.push(feature);
    }
  });
  return missing;
}

function formatDownloadTimestamp(date) {
  const target = date instanceof Date ? date : new Date();
  const pad = value => String(value).padStart(2, '0');
  const yyyy = target.getFullYear();
  const mm = pad(target.getMonth() + 1);
  const dd = pad(target.getDate());
  const hh = pad(target.getHours());
  const min = pad(target.getMinutes());
  const ss = pad(target.getSeconds());
  return `${yyyy}${mm}${dd}_${hh}${min}${ss}`;
}

function triggerJsonDownload(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8'
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function buildAnalysisExportPayload() {
  const claimsSnapshot = (claims || []).map(claim => ({
    id: claim.id,
    name: claim.name,
    text: claim.text || ''
  }));

  const citationsSnapshot = (citations || []).map(citation => ({
    id: citation.id,
    referenceName: citation.name || '',
    documentName: citation.title || citation.name || '',
    status: citation.status || '',
    fileId: citation.fileId || null,
    tabId: citation.tabId || null
  }));

  const resultsSnapshot = JSON.parse(JSON.stringify(analysisResults || {}));
  const progressSnapshot = JSON.parse(JSON.stringify(claimProgressById || {}));
  const debugLogsByClaim = {};

  Object.entries(resultsSnapshot).forEach(([claimId, result]) => {
    const errors = {};

    if (result?.error) {
      errors.error = result.error;
    }

    Object.entries(result?.debug || {}).forEach(([key, value]) => {
      if (key.toLowerCase().endsWith('error') && value) {
        errors[key] = value;
      }
    });

    debugLogsByClaim[claimId] = {
      debug: result?.debug || null,
      errors,
      progress: progressSnapshot?.[String(claimId)] || null
    };
  });

  return {
    exportType: 'k-larc-analysis',
    exportedAt: new Date().toISOString(),
    summary: {
      claimCount: claimsSnapshot.length,
      citationCount: citationsSnapshot.length,
      resultCount: Object.keys(resultsSnapshot).length,
      hasDebugLogs: Object.keys(debugLogsByClaim).length > 0
    },
    claims: claimsSnapshot,
    citations: citationsSnapshot,
    analysisResults: resultsSnapshot,
    debugLogs: {
      byClaim: debugLogsByClaim,
      claimProgressById: progressSnapshot
    }
  };
}

function downloadAnalysisSnapshot() {
  if (isAnalysisRunning) {
    alert('분석 진행 중에는 다운로드할 수 없습니다. 분석 완료 후 다시 시도해주세요.');
    return false;
  }

  if (!analysisResults || Object.keys(analysisResults).length === 0) {
    alert('다운로드할 분석 결과가 없습니다.');
    return false;
  }

  const payload = buildAnalysisExportPayload();
  const filename = `k-larc-analysis_${formatDownloadTimestamp(new Date())}.json`;
  triggerJsonDownload(filename, payload);
  return true;
}

function autoResizeTextarea(textarea) {
  const MAX_HEIGHT = 240;
  textarea.style.height = 'auto';
  const nextHeight = Math.min(textarea.scrollHeight, MAX_HEIGHT);
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = textarea.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
}
