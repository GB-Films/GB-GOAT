const { createHash } = require("node:crypto");
const { isInternalBudgetEstimate } = require('./internalBudgetEstimate');
const { HttpsError } = require("firebase-functions/v2/https");
const fail = (message) => {
  throw new HttpsError("failed-precondition", message);
};
const text = (v, max = 300) =>
  String(v ?? "")
    .trim()
    .slice(0, max);
const email = (v) => text(v).toLowerCase();
const id = (v) => {
  const s = text(v, 160);
  if (!/^[\w-]{1,160}$/.test(s)) fail("Identificador inválido.");
  return s;
};
const requestKey = (value) => {
  const result = String(value || "");
  if (!/^[\w-]{1,1000}$/.test(result)) fail("Solicitud de firma inválida.");
  return result;
};
const list = (v) => (Array.isArray(v) ? v : []);
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
const hash = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
const dateKey = (date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
const CRITICAL = [
  "cuit",
  "businessName",
  "name",
  "lastName",
  "dni",
  "bankAccount_cbu",
  "bankAccount_alias",
  "bankAccount_holder",
];
const COMMON = ["address", "phone", "birthDate", "dietaryRestriction"];
function ownAccountProfileChanges(provider, input, confirmed, allowUnchanged = false) {
  const changes = { ...input };
  const account = { cbu: changes.bankAccount_cbu ?? provider.bankAccount_cbu, alias: changes.bankAccount_alias ?? provider.bankAccount_alias };
  const accountChanges = allowUnchanged || ['bankAccount_cbu', 'bankAccount_alias', 'bankAccount_holder', 'name', 'lastName', 'businessName'].some(key => Object.hasOwn(changes, key));
  if (accountChanges && (account.cbu || account.alias)) {
    if (confirmed !== true) fail('Confirmá que la cuenta provista pertenece al proveedor de esta ficha.');
    const holder = provider.type === 'empresa' ? text(changes.businessName ?? provider.businessName ?? provider.name)
      : text([changes.name ?? provider.name, changes.lastName ?? provider.lastName].filter(Boolean).join(' '));
    if (!holder) fail('Completá el nombre del titular antes de confirmar la cuenta.');
    if (changes.bankAccount_holder && changes.bankAccount_holder !== holder) fail('La cuenta propia debe corresponder al proveedor de esta ficha.');
    changes.bankAccount_holder = holder;
  }
  return profileChanges(provider, changes, allowUnchanged);
}
function profileChanges(before, input, allowUnchanged = false) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("Faltan los cambios.");
  const result = {};
  for (const [key, raw] of Object.entries(input)) {
    if (
      ![...CRITICAL, ...COMMON].includes(key) ||
      typeof raw !== "string" ||
      raw.length > 300
    )
      fail("Dato no editable.");
    const value = text(raw);
    if (key === 'dni' && !/^\d{7,9}$/.test(value.replace(/\D/g, ''))) fail('El DNI debe tener entre 7 y 9 dígitos.');
    if (key === "cuit" && !/^\d{11}$/.test(value.replace(/\D/g, "")))
      fail("El CUIT debe tener 11 dígitos.");
    if (key === "bankAccount_cbu" && value && !/^\d{22}$/.test(value))
      fail("CBU/CVU inválida.");
    if (String(before[key] ?? "") !== value)
      result[key] = {
        before: String(before[key] ?? ""),
        after: value,
        critical: CRITICAL.includes(key),
      };
  }
  if (!Object.keys(result).length && !allowUnchanged) fail("No hay cambios.");
  return result;
}
function thirdPartyIdentity(input, payment = true, requireContext = true) {
  for (const [key, max] of Object.entries({ name: 160, cuit: 30, email: 300, relationship: 300, activity: 500, holder: 160, cbu: 22, alias: 100 })) {
    if (input[key] != null && (typeof input[key] !== "string" || input[key].length > max)) fail("Revisá los datos del tercero.");
  }
  const party = {
    name: text(input.name, 160),
    cuit: text(input.cuit, 30).replace(/\D/g, ""),
    email: email(input.email),
    holder: text(input.holder, 160),
    cbu: text(input.cbu, 22),
    alias: text(input.alias, 100),
    relationship: text(input.relationship, 300),
    activity: text(input.activity, 500),
  };
  if (!party.name || !/^\d{11}$/.test(party.cuit))
    fail("Identificá al tercero y su CUIT.");
  if (
    payment &&
    (!party.holder || (!/^\d{22}$/.test(party.cbu) && !party.alias))
  )
    fail("Indicá titular y CBU/CVU o alias.");
  if (requireContext && (!party.relationship || !party.activity))
    fail("Indicá la relación con el prestador y la actividad del tercero.");
  if (party.cbu && !/^\d{22}$/.test(party.cbu)) fail("CBU/CVU inválida.");
  return party;
}
function thirdParty(input, workKeys, requireContext = true, requireEndDate = true) {
  const roles = [...new Set(list(input.roles))].sort();
  if (!roles.length || roles.some((r) => !["invoice", "payment"].includes(r)))
    fail("Elegí quién factura y/o cobra.");
  const party = thirdPartyIdentity(input, roles.includes("payment"), requireContext);
  const scope = [...new Set(list(input.workKeys))].sort();
  if (
    !scope.length ||
    scope.length > 50 ||
    scope.some((k) => !workKeys.includes(k))
  )
    fail("Seleccioná tus trabajos alcanzados.");
  if (input.cbu && !/^\d{22}$/.test(String(input.cbu)))
    fail("CBU/CVU inválida.");
  const expiresOn = text(input.expiresOn, 10);
  if (requireEndDate && (
    !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn) ||
    Number.isNaN(Date.parse(expiresOn)) ||
    new Date(expiresOn).toISOString().slice(0, 10) !== expiresOn
  ))
    fail("Indicá hasta cuándo autorizás.");
  return {
    party,
    roles,
    workKeys: scope,
    ...(requireEndDate ? { expiresOn } : { validity: 'until_revoked' }),
    termsVersion: "third-party-v2",
    terms:
      "Declaro haber realizado los servicios identificados. Designo al tercero indicado para recibir los pagos de los trabajos seleccionados cuando corresponda. Los acuerdos y la distribución posterior de los fondos entre esa persona y yo son de nuestra responsabilidad. El emisor fiscal propuesto queda sujeto a validación contable. Esta autorización no acredita un pago realizado.",
  };
}
function accessCandidates(providers) {
  const groups = new Map();
  const missing = [];
  for (const p of providers) {
    const value = email(p.portalAccessEmail || p.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      missing.push(p.id);
      continue;
    }
    groups.set(value, [...(groups.get(value) || []), p.id]);
  }
  return {
    missing,
    candidates: [...groups].map(([value, providerIds]) => ({
      id: hash(value),
      email: value,
      providerIds,
      status: providerIds.length === 1 ? "ready" : "ambiguous",
    })),
  };
}
function publicProfile(p) {
  return Object.fromEntries(
    [...CRITICAL, ...COMMON, "email", "type"].map((k) => {
      const value = p[k] ?? '';
      const date = k === 'birthDate' ? value instanceof Date ? value : typeof value?.toDate === 'function' ? value.toDate() : null : null;
      return [k, date && Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : value];
    }),
  );
}
function expenseInvoices(item) {
  const seen = new Set();
  return [
    ...(item.invoice ? [item.invoice] : []),
    ...list(item.invoices),
  ].filter((f) => {
    if (!f || (!f.path && !f.url)) return false;
    const key = f.id || f.path || f.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function signingPath(path, projectId, documentId, artifact) {
  const prefix = `projects/${id(projectId)}/${artifact === "original" ? "documents" : "artifacts"}/${id(documentId)}/`;
  if (
    typeof path !== "string" ||
    !path.startsWith(prefix) ||
    path.split("/").includes("..")
  )
    fail("El archivo no pertenece al documento asignado.");
  return path;
}
function ownExpense(item, project, path) {
  if (isInternalBudgetEstimate(item)) return null;
  const [, projectId, collectionName, expenseId] = path.split("/");
  if (!["budgetItems", "areaExpenses"].includes(collectionName)) return null;
  if (
    (collectionName === "budgetItems") ===
    list(project.activeAreas).includes(item.area)
  )
    return null;
  const payments = list(item.paymentHistory).map((p, index) => ({
    id: text(p.id || index),
    amount: Number(p.amount) || 0,
    date: p.date?.toDate?.().toISOString() || text(p.date),
    detail: text(p.detail),
    sharedRecordId: text(p.sharedRecordId),
    hasReceipt: Boolean(p.receipt?.path || p.receipt?.url),
  }));
  return {
    key: `${projectId}/${collectionName}/${expenseId}`,
    projectId,
    expenseId,
    collectionName,
    projectName: text(project.name),
    description: text(item.description),
    area: text(item.area),
    total: Number(item.total) || 0,
    currency: text(item.currency || "ARS", 3),
    paid: payments.reduce((s, p) => s + p.amount, 0),
    payments,
    invoiceCount: expenseInvoices(item).length,
    markedPaidWithoutDetails: item.paid === true && payments.length === 0,
    thirdPartyPayoutRequired: item.thirdPartyPayoutRequired === true,
    otherCount: list(item.otherReceipts).length,
  };
}
module.exports = {
  ownAccountProfileChanges,
  dateKey,
  fail,
  text,
  email,
  id,
  requestKey,
  list,
  hash,
  CRITICAL,
  COMMON,
  profileChanges,
  thirdParty,
  thirdPartyIdentity,
  accessCandidates,
  publicProfile,
  expenseInvoices,
  signingPath,
  ownExpense,
};
