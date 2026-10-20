const crypto = require('node:crypto');

const BOOK_ID = '1YBEXhP3ZrcjW0DnvSVZyxVPTK4QLxrDVUu3ZMrpCdHY';
const INPUT_COLUMNS = [0, 1, 2, 5, 7, 8, 9, 10, 11, 12, 13, 14, 17, 18, 19, 24, 25, 26];
const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const cents = value => Math.round(Number(value) * 100);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const inputs = row => INPUT_COLUMNS.map(c => row[c] ?? '');
const cleanText = value => String(value ?? '').slice(0, 8000);

function dateSerial(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return Math.floor(date.getTime() / 86400000) + 25569;
}

function assertHeaders(rows, expected, sheet) {
  for (const [index, name] of Object.entries(expected)) {
    if (rows[0]?.[Number(index)] !== name) throw Error(`Cambió la estructura de ${sheet}. No se escribió la planilla.`);
  }
}

// All ranges begin at the real header, not at row 1. Fail closed on a schema change.
function parseSheetData(ranges, properties) {
  const services = ranges.Servicios_Recibidos || [];
  assertHeaders(services, { 0: 'ServicioID (auto)', 1: 'Fecha', 2: 'Proveedor selector', 5: 'ProyectoID', 9: 'Moneda', 10: 'Monto', 24: 'Notas' }, 'Servicios_Recibidos');
  assertHeaders(ranges.Proveedores || [], { 0: 'ProveedorID', 1: 'Nombre', 4: 'CUIT/Tax ID' }, 'Proveedores');
  assertHeaders(ranges.Proyectos || [], { 0: 'ProyectoID', 5: 'Unidad dueña' }, 'Proyectos');
  const rows = services.slice(1).map((values, index) => ({ row: index + 5, values }))
    .filter(r => r.values[0] || r.values[1] || r.values[2] || r.values[10]);
  const ids = new Map();
  for (const row of rows) {
    const id = String(row.values[0] || '');
    if (!id) throw Error(`Servicio sin ID en fila ${row.row}. Revisá CT antes de sincronizar.`);
    if (ids.has(id)) throw Error(`ServicioID repetido en CT: ${id}. Revisá el duplicado antes de sincronizar.`);
    ids.set(id, row);
  }
  const providers = (ranges.Proveedores || []).slice(1).filter(r => r[0] && r[1])
    .map(r => ({ id: String(r[0]), name: String(r[1]), selector: `${r[0]} | ${r[1]}`, taxId: String(r[4] || '').replace(/\D/g, '') }));
  const projects = (ranges.Proyectos || []).slice(1).filter(r => r[0]).map(r => ({ id: String(r[0]), unit: String(r[5] || '') }));
  const sheet = properties.find(p => p.title === 'Servicios_Recibidos');
  if (!sheet) throw Error('No se encontró Servicios_Recibidos.');
  return { rows, ids, providers, projects, sheet, payments: (ranges.Pagos_Proveedores || []).slice(1), advances: (ranges.Gastos_Adelantados || []).slice(1), lastRow: Math.max(4, ...rows.map(r => r.row)) };
}

function effectiveExpenses(project, documents) {
  const active = new Set(Array.isArray(project.activeAreas) ? project.activeAreas : []);
  return documents.filter(e => e.collection === 'areaExpenses' ? active.has(e.area) : !active.has(e.area))
    .sort((a, b) => `${a.collection}/${a.id}`.localeCompare(`${b.collection}/${b.id}`));
}

function sourceProjection(expense) {
  return {
    providerId: String(expense.providerId || ''), providerName: cleanText(expense.providerName),
    description: cleanText(expense.description), area: cleanText(expense.area),
    amount: Number(expense.total), currency: String(expense.currency || 'ARS'),
    serviceDate: String(expense.serviceDate || expense.expenseDate || ''),
    paid: expense.paid === true, paymentCount: Array.isArray(expense.paymentHistory) ? expense.paymentHistory.length : 0,
    documents: (expense.invoices || (expense.invoice ? [expense.invoice] : [])).map(d => ({ id: String(d.id || ''), path: String(d.path || ''), name: cleanText(d.originalFileName || d.fileName) })),
  };
}

