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

const projectList = [
  { id: 'proj-1', name: 'Largometraje', clientName: 'Cliente A' },
  { id: 'proj-2', name: 'Spot', clientName: 'Cliente B' },
];

const buildContext = (): AssistantProjectContext => ({
  projectId: baseProject.projectId,
  projectName: baseProject.projectName,
  userEmail: 'area@example.com',
  capabilities: areaLeadCapabilities,
  meta: {
    clientName: 'Cliente A',
    companyName: 'Gran Berta Films',
    status: 'Rodaje',
    budgetTotal: 10000,
    shootingStartDate: '2026-10-01',
    shootingEndDate: '2026-10-20',
    location: 'Buenos Aires',
    resultIncidences: { imprevistos: 5, margen: 10 },
  },
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
  collaborators: [],
  documents: [],
});

const buildTools = (options: Partial<Parameters<typeof buildAssistantTools>[0]> = {}) => buildAssistantTools({
  listProjects: async () => projectList,
  loadProject: async (projectId) => (projectId === 'proj-1' ? buildContext() : null),
  currentProjectId: 'proj-1',
  ...options,
});

const runTool = async (
  tools: ReturnType<typeof buildAssistantTools>,
  name: string,
  args: any = {},
) => {
  const tool = tools.find((entry) => entry.name === name);
  assert.ok(tool, `Falta la herramienta ${name}`);
  return await tool.run(args) as any;
};

test('el asistente lista los proyectos del usuario', async () => {
  const result = await runTool(buildTools(), 'listar_proyectos');

  assert.equal(result.total, 2);
  assert.deepEqual(result.proyectos.map((project: any) => project.nombre), ['Largometraje', 'Spot']);
});

test('sin proyecto indicado usa el que está abierto en pantalla', async () => {
  const summary = await runTool(buildTools(), 'resumen_proyecto');

  assert.equal(summary.proyecto, 'Largometraje');
  assert.equal(summary.presupuestoPrincipal, 1000);
  assert.equal(summary.gastosDeAreas, 500);
  assert.equal(summary.partidas, 1);
  assert.equal(summary.gastosCargados, 2);
});

test('un proyecto por nombre se resuelve y respeta el acceso', async () => {
  const denied = await runTool(buildTools(), 'resumen_proyecto', { proyecto: 'Spot' });
  assert.match(denied.error, /No tenés acceso/);

  const unknown = await runTool(buildTools(), 'resumen_proyecto', { proyecto: 'Película inexistente' });
  assert.match(unknown.error, /No encontré el proyecto/);
});

test('los listados respetan área y subcategoría delegadas', async () => {
  const tools = buildTools();
  const all = await runTool(tools, 'listar_gastos_area');
  assert.deepEqual(all.gastos.map((row: any) => row.id), ['a1', 'a2']);

  const shoes = await runTool(tools, 'listar_gastos_area', { subcategoria: 'Zapatos' });
  assert.deepEqual(shoes.gastos.map((row: any) => row.id), ['a2']);

  const foreign = await runTool(tools, 'listar_gastos_area', { area: 'Locaciones' });
  assert.deepEqual(foreign.gastos, []);
});

test('el detalle del proyecto muestra el alcance real', async () => {
  const detail = await runTool(buildTools(), 'detalle_proyecto');

  assert.match(detail.resumen, /jefe de área/);
  assert.deepEqual(detail.areas, [
    { area: 'Arte', acceso: 'completa' },
    { area: 'Vestuario', acceso: ['Zapatos'] },
  ]);
});

test('las herramientas globales aparecen sólo con el alcance correspondiente', () => {
  const withProviders = buildTools({
    canAccessProviders: true,
    loadProviders: async () => [{ id: 'p1', name: 'Rental', lastName: 'Sur', category: 'Técnica' }],
  }).map((tool) => tool.name);
  assert.ok(withProviders.includes('buscar_proveedores'));

  const withoutProviders = buildTools().map((tool) => tool.name);
  assert.ok(!withoutProviders.includes('buscar_proveedores'));
  assert.ok(withoutProviders.includes('listar_colaboradores'));
});

