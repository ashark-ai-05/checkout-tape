import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAcp, parseUcp, parseX402, parseMpp } from "../src/parsers/index.js";
import { parseExchange } from "../src/tape.js";
import { ex, b64, totals } from "./helpers.js";

test("ACP: create / update / complete / cancel / get", () => {
  const c = parseAcp(ex({ method: "POST", path: "/checkout_sessions", reqHeaders: { "API-Version": "2026-04-17" }, resBody: { id: "cs_1", status: "not_ready_for_payment", currency: "usd", totals: totals(1000) } }))!;
  assert.equal(c.step, "create"); assert.equal(c.session, "cs_1"); assert.equal(c.amount, 1000); assert.equal(c.role, "consent");
  assert.match(c.summary, /API 2026-04-17/);
  assert.equal(parseAcp(ex({ method: "POST", path: "/checkout_sessions/cs_1", resBody: { status: "ready_for_complete" } }))!.step, "update");
  const done = parseAcp(ex({ method: "POST", path: "/checkout_sessions/cs_1/complete", resBody: { status: "completed", totals: totals(1200) } }))!;
  assert.equal(done.step, "complete"); assert.equal(done.role, "payment"); assert.equal(done.amount, 1200);
  assert.equal(parseAcp(ex({ method: "POST", path: "/checkout_sessions/cs_1/cancel" }))!.step, "cancel");
  assert.equal(parseAcp(ex({ method: "GET", path: "/checkout_sessions/cs_1" }))!.step, "get");
});

test("ACP: delegate_payment reads the allowance", () => {
  const d = parseAcp(ex({ method: "POST", path: "/agentic_commerce/delegate_payment", reqBody: { allowance: { max_amount: 2400, currency: "aud", checkout_session_id: "cs_9" } } }))!;
  assert.equal(d.to, "psp"); assert.equal(d.session, "cs_9"); assert.equal(d.amount, 2400); assert.equal(d.role, "payment");
});

test("ACP: ignores unrelated paths and UCP hyphen paths", () => {
  assert.equal(parseAcp(ex({ path: "/products" })), null);
  assert.equal(parseAcp(ex({ path: "/checkout-sessions" })), null);
});

test("UCP: discovery and checkout-sessions lifecycle", () => {
  const d = parseUcp(ex({ path: "/.well-known/ucp", resBody: { ucp: { capabilities: [{ name: "dev.ucp.shopping.checkout" }] } } }))!;
  assert.equal(d.step, "discovery"); assert.match(d.summary, /1 capabilities/);
  const c = parseUcp(ex({ method: "POST", path: "/checkout-sessions", resBody: { id: "chk_1", status: "incomplete", currency: "USD", totals: totals(500) } }))!;
  assert.equal(c.step, "create"); assert.equal(c.session, "chk_1"); assert.equal(c.amount, 500);
  const u = parseUcp(ex({ method: "PUT", path: "/checkout-sessions/chk_1", resBody: { status: "requires_escalation" } }))!;
  assert.equal(u.step, "update"); assert.match(u.summary, /escalation/);
  assert.equal(parseUcp(ex({ method: "POST", path: "/checkout-sessions/chk_1/complete", resBody: { status: "completed" } }))!.role, "payment");
  assert.equal(parseUcp(ex({ path: "/checkout_sessions" })), null);
});

test("x402 v1: 402 challenge body and X-PAYMENT retry with settlement", () => {
  const ch = parseX402(ex({ status: 402, path: "/api/w", resBody: { x402Version: 1, accepts: [{ scheme: "exact", network: "base-sepolia", maxAmountRequired: "10000", asset: "0xabc" }] } }))!;
  assert.equal(ch.step, "challenge"); assert.equal(ch.amount, 10000); assert.match(ch.summary, /base-sepolia/);
  const pay = parseX402(ex({ path: "/api/w", reqHeaders: { "X-PAYMENT": b64({ payload: { authorization: { value: "10000" } } }) }, resHeaders: { "X-PAYMENT-RESPONSE": b64({ success: true, transaction: "0x1234567890abcdef" }) } }))!;
  assert.equal(pay.step, "pay"); assert.equal(pay.amount, 10000); assert.equal(pay.status, "settled"); assert.equal(pay.session, "/api/w");
});

test("x402 v2: PAYMENT-REQUIRED / PAYMENT-SIGNATURE headers", () => {
  const ch = parseX402(ex({ status: 402, resHeaders: { "payment-required": b64({ x402Version: 2, accepts: [{ amount: "500", network: "eip155:84532" }] }) } }))!;
  assert.equal(ch.amount, 500);
  const pay = parseX402(ex({ reqHeaders: { "payment-signature": b64({ accepted: { amount: "500" } }) }, resHeaders: { "payment-response": b64({ success: false }) } }))!;
  assert.equal(pay.amount, 500); assert.equal(pay.status, "failed");
});

test("x402: non-x402 402 is not claimed", () => {
  assert.equal(parseX402(ex({ status: 402, resBody: { error: "nope" } })), null);
});

test("MPP: WWW-Authenticate Payment challenge and Authorization: Payment credential", () => {
  const request = Buffer.from(JSON.stringify({ amount: "50", currency: "usd" })).toString("base64url");
  const ch = parseMpp(ex({ status: 402, resHeaders: { "WWW-Authenticate": `Payment id="c1", method="tempo", intent="charge", request="${request}"` } }))!;
  assert.equal(ch.step, "challenge"); assert.equal(ch.amount, 50); assert.equal(ch.currency, "usd"); assert.match(ch.summary, /tempo\/charge/);
  const cred = Buffer.from(JSON.stringify({ challenge: { request } })).toString("base64url");
  const pay = parseMpp(ex({ reqHeaders: { Authorization: `Payment ${cred}` }, resHeaders: { "payment-receipt": "r1" } }))!;
  assert.equal(pay.amount, 50); assert.equal(pay.status, "receipt");
  assert.equal(parseMpp(ex({ reqHeaders: { Authorization: "Bearer x" } })), null);
});

test("unknown traffic falls through to a generic event", () => {
  const e = parseExchange(ex({ method: "GET", path: "/health" }));
  assert.equal(e.protocol, "unknown");
});
