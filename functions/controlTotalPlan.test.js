const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPlan, parseSheetData, effectiveExpenses, sheetRequests, appliedState, inputs, dateSerial, resolveProjectDefaults } = require('./controlTotalPlan');

const projectId = 'project-local';
const project = { activeAreas: ['Producción'], controlTotalProjectId: 'G ZZ 0001 Local', shootingDate: '2026-09-23' };
const expense = overrides => ({ id: 'expense-local', collection: 'budgetItems', area: 'Ejecutiva', description: 'Servicio local', providerName: 'Proveedor local', total: 100, ...overrides });
const row = (overrides = {}) => Object.assign(Array(27).fill(''), { 0: 'SRV-local', 1: 46288, 2: 'PROV1 | Proveedor local', 5: project.controlTotalProjectId, 7: 'Servicio local', 8: 'Ejecutiva', 9: 'ARS', 10: 100, 17: 'Inmediato', 18: 46288, 24: 'expense-local', ...overrides });
const sheet = { sheetId: 100, title: 'Servicios_Recibidos', gridProperties: { rowCount: 999 } };
const ct = (rows = []) => ({ rows: rows.map((values, i) => ({ row: i + 5, values })), ids: new Map(rows.map((values, i) => [values[0], { row: i + 5, values }])), providers: [{ id: 'PROV1', name: 'Proveedor local', selector: 'PROV1 | Proveedor local', taxId: '' }], projects: [{ id: project.controlTotalProjectId, unit: 'GB' }], sheet, lastRow: rows.length + 4, payments: [], advances: [] });
const plan = (overrides = {}) => buildPlan({ projectId, project, documents: [expense()], ct: ct(), ...overrides });

test('project code resolves to the current CT name and stale full names remain linked by code', () => {
  for (const metadata of [{ projectCode: 'G ZZ 0001' }, { controlTotalProjectId: 'G ZZ 0001 Previous name' }]) {
    assert.equal(resolveProjectDefaults(projectId, metadata, ct()).projectId, project.controlTotalProjectId);
  }
  assert.equal(resolveProjectDefaults('ct-G-ZZ-0001', {}, ct()).projectId, project.controlTotalProjectId);
  assert.equal(resolveProjectDefaults(projectId, { name: 'Local' }, ct()).projectId, '');
  assert.equal(resolveProjectDefaults(projectId, project, ct(), { projectId: 'G XX 9999 Missing' }).projectId, '');
  const ambiguous = ct(); ambiguous.projects.push({ id: 'G ZZ 0001 Duplicate', unit: 'GB' });
  assert.equal(resolveProjectDefaults(projectId, { projectCode: 'G ZZ 0001' }, ambiguous).projectId, '');
});

test('new services use the last shooting day, then first day, then legacy date', () => {
  const p = plan({ project: { ...project, shootingStartDate: '2026-09-22', shootingEndDate: '2026-09-25' } });
  assert.equal(p.config.serviceDate, '2026-09-25'); assert.equal(p.actions[0].values[1], dateSerial('2026-09-25'));
  assert.equal(resolveProjectDefaults(projectId, { shootingEndDate: 'invalid', shootingStartDate: '2026-09-22' }, ct()).serviceDate, '2026-09-22');
  assert.equal(resolveProjectDefaults(projectId, { shootingDate: '2026-09-23' }, ct()).serviceDate, '2026-09-23');
  assert.equal(resolveProjectDefaults(projectId, { shootingEndDate: { toDate: () => new Date('2026-09-25T15:00:00Z') } }, ct()).serviceDate, '2026-09-25');
});

test('automatic dates follow changed shooting dates while explicit overrides and historical service dates persist', () => {
  const state = { config: { serviceDate: '2026-09-23', serviceDateMode: 'project' } };
  const current = { ...project, shootingEndDate: '2026-09-25' };
  assert.equal(resolveProjectDefaults(projectId, current, ct(), { serviceDate: '2026-09-23', serviceDateMode: 'project' }, state).serviceDate, '2026-09-25');
  assert.equal(resolveProjectDefaults(projectId, current, ct(), { serviceDate: '2026-09-21', serviceDateMode: 'manual' }).serviceDate, '2026-09-21');
  assert.equal(plan({ project: current, ct: ct([row()]) }).actions[0].values[1], row()[1]);
  assert.equal(plan({ project: current, documents: [expense({ serviceDate: '2026-09-20' })] }).actions[0].values[1], dateSerial('2026-09-20'));
});

