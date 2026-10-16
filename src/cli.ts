import { Recorder, loadTape, startProxy, startUi } from "./server.js";
import { startMockMerchant, runMockAgent } from "./demo.js";
import { diffTapes, formatDiff } from "./diff.js";
import type { TapeEvent } from "./types.js";

const HELP = `checkout-tape: Wireshark for agent checkouts (ACP, UCP, x402, Stripe MPP). Test mode only.

Usage:
  checkout-tape demo [--honest]                    zero-setup demo (mock agent + mock merchant)
  checkout-tape --upstream <url> [--port 8402]     record: point your agent at http://localhost:8402
               [--ui-port 8403] [--out tape.jsonl]
  checkout-tape replay <tape.jsonl>                open a saved tape in the timeline
  checkout-tape diff <a.jsonl> <b.jsonl> [--ui]    compare two runs
`;

function flag(args: string[], name: string, def?: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
}
const print = (ev: TapeEvent) => {
  const red = ev.anomalies.length ? "\x1b[31m" : "";
  console.log(`${red}#${String(ev.id).padStart(2)} ${ev.protocol.padEnd(5)} ${ev.from}→${ev.to} ${ev.summary}\x1b[0m`);
  for (const a of ev.anomalies) console.log(`\x1b[31m    ⚠ ${a.code}: ${a.message}\x1b[0m`);
};

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const port = Number(flag(args, "--port", "8402"));
  const uiPort = Number(flag(args, "--ui-port", "8403"));
  if (cmd === "demo") {
    const rec = new Recorder(flag(args, "--out", "checkout-tape-demo.jsonl"));
    const mport = port + 10;
    await startMockMerchant(mport, { honest: args.includes("--honest") });
    await startProxy({ upstream: `http://127.0.0.1:${mport}`, port, recorder: rec });
    await startUi({ port: uiPort, recorder: rec });
    console.log(`checkout-tape demo (TEST MODE, fake money)\n  timeline: http://localhost:${uiPort}\n  starting mock agent…`);
    const orig = rec.record.bind(rec);
    rec.record = (x) => { const e = orig(x); print(e); return e; };
    await new Promise((r) => setTimeout(r, Number(process.env.CT_DEMO_START_MS ?? 3000)));
    await runMockAgent(`http://127.0.0.1:${port}`, Number(process.env.CT_DEMO_DELAY_MS ?? 900));
    console.log(`\nDone. Tape saved. Ctrl-C to quit (timeline stays up for replay).`);
    if (args.includes("--exit")) process.exit(0);
    return;
  }
  if (cmd === "replay") {
    const rec = new Recorder();
    rec.events = loadTape(args[1]);
    await startUi({ port: uiPort, recorder: rec });
    rec.events.forEach(print);
    console.log(`replaying ${rec.events.length} events: http://localhost:${uiPort}`);
    return;
  }
  if (cmd === "diff") {
    const a = loadTape(args[1]), b = loadTape(args[2]);
    console.log(formatDiff(diffTapes(a, b)));
    if (args.includes("--ui")) {
      const rec = new Recorder(); rec.events = b;
      await startUi({ port: uiPort, recorder: rec, diffWith: a });
      console.log(`diff view: http://localhost:${uiPort}/?diff=1`);
    }
    return;
  }
  const upstream = flag(args, "--upstream");
  if (!upstream || cmd === "help" || args.includes("-h") || args.includes("--help")) { console.log(HELP); return; }
  const rec = new Recorder(flag(args, "--out", `checkout-tape-${Date.now()}.jsonl`));
  rec.record = ((orig) => (x: any) => { const e = orig(x); print(e); return e; })(rec.record.bind(rec));
  await startProxy({ upstream, port, recorder: rec });
  await startUi({ port: uiPort, recorder: rec });
  console.log(`recording ${upstream}\n  agent base URL: http://localhost:${port}\n  timeline:       http://localhost:${uiPort}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
