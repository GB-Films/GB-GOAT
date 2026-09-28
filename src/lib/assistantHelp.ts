export type AssistantHelpSection = {
  id: string;
  title: string;
  keywords: string[];
  content: string;
};

// Base de conocimiento de la app para el asistente. Es lógica de funcionamiento,
// no datos: se puede compartir con cualquier usuario, sin importar sus permisos.
export const ASSISTANT_HELP_SECTIONS: AssistantHelpSection[] = [
  {
    id: 'panorama',
    title: 'Cómo está organizada la app',
    keywords: ['panorama', 'general', 'empezar', 'como funciona', 'primeros pasos', 'que es goat'],
    content: [
      'GB GOAT organiza el trabajo por PROYECTO. Cada proyecto tiene su propio presupuesto, sus áreas, sus cajas, sus documentos y sus permisos.',
      'Dentro de un proyecto las pestañas son: Resumen, Presu Ppal, Áreas, Cajas, Finanzas, Documentos, Resultado, Proveedores, Equipo y Permisos.',
      'Resumen: datos generales del proyecto (nombre, cliente, empresa, fechas de rodaje, ubicación).',
      'Presu Ppal: el presupuesto principal, con sus categorías y partidas.',
      'Áreas: la gestión por áreas (el espacio donde cada responsable carga los gastos de su área).',
      'Cajas: la plata en efectivo que se entrega a cada responsable.',
      'Finanzas: calendario de pagos y saldos.',
      'Documentos: contratos, seguros, locaciones y otros archivos del proyecto.',
      'Resultado: análisis financiero (sólo administradores).',
      'Proveedores: base global de proveedores (se comparte entre proyectos).',
      'Equipo y Permisos: quién trabaja en el proyecto y qué puede hacer.',
      'Una categoría cargada en Presu Ppal puede además estar "activada" como área, para que la gestione un responsable con su propio equipo.',
    ].join('\n'),
  },
  {
    id: 'roles-permisos',
    title: 'Roles y permisos',
    keywords: ['permisos', 'rol', 'roles', 'acceso', 'no veo', 'habilitar', 'colaborador', 'jefe de area', 'jefe de produccion', 'administrador'],
    content: [
      'Hay dos niveles de permisos: el rol global de la persona en la app y el rol dentro de cada proyecto.',
      'Roles globales:',
      'Administrador: todo, en todos los proyectos. Crea proyectos, clientes, proveedores y usuarios.',
      'Ayudante Admin: ayuda con la base de proveedores y clientes; no administra usuarios.',
      'Jefe de Producción: acceso a las pestañas de producción y a la base de proveedores.',
      'Colaborador: sólo ve los proyectos donde fue invitado y lo que se le habilite.',
      'Roles dentro de un proyecto:',
      'Admin del proyecto (o dueño): todo el proyecto, incluido Presu Ppal, Permisos, Equipo y Resultado.',
      'Jefe de Producción: típicamente Áreas, Cajas, Finanzas, Documentos, Proveedores y Permisos (puede asignar áreas a colaboradores).',
      'Jefe de Área: sólo las áreas o subcategorías que le asignaron; puede cargar y editar gastos de esas áreas.',
      'Además de las pestañas, a cada colaborador se le habilitan ÁREAS completas o SUBCATEGORÍAS puntuales. Una subcategoría delegada no da acceso al resto del área.',
      'El permiso "puede editar áreas" habilita cargar y editar gastos; sin él, la persona sólo consulta.',
      'Existe la opción "Ve totales / Totales restringidos" en Permisos, pero hoy no cambia lo que se ve: todavía no tiene efecto.',
      'Si a alguien le falta una pestaña, un área o una subcategoría, lo habilita un administrador del proyecto desde Permisos (y se suma a la persona desde Equipo).',
    ].join('\n'),
  },
  {
    id: 'presupuesto-principal',
    title: 'Presu Ppal: cómo cargar el presupuesto',
    keywords: ['presu ppal', 'presupuesto principal', 'partida', 'partidas', 'categoria', 'categorias', 'cargar presupuesto', 'nueva categoria'],
    content: [
      'Presu Ppal es donde se carga el presupuesto del proyecto, organizado en categorías (por ejemplo Arte, Vestuario, Locaciones).',
      'Cómo cargar:',
      'Si la categoría no existe, se crea con el botón "Nueva Categoría".',
      'Se agrega una fila con el botón "+" del encabezado de la categoría o con "Nuevo Gasto" al final de la lista.',
      'En cada fila se completa proveedor, descripción, precio unitario y cantidad; el total se calcula solo (cantidad por precio unitario).',
      'Orden: las filas se reordenan arrastrando desde el ícono de puntitos (grip) a la izquierda de cada fila; las categorías también se pueden reordenar, y una fila se puede arrastrar a otra categoría.',
      'Borrar: la papelera de la fila elimina la partida; el tacho del encabezado elimina la categoría completa con todas sus partidas (pide confirmación).',
      'Restricciones importantes:',
      'Una categoría que está ACTIVA como área no se puede renombrar ni borrar desde Presu Ppal: esos gastos se gestionan desde la pestaña Áreas.',
      'Una partida con pagos registrados no se puede borrar, mover de categoría ni cambiar de importe: queda como historial financiero.',
      'La barra superior muestra el total del presupuesto visible según los permisos de cada usuario.',
    ].join('\n'),
  },
  {
    id: 'areas-activar',
    title: 'Áreas: activar una categoría como área',
    keywords: ['activar area', 'activar', 'gestion por areas', 'areas', 'migrar', 'responsable de area'],
    content: [
      'Activar un área convierte una categoría del presupuesto en un espacio de gestión con su propio responsable.',
      'Quién puede: sólo un administrador del proyecto, con el botón "Activar Nueva Área" arriba a la derecha de la pestaña Áreas.',
      'Qué pasa al activar:',
      'Las partidas de esa categoría que NO tienen pagos se copian a la gestión del área.',
      'La categoría deja de mostrarse en Presu Ppal: sus partidas quedan dentro del área.',
      'El área aparece en Áreas con su asignado, gastado y saldo.',
      'Si alguna partida de esa categoría ya tiene un pago registrado, la activación se bloquea: primero hay que resolver esos pagos.',
      'Cada área se puede asignar a un responsable (jefe de área) desde Permisos, con acceso completo al área o sólo a subcategorías puntuales.',
    ].join('\n'),
  },
  {
    id: 'areas-cargar-gastos',
    title: 'Áreas: cómo cargar un gasto',
    keywords: ['cargar gasto', 'cargar gastos', 'gasto de area', 'subcategoria', 'presupuesto por subcategoria', 'no me deja cargar'],
    content: [
      'En Áreas, cada responsable carga los gastos de su área o de la subcategoría que le delegaron.',
      'Cómo cargar: se entra al área (o a la subcategoría) y se usa el botón "+" o "Nuevo Gasto". Se completa proveedor, descripción, cantidad y precio unitario.',
      'Subcategorías:',
      'Se crean con el botón "Subcategoria" del encabezado del área.',
      'Cada subcategoría puede tener su propio presupuesto (botón "Presu") y notas.',
      'El sistema muestra asignado, gastado y saldo por subcategoría, y avisa cuando se supera lo asignado: el gasto se guarda igual y el saldo queda en rojo.',
      'Si se elimina una subcategoría, sus gastos no se borran: quedan como "Sin subcategoría".',
      'Orden: igual que en Presu Ppal, las filas se reordenan arrastrando desde el grip; el selector "Orden" permite ver por fecha de pago, proveedor o monto, y el buscador filtra los gastos.',
      'Quién puede cargar: un administrador del proyecto, o quien tenga el área completa o la subcategoría asignada y permiso de editar áreas. Si no aparece el botón, faltan permisos y los da un administrador desde Permisos.',
      'Las facturas y otros comprobantes se suben desde la propia fila (ver la sección de comprobantes).',
    ].join('\n'),
  },
  {
    id: 'areas-desactivar-eliminar',
    title: 'Áreas: desactivar o eliminar',
    keywords: ['desactivar area', 'eliminar area', 'borrar area', 'sacar area', 'baja de area'],
    content: [
      'En el encabezado del área hay dos acciones distintas, y sólo las puede hacer un administrador del proyecto.',
      '"Desactivar Gestión": el área deja de aparecer en Áreas, pero NO se borra nada. Las partidas vuelven a verse en Presu Ppal y los gastos cargados quedan guardados: si se reactiva el área, vuelven a aparecer.',
      '"Eliminar Área": borra todo lo cargado en esa gestión (gastos, partidas del área, subcategorías con sus presupuestos y los permisos de subcategorías de los colaboradores) y la saca de Áreas. La categoría queda en el proyecto, así que el área se puede volver a activar más adelante, vacía. Pide dos confirmaciones porque no se puede deshacer.',
      'En los dos casos, si el área tiene gastos con pagos registrados, la acción se bloquea: primero hay que resolver esos pagos, porque el historial financiero no se borra.',
    ].join('\n'),
  },
  {
    id: 'pagos',
    title: 'Pagos: cómo se registran y qué se bloquea',
    keywords: ['pago', 'pagos', 'pagar', 'parcial', 'total', 'saldo', 'caja efectivo', 'tercero', 'reintegro', 'corregir pago', 'borrar pago'],
    content: [
      'Los pagos se registran desde la fila del gasto, con el botón "Pago" (columna Pagado), tanto en Presu Ppal como en Áreas.',
      'Qué se completa: importe, fecha, detalle y el método:',
      'Caja efectivo: la plata sale de una caja de la app (Caja General o la caja personal de un responsable).',
      'Otro: transferencia u otro medio que no descuenta de las cajas de la app.',
      'Pago de tercero: lo pagó otra persona; el gasto queda saldado con el proveedor, la empresa le queda debiendo a esa persona y después se registra el "Reintegro" cuando se le devuelve la plata.',
      'Se puede pagar parcial o totalmente: la fila muestra el total pagado y el saldo pendiente.',
      'Una vez que un gasto tiene pagos:',
      'No se puede borrar, ni cambiar de área o subcategoría, ni cambiar proveedor, descripción, cantidad, precio o total. Queda con candado para proteger el historial financiero.',
      'Sólo un administrador puede corregir o eliminar un pago existente, y cada corrección o anulación queda auditada (con autor, fecha y motivo).',
      'Si se elimina el último pago, el gasto sigue marcado como que tuvo pagos (no vuelve a quedar editable como si nada hubiera pasado).',
      'Quién puede registrar pagos: un administrador del proyecto y, en Áreas, también el responsable del área o subcategoría.',
    ].join('\n'),
  },
  {
    id: 'cajas',
    title: 'Cajas: entregas, confirmaciones y saldos',
    keywords: ['caja', 'cajas', 'efectivo', 'entrega', 'confirmar', 'transferencia', 'devolucion', 'saldo de caja', 'quien tiene la plata'],
    content: [
      'La pestaña Cajas sirve para seguir la plata en efectivo que la productora entrega a cada responsable.',
      'Cómo funciona, paso a paso:',
      '1. Desde Caja General se registra una entrega a un responsable.',
      '2. La entrega queda pendiente hasta que esa persona confirma que la recibió.',
      '3. Con la recepción confirmada, el saldo queda disponible en su caja personal.',
      '4. Los pagos que hace con "Caja efectivo" descuentan de esa caja; también puede transferir plata a otro responsable o devolverla a Caja General.',
      'Quién ve qué: los administradores y jefes de producción ven el panorama completo (cuánto salió de Caja General, qué está pendiente de confirmación y cuánto tiene cada persona); un colaborador ve su propia caja y sus movimientos.',
      'Los reintegros a terceros también salen de una caja cuando se registran y quedan como "reintegro" en el historial.',
    ].join('\n'),
  },
  {
    id: 'comprobantes-facturas',
    title: 'Comprobantes, facturas y links de carga',
    keywords: ['factura', 'facturas', 'comprobante', 'comprobantes', 'subir factura', 'pendiente', 'archivo', 'pdf'],
    content: [
      'Cada gasto puede tener su factura y otros comprobantes, cargados desde la propia fila.',
      'Factura: se sube desde la columna Factura. Se aceptan PDF, JPG y PNG de hasta 2 MB. Al subirla, la fila queda con estado "pendiente".',
      'Se pueden adjuntar varias facturas al mismo gasto y también "otros comprobantes" (tickets, remitos, capturas).',
      'Comprobantes de pago: al registrar un pago se puede adjuntar el comprobante (transferencia, recibo).',
      'Quitar archivos: lo puede hacer un administrador, o quien tenga permiso de edición sobre esa área o subcategoría.',
      'Link público de carga de factura: desde una fila se puede generar un link para que el proveedor suba la factura sin tener cuenta en la app. El archivo queda asociado a ese gasto.',
      'En filas con pagos, los comprobantes de pagos existentes no se pueden reemplazar: forman parte del historial.',
    ].join('\n'),
  },
  {
    id: 'proveedores',
    title: 'Proveedores: asignar, crear y link de alta',
    keywords: ['proveedor', 'proveedores', 'alta de proveedor', 'link', 'invitacion', 'cuit', 'cbu', 'alias', 'no encuentra el proveedor'],
    content: [
      'La base de proveedores es global: se comparte entre todos los proyectos.',
      'Asignar un proveedor a un gasto: en la fila, la celda de proveedor abre el buscador ("Asignar Proveedor"). Si no existe, se puede generar un link de alta.',
      'Crear un proveedor manualmente (pestaña Proveedores): lo pueden hacer Administrador, Ayudante Admin y Jefe de Producción.',
      'Link de alta de proveedor: el proveedor completa sus datos (nombre, CUIT o CUIL, contacto, CBU o alias) y queda dado de alta en la base.',
      'Desde la pestaña Proveedores: un solo uso (vence en 1 día) o multiuso (1 a 4 días, sirve para varias altas).',
      'Desde una fila de gasto: un solo uso, vence en 7 días y queda atado a ese gasto: cuando el proveedor completa el alta, se asigna automáticamente a la fila.',
      'Errores típicos con los links y qué significan:',
      '"Este link ya fue utilizado", "fue cancelado" o "venció": hay que generar uno nuevo.',
      '"Ya existe una persona o empresa con este DNI o CUIT": el proveedor ya está cargado; hay que asignarlo desde la fila.',
      '"Este gasto ya tiene un proveedor asignado": se asignó otro proveedor; si corresponde, se genera un link nuevo.',
      '"El gasto ya tiene pagos registrados": no se le puede asignar proveedor por link, porque el historial financiero ya está cerrado.',
      'El CBU se carga con 22 números; si no hay CBU, se puede completar sólo el alias.',
    ].join('\n'),
  },
  {
    id: 'documentos',
    title: 'Documentos del proyecto',
    keywords: ['documentos', 'contrato', 'seguro', 'locacion', 'archivos del proyecto'],
    content: [
      'La pestaña Documentos guarda los archivos del proyecto: contratos, seguros, locaciones, finanzas y otros.',
      'Se pueden filtrar por familia, tipo, área o buscar por texto.',
      'Subir: lo puede hacer un administrador del proyecto, o un jefe de producción que tenga la pestaña Documentos habilitada. Se aceptan PDF, JPG, PNG y WEBP de hasta 2 MB.',
      'Eliminar documentos: sólo un administrador del proyecto.',
    ].join('\n'),
  },
  {
    id: 'finanzas-resultado',
    title: 'Finanzas y Resultado',
    keywords: ['finanzas', 'saldos', 'resultado', 'margen', 'incidencias', 'calendario de pagos', 'vencimientos'],
    content: [
      'Finanzas (saldos) muestra el calendario de pagos: qué vence, qué está vencido y qué falta agendar. Se puede filtrar por área, estado y búsqueda, y programar la fecha de pago de cada gasto.',
      'Resultado es el análisis financiero del proyecto y sólo lo ven los administradores. Incluye incidencias (imprevistos, impuestos, financiación) y el margen.',
      'Cómo se leen los pagos: un gasto con pagos parciales sigue mostrando saldo; un pago de tercero cuenta como costo del proyecto y genera una deuda con esa persona hasta que se reintegra.',
    ].join('\n'),
  },
  {
    id: 'errores-comunes',
    title: 'Problemas frecuentes y qué hacer',
    keywords: ['no puedo', 'error', 'no me deja', 'no veo', 'problema', 'ayuda', 'no aparece', 'se bloqueo'],
    content: [
      '"No veo una pestaña o un área": faltan permisos. Los habilita un administrador del proyecto desde Permisos (pestañas, áreas y subcategorías).',
      '"No me deja cargar un gasto": puede ser que no tengas el área o la subcategoría asignada, que falte el permiso de editar áreas, o que el área esté inactiva.',
      '"No puedo borrar o cambiar un gasto": tiene pagos registrados. Sólo un administrador puede corregir el pago (queda auditado) o eliminar el gasto con su historial.',
      '"No puedo activar o borrar un área": hay partidas o gastos con pagos en esa área.',
      '"El link del proveedor no funciona": venció, ya se usó, se dio de baja, o el gasto cambió (se le asignó proveedor o recibió un pago).',
      '"Los números no me coinciden": revisá si el área está activa (sus partidas no se muestran en Presu Ppal), si hay incidencias cargadas en Resultado, o si estás viendo sólo tus áreas asignadas.',
      '"Subí un archivo y no aparece": puede haber fallado por tamaño (máximo 2 MB) o por formato (PDF, JPG o PNG).',
      'Si algo no se puede resolver desde la app, lo más rápido es avisarle a un administrador del proyecto con la pantalla a la vista.',
    ].join('\n'),
  },
  {
    id: 'asistente',
    title: 'Qué puede hacer el asistente',
    keywords: ['asistente', 'bot', 'que podes hacer', 'como funcionas', 'planilla', 'excel', 'puedo pedirte'],
    content: [
      'El asistente puede:',
      'Consultar y resumir la información que vos podés ver (proyectos, áreas, gastos, pagos, cajas, proveedores).',
      'Explicar cómo funciona cualquier parte de la app, aunque no tengas permiso para ver esos datos.',
      'Crear partidas y gastos de área, y cargar planillas de Excel o CSV: siempre pide confirmación antes de guardar.',
      'Llevarte a una pantalla ("abrí Áreas de tal proyecto").',
      'Lo que nunca hace: mostrar datos de proyectos, áreas o personas que no están dentro de tus permisos.',
      'Las planillas que se adjuntan no se guardan: se leen en el navegador y se usan sólo en esa conversación.',
      'Para acciones destructivas (borrar, pagar, cambiar permisos) todavía no está habilitado: eso se hace desde la app.',
    ].join('\n'),
  },
];

