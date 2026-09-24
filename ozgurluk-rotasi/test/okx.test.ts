import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { signOkx } from "../src/data/okx.ts";
import { buildOrder, roundToLot } from "../src/live/orders.ts";

test("OKX imzası: base64(HMAC-SHA256(ts+METHOD+path+body))", () => {
  const ts = "2020-12-08T09:08:57.715Z";
  const expected = createHmac("sha256", "s3cr3t").update(`${ts}GET/api/v5/account/balance`).digest("base64");
  assert.equal(signOkx(ts, "get", "/api/v5/account/balance", "", "s3cr3t"), expected);
});

test("lot yuvarlama aşağı", () => {
  assert.equal(roundToLot(0.3599, "0.01"), "0.35");
  assert.equal(roundToLot(7.9, "1"), "7");
});

const btcSwap = { instId: "BTC-USDT-SWAP", ctVal: "0.01", ctValCcy: "BTC", lotSz: "0.01", minSz: "0.01", lever: "100" };

test("perp emri: kontrat sayısı ve stop eki", () => {
  const p = buildOrder({ instId: "BTC-USDT-SWAP", side: "buy", usd: 1000, stopLoss: 90000 }, btcSwap, 100000);
  assert.equal(p.body.sz, "1.00");
  assert.equal(p.notionalUsd, 1000);
  assert.deepEqual(p.body.attachAlgoOrds, [{ slTriggerPx: "90000", slOrdPx: "-1" }]);
  assert.equal(p.warnings.length, 0);
});

test("yanlış taraftaki stop ve SPX memecoin uyarısı", () => {
  const p = buildOrder({ instId: "BTC-USDT-SWAP", side: "buy", usd: 1000, stopLoss: 110000 }, btcSwap, 100000);
  assert.ok(p.warnings.some((w) => w.includes("yanlış tarafında")));
  const s = buildOrder({ instId: "SPX-USDT-SWAP", side: "buy", usd: 100, stopLoss: 0.1 }, { ...btcSwap, instId: "SPX-USDT-SWAP", ctVal: "1", lotSz: "1", minSz: "1" }, 0.5);
  assert.ok(s.warnings.some((w) => w.includes("memecoin")));
});
