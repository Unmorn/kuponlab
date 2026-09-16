import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";

const env = {
  ASSETS: { fetch: async () => new Response("asset", { status: 200 }) }
};
const ctx = { waitUntil() {} };
const call = (path, init) => worker.fetch(new Request("https://kuponlab.test" + path, init), env, ctx);

test("sağlık endpointi sürüm ve stateless durumunu verir", async () => {
  const response = await call("/api/_health");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json().then(x => [x.ok, x.cloudflareEdition, x.database]), [true, "5.6", "stateless"]);
});

test("API yöntemleri ve bozuk JSON doğru HTTP kodlarını döndürür", async () => {
  const method = await call("/api/fixtures?date=2026-09-16", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "GET");

  const malformed = await call("/api/compose-scan", { method: "POST", body: "{", headers: { "content-type": "application/json" } });
  assert.equal(malformed.status, 400);
  assert.match((await malformed.json()).error, /Geçersiz JSON/);
});

test("D1 gerektiren halka açık ekranlar stateless modu açıklar", async () => {
  const health = await call("/api/model-health");
  const moves = await call("/api/odds-moves?date=2026-09-16");
  assert.deepEqual(await health.json().then(x => [x.ok, x.enabled, x.database]), [true, false, "stateless"]);
  assert.deepEqual(await moves.json().then(x => [x.ok, x.enabled, x.database, x.rows.length]), [true, false, "stateless", 0]);
});

test("bilinmeyen API 404, statik istek asset binding üzerinden döner", async () => {
  assert.equal((await call("/api/yok")).status, 404);
  const asset = await call("/");
  assert.equal(asset.status, 200);
  assert.equal(await asset.text(), "asset");
});

