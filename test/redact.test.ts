import { test } from "node:test";
import assert from "node:assert/strict";
import { redact } from "../src/redact.js";
import { buildTape } from "../src/tape.js";
import { ex, b64 } from "./helpers.js";

test("redacts card numbers, CVC, tokens, auth headers and signed payment headers", () => {
  const r = redact({
    headers: { authorization: "Bearer sk_test_abcdef123456", "x-payment": "eyJhbGciOi", cookie: "s=1" },
    payment_method: { number: "4242424242424242", cvc: "123", card_number_type: "fpan", display_last4: "4242" },
    payment_data: { token: "spt_test_4f9aX2kLmQ81zz" },
    note: "use spt_live_ABCDEFGH or card 4000056655665556 sig 0x" + "ab".repeat(65),
  }) as any;
  const s = JSON.stringify(r);
  for (const leak of ["4242424242424242", "sk_test_abcdef", "spt_test_4f9a", "spt_live_ABCD", "4000056655665556", "abababab", "eyJhbGciOi"]) assert.ok(!s.includes(leak), `leaked ${leak}`);
  assert.equal(r.payment_method.card_number_type, "fpan");
  assert.equal(r.payment_method.display_last4, "4242");
});

test("tape events keep parsed amounts but store redacted exchanges", () => {
  const [ev] = buildTape([ex({ path: "/a", reqHeaders: { "X-PAYMENT": b64({ payload: { signature: "0x" + "ab".repeat(65), authorization: { value: "77" } } }) } })]);
  assert.equal(ev.amount, 77);
  assert.equal(ev.exchange.reqHeaders["X-PAYMENT"], "[REDACTED]");
});
