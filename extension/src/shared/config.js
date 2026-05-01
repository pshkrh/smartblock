export const OLLAMA_URL = 'http://localhost:11434/api/generate';
export const OLLAMA_MODEL = 'qwen2.5:3b';
export const OLLAMA_TIMEOUT_MS = 8000;

export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_LIMIT_MINUTES = 30;
export const POLL_INTERVAL_MINUTES = 1;
export const ACTIVITY_LIMIT = 200;

export const BLOCK_MODE = {
  SMART: 'smart',
  STRICT: 'strict',
};

export const BLOCK_PAGE = '/src/block/block.html';

export function defaultConfig() {
  return { defaultLimitMinutes: DEFAULT_LIMIT_MINUTES, domains: {} };
}
