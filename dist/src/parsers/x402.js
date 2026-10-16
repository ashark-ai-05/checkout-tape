import { b64json, lower, obj } from "../util.js";
// x402: 402 + {x402Version, accepts:[...]} (v1) or PAYMENT-REQUIRED header (v2);
// client retries with X-PAYMENT (v1) / PAYMENT-SIGNATURE (v2); server answers X-PAYMENT-RESPONSE / PAYMENT-RESPONSE.
function req0(ex) {
    const rh = lower(ex.resHeaders);
    const body = obj(ex.resBody);
    const fromHeader = b64json(rh["payment-required"]);
    const src = body.x402Version !== undefined ? body : obj(fromHeader);
    const accepts = Array.isArray(src.accepts) ? src.accepts : [];
    return { version: src.x402Version, first: obj(accepts[0]) };
}
const atomic = (v) => (v === undefined ? undefined : Number(v));
export const parseX402 = (ex) => {
    const h = lower(ex.reqHeaders);
    const rh = lower(ex.resHeaders);
    const payHeader = h["x-payment"] ?? h["payment-signature"];
    const { version, first } = req0(ex);
    if (ex.status === 402 && version !== undefined && !payHeader) {
        const amt = atomic(first.maxAmountRequired ?? first.amount);
        return {
            protocol: "x402", step: "challenge", from: "merchant", to: "agent", session: ex.path,
            amount: amt, currency: first.asset ? "usdc-atomic" : undefined, role: "consent",
            summary: `402 Payment Required: ${amt ?? "?"} atomic units on ${first.network ?? "?"} (${first.scheme ?? "?"})`,
        };
    }
    if (payHeader) {
        const p = obj(b64json(payHeader));
        const auth = obj(obj(p.payload).authorization);
        const amt = atomic(auth.value ?? obj(p.accepted).amount);
        const settle = obj(b64json(rh["x-payment-response"] ?? rh["payment-response"]));
        return {
            protocol: "x402", step: "pay", from: "agent", to: "psp", session: ex.path,
            amount: amt, currency: "usdc-atomic", role: "payment",
            status: settle.success === undefined ? String(ex.status) : settle.success ? "settled" : "failed",
            summary: `Paid with signed authorization: ${amt ?? "?"} atomic units → HTTP ${ex.status}${settle.transaction ? `, tx ${String(settle.transaction).slice(0, 10)}…` : ""}`,
        };
    }
    return null;
};
