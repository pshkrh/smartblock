import { OLLAMA_URL, OLLAMA_TIMEOUT_MS } from '../shared/config.js';
import { ruleClassify, VERDICT } from './rules.js';
import { getCached, getOverride, setCached } from './storage.js';

function buildPrompt(url, title, snippet) {
  return `Classify this web page as either "productive" or "entertainment".

"productive": learning, work, reference, documentation, research, programming, news of substance, professional content.
"entertainment": vlogs, memes, short-form video, gossip, casual social feeds, gaming streams, celebrity content, leisure browsing.

Use the URL, page title, and page text together. For video/social/article pages, classify the specific page content, not the whole website.
Respond with strict JSON only: {"verdict": "productive"|"entertainment", "confidence": 0.0-1.0}

URL: ${url}
TITLE: ${title}
SNIPPET: ${snippet}`;
}

async function callOllama(url, title, snippet, model) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  try {
    const res = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: buildPrompt(url, title, snippet),
        format: 'json',
        stream: false,
        options: { temperature: 0 },
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    const parsed = JSON.parse(data.response);
    if (!['productive', 'entertainment'].includes(parsed.verdict)) throw new Error('bad verdict');
    return parsed.verdict;
  } catch {
    return null; // fail-open
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Classify a page. Returns { verdict, source } where source is one of:
 *   'override' - manually corrected by the user
 *   'rule'     - matched a domain, URL, keyword, or default rule
 *   'cache'    - returned from local cache
 *   'ollama'   - returned from Ollama
 *   'unselected' - no Ollama model selected
 *   'fallback' - Ollama unavailable; defaulting to productive
 */
export async function classify(domain, url, title, snippet, options = {}) {
  const model = typeof options.ollamaModel === 'string' ? options.ollamaModel.trim() : '';
  const override = await getOverride(domain, url);
  if (override) return { verdict: override, source: 'override' };

  // Rule pre-pass keeps untracked domains out of Ollama. Smart tracked domains
  // fall through to override/cache/model classification.
  const ruleVerdict = ruleClassify(domain, url, title, options);
  if (ruleVerdict !== null) {
    return { verdict: ruleVerdict, source: 'rule' };
  }

  // Cache lookup for pages that need model classification.
  const cached = await getCached(domain, url, title, model);
  if (cached) return { verdict: cached, source: 'cache' };

  if (!model) {
    return { verdict: VERDICT.PRODUCTIVE, source: 'unselected' };
  }

  // Ollama
  const ollamaVerdict = await callOllama(url, title, snippet, model);
  if (ollamaVerdict) {
    await setCached(domain, url, title, model, ollamaVerdict);
    return { verdict: ollamaVerdict, source: 'ollama' };
  }

  // Ollama unreachable: fail-open so the timer does not run.
  return { verdict: VERDICT.PRODUCTIVE, source: 'fallback' };
}