function providerFor(expense, sourceProvider, ct, selectedId) {
  if (selectedId) return ct.providers.find(p => p.id === selectedId);
  const tax = [sourceProvider?.cuitNormalized, sourceProvider?.cuit, sourceProvider?.dni_cuit]
    .map(x => String(x || '').replace(/\D/g, '')).find(x => x.length === 11);
  const matches = tax ? ct.providers.filter(p => p.taxId === tax) : ct.providers.filter(p => norm(p.name) && norm(p.name) === norm(expense.providerName));
  return matches.length === 1 ? matches[0] : undefined;
}

function buildPlan({ projectId, project, documents, sourceProviders = {}, ct, state = {}, config = {}, resolutions = {} }) {
  const entries = effectiveExpenses(project, documents);
  const actions = [], items = [], bindings = { ...(state.bindings || {}) };
  const projectCode = String(config.projectId || state.config?.projectId || project.controlTotalProjectId || '').trim();
  const codeCandidates = ct.projects.filter(p => project.projectCode && p.id.startsWith(`${project.projectCode} `));
  const defaultProject = projectCode || (codeCandidates.length === 1 ? codeCandidates[0].id : '');
  const defaultDate = String(config.serviceDate || state.config?.serviceDate || project.shootingDate || '').slice(0, 10);
  const knownProjects = new Set(ct.projects.map(p => p.id));
  let nextRow = ct.lastRow + 1;
  const targets = new Set();
  const sourceKeys = new Set(entries.map(e => `${e.collection}/${e.id}`));
  const fullKeys = new Set(documents.map(e => `${e.collection}/${e.id}`));

  for (const e of entries) {
    const key = `${e.collection}/${e.id}`, source = sourceProjection(e);
    const previousKey = e.sourceBudgetItemId ? `budgetItems/${e.sourceBudgetItemId}` : '';
    const before = state.bindings?.[key] || (previousKey ? state.bindings?.[previousKey] : undefined);
    if (before && previousKey && previousKey !== key && state.bindings?.[previousKey]) bindings[previousKey] = { ...state.bindings[previousKey], mode: 'relocated', relocatedTo: key };
    const choice = resolutions[key] || before || {};
    const issue = message => { items.push({ key, name: source.description || source.providerName || e.id, provider: source.providerName, amount: source.amount, status: 'pending', message, paymentCount: source.paymentCount }); };
    if (!Number.isFinite(source.amount) || source.amount < 0 || source.amount > 1e12) { issue('Importe inválido.'); continue; }
    if (!['ARS', 'USD'].includes(source.currency)) { issue('Revisá la moneda original.'); continue; }
    if (choice.mode === 'included' || choice.mode === 'exclude') {
      if (!String(choice.reason || '').trim()) { issue('Indicá por qué se incluye en otro costo o se excluye.'); continue; }
      const serviceIds = Array.isArray(choice.serviceIds) ? choice.serviceIds : [];
      if (choice.mode === 'included' && (!serviceIds.length || serviceIds.some(id => !ct.ids.has(id)))) { issue('Seleccioná el costo existente que ya lo incluye.'); continue; }
      bindings[key] = { mode: choice.mode, reason: cleanText(choice.reason), serviceIds, source };
      items.push({ key, name: source.description || source.providerName || e.id, provider: source.providerName, amount: source.amount, status: 'included', message: cleanText(choice.reason), paymentCount: source.paymentCount });
      continue;
    }
    let matches = [];
    const selected = Array.isArray(choice.serviceIds) ? choice.serviceIds : [];
    if (selected.length) {
      matches = selected.map(id => ct.ids.get(id)).filter(Boolean);
      if (matches.length !== selected.length) { issue('El registro vinculado ya no existe en CT. Revisá el vínculo.'); continue; }
    } else {
      matches = ct.rows.filter(r => String(r.values[0]).includes(e.id) || String(r.values[24] || '').includes(e.id) || String(e.description || '').includes(String(r.values[0])));
      if (!matches.length && e.sourceBudgetItemId) matches = ct.rows.filter(r => String(r.values[0]).includes(e.sourceBudgetItemId) || String(r.values[24] || '').includes(e.sourceBudgetItemId));
    }
    if (matches.length > 1) { issue('Este gasto se vincula con varios registros. Registrá el reparto como incluido para no sumarlo dos veces.'); continue; }
    const existing = matches[0];
    if (existing && targets.has(existing.values[0])) { issue('Otro gasto del lote ya usa ese servicio CT. Revisá si es un agregado.'); continue; }
    if (existing) targets.add(existing.values[0]);
    if (existing && !before && cents(existing.values[10]) !== cents(source.amount) && !resolutions[key]) {
      issue(`CT registra ${existing.values[10]} ${existing.values[9]} en ${existing.values[0]}. Revisá si este gasto está incluido en un sueldo, reparto o rendición antes de cambiar ese importe.`); continue;
    }
    const targetProject = String(choice.projectId || existing?.values[5] || defaultProject);
    if (!knownProjects.has(targetProject)) { issue('Seleccioná el código de proyecto existente en CT.'); continue; }
    if (norm(e.providerName).includes('banivfx')) { issue('Es un componente del servicio interno BANI. Vinculalo como incluido o excluilo con referencia al documento interno; no se crea como costo externo.'); continue; }
    if (norm(e.area).includes('post') && targetProject.startsWith('G ')) { issue('Este proveedor de postproducción corresponde al código B, no a otro costo de producción G.'); continue; }
    if (!existing && ['Presupuesto', 'Pre Producción'].includes(project.status) && choice.mode !== 'new') { issue('El proyecto está en presupuesto o preproducción. Confirmá que este costo ya fue realizado antes de cargarlo.'); continue; }
    if (!existing && norm(e.area).includes('post') && !resolutions[key]?.projectId && !before?.projectId) { issue('Postproducción: elegí el proyecto B o el vínculo del servicio interno.'); continue; }
    if (before?.source?.providerId && before.source.providerId !== source.providerId && !resolutions[key]?.providerId) { issue('Cambió el prestador en GOAT. Confirmá el proveedor o beneficiario fiscal de CT.'); continue; }
    const provider = providerFor(e, sourceProviders[e.providerId], ct, choice.providerId);
    // Existing fiscal beneficiary may differ from the operational provider. Preserve it until explicitly resolved.
    const selector = choice.providerId ? provider?.selector : existing?.values[2] || provider?.selector;
    if (!selector) { issue('Seleccioná el proveedor CT; puede ser distinto de quien adelantó el dinero.'); continue; }
    const serviceDate = dateSerial(source.serviceDate || choice.serviceDate || defaultDate);
    const date = source.serviceDate ? dateSerial(source.serviceDate) : existing?.values[1] || serviceDate;
    if (!Number.isInteger(date) || date < 40000 || date > 80000) { issue('Completá la fecha del servicio, independiente de la factura o del pago.'); continue; }
    if (existing && existing.values[9] !== source.currency) { issue('Las monedas difieren. Vinculá como incluido con la conversión respaldada, sin reescribir la moneda original.'); continue; }
    if (existing && source.currency === 'ARS' && cents(existing.values[14]) === cents(source.amount) && cents(existing.values[10]) !== cents(source.amount)) { issue('GOAT tiene el total con IVA y CT el costo neto. Corregí o confirmá la diferencia antes de actualizar.'); continue; }
    // If no stable link exists, a matching amount is a candidate, never permission to duplicate.
    if (!existing && choice.mode !== 'new') {
      const candidates = ct.rows.filter(r => r.values[5] === targetProject);
      if (candidates.length) { issue('Hay posibles registros anteriores en CT. Vinculá uno o confirmá que es un gasto nuevo.'); continue; }
    }
    const id = existing?.values[0] || `SRV-GOAT-${e.id}`;
    if (!existing && ct.ids.has(id)) { issue('Ese ServicioID ya existe. Vinculá el registro antes de continuar.'); continue; }
    const row = existing?.row || nextRow++;
    const current = existing?.values || [];
    const managed = { 1: date, 2: selector, 5: targetProject, 7: source.description, 8: source.area, 9: source.currency, 10: source.amount };
    if (before?.source) {
      const sourceField = { 1: 'serviceDate', 2: 'providerId', 5: null, 7: 'description', 8: 'area', 9: 'currency', 10: 'amount' };
      let conflict = false;
      for (const [col, next] of Object.entries(managed)) {
        const field = sourceField[col], previousTarget = before.target?.[col];
        if (previousTarget === undefined) continue;
        const targetChanged = !same(current[col] ?? '', previousTarget);
        const sourceChanged = field && !same(source[field], before.source[field]);
        if (targetChanged && (sourceChanged || !same(next, current[col] ?? ''))) conflict = true;
      }
      if (conflict) { issue('CT cambió desde la última actualización. Revisá la diferencia antes de reemplazarlo.'); continue; }
    }
    const after = Array.from({ length: 27 }, (_, c) => current[c] ?? '');
    after[0] = id;
    for (const [col, value] of Object.entries(managed)) after[col] = value;
    if (!existing) { after[17] = 'Inmediato'; after[18] = date; }
    const changed = !existing || Object.entries(managed).some(([c, v]) => !same(current[c] ?? '', v));
    const marker = `[[GOAT_SYNC:${projectId}/${key}]]`;
    const previousNote = String(after[24] || '');
    const start = previousNote.indexOf(marker);
    const end = start >= 0 ? previousNote.indexOf('[[/GOAT_SYNC]]', start) : -1;
    const userNote = (start >= 0 && end >= 0 ? previousNote.slice(0, start) + previousNote.slice(end + '[[/GOAT_SYNC]]'.length) : previousNote).trim();
    const documentNote = source.documents.map(d => d.name || d.path).join('; ').slice(0, 10000);
    const syncNote = `${marker} GOAT:${projectId}/${key}. Documentos: ${documentNote || 'sin adjunto'}. Pagos GOAT: ${source.paymentCount}; conciliación bancaria separada. IVA no presumido. [[/GOAT_SYNC]]`;
    after[24] = `${userNote}${userNote ? '\n' : ''}${syncNote}`;
    if (after[24].length > 45000) { issue('Las notas CT exceden el espacio disponible. Conservá su historia antes de actualizar.'); continue; }
    const target = Object.fromEntries(Object.keys(managed).map(c => [c, after[c]]));
    bindings[key] = { mode: 'direct', serviceIds: [id], projectId: targetProject, providerId: selector.split(' | ')[0], source, target, owned: before?.owned === true || !existing };
    if (changed || after[24] !== current[24]) actions.push({ key, type: existing ? 'update' : 'create', row, id, before: existing ? inputs(current) : null, after: inputs(after), values: after, name: source.description || source.providerName || e.id });
    items.push({ key, name: source.description || source.providerName || e.id, provider: source.providerName, amount: source.amount, currency: source.currency, ctAmount: existing ? Number(existing.values[10]) : null, status: changed ? existing ? 'update' : 'create' : 'same', message: existing ? id : 'Nuevo servicio', paymentCount: source.paymentCount, documents: source.documents.length });
  }
  for (const [key, binding] of Object.entries(state.bindings || {})) {
    if (sourceKeys.has(key) || !binding.owned || binding.mode !== 'direct' || bindings[key]?.mode === 'relocated') continue;
    const existing = ct.ids.get(binding.serviceIds?.[0]);
    if (!existing) continue;
    // Missing from effective sources is not necessarily deleted: area activation can relocate an expense.
    const replacement = entries.some(e => e.sourceBudgetItemId && key.endsWith(`/${e.sourceBudgetItemId}`));
    if (replacement || fullKeys.has(key)) {
      items.push({ key, name: String(existing.values[7] || binding.serviceIds[0]), status: 'pending', amount: existing.values[10], message: 'Cambió la fuente de la categoría. Revisá el vínculo; no es una baja automática.' });
      continue;
    }
    const hasPayment = binding.source?.paid || binding.source?.paymentCount || [...(ct.payments || []), ...(ct.advances || [])].some(r => r.some(v => typeof v === 'string' && v.includes(String(binding.serviceIds[0]))));
    const choice = resolutions[key];
    if (choice?.mode === 'void' && !hasPayment && String(choice.reason || '').trim().length >= 8) {
      const after = Array.from({ length: 27 }, (_, c) => existing.values[c] ?? '');
      after[10] = 0;
      after[24] = `${after[24] || ''} | Anulado desde GOAT por administrador: ${cleanText(choice.reason)}. Se conserva historia.`;
      actions.push({ key, type: 'void', row: existing.row, id: existing.values[0], before: inputs(existing.values), after: inputs(after), values: after, name: String(existing.values[7] || existing.values[0]) });
      bindings[key] = { ...binding, mode: 'void', reason: cleanText(choice.reason) };
      items.push({ key, name: String(existing.values[7] || existing.values[0]), status: 'void', amount: existing.values[10], message: 'Anulación de costo sin pagos; conserva historia.' });
      continue;
    }
    items.push({ key, name: String(existing.values[7] || binding.serviceIds[0]), status: 'pending', canVoid: !hasPayment, amount: existing.values[10], message: hasPayment ? 'El gasto eliminado tenía pagos. Requiere corrección administrativa y conservar el movimiento real.' : 'Gasto eliminado en GOAT. Revisá su anulación en CT; no se borra historia automáticamente.' });
  }
  if (nextRow > 601) throw Error('El lote supera la fila 600. Primero hay que ampliar y verificar el alcance de las fórmulas mensuales de CT.');
  const sourceHash = hash({ project, documents });
  const ctHash = hash({ rows: ct.rows.map(r => [r.row, inputs(r.values)]), providers: ct.providers, projects: ct.projects });
  const payload = { sourceHash, ctHash, config: { projectId: defaultProject, serviceDate: defaultDate }, items, actions, bindings };
  return { ...payload, fingerprint: hash(payload), summary: { create: actions.filter(a => a.type === 'create').length, update: actions.filter(a => a.type === 'update').length, void: actions.filter(a => a.type === 'void').length, pending: items.filter(i => i.status === 'pending').length, included: items.filter(i => i.status === 'included').length, same: items.filter(i => i.status === 'same').length, paymentsPending: items.reduce((n, i) => n + (i.paymentCount || 0), 0) } };
}

