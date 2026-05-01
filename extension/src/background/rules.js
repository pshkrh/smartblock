export const VERDICT = {
  PRODUCTIVE: 'productive',
  ENTERTAINMENT: 'entertainment',
};

/**
 * Returns a verdict from the local rule pre-pass, or null if the page should
 * be classified by Ollama. Smart mode is intentionally model-driven: the only
 * built-in behavior here is that unconfigured domains stay productive by
 * default so the extension does not classify arbitrary browsing.
 */
export function ruleClassify(_domain, _url, _title, { allowOllama = false } = {}) {
  if (allowOllama) return null;
  return VERDICT.PRODUCTIVE;
}
