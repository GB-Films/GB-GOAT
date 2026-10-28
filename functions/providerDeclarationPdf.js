const { PDFDocument, StandardFonts } = require("pdf-lib");
const fieldNames = {
  address: "Domicilio",
  phone: "Teléfono",
  email: "Correo de contacto",
  cuit: "CUIT",
  dni: "DNI",
  name: "Nombre",
  lastName: "Apellido",
  businessName: "Razón social",
  role: 'Cargo o carácter', company: 'Empresa representada', companyCuit: 'CUIT de la empresa',
  bankAccount_cbu: "CBU/CVU",
  bankAccount_alias: "Alias",
  bankAccount_holder: "Titular de cuenta",
};
const safe = (value) =>
  String(value ?? "").replace(
    /[^\x20-\xff\n]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
async function declarationPdf(d) {
  const pdf = await PDFDocument.create();
  const created = new Date(d.preparedAt || 0);
  pdf.setCreationDate(created);
  pdf.setModificationDate(created);
  const font = await pdf.embedFont(StandardFonts.Helvetica),
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595, 842]),
    y = 795;
  function line(value, strong = false) {
    const words = safe(value).split(/\s+/);
    let row = "";
    for (const word of words) {
      const next = (row ? row + " " : "") + word;
      if (font.widthOfTextAtSize(next, 10) > 510 && row) {
        draw(row, strong);
        row = word;
      } else row = next;
    }
    if (row) draw(row, strong);
  }
  function draw(value, strong) {
    if (y < 140) {
      page = pdf.addPage([595, 842]);
      y = 795;
    }
    page.drawText(value, { x: 40, y, size: 10, font: strong ? bold : font });
    y -= 16;
  }
  function gap() {
    y -= 12;
  }
  const c = d.content;
  line(
    d.kind === "representation"
      ? "Declaración de representación"
      : d.kind === "profile"
        ? "Declaración de actualización de datos"
        : "Autorización para que otra persona facture y cobre por mí",
    true,
  );
  gap();
  line(`Proveedor: ${c.provider?.name || d.providerId}`);
  line(
    `${d.kind === "representation" ? "CUIT informado en la ficha (dato de referencia)" : "CUIT"}: ${c.provider?.cuit || "No informado"}`,
  );
  line(`Cuenta que declara: ${d.actor.email}`);
  line(
    `Carácter declarado: ${d.kind === "representation" ? "Representante autorizado de la empresa" : "Prestador por cuenta propia"}`,
  );
  gap();
  if (d.kind === "representation")
    for (const [key, value] of Object.entries(c.profile).sort(([a], [b]) =>
      a.localeCompare(b),
    ))
      if (value) line(`${fieldNames[key] || key}: ${value}`);
  if (d.kind === "profile")
    for (const [key, value] of Object.entries(c.changes).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      line(fieldNames[key] || key, true);
      line(`Valor anterior: ${value.before || "Sin dato"}`);
      line(`Valor propuesto: ${value.after || "Sin dato"}`);
      line(
        value.critical
          ? "Entrada en vigencia: pendiente de aprobación administrativa."
          : "Entrada en vigencia: al completar la firma.",
      );
      gap();
    }
  if (d.kind === "third_party") {
    line('Prestador del servicio: ' + c.provider.name, true);
    if (c.signerDni) line('DNI del prestador que firma: ' + c.signerDni);
    if (c.reason) line('Motivo declarado: ' + c.reason);
    line(`Quién factura y cobra por el prestador: ${c.party.name}`, true);
    line(`CUIT del titular de la factura: ${c.party.cuit}`);
    if (c.party.relationship) line(`Relación con el prestador: ${c.party.relationship}`);
    if (c.party.activity) line(`Actividad declarada del tercero: ${c.party.activity}`);
    line("El prestador del servicio conserva sus trabajos; la persona designada emite la factura y recibe el pago autorizado.");
    line(
      `Funciones solicitadas: ${c.roles.map((r) => (r === "invoice" ? "Emisor fiscal propuesto (sujeto a validación)" : "Beneficiario designado para cobro")).join("; ")}`,
    );
    if (c.roles.includes("payment")) {
      line(`Titular: ${c.party.holder}`);
      if (c.party.holderCuit) line('CUIT del titular de la cuenta: ' + c.party.holderCuit);
      if (c.party.cbu) line(`CBU/CVU: ${c.party.cbu}`);
      if (c.party.alias) line(`Alias: ${c.party.alias}`);
    }
    line(c.validity === 'until_revoked' ? 'Sin fecha de vencimiento. Sólo los trabajos seleccionados, hasta revocar la autorización.' : `Vigencia hasta: ${c.expiresOn}`);
    if (c.ownAccount) {
      gap(); line('Cuenta propia del prestador: se conserva por separado y no es el destino de estos pagos.', true);
      if (c.ownAccount.cbu) line('CBU/CVU propio: ' + c.ownAccount.cbu);
      if (c.ownAccount.alias) line('Alias propio: ' + c.ownAccount.alias);
    }
    gap();
    line("Trabajos alcanzados", true);
    for (const w of c.workDetails || [])
      line(
        `${w.projectName} - ${w.description}. Importe de referencia del trabajo: ${w.currency} ${w.total}. Identificador: ${w.key}`,
      );
  }
  if (c.evidence?.length) {
    gap(); line('Respaldos identificados en esta declaración', true);
    const { EVIDENCE_LABELS } = require('./providerEvidence');
    for (const evidence of c.evidence) {
      line(`${EVIDENCE_LABELS[evidence.kind] || evidence.kind}: ${evidence.fileName}`);
      line(`SHA256: ${evidence.sha256}`);
    }
  }
  gap();
  line("Declaración y aceptación", true);
  line(c.terms);
  gap();
  line(
    "La firma electrónica deja constancia de esta declaración y de la cuenta utilizada. No constituye un recibo de pago ni acredita por sí sola identidad fiscal, titularidad bancaria o facultades de representación.",
  );
  gap();
  line(`Versión de declaración: ${d.id}`);
  line(`Hash de datos: ${d.contentHash}`);
  return {
    bytes: Buffer.from(await pdf.save()),
    field: {
      id: "portal_signature",
      signerEmail: d.actor.email,
      page: pdf.getPageCount(),
      x: 0.06,
      y: 0.88,
      w: 0.45,
      h: 0.08,
    },
  };
}
module.exports = { declarationPdf };