test('la navegación sólo permite pestañas habilitadas', async () => {
  const tools = buildTools();
  assert.deepEqual(
    await runTool(tools, 'ir_a_pantalla', { pestana: 'areas' }),
    { abrirProyecto: 'proj-1', pestana: 'areas' },
  );
  assert.ok((await runTool(tools, 'ir_a_pantalla', { pestana: 'resultado' })).error);
});

test('los pagos pendientes descuentan lo ya pagado', async () => {
  const context = buildContext();
  context.budgetItems = [
    { id: 'b1', area: 'Arte', total: 1000, paymentHistory: [{ amount: 400 }], paymentDate: '2026-10-01' },
    { id: 'b2', area: 'Locaciones', total: 500, paid: true, paymentDate: '2026-09-20' },
  ];
  context.areaExpenses = [];

  const tools = buildTools({ loadProject: async () => context });
  const pending = await runTool(tools, 'pagos_pendientes');

  assert.equal(pending.pendientes.length, 1);
  assert.equal(pending.pendientes[0].id, 'b1');
  assert.equal(pending.pendientes[0].saldo, 600);
});

test('el resumen de cajas acota los movimientos de quien no ve todo el equipo', async () => {
  const cash = await runTool(buildTools(), 'resumen_cajas');

  assert.equal(cash.movimientos, 1);
  assert.equal(cash.totalesPorEstado.confirmed, 500);
});

test('los colaboradores sólo se exponen si el usuario puede verlos', async () => {
  const withoutPermission = await runTool(buildTools(), 'listar_colaboradores');
  assert.match(withoutPermission.error, /no tiene permiso/);

  const context = buildContext();
  context.collaborators = [{ email: 'area@example.com', displayName: 'Jefa de Área', role: 'jefe_area' }];
  const withPermission = await runTool(buildTools({ loadProject: async () => context }), 'listar_colaboradores');
  assert.equal(withPermission.colaboradores.length, 1);
});

test('las acciones de escritura piden confirmación y respetan los permisos', async () => {
  const tools = buildTools();
  const createExpense = tools.find((tool) => tool.name === 'crear_gasto_area');
  const createBudgetItem = tools.find((tool) => tool.name === 'crear_partida');

  assert.equal(createExpense?.requiresConfirmation, true);
  assert.equal(createBudgetItem?.requiresConfirmation, true);
  assert.match(
    String(createExpense?.summarize?.({ area: 'Arte', descripcion: 'Pintura', cantidad: 2, precioUnitario: 1500 })),
    /Cargar gasto en Arte/,
  );
  assert.match(
    String(createExpense?.summarize?.({ area: 'Arte', descripcion: 'Pintura', cantidad: 2, precioUnitario: 1500 })),
    /\$3\.000/,
  );

  // Un jefe de área no puede tocar el presupuesto principal.
  const denied = await createBudgetItem?.run({ area: 'Arte', descripcion: 'Cámara', cantidad: 1, precioUnitario: 100 });
  assert.match(String((denied as any).error), /presupuesto principal/);

  // Ni cargar gastos en un área que no tiene asignada ni sin precio.
  const foreignArea = await createExpense?.run({ area: 'Locaciones', descripcion: 'Estudio', cantidad: 1, precioUnitario: 100 });
  assert.match(String((foreignArea as any).error), /no tiene permiso/);

  const missingPrice = await createExpense?.run({ area: 'Arte', descripcion: 'Pintura', cantidad: 1 });
  assert.match(String((missingPrice as any).error), /precio unitario/);
});

