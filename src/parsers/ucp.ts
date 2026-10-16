import type { Parser } from "../types.js";
import { grandTotal, obj, money } from "../util.js";

// UCP (Shopify + Google), spec 2026-08-25: /.well-known/ucp, /checkout-sessions[/:id[/complete|/cancel]]
const SESS = /\/checkout-sessions(?:\/([^/?]+))?(?:\/(complete|cancel))?\/?(?:\?|$)/;

export const parseUcp: Parser = (ex) => {
  if (/\/\.well-known\/ucp\/?(?:\?|$)/.test(ex.path)) {
    const caps = obj(obj(ex.resBody).ucp).capabilities ?? obj(ex.resBody).capabilities;
    const n = Array.isArray(caps) ? caps.length : caps && typeof caps === "object" ? Object.keys(caps).length : 0;
    return { protocol: "ucp", step: "discovery", from: "agent", to: "merchant", role: "info", summary: `Discovery profile (${n} capabilities)` };
  }
  const m = ex.path.match(SESS);
  if (!m) return null;
  const res = obj(ex.resBody);
  let step: string;
  if (m[2]) step = m[2];
  else if (!m[1] && ex.method === "POST") step = "create";
  else if (m[1] && (ex.method === "PUT" || ex.method === "PATCH")) step = "update";
  else step = "get";
  const amount = grandTotal(res);
  const status = res.status;
  return {
    protocol: "ucp", step, from: "agent", to: "merchant", session: m[1] || res.id,
    amount, currency: res.currency, status,
    role: step === "complete" ? "payment" : amount !== undefined ? "consent" : "info",
    summary: `${step} → ${status ?? ex.status}${amount !== undefined ? `, total ${money(amount, res.currency)}` : ""}${status === "requires_escalation" ? " (human escalation)" : ""}`,
  };
};
