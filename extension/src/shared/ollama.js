import { OLLAMA_MODEL } from './config.js';

export async function checkOllamaReachable() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch('http://localhost:11434/api/tags', { signal: controller.signal });
    if (!res.ok) return false;
    const data = await res.json();
    return (data.models ?? []).some(model => model.name === OLLAMA_MODEL);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
