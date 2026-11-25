import assert from "node:assert/strict";
import { test } from "node:test";
import { checkSefin } from "../lib/sefin-status.ts";

test("reports independent SEFIN responses for production and homologation", async () => {
  const [production, homologation] = await Promise.all([
    checkSefin("production", async () => 200),
    checkSefin("homologation", async () => 403),
  ]);
  assert.equal(production.tone, "available");
  assert.equal(production.detail, "online");
  assert.equal(homologation.tone, "unstable");
  assert.equal(homologation.detail, "indisponível — HTTP 403 externo");
  assert.ok(Number.isFinite(Date.parse(homologation.checkedAt)));
  assert.equal((await checkSefin("production", async () => 403)).tone, "unavailable");
});

test("marks HTTP 5xx and timeouts as unavailable", async () => {
  for (const environment of ["production", "homologation"] as const) {
    assert.equal((await checkSefin(environment, async () => 503)).tone, "unavailable");
    const timeout = await checkSefin(environment, async () => {
      throw new DOMException("Timed out", "AbortError");
    });
    assert.equal(timeout.tone, "unavailable");
    assert.match(timeout.detail, /tempo limite/);
    assert.equal((await checkSefin(environment, async () => 405)).tone, "unknown");
  }
});
