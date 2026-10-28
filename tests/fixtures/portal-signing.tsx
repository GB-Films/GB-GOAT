import React, { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { PortalSigningRoom } from "../../src/components/PortalSigningRoom";
import "../../src/index.css";

// Real local PDFs; the longer variant also exercises pages outside the rendering window.
function samplePdf(count = 2) {
  const numbers = Array.from({ length: count }, (_, i) => i + 1);
  const streams = numbers.map(page => `BT /F1 19 Tf 50 780 Td (PRUEBA DE DISTRIBUCION - PAGINA ${page}) Tj /F1 12 Tf 0 -35 Td (Documento de prueba. No es un contrato ni autoriza pagos.) Tj ${Array.from({ length: 20 }, (_, i) => `0 -23 Td (Linea ${i + 1}. Texto de ejemplo para revisar la lectura del documento.) Tj`).join(" ")} ET`);
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${numbers.map(n => `${n + 2} 0 R`).join(" ")}] /Count ${count} >>`,
    ...numbers.map(n => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${count + 3} 0 R >> >> /Contents ${count + 3 + n} 0 R >>`),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", ...streams.map(s => `<< /Length ${s.length} >>\nstream\n${s}\nendstream`)];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}
const params = new URLSearchParams(location.search);
const url = URL.createObjectURL(params.has("broken") ? new Blob(["invalid pdf"]) : samplePdf(params.has("long") ? 8 : 2));
const email = "persona@example.com";
const doc = { title: "Prueba local de firma — dos páginas", signatureFields: [
  { id: "other", signerEmail: "otra@example.com", page: 1, x: .1, y: .7, w: .35, h: .1 },
  { id: "first", signerEmail: email, page: 1, x: .5, y: .8, w: .35, h: .1 },
  { id: "second", signerEmail: email, page: 2, x: .15, y: .75, w: .35, h: .12 },
].filter(f => !params.has("foreign") || f.id === "other").map(f => params.has('last') && f.signerEmail === email ? { ...f, page: params.has('long') ? 8 : 2 } : f) };
(window as any).submissions = [];
function Fixture() {
  const [closed, setClosed] = useState(false);
  return closed ? <p>Prueba cerrada</p> : <PortalSigningRoom document={doc} signer={{ email, name: "Persona de prueba" }} url={url} loadError="" onRetry={() => location.reload()} onClose={() => setClosed(true)} onSubmit={async input => {
    (window as any).submissions.push(input);
    if (params.has("failure")) throw Error("Error de prueba: podés reintentar.");
    await new Promise(resolve => setTimeout(resolve, 400));
  }} />;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Fixture /></StrictMode>);
