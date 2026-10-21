# GB GOAT

Aplicación de gestión integral para proyectos audiovisuales. Centraliza presupuestos, gastos por área, proveedores, colaboradores, facturas, comprobantes, pagos, cajas, reportes financieros y resultado por proyecto.

## Desarrollo local

Requisitos: Node.js 20 o superior y npm.

```bash
npm install
npm run dev
```

La aplicación usa la configuración versionada en `firebase-applet-config.json`. No necesita una clave de Gemini para funcionar.

## Validación

Antes de publicar cambios:

```bash
npm test
npm run lint
npm run build
```

`npm run lint` valida TypeScript y la sintaxis local de `firestore.rules` y `storage.rules`.

La privacidad comercial tiene pruebas de autorización específicas (requiere Java y Firebase Emulator Suite):

```bash
firebase emulators:exec --only firestore --project demo-gb-goat-commercial "node tests/projectCommercialRules.emulator.mjs"
npm run test:admin-rules
```

## Publicación

Un push a `main` ejecuta las validaciones y publica la interfaz en GitHub Pages. Las reglas de Firebase se publican por separado:

```bash
firebase deploy --only firestore:rules,storage --project gb-goat
```

## Estructura

- `src/components`: componentes visuales compartidos.
- `src/lib`: reglas de dominio reutilizables (acceso, finanzas, identidad, archivos y catálogos).
- `src/pages`: pantallas y flujos de la aplicación.
- `src/pages/project-detail`: componentes específicos del detalle de proyecto reutilizados por Presu Ppal y Áreas.
- `firestore.rules`: autorización de datos.
- `storage.rules`: autorización y límites para archivos.
- `docs/ARCHITECTURE.md`: modelo de dominio y criterios de diseño.
- `security_spec.md`: matriz de permisos y criterios de auditoría.

Las condiciones de seguridad deben existir en las reglas de Firebase. Ocultar un botón en la interfaz mejora la experiencia, pero no reemplaza una regla de autorización.

## Actualización con Control Total

Las cuentas administrativas de CT cuentan con una comparación por proyecto y
aplicación revisada de costos. Alcance, controles, límites y publicación acotada:
[`docs/control-total-sync.md`](docs/control-total-sync.md). Esta conexión no registra
pagos ni movimientos de caja automáticamente.

## Administración de proyectos

La pestaña **Administración** de cada proyecto es exclusiva de administradores
globales. Registra acuerdo aprobado, OC, requisitos de facturación, plazo con su
fuente, facturas emitidas y cobros aplicados (incluidas las retenciones). Los
documentos se enlazan por su referencia original; los archivos siguen en su
repositorio privado. El importe aprobado debe expresarse en la misma moneda y
base impositiva que el total de las facturas para calcular lo que resta facturar.

El dashboard administrativo señala proyectos por facturar, facturas sin envío o
carga, plazos sin confirmar y cobros vencidos. Sólo calcula un vencimiento cuando
se conoce la condición pactada y su fecha de inicio. Los cobros de esta pestaña
son seguimiento por proyecto: **Control Total sigue siendo el registro de los
movimientos reales** y se concilia por separado. No se importan ni se alteran
facturas o pagos históricos automáticamente al abrir esta pestaña.
