// Domains always classified as entertainment regardless of page content.
export const HARD_ENTERTAINMENT = new Set([
  // Short-form / social video
  'tiktok.com',
  // Photo / social feeds
  'instagram.com',
  'facebook.com',
  'threads.net',
  'snapchat.com',
  'pinterest.com',
  // Microblogging / social
  'x.com',
  'twitter.com',
  'tumblr.com',
  // Memes / aggregators
  '9gag.com',
  'imgur.com',
  // Tabloid / celebrity news
  'buzzfeed.com',
  'tmz.com',
  // Pure-entertainment streaming
  'netflix.com',
  'hulu.com',
  'disneyplus.com',
  'primevideo.com',
  // Reddit treated as hard entertainment by default (promote to MIXED for
  // subreddit-level granularity if needed)
  'reddit.com',
]);

// Domains always classified as productive; never tick the timer.
export const HARD_PRODUCTIVE = new Set([
  'github.com',
  'gitlab.com',
  'bitbucket.org',
  'stackoverflow.com',
  'developer.mozilla.org',
  'mdn.io',
  'arxiv.org',
  'wikipedia.org',
  'khanacademy.org',
  'coursera.org',
  'edx.org',
  'udacity.com',
  'figma.com',
  'notion.so',
  'linear.app',
  'jira.atlassian.com',
  'confluence.atlassian.com',
  'docs.google.com',
]);

// Domains that need per-page classification via Ollama.
export const MIXED = new Set([
  'youtube.com',
  'linkedin.com',
  'twitch.tv',
  'medium.com',
  'substack.com',
]);

// Regex applied to page title for fast productive classification on MIXED domains.
const PRODUCTIVE_RE = /\b(tutorial|lecture|course|documentation|how[\s-]to|guide|reference|paper|research|docs|learn|programming|dev\b|api\s+reference)\b/i;

// On these MIXED domains, only specific paths can be entertainment.
// Every other path (homepage, search, channel pages, etc.) is treated as
// productive navigation so the timer doesn't run while you're just browsing.
const ENTERTAINMENT_PATHS_ONLY = {
  'youtube.com': ['/watch', '/shorts/'],
};

// URL path prefixes that immediately indicate entertainment on MIXED domains.
const ENTERTAINMENT_PATHS = {
  'linkedin.com': ['/feed', '/posts/', '/in/'],
  'twitch.tv': ['/videos/', '/clip/'],
};

export const VERDICT = {
  PRODUCTIVE: 'productive',
  ENTERTAINMENT: 'entertainment',
};

/**
 * Returns a verdict from the rule pre-pass, or null if the domain needs
 * Ollama classification.
 */
export function ruleClassify(domain, url, title) {
  if (HARD_ENTERTAINMENT.has(domain)) return VERDICT.ENTERTAINMENT;
  if (HARD_PRODUCTIVE.has(domain)) return VERDICT.PRODUCTIVE;

  if (MIXED.has(domain)) {
    try {
      const path = new URL(url).pathname;

      // Domains with restricted entertainment paths: only those paths can tick.
      const restrictedPaths = ENTERTAINMENT_PATHS_ONLY[domain];
      if (restrictedPaths) {
        const isEntertainmentPath = restrictedPaths.some(p => path.startsWith(p));
        if (!isEntertainmentPath) return VERDICT.PRODUCTIVE;
        // Falls through to keyword check + Ollama for the entertainment-eligible paths.
      }

      // Fast-path: URL immediately signals entertainment.
      const entertainmentPaths = ENTERTAINMENT_PATHS[domain] ?? [];
      if (entertainmentPaths.some(p => path.startsWith(p))) return VERDICT.ENTERTAINMENT;
    } catch { /* ignore */ }

    // Title keyword fast-path → productive.
    if (PRODUCTIVE_RE.test(title)) return VERDICT.PRODUCTIVE;

    // Needs Ollama.
    return null;
  }

  // All other domains → productive by default (normal sites don't tick)
  return VERDICT.PRODUCTIVE;
}
