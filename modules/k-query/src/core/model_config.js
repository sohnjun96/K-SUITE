const DEFAULT_LLM_MODEL = String(globalThis.KSUITE_DEFAULT_LLM_MODEL || "").trim();
if (!DEFAULT_LLM_MODEL) {
  throw new Error("K-SUITE default model is not initialized.");
}

export const ANALYST_MODEL = DEFAULT_LLM_MODEL;
export const JUDGE_MODEL = DEFAULT_LLM_MODEL;

// Replace these with model IDs that are available in your OpenWebUI instance.
export const ENSEMBLE_MODELS = [DEFAULT_LLM_MODEL, "GEMMA-3-27B", "exaone 3.5 32b"];

export const TEMPERATURES = {
  analysis: 0.2,
  expansion: 0.6,
  evaluation: 0.2,
  validation: 0.0
};

export const DEFAULT_NEAR_DISTANCE = 3;
