import { OLLAMA_MODEL } from './config.js';

export async function getOllamaStatus() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch('http://localhost:11434/api/tags', { signal: controller.signal });
    if (!res.ok) return { ok: false, reason: 'offline', model: OLLAMA_MODEL };
    const data = await res.json();
    const hasModel = (data.models ?? []).some(model => model.name === OLLAMA_MODEL);
    return {
      ok: hasModel,
      reason: hasModel ? 'ok' : 'missing_model',
      model: OLLAMA_MODEL,
    };
  } catch {
    return { ok: false, reason: 'offline', model: OLLAMA_MODEL };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkOllamaReachable() {
  const status = await getOllamaStatus();
  return status.ok;
}