const normalize = (value: unknown) => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim();

export const listAssistantHelpTopics = () => ASSISTANT_HELP_SECTIONS.map((section) => ({
  id: section.id,
  titulo: section.title,
}));

const HELP_STOPWORDS = new Set([
  'para', 'como', 'donde', 'cuando', 'puedo', 'puede', 'pueden', 'hacer', 'hago', 'tengo',
  'este', 'esta', 'esto', 'algo', 'todo', 'toda', 'algun', 'alguno', 'una', 'uno', 'unos',
  'los', 'las', 'del', 'que', 'por', 'con', 'sin', 'mas', 'muy', 'sobre', 'desde', 'hasta',
  'entre', 'porque', 'solo', 'tambien', 'aca', 'ahi', 'alla', 'seria', 'tiene', 'hay',
]);

// Devuelve las secciones que mejor responden a la consulta del usuario.
export const searchAssistantHelp = (query: unknown, limit = 3) => {
  const text = normalize(query);
  if (!text) return ASSISTANT_HELP_SECTIONS.slice(0, limit);
  const words = text.split(/\s+/).filter((word) => word.length > 3 && !HELP_STOPWORDS.has(word));

  const scored = ASSISTANT_HELP_SECTIONS.map((section) => {
    const title = normalize(section.title);
    const content = normalize(section.content);
    let score = 0;
    if (title.includes(text)) score += 10;
    const keywords = section.keywords.map(normalize).filter(Boolean);
    keywords.forEach((keyword) => {
      if (keyword === text) score += 8;
      else if (keyword.length > 3 && text.includes(keyword)) score += 5;
      else if (keyword.length > 3 && keyword.includes(text)) score += 4;
    });
    words.forEach((word) => {
      if (title.includes(word)) score += 2;
      if (keywords.some((keyword) => keyword.includes(word))) score += 1;
      if (content.includes(word)) score += 0.5;
    });
    return { section, score };
  });

  const matches = scored.filter((entry) => entry.score > 0);
  if (matches.length === 0) {
    return ASSISTANT_HELP_SECTIONS.filter((section) => section.id === 'panorama').slice(0, limit);
  }
  return matches
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.section);
};
