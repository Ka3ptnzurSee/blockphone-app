// Kopie der Suffix-Logik aus targets/packettunnel/DnsFilter.swift (dort nicht
// unter Node testbar). Änderungen an der Swift-Logik hier nachziehen.
export function adSuffixMatch(host: string, set: Set<string>): boolean {
  if (!host || host === ".") return false;
  const h = host.toLowerCase().replace(/\.$/, "");
  if (set.has(h)) return true;
  const parts = h.split(".");
  for (let i = 1; i < parts.length; i++) {
    if (set.has(parts.slice(i).join("."))) return true;
  }
  return false;
}
