import test from "node:test";
import assert from "node:assert/strict";
import { customCoupon, targetCoupon } from "../lib/product.js";

const keys = ["1", "O25", "BTTS", "DC_1X"];

function item(index) {
  const eventId = 10_000 + index;
  const catalogItems = keys.map((key, option) => ({
    key,
    label: ["1", "2.5 ÜST", "KG VAR", "1X"][option],
    title: "Test marketi",
    family: option === 0 || option === 3 ? "result" : option === 1 ? "goals" : "btts",
    probability: 72 - option * 4,
    probabilityRaw: (72 - option * 4) / 100,
    fairOdds: 1.5 + option * 0.12,
    risk: 30 + option * 4,
    sample: 8,
    marketConfidence: 78,
    iddaa: {
      available: true,
      eventId,
      marketId: eventId * 10 + option,
      marketName: "Test marketi",
      outcomeNo: option + 1,
      outcomeName: ["1", "Üst", "Var", "1 ve 0"][option],
      odd: 1.35 + ((index + option) % 6) * 0.11,
      mbs: 2,
      fairProbability: 0.6 - option * 0.04
    }
  }));
  return {
    event: {
      id: eventId,
      startTimestamp: 1_800_000_000 + index * 3_600,
      homeTeam: { name: `Ev ${index}` },
      awayTeam: { name: `Dep ${index}` },
      tournament: { name: "Test Lig", uniqueTournament: { id: index % 4, name: "Test Lig" } }
    },
    analysis: {
      confidence: 82,
      dataQuality: 86,
      stability: 84,
      marketPerformance: {},
      catalog: { categories: [{ id: "result", items: catalogItems }] }
    },
    marketComparison: { available: false }
  };
}

test("özel kupon istenen sayıyı korur ve her maçtan tek seçim alır", () => {
  const coupon = customCoupon(Array.from({ length: 12 }, (_, i) => item(i)), 8, 12, 0);
  assert.equal(coupon.count, 8);
  assert.equal(coupon.picks.length, 8);
  assert.equal(coupon.complete, true);
  assert.equal(new Set(coupon.picks.map(pick => pick.matchId)).size, 8);
  assert.ok(coupon.picks.every(pick => pick.iddaaEventId && pick.iddaaMarketId));
});

test("yetersiz maçta seçim sayısını gizlice düşürmez", () => {
  const coupon = customCoupon(Array.from({ length: 3 }, (_, i) => item(i)), 8, 10, 0);
  assert.equal(coupon.count, 8);
  assert.equal(coupon.picks.length, 3);
  assert.equal(coupon.eligibleMatches, 3);
  assert.equal(coupon.complete, false);
  assert.match(coupon.notes.join(" "), /yalnızca 3/);
});

test("hedef oran kuponu resmi İddaa kimliklerini kaybetmez", () => {
  const coupon = targetCoupon(Array.from({ length: 10 }, (_, i) => item(i)), 5, 1);
  assert.ok(coupon.picks.length >= 2);
  assert.ok(coupon.picks.every(pick => pick.oddsType === "iddaa"));
  assert.ok(coupon.picks.every(pick => pick.iddaaEventId && pick.iddaaMarketId && pick.iddaaOutcomeNo));
});

test("özel kupon varyantları Worker CPU bütçesine uygun sürede oluşur", () => {
  const items = Array.from({ length: 24 }, (_, i) => item(i));
  const started = performance.now();
  for (let variant = 0; variant < 5; variant++) customCoupon(items, 12, 80, variant);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 2_500, `kupon üretimi fazla yavaş: ${elapsed.toFixed(0)} ms`);
});