test('la carga en lote avisa los problemas antes de escribir nada', async () => {
  // Locaciones queda activa pero fuera del alcance del usuario, para probar el
  // mensaje de permisos además del de área inactiva.
  const context = buildContext();
  context.activeAreas = ['Arte', 'Locaciones'];
  const tools = buildTools({ loadProject: async () => context });
  const batch = tools.find((tool) => tool.name === 'cargar_gastos_lote');

  assert.equal(batch?.requiresConfirmation, true);
  assert.match(
    String(batch?.summarize?.({
      filas: [
        { area: 'Arte', descripcion: 'Pintura', cantidad: 2, precioUnitario: 1500 },
        { area: 'Arte', descripcion: 'Rodillo', cantidad: 1, precioUnitario: 500 },
      ],
    })),
    /Cargar 2 gastos en Gestión por Áreas \(Arte: 2\)/,
  );

  const result = await batch?.run({
    filas: [
      { area: 'Arte', descripcion: '', cantidad: 1, precioUnitario: 100 },
      { area: 'Locaciones', descripcion: 'Estudio', cantidad: 1, precioUnitario: 100 },
      { area: 'Vestuario', subcategoria: 'Zapatos', descripcion: 'Botas', cantidad: 1, precioUnitario: 100 },
      { area: 'Arte', descripcion: 'Sin precio', cantidad: 1 },
    ],
  }) as any;

  assert.match(result.error, /No cargué nada/);
  assert.deepEqual(result.problemas.map((problem: any) => problem.fila), [1, 2, 3, 4]);
  assert.match(result.problemas[0].problema, /descripción/);
  assert.match(result.problemas[1].problema, /no tiene permiso/);
  assert.match(result.problemas[2].problema, /no está activa/);
  assert.match(result.problemas[3].problema, /precio unitario/);
});

test('la ayuda de la app está disponible sin permisos de proyecto', async () => {
  const tools = buildTools({ loadProject: async () => null });
  const help = await runTool(tools, 'consultar_ayuda', { tema: 'cómo cargo un gasto' });

  assert.ok(help.secciones.length > 0);
  assert.match(JSON.stringify(help.secciones), /cargar/i);
});

test('que_puedo_hacer explica el rol, las áreas y lo que falta pedir', async () => {
  const result = await runTool(buildTools(), 'que_puedo_hacer');

  assert.equal(result.rol, 'jefe_area');
  assert.match(result.resumen, /jefe de área/);
  assert.deepEqual(result.areas, [
    { area: 'Arte', acceso: 'completa' },
    { area: 'Vestuario', acceso: ['Zapatos'] },
  ]);
  assert.ok(result.sinAcceso.includes('Resultado'));
  assert.match(result.comoAmpliar, /Pedile|pedirle/i);
});

test('datos_proyecto devuelve cliente, fechas y presupuesto estimado', async () => {
  const data = await runTool(buildTools(), 'datos_proyecto');

  assert.equal(data.cliente, 'Cliente A');
  assert.equal(data.estado, 'Rodaje');
  assert.equal(data.presupuestoEstimado, 10000);
  assert.equal(data.rodajeHasta, '2026-10-20');
});

test('el Resultado sólo se comparte con administradores', async () => {
  const denied = await runTool(buildTools(), 'resultado_proyecto');
  assert.match(denied.error, /no tiene permiso/i);
});

test('el Resultado calcula margen, incidencias y costos por área', async () => {
  const adminCapabilities = buildAssistantCapabilities({ ...baseProject, userId: 'owner-uid' });
  const context = { ...buildContext(), capabilities: adminCapabilities };
  const tools = buildTools({ loadProject: async () => context });

  const result = await runTool(tools, 'resultado_proyecto');

  assert.equal(result.venta, 10000);
  assert.equal(result.costosDirectos, 1550);
  assert.equal(result.incidenciasDeGasto, 500);
  assert.equal(result.costoTotal, 2050);
  assert.equal(result.margenEstimado, 7950);
  assert.equal(result.margen, 8950);
  assert.equal(result.margenPorcentaje, 89.5);
  assert.deepEqual(result.costosPorArea, [
    { area: 'Arte', costo: 300 },
    { area: 'Vestuario', costo: 350 },
    { area: 'Locaciones', costo: 900 },
  ]);
  assert.ok(result.incidencias.some((incidence: any) => incidence.incidencia === 'Imprevistos' && incidence.monto === 500));
});

