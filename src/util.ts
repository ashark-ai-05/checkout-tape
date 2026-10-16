export function lower(h: Record<string, string>): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(h || {})) o[k.toLowerCase()] = String(v);
  return o;
}
export function obj(x: unknown): Record<string, any> {
  return x && typeof x === "object" ? (x as Record<string, any>) : {};
}
/** Pull the grand total (minor units) from an ACP/UCP style `totals` array. */
export function grandTotal(body: unknown): number | undefined {
  const totals = obj(body).totals;
  if (!Array.isArray(totals)) return undefined;
  const t = totals.find((x: any) => x && x.type === "total");
  return t && typeof t.amount === "number" ? t.amount : undefined;
}
export function b64json(s: string | undefined): any {
  if (!s) return undefined;
  try {
    const norm = s.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(norm, "base64").toString("utf8"));
  } catch {
    return undefined;
  }
}
export function money(amount?: number, currency?: string): string {
  if (amount === undefined) return "";
  return `${(amount / 100).toFixed(2)} ${(currency || "").toUpperCase()}`.trim();
}
