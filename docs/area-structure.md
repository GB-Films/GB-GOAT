# Clasificación de gastos de Áreas

`manageProviderFinance` acepta `action: reclassifyAreaExpenses` para renombrar/reordenar una subcategoría completa, trasladarla a otra área activa o mover/reordenar un gasto individual. El cliente no copia ni recrea filas. Los tiradores de subcategoría permiten arrastrar grupos completos; un grupo colapsado sigue siendo destino para gastos y los grupos completos pueden alcanzar áreas colapsadas o fuera de la ventana mediante desplazamiento automático.

## Identidad y consistencia

Una transacción lee proyecto, filas, permisos y documentos vinculados antes de escribir. Cambia únicamente área, subcategoría, orden y metadatos de actualización (`updatedAt`, `areaStructureRevision`), y avanza `budgetRevision`. Conserva `projectId/collectionName/itemId`, proveedor, descripción, importes, historial de pagos, autores, cuentas, archivos y firmas. No ejecuta pagos ni crea movimientos de caja.

Las asignaciones y liquidaciones de documentos financieros compartidos conservan su tupla e importes; sólo actualizan su clasificación. Los índices derivados del proyecto y las etiquetas de movimientos individuales de caja acompañan al gasto. Los movimientos agregados compartidos y las asignaciones de otros proyectos permanecen intactos. Las declaraciones firmadas siguen apuntando a la misma tupla. No se trasladan archivos ni se reescriben firmas, huellas fiscales o de idempotencia.

Una subcategoría completa lleva su presupuesto y sus permisos/exclusiones explícitos al nuevo nombre o área. La asignación debe caber en el presupuesto de destino. El acceso heredado por área sigue el área de destino, como indica la confirmación del traslado. Renombrar desde el editor conserva la versión del presupuesto abierto y rechaza sobrescribir cambios de otro usuario.

## Acceso e intentos repetidos

La operación exige sesión verificada, perfil de equipo habilitado, pertenencia al proyecto y edición de origen y destino, incluidas exclusiones. Los colaboradores con edición sobre las categorías de origen y destino pueden renombrar, mover y reordenar grupos completos, sin exigir rol de administrador. Una exclusión sobre el grupo involucrado impide la operación; excluir otro grupo no bloquea los grupos permitidos. Un permiso aislado sobre una subcategoría permite mover sus gastos al alcance autorizado, pero no reorganizar la categoría completa.

Organizar grupos conserva su presupuesto y no concede permiso para editar asignaciones. El editor de nombre muestra sólo ese campo cuando la persona no administra presupuestos; el servidor rechaza que se agregue una modificación de presupuesto a esa solicitud. Administración y los jefes de producción con acceso completo al área conservan sus permisos presupuestarios existentes.

El identificador de operación y su contenido quedan en una auditoría inmutable. Un reintento con la misma solicitud reconoce la operación anterior y devuelve la ubicación actual de sus filas; no vuelve a mover ni restaura una ubicación antigua. El cliente conserva ese intento si no puede confirmar el resultado. Un origen, revisión o presupuesto desactualizado produce un mensaje para actualizar y reintentar, sin escrituras parciales. Los pagos concurrentes se preservan al releer dentro de la transacción.

La pantalla escucha en vivo las filas, la estructura del proyecto y los permisos. Muestra provisionalmente la ubicación al soltar un gasto y abre el destino; si el servidor rechaza el cambio, descarta esa proyección. La respuesta confirmada incluye sólo ubicaciones y estructura, sin campos financieros, y se aplica sin esperar una recarga conjunta de catálogos. Las instantáneas retrasadas no pueden retroceder una ubicación ya confirmada (`areaStructureRevision`), pero sí actualizan pagos y archivos concurrentes. La escucha estructural no incorpora información comercial privada. Al cambiar de proyecto o cuenta se descartan las respuestas de la vista anterior.

Los límites explícitos son 2.000 gastos, 2.000 movimientos de caja consultados, 2.000 partidas presupuestarias consultadas, 300 colaboradores consultados, 150 documentos financieros vinculados y 449 escrituras previas a la auditoría. Una operación que los supera se rechaza íntegramente. Las reglas de identidad financiera del SDK permanecen sin cambios.

## Validación y activación

`tests/areaStructureChange.emulator.mjs` ejecuta la operación real con datos ficticios en Firestore local: renombrado, grupo predeterminado, mayúsculas, orden, traslados pagados, presupuesto, permisos, comprobantes compartidos, declaraciones, índices, caja y concurrencia. Incluye observadores SDK de administrador y colaborador sujetos a las reglas reales, con varios movimientos sucesivos y cambios de permisos sin recargar. Se incorpora a `test:portal-rules`. Las pruebas del cliente verifican destinos colapsados, proyección inmediata, instantáneas retrasadas, campos financieros concurrentes, identificadores, errores e intentos repetidos.

Para activar este cambio, una vez autorizada su publicación: desplegar únicamente `manageProviderFinance` y después la web. No requiere migración de datos ni cambios de reglas, Auth, Storage o IAM.
