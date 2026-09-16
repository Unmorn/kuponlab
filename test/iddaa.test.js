import test from "node:test";
import assert from "node:assert/strict";
import { matchIddaaRows } from "../lib/iddaa.js";

const ts = 1_800_000_000;
const event = {
  startTimestamp: ts,
  homeTeam: { name: "Inter Miami CF" },
  awayTeam: { name: "Cruz Azul FC" }
};

test("İddaa programı takım eki ve küçük saat farkıyla eşleşir", () => {
  const match = matchIddaaRows(event, [
    { i: 42, hn: "Inter Miami", an: "Cruz Azul", d: ts + 300, m: [{}, {}] }
  ]);
  assert.equal(match?.eventId, "42");
  assert.equal(match?.marketCount, 2);
  assert.equal(match?.reversed, false);
});

test("ters ev/deplasman veya uzak saat yanlış eşleşmez", () => {
  assert.equal(matchIddaaRows(event, [{ i: 43, hn: "Cruz Azul", an: "Inter Miami", d: ts, m: [] }]), null);
  assert.equal(matchIddaaRows(event, [{ i: 44, hn: "Inter Miami", an: "Cruz Azul", d: ts + 7_200, m: [] }]), null);
});

