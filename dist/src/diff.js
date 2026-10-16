import { money } from "./util.js";
const key = (e) => `${e.protocol}:${e.step}`;
/** Align two tapes by protocol+step order and report what differs (amounts, statuses, anomalies). */
export function diffTapes(a, b) {
    const rows = [];
    let j = 0;
    for (let i = 0; i < a.length; i++) {
        const ea = a[i];
        let k = j;
        while (k < b.length && key(b[k]) !== key(ea))
            k++;
        if (k >= b.length) {
            rows.push({ kind: "removed", a: ea, notes: ["only in A"] });
            continue;
        }
        for (; j < k; j++)
            rows.push({ kind: "added", b: b[j], notes: ["only in B"] });
        const eb = b[j++];
        const notes = [];
        if (ea.amount !== eb.amount)
            notes.push(`amount ${money(ea.amount, ea.currency) || "-"} → ${money(eb.amount, eb.currency) || "-"}`);
        if (ea.status !== eb.status)
            notes.push(`status ${ea.status ?? "-"} → ${eb.status ?? "-"}`);
        if (ea.exchange.status !== eb.exchange.status)
            notes.push(`HTTP ${ea.exchange.status} → ${eb.exchange.status}`);
        const an = (e) => e.anomalies.map((x) => x.code).sort().join(",");
        if (an(ea) !== an(eb))
            notes.push(`anomalies [${an(ea)}] → [${an(eb)}]`);
        rows.push({ kind: notes.length ? "changed" : "same", a: ea, b: eb, notes });
    }
    for (; j < b.length; j++)
        rows.push({ kind: "added", b: b[j], notes: ["only in B"] });
    return rows;
}
export function formatDiff(rows) {
    const sym = { same: " ", changed: "~", added: "+", removed: "-" };
    return rows.map((r) => {
        const e = (r.a ?? r.b);
        return `${sym[r.kind]} ${e.protocol.padEnd(5)} ${e.step.padEnd(17)} ${r.notes.join("; ")}`;
    }).join("\n");
}
