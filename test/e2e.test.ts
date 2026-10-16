import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Recorder, startProxy, startUi, loadTape } from "../src/server.js";
import { startMockMerchant, runMockAgent } from "../src/demo.js";
import { diffTapes } from "../src/diff.js";

async function run(honest: boolean, base: number) {
  const out = path.join(os.tmpdir(), `ct-${base}-${Date.now()}.jsonl`);
  const rec = new Recorder(out);
  const m = await startMockMerchant(base + 1, { honest });
  const p = await startProxy({ upstream: `http://127.0.0.1:${base + 1}`, port: base, recorder: rec });
  const u = await startUi({ port: base + 2, recorder: rec });
  await runMockAgent(`http://127.0.0.1:${base}`, 0);
  const ui = await (await fetch(`http://127.0.0.1:${base + 2}/`)).text();
  const api = await (await fetch(`http://127.0.0.1:${base + 2}/api/tape`)).json();
  for (const s of [m, p, u]) s.close();
  return { rec, out, ui, api };
}

test("demo end-to-end: proxy records all 4 protocols, flags the price change, redacts secrets on disk", async () => {
  const { rec, out, ui, api } = await run(false, 18500);
  const protos = new Set(rec.events.map((e) => e.protocol));
  for (const p of ["acp", "ucp", "x402", "mpp"]) assert.ok(protos.has(p as any), `missing ${p}`);
  const bad = rec.events.filter((e) => e.anomalies.length);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].step, "complete");
  assert.equal(bad[0].anomalies[0].code, "PRICE_CHANGED_AFTER_CONSENT");
  const disk = fs.readFileSync(out, "utf8");
  for (const leak of ["4242424242424242", "sk_test_demoAgentKey", "spt_test_4f9a", '"cvc":"123"']) assert.ok(!disk.includes(leak), `tape leaked ${leak}`);
  assert.equal(loadTape(out).length, rec.events.length);
  assert.match(ui, /checkout/);
  assert.equal(api.length, rec.events.length);
});

test("diff: honest vs price-change run differs only at complete", async () => {
  const a = (await run(true, 18510)).rec.events;
  const b = (await run(false, 18520)).rec.events;
  const changed = diffTapes(a, b).filter((r) => r.kind !== "same");
  assert.equal(changed.length, 1);
  assert.equal(changed[0].a!.step, "complete");
  assert.ok(changed[0].notes.some((n) => /24\.00 AUD → 27\.50 AUD/.test(n)));
});
