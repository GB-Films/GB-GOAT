import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAssistantCapabilities } from './assistantCapabilities';
import { buildAssistantTools, type AssistantProjectContext } from './assistantTools';

const baseProject = {
  projectId: 'proj-1',
  projectName: 'Largometraje',
  projectCreatedBy: 'owner-uid',
  categories: ['Arte', 'Vestuario', 'Locaciones'],
  activeAreas: ['Arte'],
};

const adminCapabilities = buildAssistantCapabilities({ ...baseProject, userId: 'owner-uid' });

const areaLeadCapabilities = buildAssistantCapabilities({
  ...baseProject,
  userId: 'area-uid',
  collaborator: {
    role: 'jefe_area',
    allowedTabs: ['resumen', 'areas', 'cajas', 'saldos', 'documentos', 'proveedores'],
    allowedCategories: ['Arte'],
    allowedSubcategories: ['Vestuario||Zapatos'],
    canEditBudgetAreas: true,
  },
});

const buildContext = (capabilities: AssistantProjectContext['capabilities']): AssistantProjectContext => ({
  projectId: baseProject.projectId,
  projectName: baseProject.projectName,
  userEmail: 'area@example.com',
  capabilities,
  categories: baseProject.categories,
  activeAreas: baseProject.activeAreas,
  budgetItems: [
    { id: 'b1', area: 'Arte', providerName: 'Rental Sur', description: 'Cámara', total: 1000, order: 0 },
    { id: 'b2', area: 'Locaciones', providerName: 'Estudio Norte', description: 'Estudio', total: 5000, order: 1 },
  ],
  areaExpenses: [
    { id: 'a1', area: 'Arte', subcategory: 'Utilería', providerName: 'Ferretería', description: 'Pintura', total: 300, order: 0 },
    { id: 'a2', area: 'Vestuario', subcategory: 'Zapatos', providerName: 'Zapatería', description: 'Botas', total: 200, order: 0 },
    { id: 'a3', area: 'Vestuario', subcategory: 'Sombreros', providerName: 'Sombrerería', description: 'Galera', total: 150, order: 1 },
    { id: 'a4', area: 'Locaciones', subcategory: '', providerName: 'Estudio Norte', description: 'Alquiler', total: 900, order: 0 },
  ],
  cashMovements: [
    { id: 'c1', type: 'entrega', amount: 500, status: 'confirmed', toUserEmail: 'area@example.com' },
    { id: 'c2', type: 'pago', amount: 100, status: 'confirmed', toUserEmail: 'otro@example.com' },
  ],
  collaborators: [
    { email: 'area@example.com', displayName: 'Jefa de Área', role: 'jefe_area', allowedCategories: ['Arte'], allowedSubcategories: ['Vestuario||Zapatos'] },
  ],
  providers: [
    { id: 'p1', name: 'Rental', lastName: 'Sur', category: 'Técnica' },
  ],
});

const toolByName = (tools: ReturnType<typeof buildAssistantTools>, name: string) => {
  const tool = tools.find((entry) => entry.name === name);
  assert.ok(tool, `Falta la herramienta ${name}`);
  return tool;
};

test('el resumen del proyecto sólo cuenta lo que el usuario puede ver', () => {
  const tools = buildAssistantTools(buildContext(areaLeadCapabilities));
  const summary = toolByName(tools, 'resumen_proyecto').run({}) as any;

  assert.equal(summary.presupuestoPrincipal, 1000);
  assert.equal(summary.gastosDeAreas, 500);
  assert.equal(summary.partidas, 1);
  assert.equal(summary.gastosCargados, 2);
});

test('el listado de gastos respeta área y subcategoría delegadas', () => {
  const tools = buildAssistantTools(buildContext(areaLeadCapabilities));

  const all = toolByName(tools, 'listar_gastos_area').run({}) as any;
  assert.deepEqual(all.gastos.map((row: any) => row.id), ['a1', 'a2']);

  const sandals = toolByName(tools, 'listar_gastos_area').run({ subcategoria: 'Zapatos' }) as any;
  assert.deepEqual(sandals.gastos.map((row: any) => row.id), ['a2']);

  const foreign = toolByName(tools, 'listar_gastos_area').run({ area: 'Locaciones' }) as any;
  assert.deepEqual(foreign.gastos, []);
});

test('las herramientas globales aparecen sólo con el alcance correspondiente', () => {
  const scopedTools = buildAssistantTools(buildContext(areaLeadCapabilities)).map((tool) => tool.name);
  assert.ok(scopedTools.includes('buscar_proveedores'));
  assert.ok(scopedTools.includes('resumen_cajas'));
  assert.ok(!scopedTools.includes('listar_colaboradores'));

  const adminTools = buildAssistantTools(buildContext(adminCapabilities)).map((tool) => tool.name);
  assert.ok(adminTools.includes('listar_colaboradores'));
});

test('la navegación sólo permite pestañas habilitadas', () => {
  const scopedTools = buildAssistantTools(buildContext(areaLeadCapabilities));
  assert.deepEqual(toolByName(scopedTools, 'ir_a_pantalla').run({ pestana: 'areas' }), { abrirPestana: 'areas' });
  assert.ok((toolByName(scopedTools, 'ir_a_pantalla').run({ pestana: 'resultado' }) as any).error);

  const adminTools = buildAssistantTools(buildContext(adminCapabilities));
  assert.deepEqual(toolByName(adminTools, 'ir_a_pantalla').run({ pestana: 'resultado' }), { abrirPestana: 'resultado' });
});

test('los pagos pendientes descuentan lo ya pagado', () => {
  const capabilities = buildAssistantCapabilities({ ...baseProject, userId: 'owner-uid' });
  const context = buildContext(capabilities);
  context.budgetItems = [
    { id: 'b1', area: 'Arte', total: 1000, paymentHistory: [{ amount: 400 }], paymentDate: '2026-10-01' },
    { id: 'b2', area: 'Locaciones', total: 500, paid: true, paymentDate: '2026-09-20' },
  ];
  context.areaExpenses = [];

  const tools = buildAssistantTools(context);
  const pending = toolByName(tools, 'pagos_pendientes').run({}) as any;

  assert.equal(pending.pendientes.length, 1);
  assert.equal(pending.pendientes[0].id, 'b1');
  assert.equal(pending.pendientes[0].saldo, 600);
});

test('el resumen de cajas acota los movimientos de quien no ve todo el equipo', () => {
  const tools = buildAssistantTools(buildContext(areaLeadCapabilities));
  const cash = toolByName(tools, 'resumen_cajas').run({}) as any;

  assert.equal(cash.movimientos, 1);
  assert.equal(cash.totalesPorEstado.confirmed, 500);
});
