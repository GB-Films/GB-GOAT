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
