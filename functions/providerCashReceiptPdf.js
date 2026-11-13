const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const safe = value => String(value ?? '').replace(/[^\x20-\xff\n]/g, '?');
const money = cents => (cents / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
async function cashReceiptPdf(receipt) {
  const c = receipt.content, p = c.payment, pdf = await PDFDocument.create();
  const prepared = new Date(c.preparedAt); pdf.setCreationDate(prepared); pdf.setModificationDate(prepared);
  const regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page, y;
  const newPage = () => {
    page = pdf.addPage([595, 842]); y = 786;
    page.drawText('GRAN BERTA', { x: 48, y, font: bold, size: 10, color: rgb(.25, .35, .48) });
    y -= 28; page.drawText('RECIBO DE EFECTIVO', { x: 48, y, font: bold, size: 20, color: rgb(.06, .12, .22) }); y -= 28;
  };
  newPage();
  function line(value, strong = false, size = 10) {
    const font = strong ? bold : regular, words = safe(value).split(/\s+/); let row = '';
    const draw = () => { if (y < 210) newPage(); page.drawText(row, { x: 48, y, font, size }); y -= size + 4; row = ''; };
    for (const word of words) {
      if (row && font.widthOfTextAtSize(row + ' ' + word, size) > 499) draw();
      if (font.widthOfTextAtSize(word, size) <= 499) { row = row ? row + ' ' + word : word; continue; }
      for (const character of word) { if (font.widthOfTextAtSize(row + character, size) > 499) draw(); row += character; }
    }
    if (row) draw();
  }
  const field = (label, value) => { line(label.toUpperCase(), true, 8); line(value || 'Sin informar', false, 11); y -= 5; };
  field('Proyecto', c.projectName);
  field('Concepto / trabajo', p.concept || p.detail);
  field('Fecha del pago', p.date.split('-').reverse().join('/'));
  field('Quién recibe / proveedor', `${c.provider.name} · ${String(c.provider.cuit).replace(/\D/g, '').length === 9 ? 'EIN' : 'CUIT'} ${c.provider.cuit || 'Sin informar'}`);
  field('Persona que firma', `${c.signerName} · DNI ${c.signerDni} · ${receipt.actor.email}`);
  field('Entregado por cuenta de Gran Berta', `${p.deliveredBy || 'Responsable de caja'} · ${p.cashBoxLabel}`);
  y -= 4;
  line('EFECTIVO RECIBIDO', true, 12);
  if (c.parts.arsCents) line(`Pesos argentinos: ARS ${money(c.parts.arsCents)}`, true, 12);
  if (c.parts.usdCents) {
    line(`Dólares estadounidenses: USD ${money(c.parts.usdCents)}`, true, 12);
    line(`Cotización declarada: ARS ${c.parts.rate.toLocaleString('es-AR', { maximumFractionDigits: 6 })} por USD 1`);
  }
  line(`Importe del pago registrado en el proyecto: ARS ${money(p.amountCents)}`);
  line(p.paymentType === 'partial' ? 'Imputación: pago parcial del trabajo indicado.' : 'Imputación: pago del trabajo indicado.');
  if (p.detail) { y -= 8; field('Detalle del pago', p.detail); }
  y -= 8;
  line('CONSTANCIA DE RECEPCIÓN', true);
  line('Declaro que recibí en efectivo los importes y monedas detallados arriba, por el concepto y proyecto indicados. Al firmar confirmo esta recepción con mi cuenta verificada.');
  line('Esta constancia corresponde al pago identificado; no reemplaza la factura del servicio ni implica recepción de otros importes.');
  y -= 10; line(`Emitido: ${c.preparedAt.slice(0, 10).split('-').reverse().join('/')}`, false, 8);
  line(`Referencia del pago: ${c.projectId}/${c.collectionName}/${c.itemId}/${c.paymentId}`, false, 7);
  line(`Recibo: ${receipt.id}`, false, 7); line(`Hash de contenido: ${receipt.contentHash}`, false, 7);
  page.drawRectangle({ x: 48, y: 58, width: 499, height: 102, borderWidth: 1, borderColor: rgb(.7, .76, .84) });
  page.drawText('Firma y DNI de quien recibe', { x: 58, y: 170, font: regular, size: 9, color: rgb(.3, .38, .5) });
  return { bytes: Buffer.from(await pdf.save()), field: { id: 'cash_receipt_signature', signerEmail: receipt.actor.email, page: pdf.getPageCount(), x: .08, y: .81, w: .84, h: .12 } };
}
module.exports = { cashReceiptPdf };
