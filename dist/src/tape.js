import { PARSERS } from "./parsers/index.js";
import { lower, money } from "./util.js";
import { redact } from "./redact.js";
export function parseExchange(ex) {
    for (const p of PARSERS) {
        const r = p(ex);
        if (r)
            return { ...r, id: ex.id, ts: ex.ts, exchange: ex };
    }
    return {
        id: ex.id, ts: ex.ts, exchange: ex, protocol: "unknown", step: ex.method.toLowerCase(),
        from: "agent", to: "merchant", role: "info", summary: `${ex.method} ${ex.path} → ${ex.status}`,
    };
}
/** Stateful anomaly detector: feed events in order. */
export class Detector {
    sessions = new Map();
    idem = new Map();
    check(ev) {
        const out = [];
        const h = lower(ev.exchange.reqHeaders);
        const key = h["idempotency-key"];
        if (key && ev.exchange.method !== "GET") {
            const body = JSON.stringify(ev.exchange.reqBody ?? null);
            const sig = `${ev.exchange.method} ${ev.exchange.path}|${body}`;
            const prev = this.idem.get(key);
            if (prev !== undefined && prev !== sig)
                out.push({ code: "IDEMPOTENCY_KEY_REUSED", severity: "high", message: `Idempotency-Key ${key} reused with a different request` });
            else
                this.idem.set(key, sig);
        }
        if (!ev.session)
            return out;
        const famProto = ev.protocol === "acp" || ev.protocol === "ucp" ? "checkout" : ev.protocol;
        const sk = `${famProto}:${ev.session}`;
        const st = this.sessions.get(sk) ?? {};
        this.sessions.set(sk, st);
        if (ev.role === "consent" && ev.amount !== undefined) {
            st.consent = { amount: ev.amount, currency: ev.currency, eventId: ev.id };
        }
        else if (ev.role === "payment" && ev.amount !== undefined && st.consent) {
            const c = st.consent;
            if (ev.step === "delegate_payment") {
                if (ev.amount > c.amount)
                    out.push({ code: "ALLOWANCE_EXCEEDS_CONSENT", severity: "medium", message: `Delegated allowance ${money(ev.amount, ev.currency)} is above the consented total ${money(c.amount, c.currency)}` });
            }
            else if (ev.amount !== c.amount) {
                const isX = ev.protocol === "x402" || ev.protocol === "mpp";
                if (!isX || ev.amount > c.amount)
                    out.push({
                        code: "PRICE_CHANGED_AFTER_CONSENT", severity: "high",
                        message: isX
                            ? `Paid ${ev.amount} but the challenge asked for ${c.amount} (event #${c.eventId})`
                            : `Total changed ${money(c.amount, c.currency)} → ${money(ev.amount, ev.currency)} after consent (event #${c.eventId})`,
                    });
            }
            if (ev.currency && c.currency && ev.currency.toLowerCase() !== c.currency.toLowerCase())
                out.push({ code: "CURRENCY_CHANGED", severity: "high", message: `Currency changed ${c.currency} → ${ev.currency}` });
        }
        if (ev.step === "complete" && st.status && st.status !== "ready_for_complete" && !/^complete/.test(st.status))
            out.push({ code: "COMPLETE_BEFORE_READY", severity: "medium", message: `Complete called while session was '${st.status}'` });
        if (ev.status && ev.step !== "complete")
            st.status = ev.status;
        return out;
    }
}
/** Redact, parse and flag a batch of raw exchanges (used by replay and tests). */
export function buildTape(exchanges) {
    const d = new Detector();
    return exchanges.map((raw) => {
        const ev = parseExchange(raw);
        const anomalies = d.check(ev);
        return { ...ev, exchange: redactExchange(raw), anomalies };
    });
}
export function redactExchange(ex) {
    // Parse on raw values first so amounts inside signed payment headers survive, then redact for storage.
    return { ...ex, reqHeaders: redact(ex.reqHeaders), reqBody: redact(ex.reqBody), resHeaders: redact(ex.resHeaders), resBody: redact(ex.resBody) };
}
