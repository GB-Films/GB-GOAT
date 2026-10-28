const { createHash } = require('node:crypto');
const SOURCE = 'https://www.bna.com.ar/Personas/';
const argentinaDate = now => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
function validateQuote(quote, now) {
  if (quote?.source !== SOURCE || quote.date !== argentinaDate(now) || quote.kind !== 'billetes'
    || !Number.isFinite(quote.buy) || !Number.isFinite(quote.sell) || quote.buy <= 0 || quote.sell < quote.buy
    || quote.rate !== (quote.buy + quote.sell) / 2 || !/^[a-f0-9]{64}$/.test(quote.sha256 || ''))
    throw Error('No hay cotización oficial BNA verificable del día de creación.');
  return quote;
}
function parseBnaQuote(html, now = new Date()) {
  const section = html.match(/<div\b[^>]*\bid=["']billetes["'][^>]*>([\s\S]*?)<\/table>/i)?.[1];
  if (!section || !/<th\b[^>]*>\s*Compra\s*<\/th>[\s\S]*?<th\b[^>]*>\s*Venta\s*<\/th>/i.test(section)) throw Error('Cambió la tabla de billetes del BNA.');
  const date = section.match(/class=["']fechaCot["'][^>]*>\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  const rows = [...section.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(match => [...match[1].matchAll(/<td\b[^>]*>\s*([^<]+)\s*<\/td>/gi)].map(cell => cell[1].trim()));
  const dollars = rows.filter(cells => cells[0] === 'Dolar U.S.A');
  if (!date || dollars.length !== 1 || dollars[0].length !== 3) throw Error('No se pudo identificar el dólar billetes del BNA.');
  const amount = value => /^\d+(?:\.\d{3})*,\d{2}$/.test(value) ? Number(value.replaceAll('.', '').replace(',', '.')) : NaN;
  const buy = amount(dollars[0][1]), sell = amount(dollars[0][2]);
  return validateQuote({ source: SOURCE, kind: 'billetes', date: `${date[3]}-${date[2]}-${date[1]}`, buy, sell,
    rate: (buy + sell) / 2, retrievedAt: now.toISOString(), sha256: createHash('sha256').update(html).digest('hex') }, now);
}
async function fetchBnaQuote({ now = new Date(), fetchImpl = fetch } = {}) {
  const response = await fetchImpl(SOURCE, { redirect: 'error', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'GB-GOAT/1.0 official-project-import' } });
  if (!response.ok) throw Error('BNA no está disponible.');
  const html = await response.text();
  if (html.length > 2000000) throw Error('Respuesta BNA inesperada.');
  return parseBnaQuote(html, now);
}
function convertUsd(amount, quote, now = new Date()) {
  validateQuote(quote, now);
  const cents = Math.round(amount * 100), sum = Math.round(quote.buy * 100) + Math.round(quote.sell * 100);
  if (!Number.isSafeInteger(cents) || !Number.isSafeInteger(sum) || Math.abs(amount * 100 - cents) > 0.00001) throw Error('El importe USD no admite una conversión segura a centavos.');
  const result = Number((BigInt(cents) * BigInt(sum) + 100n) / 200n) / 100;
  if (!Number.isFinite(result) || result < 0 || result > 1000000000000) throw Error('El importe convertido excede el límite admitido.');
  return result;
}
module.exports = { SOURCE, argentinaDate, validateQuote, parseBnaQuote, fetchBnaQuote, convertUsd };
