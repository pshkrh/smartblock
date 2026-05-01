// Deterministic DNR rule ID from domain string (range 100000-999999).
export function ruleIdForDomain(domain) {
  let h = 5381;
  for (const c of domain) h = (((h << 5) + h) ^ c.charCodeAt(0)) >>> 0;
  return (h % 900000) + 100000;
}

