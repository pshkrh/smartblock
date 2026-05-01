// Known two-part TLD suffixes that need three labels to form a registrable domain.
const MULTI_PART = new Set([
  'co.uk', 'co.jp', 'co.in', 'co.nz', 'co.za', 'co.kr',
  'com.au', 'com.br', 'com.mx', 'com.ar', 'com.sg',
  'org.uk', 'net.au',
]);

export function extractDomain(url) {
  try {
    const { hostname } = new URL(url);
    const host = hostname.replace(/^www\./, '');
    const parts = host.split('.');
    if (parts.length <= 2) return host;
    const lastTwo = parts.slice(-2).join('.');
    if (MULTI_PART.has(lastTwo)) return parts.slice(-3).join('.');
    return lastTwo;
  } catch {
    return null;
  }
}

// Returns true if hostname belongs to domain (handles subdomains).
export function matchesDomain(hostname, domain) {
  const h = hostname.replace(/^www\./, '');
  return h === domain || h.endsWith('.' + domain);
}
