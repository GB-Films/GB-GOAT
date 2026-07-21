# Arquitectura y dominio

## Objetivo

GB GOAT organiza el ciclo completo de una producción audiovisual: cliente y proyecto, presupuesto, ejecución por áreas, proveedores, facturas, pagos, cajas, documentos y resultado final.

## Fuente de verdad

- `projects/{projectId}` contiene identidad, estado, fechas, cliente, presupuesto global, áreas activas y miembros visibles.
- `projects/{projectId}/budgetItems` contiene las líneas de Presu Ppal. Su edición financiera es administrativa.
- `projects/{projectId}/areaExpenses` contiene la ejecución operativa por área y subcategoría.
- `projects/{projectId}/collaborators` contiene roles y alcances exclusivos de ese proyecto.
- `projects/{projectId}/cashMovements` registra entregas, transferencias y movimientos asociados a pagos.
- `providers`, `providerIdentifiers` y `clients` son catálogos globales.
- `providerInvites`, `invoiceUploadInvites` y `userInvites` son accesos temporales con propósito limitado.

Cuando un área está activa, los reportes financieros toman sus gastos desde `areaExpenses`; las líneas de `budgetItems` de esa misma área no se suman nuevamente. Esta regla está centralizada en `src/lib/projectFinance.ts` para evitar doble conteo.

## Separación de responsabilidades

- Los componentes presentan información y delegan cálculos o decisiones repetibles.
- `src/lib/projectFinance.ts` define totales, pagos, deuda y selección de gastos contabilizables.
- `src/lib/projectAccess.ts` define pestañas, defaults y permisos de área/subcategoría para la UI.
- `src/lib/identity.ts` normaliza emails y búsquedas.
- `src/lib/files.ts` normaliza nombres de archivos.
- Las reglas de Firestore y Storage son la autoridad final de permisos.

## Consistencia de UI/UX

- Las páginas principales usan `PageHeader` para jerarquía y espaciado consistentes.
- Presu Ppal y Áreas usan las mismas celdas de factura/comprobantes y el mismo modal de pagos.
- Las diferencias entre ambas vistas deben provenir del dominio: Presu Ppal es la referencia administrativa; Áreas es la ejecución delegable.
- Una acción no debe mostrarse si el rol no puede completarla según las reglas.

## Política financiera

- Un colaborador autorizado puede crear gastos en su alcance y anexar pagos o comprobantes.
- El historial existente es inmutable para colaboradores.
- Corregir o eliminar pagos, comprobantes existentes o gastos que ya recibieron pagos requiere administración del proyecto.
- Los archivos financieros se crean dentro del alcance de la fila y no pueden reemplazarse o borrarse por un colaborador.

## Límites conocidos

- Los miembros de un proyecto pueden leer el contexto completo del proyecto. Las áreas y subcategorías limitan escritura, no confidencialidad de campos. Si se necesita ocultar importes o proveedores por área, habrá que separar documentos/colecciones para que las reglas puedan autorizar lecturas parciales.
- El borrado de un proyecto elimina documentos conocidos desde el cliente, pero no garantiza el borrado recursivo de todos los archivos de Storage. Un borrado total y auditable requiere una función backend privilegiada.