function sheetRequests(actions, sheetId, rowCount) {
  const cell = value => ({ userEnteredValue: typeof value === 'number' ? { numberValue: value } : { stringValue: String(value ?? '') } });
  const formula = value => ({ userEnteredValue: { formulaValue: value } });
  const requests = [];
  const max = Math.max(0, ...actions.map(a => a.row));
  if (max > rowCount) requests.push({ appendDimension: { sheetId, dimension: 'ROWS', length: max - rowCount } });
  for (const a of actions) {
    const r = a.row;
    const updates = new Map(INPUT_COLUMNS.flatMap((c, i) => a.type === 'create' || !same(a.before?.[i], a.after[i]) ? [[c, cell(a.after[i])]] : []));
    // Never overwrite derived columns on existing services.
    if (a.type === 'create') {
      const formulas = {
        3: `=IF(C${r}="";"";IFERROR(INDEX(Proveedores!$A$5:$A;MATCH(C${r};Proveedores!$C$5:$C;0));""))`,
        4: `=IF(C${r}="";"";IFERROR(INDEX(Proveedores!$B$5:$B;MATCH(C${r};Proveedores!$C$5:$C;0));""))`,
        6: `=IF(F${r}="";"";IFERROR(INDEX(Proyectos!$F$5:$F;MATCH(F${r};Proyectos!$A$5:$A;0));""))`,
        15: `=IF(A${r}="";"";IF(J${r}="USD";1;IFERROR(INDEX(TC!$B$5:$B;MATCH(B${r};TC!$A$5:$A;1));0)))`,
        16: `=IF(A${r}="";"";IF(J${r}="USD";K${r};IFERROR(K${r}/P${r};0)))`,
        20: `=IF(A${r}="";"";DATE(YEAR(IF(S${r}="";B${r};S${r}));MONTH(IF(S${r}="";B${r};S${r}));1))`,
        21: `=IF(A${r}="";"";IF(R${r}="Prorrateado";MAX(1;T${r});1))`,
        22: `=IF(A${r}="";"";EDATE(U${r};V${r}))`,
        23: `=IF(A${r}="";"";IFERROR(Q${r}/V${r};0))`,
      };
      for (const [c, f] of Object.entries(formulas)) updates.set(Number(c), formula(f));
    }
    // Contiguous updates reduce API payload while preserving column AB and all formats/validations.
    const sorted = [...updates.keys()].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length;) {
      const start = sorted[i], cols = [start]; i++;
      while (i < sorted.length && sorted[i] === cols.at(-1) + 1) cols.push(sorted[i++]);
      requests.push({ updateCells: { start: { sheetId, rowIndex: r - 1, columnIndex: start }, rows: [{ values: cols.map(c => updates.get(c)) }], fields: 'userEnteredValue' } });
    }
  }
  return requests;
}

function appliedState(actions, ct) {
  if (!actions.length) return 'after';
  const states = actions.map(a => {
    const actual = ct.ids.get(a.id);
    if (actual && same(inputs(actual.values), a.after)) return 'after';
    if (a.before && actual && actual.row === a.row && same(inputs(actual.values), a.before)) return 'before';
    if (!a.before && !actual && !ct.rows.some(r => r.row === a.row)) return 'before';
    return 'conflict';
  });
  return states.every(s => s === 'after') ? 'after' : states.every(s => s === 'before') ? 'before' : 'conflict';
}

module.exports = { BOOK_ID, INPUT_COLUMNS, norm, hash, inputs, dateSerial, parseSheetData, effectiveExpenses, buildPlan, sheetRequests, appliedState };
