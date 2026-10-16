import type { TapeEvent } from "./types.js";
import { money } from "./util.js";

export interface DiffRow { kind: "same" | "changed" | "added" | "removed"; a?: TapeEvent; b?: TapeEvent; notes: string[] }

const key = (e: TapeEvent) => `${e.protocol}:${e.step}`;

/** Align two tapes by protocol+step order and report what differs (amounts, statuses, anomalies). */
export function diffTapes(a: TapeEvent[], b: TapeEvent[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let j = 0;
  for (let i = 0; i < a.length; i++) {
    const ea = a[i];
    let k = j;
    while (k < b.length && key(b[k]) !== key(ea)) k++;
    if (k >= b.length) { rows.push({ kind: "removed", a: ea, notes: ["only in A"] }); continue; }
    for (; j < k; j++) rows.push({ kind: "added", b: b[j], notes: ["only in B"] });
    const eb = b[j++];
    const notes: string[] = [];
    if (ea.amount !== eb.amount) notes.push(`amount ${money(ea.amount, ea.currency) || "-"} → ${money(eb.amount, eb.currency) || "-"}`);
    if (ea.status !== eb.status) notes.push(`status ${ea.status ?? "-"} → ${eb.status ?? "-"}`);
    if (ea.exchange.status !== eb.exchange.status) notes.push(`HTTP ${ea.exchange.status} → ${eb.exchange.status}`);
    const an = (e: TapeEvent) => e.anomalies.map((x) => x.code).sort().join(",");
    if (an(ea) !== an(eb)) notes.push(`anomalies [${an(ea)}] → [${an(eb)}]`);
    rows.push({ kind: notes.length ? "changed" : "same", a: ea, b: eb, notes });
  }
  for (; j < b.length; j++) rows.push({ kind: "added", b: b[j], notes: ["only in B"] });
  return rows;
}

export function formatDiff(rows: DiffRow[]): string {
  const sym = { same: " ", changed: "~", added: "+", removed: "-" } as const;
  return rows.map((r) => {
    const e = (r.a ?? r.b)!;
    return `${sym[r.kind]} ${e.protocol.padEnd(5)} ${e.step.padEnd(17)} ${r.notes.join("; ")}`;
  }).join("\n");
}