test('los pagos próximos separan vencidos de los que vienen', async () => {
  const context = buildContext();
  const today = new Date();
  const inTenDays = new Date(today.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  context.budgetItems = [
    { id: 'b1', area: 'Arte', total: 1000, paymentHistory: [{ amount: 400 }], paymentDate: '2026-09-20' },
    { id: 'b2', area: 'Arte', total: 500, paymentDate: inTenDays },
  ];
  context.areaExpenses = [];
  const tools = buildTools({ loadProject: async () => context });

  const upcoming = await runTool(tools, 'pagos_proximos', { dias: 30 });

  assert.equal(upcoming.total, 2);
  assert.equal(upcoming.vencidos, 1);
  assert.equal(upcoming.pagos[1].vencido, false);
  assert.equal(upcoming.pagos[0].saldo, 600);
});

test('lista los documentos del proyecto con filtros', async () => {
  const context = buildContext();
  context.documents = [
    { id: 'd1', family: 'contratos', type: 'Contrato proveedor', title: 'Contrato Rental', area: 'Arte', expirationDate: '2026-01-01', url: 'https://x/1' },
    { id: 'd2', family: 'seguros', type: 'ART', title: 'Seguro producción', area: '', expirationDate: '2030-01-01', url: 'https://x/2' },
  ];
  const tools = buildTools({ loadProject: async () => context });

  const all = await runTool(tools, 'listar_documentos');
  assert.equal(all.total, 2);
  assert.deepEqual(all.porFamilia, { contratos: 1, seguros: 1 });
  assert.equal(all.documentos[0].vencido, true);

  const contracts = await runTool(tools, 'listar_documentos', { familia: 'contratos' });
  assert.equal(contracts.total, 1);
  assert.equal(contracts.documentos[0].titulo, 'Contrato Rental');
});

test('los saldos de caja se acotan a la caja del usuario', async () => {
  const result = await runTool(buildTools(), 'saldos_cajas');

  assert.equal(result.alcance, 'sólo la caja del usuario');
  assert.deepEqual(result.saldosPorResponsable, [
    { persona: 'area@example.com', email: 'area@example.com', saldo: 500 },
  ]);
  assert.equal(result.entregasPendientes.length, 0);
});

test('un administrador ve el resumen completo de cajas', async () => {
  const adminCapabilities = buildAssistantCapabilities({ ...baseProject, userId: 'owner-uid' });
  const context = { ...buildContext(), capabilities: adminCapabilities };
  const result = await runTool(buildTools({ loadProject: async () => context }), 'saldos_cajas');

  assert.equal(result.alcance, 'todo el equipo');
  assert.equal(result.cajaGeneral.entregasConfirmadas, 500);
});

test('el resumen general suma los proyectos visibles y marca alertas', async () => {
  const tools = buildTools({
    loadProjectFinance: async (projectId) => (projectId === 'proj-1'
      ? {
        projectId, name: 'Largometraje', status: 'Rodaje', clientName: 'Cliente A',
        budgetTotal: 10000, spent: 9000, paid: 4000, margin: 1000, debt: 5000, pendingLines: 3, usagePercent: 90, overBudget: 0,
        payableLines: [],
      }
      : null),
  });

  const summary = await runTool(tools, 'dashboard_proyectos');

  assert.equal(summary.proyectosIncluidos, 1);
  assert.equal(summary.totales.presupuesto, 10000);
  assert.equal(summary.totales.deuda, 5000);
  assert.equal(summary.proyectos[0].nombre, 'Largometraje');
  assert.deepEqual(summary.alertas[0].motivos, ['al 90% del presupuesto', 'deuda $5.000']);
});

test('lista el equipo del proyecto con el personal por rubro', async () => {
  const context = buildContext();
  context.collaborators = [{ email: 'area@example.com', displayName: 'Jefa de Área', role: 'jefe_area' }];
  const adminCapabilities = buildAssistantCapabilities({ ...baseProject, userId: 'owner-uid' });
  const tools = buildTools({ loadProject: async () => ({ ...context, capabilities: adminCapabilities }) });

  const team = await runTool(tools, 'listar_equipo');

  assert.equal(team.colaboradores.length, 1);
  assert.deepEqual(team.personalPorRubro[0], {
    area: 'Arte',
    personas: [{ proveedor: 'Rental Sur', detalle: 'Cámara', total: 1000 }],
  });
});

test('clientes y usuarios sólo están para administradores de la aplicación', () => {
  const withoutAdmin = buildTools().map((tool) => tool.name);
  assert.ok(!withoutAdmin.includes('listar_clientes'));
  assert.ok(!withoutAdmin.includes('listar_usuarios'));
  assert.ok(!withoutAdmin.includes('reportes_pagos'));

  const withAdmin = buildTools({
    isAppAdmin: true,
    loadClients: async () => [{ id: 'c1', businessName: 'Gran Berta Films', contactName: 'Ana', email: 'ana@x.com' }],
    loadUsers: async () => [{ id: 'u1', email: 'ana@x.com', displayName: 'Ana', role: 'admin' }],
    loadProjectFinance: async () => null,
  }).map((tool) => tool.name);
  assert.ok(withAdmin.includes('listar_clientes'));
  assert.ok(withAdmin.includes('listar_usuarios'));
  assert.ok(withAdmin.includes('reportes_pagos'));
});

test('busca clientes y usuarios con filtros', async () => {
  const tools = buildTools({
    isAppAdmin: true,
    loadClients: async () => [
      { id: 'c1', businessName: 'Gran Berta Films', contactName: 'Ana', email: 'ana@x.com' },
      { id: 'c2', businessName: 'Cervecería Quilmes', contactName: 'Luis' },
    ],
    loadUsers: async () => [
      { id: 'u1', email: 'ana@x.com', displayName: 'Ana', role: 'admin' },
      { id: 'u2', email: 'jefe@x.com', displayName: 'Jefe', role: 'jefe_produccion' },
    ],
  });

  const clients = await runTool(tools, 'listar_clientes', { texto: 'quilmes' });
  assert.equal(clients.total, 1);
  assert.equal(clients.clientes[0].nombre, 'Cervecería Quilmes');

  const admins = await runTool(tools, 'listar_usuarios', { rol: 'admin' });
  assert.equal(admins.total, 1);
  assert.equal(admins.usuarios[0].nombre, 'Ana');
});

test('el reporte de pagos separa vencidos, hoy, mes y sin fecha', async () => {
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const tools = buildTools({
    isAppAdmin: true,
    loadProjectFinance: async (projectId) => (projectId === 'proj-1' ? {
      projectId,
      name: 'Largometraje',
      status: 'Rodaje',
      clientName: 'Cliente A',
      budgetTotal: 10000,
      spent: 5000,
      paid: 2000,
      margin: 5000,
      debt: 3000,
      pendingLines: 3,
      usagePercent: 50,
      overBudget: 0,
      payableLines: [
        { id: 'l1', projectId, projectName: 'Largometraje', area: 'Arte', providerName: 'Rental', description: 'Cámara', total: 1000, paid: 0, debt: 1000, paymentDate: '2026-01-01', source: 'budget' as const },
        { id: 'l2', projectId, projectName: 'Largometraje', area: 'Arte', providerName: 'Ferretería', description: 'Pintura', total: 500, paid: 0, debt: 500, paymentDate: todayKey, source: 'area' as const },
        { id: 'l3', projectId, projectName: 'Largometraje', area: 'Vestuario', providerName: 'Zapatería', description: 'Botas', total: 1500, paid: 0, debt: 1500, paymentDate: '', source: 'area' as const },
      ],
    } : null),
  });

  const report = await runTool(tools, 'reportes_pagos');

  assert.equal(report.totalPendiente, 3000);
  assert.equal(report.vencidos.cantidad, 1);
  assert.equal(report.deHoy.monto, 500);
  assert.equal(report.sinFechaProgramada.monto, 1500);
  assert.equal(report.porProyecto[0].proyecto, 'Largometraje');
});
