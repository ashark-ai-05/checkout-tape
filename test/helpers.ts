import type { Exchange } from "../src/types.js";
let id = 0;
export function ex(p: Partial<Exchange>): Exchange {
  return { id: ++id, ts: new Date().toISOString(), method: "GET", path: "/", reqHeaders: {}, reqBody: undefined, status: 200, resHeaders: {}, resBody: undefined, durationMs: 1, ...p };
}
export const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
export const totals = (t: number) => [{ type: "subtotal", amount: t }, { type: "total", amount: t }];
