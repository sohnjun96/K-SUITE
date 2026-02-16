const PROMPT_PATHS = {
  layer1Extraction: "modules/k-query/prompts/layer_1/extraction.txt",
  layer1Relations: "modules/k-query/prompts/layer_1/relations.txt",
  layer2Expansion: "modules/k-query/prompts/layer_2/expansion_base.txt",
  layer2Evaluation: "modules/k-query/prompts/layer_2/evaluation.txt",
  layer2ContextFilter: "modules/k-query/prompts/layer_2/context_filter.txt",
  layer3Validation: "modules/k-query/prompts/layer_3/validation.txt"
};

const promptCache = new Map();

export async function loadPrompt(key) {
  const path = PROMPT_PATHS[key];
  if (!path) throw new Error(`Unknown prompt key: ${key}`);

  if (promptCache.has(path)) return promptCache.get(path);

  const url = chrome.runtime.getURL(path);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load prompt: ${path}`);

  const text = await response.text();
  promptCache.set(path, text);
  return text;
}

export function fillTemplate(promptText, variables) {
  return promptText.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => {
    const value = variables?.[key];
    return value === undefined || value === null ? "" : String(value);
  });
}
