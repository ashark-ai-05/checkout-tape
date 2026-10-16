import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Detector, parseExchange, redactExchange } from "./tape.js";
import { diffTapes } from "./diff.js";
const UI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../ui");
export function readBody(req) {
    return new Promise((res, rej) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => res(Buffer.concat(chunks)));
        req.on("error", rej);
    });
}
const tryJson = (b) => {
    if (!b.length)
        return undefined;
    try {
        return JSON.parse(b.toString("utf8"));
    }
    catch {
        return b.toString("utf8").slice(0, 4000);
    }
};
const flat = (h) => {
    const o = {};
    for (const [k, v] of Object.entries(h))
        if (v !== undefined)
            o[k] = Array.isArray(v) ? v.join(", ") : String(v);
    return o;
};
export class Recorder {
    outFile;
    events = [];
    detector = new Detector();
    clients = new Set();
    nextId = 1;
    constructor(outFile) {
        this.outFile = outFile;
        if (outFile)
            fs.writeFileSync(outFile, "");
    }
    record(raw) {
        const ex = { ...raw, id: this.nextId++ };
        const ev0 = parseExchange(ex);
        const anomalies = this.detector.check(ev0);
        const ev = { ...ev0, exchange: redactExchange(ex), anomalies };
        this.events.push(ev);
        if (this.outFile)
            fs.appendFileSync(this.outFile, JSON.stringify(ev) + "\n");
        const line = `data: ${JSON.stringify(ev)}\n\n`;
        for (const c of this.clients)
            c.write(line);
        return ev;
    }
    subscribe(res) {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        for (const ev of this.events)
            res.write(`data: ${JSON.stringify(ev)}\n\n`);
        this.clients.add(res);
        res.on("close", () => this.clients.delete(res));
    }
}
/** Reverse proxy: agent → this → upstream merchant/PSP. Records each request/response pair. */
export function startProxy(opts) {
    const up = new URL(opts.upstream);
    const server = http.createServer(async (req, res) => {
        const started = Date.now();
        const body = await readBody(req);
        const target = new URL(req.url || "/", up);
        const headers = flat(req.headers);
        delete headers.host;
        delete headers["content-length"];
        try {
            const r = await fetch(target, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method || "") ? undefined : new Uint8Array(body), redirect: "manual" });
            const buf = Buffer.from(await r.arrayBuffer());
            const resHeaders = {};
            r.headers.forEach((v, k) => { if (!["content-encoding", "transfer-encoding", "content-length", "connection"].includes(k))
                resHeaders[k] = v; });
            res.writeHead(r.status, resHeaders);
            res.end(buf);
            opts.recorder.record({
                ts: new Date().toISOString(), method: req.method || "GET", path: target.pathname + target.search,
                reqHeaders: headers, reqBody: tryJson(body), status: r.status, resHeaders, resBody: tryJson(buf), durationMs: Date.now() - started,
            });
        }
        catch (e) {
            res.writeHead(502, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "checkout-tape: upstream unreachable", detail: String(e) }));
        }
    });
    return new Promise((ok) => server.listen(opts.port, opts.host ?? "127.0.0.1", () => ok(server)));
}
/** UI server: static timeline + SSE stream + diff API. */
export function startUi(opts) {
    const server = http.createServer((req, res) => {
        const u = new URL(req.url || "/", "http://x");
        if (u.pathname === "/events")
            return opts.recorder.subscribe(res);
        if (u.pathname === "/api/tape") {
            res.writeHead(200, { "content-type": "application/json" });
            return res.end(JSON.stringify(opts.recorder.events));
        }
        if (u.pathname === "/api/diff") {
            res.writeHead(200, { "content-type": "application/json" });
            return res.end(JSON.stringify(opts.diffWith ? diffTapes(opts.diffWith, opts.recorder.events) : null));
        }
        const file = u.pathname === "/" ? "index.html" : path.basename(u.pathname);
        const p = path.join(UI_DIR, file);
        if (!fs.existsSync(p)) {
            res.writeHead(404);
            return res.end("not found");
        }
        const type = file.endsWith(".html") ? "text/html" : file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "application/octet-stream";
        res.writeHead(200, { "content-type": type });
        fs.createReadStream(p).pipe(res);
    });
    return new Promise((ok) => server.listen(opts.port, opts.host ?? "127.0.0.1", () => ok(server)));
}
export function loadTape(file) {
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
