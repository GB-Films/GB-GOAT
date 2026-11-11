# Clasificación de gastos de Áreas

`manageProviderFinance` acepta `action: reclassifyAreaExpenses` para renombrar/reordenar una subcategoría completa, trasladarla a otra área activa o mover/reordenar un gasto individual. El cliente no copia ni recrea filas. Los tiradores de subcategoría permiten arrastrar grupos completos; un grupo colapsado sigue siendo destino para gastos y los grupos completos pueden alcanzar áreas colapsadas o fuera de la ventana mediante desplazamiento automático.

## Identidad y consistencia

Una transacción lee proyecto, filas, permisos y documentos vinculados antes de escribir. Cambia únicamente área, subcategoría, orden y fechas de actualización, y avanza `budgetRevision`. Conserva `projectId/collectionName/itemId`, proveedor, descripción, importes, historial de pagos, autores, cuentas, archivos y firmas. No ejecuta pagos ni crea movimientos de caja.

Las asignaciones y liquidaciones de documentos financieros compartidos conservan su tupla e importes; sólo actualizan su clasificación. Los índices derivados del proyecto y las etiquetas de movimientos individuales de caja acompañan al gasto. Los movimientos agregados compartidos y las asignaciones de otros proyectos permanecen intactos. Las declaraciones firmadas siguen apuntando a la misma tupla. No se trasladan archivos ni se reescriben firmas, huellas fiscales o de idempotencia.

Una subcategoría completa lleva su presupuesto y sus permisos/exclusiones explícitos al nuevo nombre o área. La asignación debe caber en el presupuesto de destino. El acceso heredado por área sigue el área de destino, como indica la confirmación del traslado. Renombrar desde el editor conserva la versión del presupuesto abierto y rechaza sobrescribir cambios de otro usuario.

## Acceso e intentos repetidos

La operación exige sesión verificada, perfil de equipo habilitado, pertenencia al proyecto y edición de origen y destino, incluidas exclusiones. Sólo administración del proyecto puede mover/reordenar grupos completos. El jefe de producción conserva la posibilidad de renombrar dentro de un área completa de su alcance, sin exclusiones. Mover gastos individuales mantiene el alcance de edición existente.

El identificador de operación y su contenido quedan en una auditoría inmutable. Un reintento con la misma solicitud devuelve el resultado anterior; no vuelve a mover. El cliente conserva ese intento también si la respuesta o la actualización de pantalla falla. Un origen, revisión o presupuesto desactualizado produce un mensaje para actualizar y reintentar, sin escrituras parciales. Los pagos concurrentes se preservan al releer dentro de la transacción.

Los límites explícitos son 2.000 gastos, 2.000 movimientos de caja consultados, 2.000 partidas presupuestarias consultadas, 300 colaboradores consultados, 150 documentos financieros vinculados y 449 escrituras previas a la auditoría. Una operación que los supera se rechaza íntegramente. Las reglas de identidad financiera del SDK permanecen sin cambios.

## Validación y activación

`tests/areaStructureChange.emulator.mjs` ejecuta la operación real con datos ficticios en Firestore local: renombrado, grupo predeterminado, mayúsculas, orden, traslados pagados, presupuesto, permisos, comprobantes compartidos, declaraciones, índices, caja y concurrencia. Se incorpora a `test:portal-rules`. Las pruebas del cliente verifican destinos colapsados, identificadores, errores e intentos repetidos.

Para activar este cambio, una vez autorizada su publicación: desplegar únicamente `manageProviderFinance` y después la web. No requiere migración de datos ni cambios de reglas, Auth, Storage o IAM.
