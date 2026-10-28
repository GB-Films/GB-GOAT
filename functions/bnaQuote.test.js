const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBnaQuote, convertUsd, argentinaDate, fetchBnaQuote, SOURCE } = require('./bnaQuote');
const now = new Date('2026-10-28T20:00:00Z');
const html = (date = '28/10/2026', buy = '100,00', sell = '102,00') => `<div id="divisas"><table><tr><td>Dolar U.S.A</td><td>999,00</td><td>999,00</td></tr></table></div><div class="tab-pane" id="billetes"><table><tr><th class="fechaCot">${date}</th><th>Compra</th><th>Venta</th></tr><tr><td class="tit">Dolar U.S.A</td><td>${buy}</td><td>${sell}</td></tr></table></div>`;
test('uses the dated official billetes table, not divisas, and averages buy/sell', () => {
  const quote = parseBnaQuote(html(), now);
  assert.equal(quote.rate, 101); assert.equal(convertUsd(900, quote, now), 90900);
  assert.equal(convertUsd(1.23, quote, now), 124.23);
  assert.equal(convertUsd(0.01, parseBnaQuote(html('28/10/2026', '100,00', '101,00'), now), now), 1.01, 'half-cent rounds up without float drift');
  assert.equal(argentinaDate(new Date('2026-10-29T02:00:00Z')), '2026-10-28');
});
test('rejects previous-day, incomplete, zero, malformed and inverted quotes without fallback', () => {
  for (const body of [html('27/10/2026'), html('28/10/2026', '0,00'), html('28/10/2026', '104,00'), html().replace('id="billetes"', 'id="other"'), html().replace('100,00', 'bad')]) assert.throws(() => parseBnaQuote(body, now));
});

test('only requests the fixed official source, rejects redirects and network failures', async () => {
  const quote = await fetchBnaQuote({ now, fetchImpl: async (url, options) => {
    assert.equal(url, SOURCE); assert.equal(options.redirect, 'error'); assert.ok(options.signal);
    return { ok: true, text: async () => html() };
  } });
  assert.equal(quote.rate, 101);
  for (const fetchImpl of [async () => { throw Error('offline'); }, async () => ({ ok: false }), async () => ({ ok: true, text: async () => html('27/10/2026') })])
    await assert.rejects(fetchBnaQuote({ now, fetchImpl }));
});
