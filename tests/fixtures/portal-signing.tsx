import React, { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { PortalSigningRoom } from "../../src/components/PortalSigningRoom";
import "../../src/index.css";

// A real, local two-page PDF. No Firebase session, network writes or personal data.
function samplePdf() {
  const streams = [1, 2].map(page => `BT /F1 19 Tf 50 780 Td (PRUEBA DE DISTRIBUCION - PAGINA ${page}) Tj /F1 12 Tf 0 -35 Td (Documento de prueba. No es un contrato ni autoriza pagos.) Tj ${Array.from({ length: 20 }, (_, i) => `0 -23 Td (Linea ${i + 1}. Texto de ejemplo para revisar la lectura del documento.) Tj`).join(" ")} ET`);
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", ...streams.map(s => `<< /Length ${s.length} >>\nstream\n${s}\nendstream`)];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}
const params = new URLSearchParams(location.search);
const url = URL.createObjectURL(params.has("broken") ? new Blob(["invalid pdf"]) : samplePdf());
const email = "persona@example.com";
const doc = { title: "Prueba local de firma — dos páginas", signatureFields: [
  { id: "other", signerEmail: "otra@example.com", page: 1, x: .1, y: .7, w: .35, h: .1 },
  { id: "first", signerEmail: email, page: 1, x: .5, y: .8, w: .35, h: .1 },
  { id: "second", signerEmail: email, page: 2, x: .15, y: .75, w: .35, h: .12 },
].filter(f => !params.has("foreign") || f.id === "other") };
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
