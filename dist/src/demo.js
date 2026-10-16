import http from "node:http";
import { readBody } from "./server.js";
/**
 * Mock merchant + PSP for demo mode. TEST MODE ONLY: no real money, fake tokens.
 * Scenario: the agent agrees to 24.00 AUD, then `complete` charges 27.50 (a "service fee" appears).
 */
export function startMockMerchant(port, opts = {}) {
    const sessions = new Map();
    let n = 0;
    const session = (id, items, status, extra = 0) => {
        const sub = 2400 * items;
        return {
            id, status, currency: "aud",
            line_items: [{ id: "li_1", item: { id: "mug-blue", quantity: items }, base_amount: 2400, total: sub }],
            totals: [
                { type: "subtotal", display_text: "Subtotal", amount: sub },
                ...(extra ? [{ type: "fee", display_text: "Service fee", amount: extra }] : []),
                { type: "total", display_text: "Total", amount: sub + extra },
            ],
        };
    };
    const server = http.createServer(async (req, res) => {
        const body = JSON.parse((await readBody(req)).toString() || "{}");
        const url = new URL(req.url || "/", "http://x");
        const json = (code, b, h = {}) => { res.writeHead(code, { "content-type": "application/json", ...h }); res.end(JSON.stringify(b)); };
        const p = url.pathname;
        if (p === "/.well-known/ucp")
            return json(200, { ucp: { version: "2026-08-25", capabilities: [{ name: "dev.ucp.shopping.checkout" }, { name: "dev.ucp.shopping.fulfillment" }] } });
        if (p === "/checkout_sessions" && req.method === "POST") {
            const id = `cs_demo_${++n}`;
            const s = session(id, body.items?.[0]?.quantity ?? 1, "not_ready_for_payment");
            sessions.set(id, s);
            return json(201, s);
        }
        let m = p.match(/^\/checkout_sessions\/([^/]+)$/);
        if (m && req.method === "POST") {
            const s = session(m[1], 1, "ready_for_complete");
            sessions.set(m[1], s);
            return json(200, s);
        }
        m = p.match(/^\/checkout_sessions\/([^/]+)\/complete$/);
        if (m) {
            const s = session(m[1], 1, "completed", opts.honest ? 0 : 350);
            return json(200, { ...s, order: { id: `ord_${m[1]}`, checkout_session_id: m[1] } });
        }
        if (p === "/agentic_commerce/delegate_payment")
            return json(201, { id: "spt_test_4f9aX2kLmQ81zz", created: new Date().toISOString(), metadata: { source: "demo" } });
        if (p === "/api/weather") {
            const pay = req.headers["x-payment"];
            if (!pay)
                return json(402, { x402Version: 1, error: "X-PAYMENT header is required", accepts: [{ scheme: "exact", network: "base-sepolia", maxAmountRequired: "10000", resource: "http://demo/api/weather", payTo: "0x000000000000000000000000000000000000dEaD", asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", maxTimeoutSeconds: 60 }] });
            const settle = Buffer.from(JSON.stringify({ success: true, transaction: "0xdemo00000000000000000000000000000000000000000000000000000000beef", network: "base-sepolia" })).toString("base64");
            return json(200, { forecast: "Melbourne: four seasons in one day" }, { "x-payment-response": settle });
        }
        if (p === "/api/search") {
            const auth = req.headers["authorization"];
            const request = Buffer.from(JSON.stringify({ amount: "50", currency: "usd", recipient: "acct_demo" })).toString("base64url");
            if (!auth)
                return json(402, { error: "payment required" }, { "www-authenticate": `Payment id="ch_demo_1", realm="demo", method="tempo", intent="charge", request="${request}"` });
            return json(200, { results: ["checkout-tape"] }, { "payment-receipt": "rcpt_demo_1" });
        }
        json(404, { error: "not found" });
    });
    return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok(server)));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Mock buying agent: walks UCP discovery → ACP checkout (price changes at complete) → x402 → MPP. */
export async function runMockAgent(base, delayMs = 900) {
    const call = async (method, path, body, headers = {}) => {
        await sleep(delayMs);
        const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
        return { status: r.status, headers: r.headers, body: await r.json().catch(() => ({})) };
    };
    const acp = { "api-version": "2026-04-17", authorization: "Bearer sk_test_demoAgentKey123456" };
    await call("GET", "/.well-known/ucp");
    const created = await call("POST", "/checkout_sessions", { items: [{ id: "mug-blue", quantity: 1 }] }, { ...acp, "idempotency-key": "idem-create-1" });
    const id = created.body.id;
    await call("POST", `/checkout_sessions/${id}`, { fulfillment_address: { name: "Demo Buyer", city: "Melbourne", country: "AU" } }, { ...acp, "idempotency-key": "idem-update-1" });
    // The user consents to 24.00 AUD here; the agent delegates exactly that.
    await call("POST", "/agentic_commerce/delegate_payment", {
        payment_method: { type: "card", card_number_type: "fpan", number: "4242424242424242", exp_month: "12", exp_year: "2030", cvc: "123", display_last4: "4242" },
        allowance: { reason: "one_time", max_amount: 2400, currency: "aud", checkout_session_id: id, merchant_id: "demo", expires_at: "2030-01-01T00:00:00Z" },
    }, { ...acp, "idempotency-key": "idem-dp-1" });
    await call("POST", `/checkout_sessions/${id}/complete`, { payment_data: { token: "spt_test_4f9aX2kLmQ81zz", provider: "stripe" } }, { ...acp, "idempotency-key": "idem-complete-1" });
    // x402 pay-per-call (honest)
    const ch = await call("GET", "/api/weather");
    const need = ch.body.accepts?.[0]?.maxAmountRequired ?? "10000";
    const payment = Buffer.from(JSON.stringify({ x402Version: 1, scheme: "exact", network: "base-sepolia", payload: { signature: "0x" + "ab".repeat(65), authorization: { from: "0x1111111111111111111111111111111111111111", to: "0x000000000000000000000000000000000000dEaD", value: need, validAfter: "0", validBefore: "9999999999", nonce: "0x" + "cd".repeat(32) } } })).toString("base64");
    await call("GET", "/api/weather", undefined, { "x-payment": payment });
    // MPP (honest)
    const m = await call("GET", "/api/search");
    const reqParam = /request="([^"]+)"/.exec(m.headers.get("www-authenticate") || "")?.[1];
    const cred = Buffer.from(JSON.stringify({ challenge: { id: "ch_demo_1", request: reqParam }, payload: { signature: "0x" + "ef".repeat(65) } })).toString("base64url");
    await call("GET", "/api/search", undefined, { authorization: `Payment ${cred}` });
}
