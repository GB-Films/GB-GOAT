export function contractSamplePdf() {
  const streams = [1, 2].map(page => `BT /F1 20 Tf 50 780 Td (CONTRATO DE EJEMPLO - PAGINA ${page}) Tj /F1 11 Tf 0 -35 Td (Datos ficticios. No es un contrato ni una solicitud real.) Tj ${Array.from({ length: page === 1 ? 22 : 10 }, (_, index) => `0 -22 Td (Clausula de ejemplo ${index + 1}. Texto para revisar el lugar de la firma.) Tj`).join(' ')} ET`);
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    ...[1, 2].map(page => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents ${5 + page} 0 R >>`),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', ...streams.map(stream => `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)];
  let output = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(output.length); output += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([output], { type: 'application/pdf' });
}
