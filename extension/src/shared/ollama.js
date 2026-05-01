import { DEFAULT_OLLAMA_MODEL } from './config.js';

async function fetchTags() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch('http://localhost:11434/api/tags', { signal: controller.signal });
    if (!res.ok) return { ok: false, models: [] };
    const data = await res.json();
    const models = (data.models ?? [])
      .map(model => model.name)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    return { ok: true, models };
  } catch {
    return { ok: false, models: [] };
  } finally {
    clearTimeout(timer);
  }
}

export async function listInstalledModels() {
  const result = await fetchTags();
  return result.models;
}

export async function getOllamaStatus(model = DEFAULT_OLLAMA_MODEL) {
  const targetModel = model || DEFAULT_OLLAMA_MODEL;
  const result = await fetchTags();
  if (!result.ok) return { ok: false, reason: 'offline', model: targetModel, models: [] };

  const hasModel = result.models.includes(targetModel);
  return {
    ok: hasModel,
    reason: hasModel ? 'ok' : 'missing_model',
    model: targetModel,
    models: result.models,
  };
}

export async function checkOllamaReachable(model = DEFAULT_OLLAMA_MODEL) {
  const status = await getOllamaStatus(model);
  return status.ok;
}
