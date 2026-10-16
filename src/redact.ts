/** Redact payment credentials and secrets before anything is written to a tape. */
const SECRET_KEY = /(token|secret|password|authorization|signature|cvc|cvv|number|credential|private|api[-_]?key|x-payment|payment-signature|hmac|cookie)/i;
const KEEP_KEY = /^(card_number_type|number_type|display_last4|last4|token_type)$/i;
const PATTERNS: [RegExp, string][] = [
  [/\b(spt|sk|rk|pk|whsec|tok|pm|seti|pi)_(test_|live_)?[A-Za-z0-9]{6,}\b/g, "$1_[REDACTED]"],
  [/\b\d{13,19}\b/g, "[REDACTED_PAN]"],
  [/0x[a-fA-F0-9]{64,}/g, "0x[REDACTED_SIG]"],
  [/(Bearer|Payment)\s+[^\s,]+/g, "$1 [REDACTED]"],
];

export function redactString(s: string): string {
  let out = s;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

export function redact<T>(value: T, key = ""): T {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (key && SECRET_KEY.test(key) && !KEEP_KEY.test(key)) return "[REDACTED]" as unknown as T;
    return redactString(value) as unknown as T;
  }
  if (typeof value === "number" && key && SECRET_KEY.test(key) && !KEEP_KEY.test(key)) return "[REDACTED]" as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redact(v, key)) as unknown as T;
  if (typeof value === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) o[k] = redact(v, k);
    return o as T;
  }
  return value;
}
