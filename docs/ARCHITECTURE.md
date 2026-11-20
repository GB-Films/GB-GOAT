# Arquitectura y dominio

## Objetivo

GB GOAT organiza el ciclo completo de una producción audiovisual: cliente y proyecto, presupuesto, ejecución por áreas, proveedores, facturas, pagos, cajas, documentos y resultado final.

## Fuente de verdad

- `projects/{projectId}` contiene identidad, estado, fechas, cliente, presupuesto global, áreas activas y miembros visibles.
- `projects/{projectId}/budgetItems` contiene las líneas de Presu Ppal. Su edición financiera es administrativa.
- `projects/{projectId}.categoryBudgets` contiene las asignaciones globales opcionales por categoría, en ARS. Reemplazan el presupuesto estimado de sus partidas; los gastos y pagos conservan sus documentos propios.
- `projects/{projectId}/areaExpenses` contiene la ejecución operativa por área y subcategoría.
- Renombrar/reordenar una subcategoría o trasladar un gasto entre áreas activas usa `manageProviderFinance/reclassifyAreaExpenses`. Conserva IDs, pagos, archivos y declaraciones; actualiza sólo clasificación/orden y metadatos vinculados en una transacción auditada. Los pagos registrados no impiden esta operación. Alcance, permisos y publicación en [area-structure.md](area-structure.md).
- `projects/{projectId}/collaborators` contiene roles y alcances exclusivos de ese proyecto.
- `projects/{projectId}/cashMovements` registra entregas, devoluciones, transferencias y movimientos asociados a pagos.
- Caja General y su libro completo están reservados a `tomas@granberta.com`, `agustin@granberta.com` y `guido@bani-vfx.com`, dentro de sus permisos de proyecto. Los demás usuarios, incluidos administradores, consultan sólo su caja personal; no hay bypass de dueño/admin. Detalles y orden de publicación en [general-cash-access.md](general-cash-access.md).
- `providers`, `providerIdentifiers` y `clients` son catálogos globales.
- `providerInvites`, `invoiceUploadInvites` y `userInvites` son accesos temporales con propósito limitado.

Cuando un área está activa, los reportes financieros toman sus gastos desde `areaExpenses`; las líneas de `budgetItems` de esa misma área no se suman nuevamente. Esta regla está centralizada en `src/lib/projectFinance.ts` para evitar doble conteo.

## Separación de responsabilidades

- Los componentes presentan información y delegan cálculos o decisiones repetibles.
- `src/lib/projectFinance.ts` define totales, pagos, deuda y selección de gastos contabilizables.
- `src/lib/projectAccess.ts` define pestañas, defaults y permisos de área/subcategoría para la UI.
- `src/lib/identity.ts` normaliza emails y búsquedas.
- `src/lib/files.ts` normaliza nombres de archivos.
- Firestore y Storage autorizan el acceso directo. Las funciones que usan credenciales de servidor comprueban el acceso antes de leer o escribir. `projectFinanceAccess.js` resuelve la cuenta y su relación con el proyecto, y `projectReadScope.js` decide el alcance de cada operación.

## Alcance por área y subcategoría

Seleccionar un área en Permisos incluye todas sus subcategorías actuales y futuras. No se materializa esa herencia en `allowedSubcategories`: ese campo conserva las delegaciones individuales sin el área padre. El campo opcional `excludedSubcategories` contiene claves `Área||Subcategoría` que prevalecen sobre ambos tipos de concesión; si falta, se mantiene el comportamiento anterior. Al quitar y volver a seleccionar un área se vuelve a la selección completa.

Las exclusiones aparecen en amarillo y el área padre se marca «Parcial». Áreas, sus resúmenes, saldos, reintegros, exportación y herramientas del asistente filtran sus gastos según ese alcance. Firestore y Storage rechazan la edición/carga de gastos y adjuntos excluidos; el backend de corrección de pagos propios vuelve a comprobarlo. Las operaciones de estructura trasladan o limpian las exclusiones junto con las delegaciones individuales. Un jefe de producción debe conservar sus propias exclusiones al delegar acceso y no puede ampliar su alcance.

