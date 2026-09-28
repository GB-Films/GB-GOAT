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
