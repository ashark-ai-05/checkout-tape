import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("package.json declares the Node and npm versions the npx github: install needs", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    assert.equal(pkg.engines.node, ">=20");
    assert.equal(pkg.engines.npm, ">=10");
});