Este alcance organiza las vistas y autoriza la lectura de filas y adjuntos, además de la edición de `areaExpenses`. Un colaborador consulta una vista acotada desde el servidor. Los documentos generales, el presupuesto principal sin subcategoría y el historial de caja propio conservan sus permisos independientes.

Publicar este cambio requiere las nuevas reglas de Firestore/Storage, la función `manageProviderFinance` (correcciones de pagos) y el frontend, en ese orden. No necesita cambios de IAM, Auth ni migración de registros existentes.

## Consistencia de UI/UX

- La barra lateral ocupa la altura dinámica visible. Menú y pineados se desplazan en su propio espacio; la cuenta actual y «Cerrar sesión» no se comprimen ni salen del borde inferior. Bajo el umbral de escritorio se ofrece «Cuenta» fuera del desplazamiento horizontal del menú móvil.
- Los favoritos usan el perfil compartido de la cuenta para sincronizar lista y menú lateral. Agregar o quitar actualiza sólo `pinnedProjectIds` con operaciones atómicas; si falla, ambas vistas recuperan el estado anterior. Se pueden quitar desde la estrella del proyecto o desde la cruz de Pineados.

- Las páginas principales usan `PageHeader` para jerarquía y espaciado consistentes.
- Presu Ppal y Áreas usan las mismas celdas de factura/comprobantes y el mismo modal de pagos.
- La pestaña Documentos del proyecto reúne Contratos (vista inicial, con su firma) y Seguros. La carga ofrece sólo esas dos categorías. Facturas, pagos, retenciones y otros comprobantes se consultan desde los gastos y la ficha del proveedor; los archivos históricos conservan sus rutas y metadatos.
- Durante la búsqueda, las categorías y subcategorías con coincidencias se muestran desplegadas. En Áreas se incluyen también las áreas ocultas por el filtro de vista, dentro del alcance permitido. Limpiar la búsqueda recupera la selección y los pliegues anteriores, sin guardar cambios en esas preferencias.
- Las diferencias entre ambas vistas deben provenir del dominio: Presu Ppal es la referencia administrativa; Áreas es la ejecución delegable.
- Una acción no debe mostrarse si el rol no puede completarla según las reglas.

## Política financiera

- Un colaborador autorizado puede crear gastos en su alcance y anexar pagos o comprobantes.
- El SDK de un colaborador no puede reescribir el historial. Puede corregir un pago propio desde la callable, con autor original, alcance vigente, versión abierta, saldo y auditoría comprobados en una transacción. Los pagos ajenos y las aplicaciones compartidas permanecen protegidos.
- Corregir un pago ajeno o eliminar un pago requiere administración del proyecto. Toda corrección queda auditada. La Caja General y la caja personal conservan sus comprobaciones de acceso. Si todos los pagos de una fila se eliminaron y no quedan movimientos de caja, un administrador puede borrar la fila individualmente y guardar el documento anterior en la auditoría. Se conservan los archivos originales.
- Las devoluciones de caja nacen pendientes: sólo el administrador destinatario puede confirmar la recepción y entonces se reduce el saldo de la persona. El emisor puede cancelar una devolución pendiente, conservando el registro. Caja General muestra salidas netas, sin saldo inicial.
- Los archivos financieros se crean dentro del alcance de la fila y no pueden reemplazarse o borrarse por un colaborador.

## Límites conocidos

- Las vistas de colaboradores omiten filas y datos de otras áreas. El servicio entrega un comprobante compartido cuando el usuario puede consultar todas las filas que abarca. El libro completo de Caja General conserva su permiso independiente.
- El borrado de un proyecto elimina documentos conocidos desde el cliente, pero no garantiza el borrado recursivo de todos los archivos de Storage. Un borrado total y auditable requiere una función backend privilegiada.
