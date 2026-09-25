import { test } from "node:test";
import assert from "node:assert/strict";
import { cluster, decode, enrich, parseRss, FEEDS } from "../src/news.ts";

const XML = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[Fed cuts rates by 25bp as inflation cools]]></title><link>https://ex.com/a</link><pubDate>Thu, 24 Sep 2026 18:00:00 GMT</pubDate><description>&lt;p&gt;The Federal Reserve &amp; markets&lt;/p&gt;</description></item>
<item><title>Bitcoin surges to record high on ETF inflows</title><link>https://ex.com/b</link><pubDate>Thu, 24 Sep 2026 17:00:00 GMT</pubDate></item>
<item><title>4 No-Brainer ETFs I'm Buying if the Stock Market Crashes</title><link>https://ex.com/c</link><pubDate>Thu, 24 Sep 2026 17:30:00 GMT</pubDate></item>
</channel></rss>`;

test("RSS ayrıştırma: CDATA, varlık ve HTML temizliği", () => {
  const items = parseRss(XML);
  assert.equal(items.length, 3);
  assert.equal(items[0].title, "Fed cuts rates by 25bp as inflation cools");
  assert.equal(items[0].summary, "The Federal Reserve & markets");
  assert.equal(decode("&#8217;&amp;&#x41;"), "’&A");
});

test("etiket, yüksek etki, duygu ve tık tuzağı cezası", () => {
  const now = Date.parse("2026-09-24T19:00:00Z");
  const feed = FEEDS[0];
  const [fed, btc, bait] = parseRss(XML).map((r) => enrich({ ...r, feed }, now));
  assert.ok(fed.tags.includes("MACRO"));
  assert.ok(fed.highImpact.includes("Fed / faiz kararı"));
  assert.ok(btc.tags.includes("BTC"));
  assert.equal(btc.sentiment, 1);
  assert.ok(bait.importance < btc.importance);
});

test("aynı hikâye farklı kaynaklardan tek kümede birleşir", () => {
  const now = Date.parse("2026-09-24T19:00:00Z");
  const a = enrich({ title: "Fed cuts interest rates by quarter point", link: "https://a/1", published: "2026-09-24T18:00:00Z", summary: "", feed: FEEDS[0] }, now);
  const b = enrich({ title: "Federal Reserve: Fed cuts interest rates by quarter point", link: "https://b/1", published: "2026-09-24T18:10:00Z", summary: "", feed: { ...FEEDS[1] } }, now);
  const out = cluster([a, b]);
  assert.equal(out.length, 1);
  assert.equal(out[0].alsoIn.length, 1);
});
