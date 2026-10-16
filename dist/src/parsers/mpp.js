import { b64json, lower, obj } from "../util.js";
// Machine Payments Protocol (Stripe + Tempo): HTTP 402 with `WWW-Authenticate: Payment ...` challenge,
// client retries with `Authorization: Payment <credential>`, server returns `Payment-Receipt`.
// Best-effort parser: reads `request=` (base64url JSON) for amount/currency.
function params(h) {
    const o = {};
    for (const m of h.matchAll(/(\w+)="?([^",]+)"?/g))
        o[m[1]] = m[2];
    return o;
}
export const parseMpp = (ex) => {
    const h = lower(ex.reqHeaders);
    const rh = lower(ex.resHeaders);
    const www = rh["www-authenticate"];
    if (ex.status === 402 && www && /^Payment\b/i.test(www)) {
        const p = params(www.replace(/^Payment\s*/i, ""));
        const r = obj(b64json(p.request));
        const amount = r.amount !== undefined ? Number(r.amount) : undefined;
        return {
            protocol: "mpp", step: "challenge", from: "merchant", to: "agent", session: ex.path,
            amount, currency: r.currency, role: "consent",
            summary: `MPP challenge (${p.method ?? "?"}/${p.intent ?? "?"}): ${amount ?? "?"} ${r.currency ?? ""}`.trim(),
        };
    }
    const auth = h["authorization"];
    if (auth && /^Payment\b/i.test(auth)) {
        const cred = obj(b64json(auth.replace(/^Payment\s*/i, "").trim()));
        const r = obj(b64json(obj(cred.challenge).request));
        const amount = r.amount !== undefined ? Number(r.amount) : undefined;
        const receipt = rh["payment-receipt"];
        return {
            protocol: "mpp", step: "pay", from: "agent", to: "psp", session: ex.path,
            amount, currency: r.currency, role: "payment", status: receipt ? "receipt" : String(ex.status),
            summary: `MPP credential presented → HTTP ${ex.status}${receipt ? " (receipt issued)" : ""}`,
        };
    }
    return null;
};