test('effective source excludes residual inactive areas and active-area budgets', () => {
  const docs = [expense(), expense({ id: 'residual', collection: 'areaExpenses' }), expense({ id: 'budget', area: 'Producción' }), expense({ id: 'real', collection: 'areaExpenses', area: 'Producción' })];
  assert.deepEqual(effectiveExpenses(project, docs).map(e => e.id).sort(), ['expense-local', 'real']);
});
test('new cost requires provider, project and actual service date', () => {
  assert.equal(plan().actions[0].type, 'create');
  assert.equal(plan({ project: { activeAreas: [] } }).actions.length, 0);
  assert.equal(plan({ documents: [expense({ providerName: '' })] }).actions.length, 0);
});
test('does not automatically duplicate a preexisting candidate', () => {
  const current = row({ 0: 'old-manual', 24: '' });
  const p = plan({ ct: ct([current]) });
  assert.equal(p.actions.length, 0);
  assert.equal(p.items[0].status, 'pending');
  assert.equal(plan({ ct: ct([current]), resolutions: { 'budgetItems/expense-local': { mode: 'new' } } }).actions.length, 1);
});
test('stable ID updates cost in place and preserves fiscal data and formulas', () => {
  const current = row({ 12: 100, 13: 21, 14: 121 });
  const baseline = plan({ ct: ct([current]) });
  const p = plan({ ct: ct([current]), state: { bindings: baseline.bindings }, documents: [expense({ total: 110 })] });
  assert.equal(p.actions[0].id, 'SRV-local');
  assert.equal(p.actions[0].values[14], 121);
  const requests = sheetRequests(p.actions, 100, 999);
  const columns = requests.flatMap(r => r.updateCells ? r.updateCells.rows[0].values.map((v, i) => [r.updateCells.start.columnIndex + i, v]) : []);
  assert.ok(!columns.some(([c]) => [3, 4, 6, 12, 13, 14, 15, 16, 20, 21, 22, 23].includes(c)));
  assert.ok(columns.some(([c, v]) => c === 10 && v.userEnteredValue.numberValue === 110));
});
test('new formulas cover new projects and text cannot become a formula', () => {
  const p = plan({ documents: [expense({ description: '=IMPORTXML("untrusted")' })] });
  const requests = sheetRequests(p.actions, 100, 999);
  const values = requests.flatMap(r => r.updateCells?.rows[0].values || []);
  assert.ok(values.some(v => v.userEnteredValue?.stringValue?.startsWith('=IMPORTXML')));
  assert.ok(values.some(v => v.userEnteredValue?.formulaValue?.includes('Proyectos!$F$5:$F;')));
  assert.ok(!JSON.stringify(p).includes('null,null'));
});
test('cleared source fields propagate without clearing CT-owned fields', () => {
  const initial = plan({ ct: ct([row()]) });
  const state = { bindings: initial.bindings };
  const target = initial.actions[0].values;
  const p = plan({ state, ct: ct([target]), documents: [expense({ description: undefined })] });
  assert.equal(p.actions[0].values[7], '');
  assert.equal(p.actions[0].values[1], 46288);
});
test('existing accounting category is not replaced by the operational GOAT area', () => {
  const p = plan({ ct: ct([row({ 8: 'Transporte' })]) });
  assert.equal(p.actions[0].values[8], 'Transporte');
});
test('CT manual edit and changed GOAT version cause conflict, not overwrite', () => {
  const initial = plan({ ct: ct([row()]) });
  const target = [...initial.actions[0].values]; target[10] = 115;
  const p = plan({ state: { bindings: initial.bindings }, ct: ct([target]), documents: [expense({ total: 120 })] });
  assert.equal(p.actions.length, 0);
  assert.equal(p.items[0].status, 'pending');
});
test('salary / aggregate inclusion links without a second cost', () => {
  const p = plan({ ct: ct([row()]), resolutions: { 'budgetItems/expense-local': { mode: 'included', reason: 'Incluido en sueldo', serviceIds: ['SRV-local'] } } });
  assert.equal(p.actions.length, 0); assert.equal(p.summary.included, 1);
});
test('currency and gross-vs-net mismatches require review', () => {
  assert.equal(plan({ ct: ct([row({ 9: 'USD' })]) }).actions.length, 0);
  assert.equal(plan({ ct: ct([row({ 10: 100, 14: 121 })]), documents: [expense({ total: 121 })] }).actions.length, 0);
});
test('postproduction cannot silently create a G external cost', () => {
  assert.equal(plan({ documents: [expense({ area: 'Post Producción' })] }).actions.length, 0);
  assert.equal(plan({ documents: [expense({ providerName: 'BANI VFX LLC' })], resolutions: { 'budgetItems/expense-local': { mode: 'new', projectId: project.controlTotalProjectId, providerId: 'PROV1' } } }).actions.length, 0);
});
test('source deletion requires explicit admin void reason; bank/advance history blocks it', () => {
  const initial = plan(); const target = initial.actions[0].values;
  const state = { bindings: initial.bindings };
  let p = plan({ documents: [], state, ct: ct([target]) });
  assert.equal(p.actions.length, 0); assert.equal(p.items[0].canVoid, true);
  p = plan({ documents: [], state, ct: ct([target]), resolutions: { 'budgetItems/expense-local': { mode: 'void', reason: 'Carga errónea confirmada' } } });
  assert.equal(p.actions[0].type, 'void'); assert.equal(p.actions[0].values[10], 0);
  const paid = ct([target]); paid.payments = [['payment-local', 'SRV-GOAT-expense-local']];
  p = plan({ documents: [], state, ct: paid, resolutions: { 'budgetItems/expense-local': { mode: 'void', reason: 'Carga errónea confirmada' } } });
  assert.equal(p.actions.length, 0); assert.equal(p.items[0].canVoid, false);
});
test('category source change is not a deletion', () => {
  const initial = plan(); const target = initial.actions[0].values;
  const p = plan({ project: { ...project, activeAreas: ['Ejecutiva'] }, documents: [expense()], state: { bindings: initial.bindings }, ct: ct([target]) });
  assert.equal(p.actions.length, 0); assert.match(p.items[0].message, /fuente/);
});
test('area activation carries the previous stable link instead of duplicating the budget cost', () => {
  const initial = plan();
  const p = plan({ project: { ...project, activeAreas: ['Ejecutiva'] }, documents: [expense(), expense({ id: 'area-local', collection: 'areaExpenses', sourceBudgetItemId: 'expense-local' })], state: { bindings: initial.bindings }, ct: ct([initial.actions[0].values]) });
  assert.equal(p.summary.create, 0);
  assert.equal(p.summary.pending, 0);
  assert.equal(p.bindings['areaExpenses/area-local'].serviceIds[0], 'SRV-GOAT-expense-local');
  assert.equal(p.bindings['budgetItems/expense-local'].mode, 'relocated');
});
test('readback recovery is idempotent and detects reordered before-rows', () => {
  const p = plan(); const actual = ct([p.actions[0].values]);
  assert.equal(appliedState(p.actions, actual), 'after');
  assert.equal(appliedState(p.actions, ct()), 'before');
  const baseline = plan({ ct: ct([row()]) });
  const edit = plan({ ct: ct([row()]), state: { bindings: baseline.bindings }, documents: [expense({ total: 110 })] });
  const moved = ct([row({ 0: 'other' }), row()]);
  assert.equal(appliedState(edit.actions, moved), 'conflict');
});
test('first linking cannot reduce a salary or add over a legacy aggregate', () => {
  const salary = row({ 7: 'Sueldo mensual', 10: 1500 });
  assert.equal(plan({ ct: ct([salary]), documents: [expense({ total: 780 })] }).actions.length, 0);
  const aggregate = row({ 0: 'legacy', 2: 'PROV-other | Varios', 10: 333, 24: '' });
  assert.equal(plan({ ct: ct([aggregate]) }).actions.length, 0);
  assert.equal(plan({ project: { ...project, status: 'Presupuesto' } }).actions.length, 0);
});
test('invalid dates / partial schemas fail closed', () => {
  assert.equal(dateSerial('2026-02-30'), null);
  assert.throws(() => parseSheetData({ Servicios_Recibidos: [[]] }, [sheet]), /estructura/);
});
test('provider change requires explicit fiscal beneficiary review', () => {
  const initial = plan({ documents: [expense({ providerId: 'first-provider' })] });
  const p = plan({ documents: [expense({ providerId: 'different-provider' })], ct: ct([initial.actions[0].values]), state: { bindings: initial.bindings } });
  assert.equal(p.actions.length, 0); assert.match(p.items[0].message, /prestador/);
});
