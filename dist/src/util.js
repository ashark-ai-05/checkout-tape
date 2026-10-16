export function lower(h) {
    const o = {};
    for (const [k, v] of Object.entries(h || {}))
        o[k.toLowerCase()] = String(v);
    return o;
}
export function obj(x) {
    return x && typeof x === "object" ? x : {};
}
/** Pull the grand total (minor units) from an ACP/UCP style `totals` array. */
export function grandTotal(body) {
    const totals = obj(body).totals;
    if (!Array.isArray(totals))
        return undefined;
    const t = totals.find((x) => x && x.type === "total");
    return t && typeof t.amount === "number" ? t.amount : undefined;
}
export function b64json(s) {
    if (!s)
        return undefined;
    try {
        const norm = s.replace(/-/g, "+").replace(/_/g, "/");
        return JSON.parse(Buffer.from(norm, "base64").toString("utf8"));
    }
    catch {
        return undefined;
    }
}
export function money(amount, currency) {
    if (amount === undefined)
        return "";
    return `${(amount / 100).toFixed(2)} ${(currency || "").toUpperCase()}`.trim();
}
