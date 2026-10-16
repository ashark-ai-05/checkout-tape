import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTape } from "../src/tape.js";
import { ex, b64, totals } from "./helpers.js";
const acpFlow = (completeTotal, extra = []) => [
    ex({ method: "POST", path: "/checkout_sessions", resBody: { id: "cs_1", status: "not_ready_for_payment", currency: "aud", totals: totals(2400) } }),
    ex({ method: "POST", path: "/checkout_sessions/cs_1", resBody: { id: "cs_1", status: "ready_for_complete", currency: "aud", totals: totals(2400) } }),
    ...extra,
    ex({ method: "POST", path: "/checkout_sessions/cs_1/complete", resBody: { id: "cs_1", status: "completed", currency: "aud", totals: totals(completeTotal) } }),
];
const codes = (t) => t.flatMap((e) => e.anomalies.map((a) => a.code));
test("headline: price changed between consent and payment is flagged on the complete step", () => {
    const t = buildTape(acpFlow(2750));
    const last = t[t.length - 1];
    assert.deepEqual(last.anomalies.map((a) => a.code), ["PRICE_CHANGED_AFTER_CONSENT"]);
    assert.equal(last.anomalies[0].severity, "high");
    assert.match(last.anomalies[0].message, /24\.00 AUD → 27\.50 AUD/);
});
test("honest checkout produces no anomalies", () => {
    assert.deepEqual(codes(buildTape(acpFlow(2400))), []);
});
test("price drop is still flagged for checkout protocols (total differs from consent)", () => {
    assert.deepEqual(codes(buildTape(acpFlow(2000))), ["PRICE_CHANGED_AFTER_CONSENT"]);
});
test("UCP sessions are tracked the same way", () => {
    const t = buildTape([
        ex({ method: "POST", path: "/checkout-sessions", resBody: { id: "u1", status: "ready_for_complete", currency: "USD", totals: totals(900) } }),
        ex({ method: "POST", path: "/checkout-sessions/u1/complete", resBody: { id: "u1", status: "completed", currency: "USD", totals: totals(990) } }),
    ]);
    assert.deepEqual(codes(t), ["PRICE_CHANGED_AFTER_CONSENT"]);
});
test("delegated allowance above consented total is flagged", () => {
    const dp = ex({ method: "POST", path: "/agentic_commerce/delegate_payment", reqBody: { allowance: { max_amount: 5000, currency: "aud", checkout_session_id: "cs_1" } } });
    assert.ok(codes(buildTape(acpFlow(2400, [dp]))).includes("ALLOWANCE_EXCEEDS_CONSENT"));
});
test("complete before ready_for_complete is flagged", () => {
    const t = buildTape([
        ex({ method: "POST", path: "/checkout_sessions", resBody: { id: "cs_2", status: "not_ready_for_payment", currency: "aud", totals: totals(100) } }),
        ex({ method: "POST", path: "/checkout_sessions/cs_2/complete", resBody: { id: "cs_2", status: "completed", currency: "aud", totals: totals(100) } }),
    ]);
    assert.deepEqual(codes(t), ["COMPLETE_BEFORE_READY"]);
});
test("currency switch is flagged", () => {
    const t = buildTape([
        ex({ method: "POST", path: "/checkout_sessions", resBody: { id: "c3", status: "ready_for_complete", currency: "aud", totals: totals(100) } }),
        ex({ method: "POST", path: "/checkout_sessions/c3/complete", resBody: { id: "c3", status: "completed", currency: "usd", totals: totals(100) } }),
    ]);
    assert.deepEqual(codes(t), ["CURRENCY_CHANGED"]);
});
test("idempotency key reused with a different body is flagged", () => {
    const t = buildTape([
        ex({ method: "POST", path: "/checkout_sessions", reqHeaders: { "Idempotency-Key": "k1" }, reqBody: { q: 1 } }),
        ex({ method: "POST", path: "/checkout_sessions", reqHeaders: { "Idempotency-Key": "k1" }, reqBody: { q: 1 } }),
        ex({ method: "POST", path: "/checkout_sessions", reqHeaders: { "Idempotency-Key": "k1" }, reqBody: { q: 2 } }),
    ]);
    assert.deepEqual(codes(t), ["IDEMPOTENCY_KEY_REUSED"]);
});
test("x402: paying more than the challenge is flagged; paying the asked amount is not", () => {
    const ch = () => ex({ status: 402, path: "/a", resBody: { x402Version: 1, accepts: [{ maxAmountRequired: "100" }] } });
    const pay = (v) => ex({ path: "/a", reqHeaders: { "x-payment": b64({ payload: { authorization: { value: v } } }) } });
    assert.deepEqual(codes(buildTape([ch(), pay("100")])), []);
    assert.deepEqual(codes(buildTape([ch(), pay("150")])), ["PRICE_CHANGED_AFTER_CONSENT"]);
});
