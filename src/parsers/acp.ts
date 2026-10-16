import type { Parser } from "../types.js";
import { grandTotal, lower, obj, money } from "../util.js";

// ACP (OpenAI + Stripe), spec 2026-04-17: /checkout_sessions[/:id[/complete|/cancel]] and /agentic_commerce/delegate_payment
const SESS = /\/checkout_sessions(?:\/([^/?]+))?(?:\/(complete|cancel))?\/?(?:\?|$)/;
const DELEGATE = /\/agentic_commerce\/delegate_payment\/?(?:\?|$)/;

export const parseAcp: Parser = (ex) => {
  const h = lower(ex.reqHeaders);
  if (DELEGATE.test(ex.path)) {
    const allowance = obj(obj(ex.reqBody).allowance);
    return {
      protocol: "acp", step: "delegate_payment", from: "agent", to: "psp",
      session: allowance.checkout_session_id, amount: allowance.max_amount, currency: allowance.currency,
      role: "payment",
      summary: `Delegate payment, allowance ${money(allowance.max_amount, allowance.currency)}`,
    };
  }
  const m = ex.path.match(SESS);
  if (!m) return null;
  const res = obj(ex.resBody);
  const id = m[1] || res.id;
  let step: string;
  if (m[2]) step = m[2];
  else if (!m[1] && ex.method === "POST") step = "create";
  else if (m[1] && ex.method === "POST") step = "update";
  else step = "get";
  const amount = grandTotal(res);
  const currency = res.currency;
  return {
    protocol: "acp", step, from: "agent", to: "merchant", session: id,
    amount, currency, status: res.status,
    role: step === "complete" ? "payment" : amount !== undefined ? "consent" : "info",
    summary: `${step} → ${res.status ?? ex.status}${amount !== undefined ? `, total ${money(amount, currency)}` : ""}${h["api-version"] ? ` (API ${h["api-version"]})` : ""}`,
  };
};
