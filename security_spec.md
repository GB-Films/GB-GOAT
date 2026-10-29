# Especificación de seguridad - GB GOAT

## Principios

1. Las reglas de Firebase son la autoridad; la UI sólo refleja permisos.
2. Los roles globales (`users/{uid}.role`) y los roles de proyecto (`projects/{id}/collaborators/{email}.role`) son independientes.
3. Ser miembro permite leer el contexto del proyecto. La edición se limita por rol, pestaña, área y subcategoría.
4. El historial financiero es append-only para colaboradores. Sólo un administrador del proyecto puede corregir o borrar registros existentes.
5. Facturas y comprobantes se autorizan contra el proyecto, la colección y la fila a la que pertenecen.

## Matriz resumida

| Acción | Admin app/proyecto | Jefe de producción | Jefe de área |
| --- | --- | --- | --- |
| Leer proyecto asignado | Sí | Sí | Sí |
| Editar Presu Ppal | Sí | No | No |
| Crear/editar gasto de Área | Sí | Sólo alcance asignado | Sólo alcance asignado |
| Anexar pago/comprobante | Sí | Sólo alcance asignado | Sólo alcance asignado |
| Editar/borrar historial financiero | Sí | No | No |
| Editar fechas y locación del proyecto | Sí | Sí | No |
| Administrar roles de proyecto | Sí | No | No |
| Delegar áreas | Sí | Sólo áreas propias | No |
| Administrar documentos de proyecto | Sí | Si tiene pestaña Documentos | No |
| Ver reportes globales | Admin app | No | No |

Un jefe de producción sólo puede delegar subcategorías que le hayan sido asignadas explícitamente. Si posee el área completa, puede delegar el área completa; la delegación fina fuera de su lista explícita queda reservada al administrador.

## Privacidad comercial

`projectCommercial/{projectId}` conserva presupuesto total, cliente, marca, empresa, servicio, importación/contrato de Control Total y referencia de venta CRM. Sólo admin global, creador o colaborador con rol real `admin` pueden leer un registro específico. Sólo admin global puede listar la colección o borrar registros. Las escrituras validan esquema, tipos, límites y timestamp de servidor, y requieren un proyecto existente (o creado en el mismo batch). Flags de UI y `canViewBudgetTotals` no conceden acceso comercial.

Las altas manuales/CT y CRM separan ambos documentos atómicamente. Las actualizaciones de proyecto también se separan; las reglas impiden reinsertar campos comerciales en el documento compartido, incluso a un administrador. Las pantallas hidratan los datos privados sólo con ACL autorizada. BANI sigue recibiendo únicamente identidad operativa, nunca importes comerciales; su integración usa IAM de servidor, no permisos de cliente.

La migración `scripts/migrate-project-commercial.cjs` es de sólo lectura salvo `--apply --backup-dir <carpeta privada>`. Respalda los documentos completos fuera de Git, verifica versiones, copia valores exactos y los retira del documento compartido dentro de un commit por proyecto, con lectura posterior. No modifica subcolecciones de gastos, pagos ni cajas. Nombre/código continúan compartidos como identificadores operativos. La separación no revoca información ya descargada antes de la migración ni constituye un aislamiento frente a operadores IAM del backend.

Pruebas: `tests/projectCommercialRules.emulator.mjs`, política compartida frontend/backend y pruebas de integraciones CRM/BANI. El alcance es la nueva separación comercial; no representa una auditoría integral del resto del sistema.

## Invariantes financieras

- Los pagos nuevos deben tener importe mayor que cero y autor/autora iguales a la sesión autenticada.
- Un colaborador puede anexar pagos por el SDK; no puede reescribir ni acortar `paymentHistory` directamente. La callable permite corregir un pago propio con UID/correo originales, alcance vigente, versión abierta, saldo y auditoría transaccionales, sin modificar pagos ajenos ni su origen de caja.
- Un gasto con pagos vigentes no puede eliminarse. Después de eliminar el último pago, administración puede eliminar la fila individual con auditoría, copia íntegra del documento anterior y verificación de que no quedan movimientos de caja.
- Los movimientos de caja no se corrigen directamente por el colaborador. Al corregir su pago por servidor se ajusta el movimiento vinculado en la misma transacción, conservando el origen de caja y comprobando saldo y autor. Cambiar el origen o eliminar pagos/movimientos conserva el circuito administrativo. La validación usa el movimiento real, no sólo la etiqueta del pago.
- Luego de eliminar el último pago, sólo un administrador puede corregir cantidad, precio e importe de la fila. Debe conservar el bloqueo histórico, los autores y las auditorías previas, y registrar los valores anteriores y nuevos en una actividad inmutable dentro de la misma transacción. Se aplica a Áreas y Presu Ppal; si aún hay pagos o la marca `paid` sigue activa, la corrección de importes se rechaza.
- Un comprobante adicional de colaborador sólo puede agregarse al final y debe registrar su email.

## Invariantes de archivos

- Tamaño máximo: 2 MB.
- Facturas: PDF, JPG o PNG.
- Comprobantes y documentos: PDF, JPG, PNG o WEBP según el flujo.
- La metadata de una factura autenticada debe coincidir con `projectId`, colección, fila y área.
- Los colaboradores pueden crear archivos dentro de su alcance, pero sólo un administrador puede reemplazar o borrar comprobantes financieros existentes.

## Casos negativos mínimos

- Usuario ajeno leyendo o escribiendo un proyecto.
- Colaborador editando Presu Ppal.
- Jefe de área escribiendo fuera de su área/subcategoría.
- Colaborador cambiando o eliminando un pago ya registrado.
- Jefe de producción delegando un área o subcategoría que no posee.
- Carga de factura cuya metadata apunta a otra fila o proyecto.
- Invitación pública usada, vencida o destinada a otra fila.
- Cambio de rol global provocado por una asignación dentro de un proyecto.

La sintaxis se valida localmente con `npm run lint:rules`. La validación funcional completa debe ejecutarse contra Firebase Emulator Suite antes de desplegar reglas.

## Documentos y pagos compartidos de proveedores

El diseño agrega reglas preliminares para proteger referencias de gasto y
archivos compartidos, verificadas con emuladores antes de activarse. La callable
`manageProviderFinance` exige rol global admin para registrar/anular operaciones compartidas y aplica operación y proyecciones
en una única transacción. El cliente no escribe `providerFinancialRecords`, las
claves fiscales/de pago ni las referencias compartidas de gastos. Sólo administra
estos registros el servidor, que comprueba identidad del prestador, estado,
gestión activa del gasto, importes y saldo actualizado.

Los registros globales multiproyecto son privados para administradores. Los
miembros vigentes pueden descargar el original vinculado al gasto de su proyecto mediante la callable, sin obtener metadatos de las aplicaciones de otros proyectos ni acceso a documentos ajenos. Los originales confirmados son inmutables y la anulación global
conserva evidencia y auditoría. Ningún rol puede corregir una sola proyección de
pago compartido por el SDK cliente. El circuito no concede permisos nuevos sobre
CT, cuentas bancarias o proyectos ajenos. Ver `docs/provider-finance.md`.

## Riesgo de dependencia pendiente

La versión de `xlsx` publicada en npm mantiene avisos de seguridad sin corrección disponible en ese registro. Las importaciones quedaron limitadas por tipo y a 5 MB para reducir exposición, pero esto no elimina el riesgo de un archivo malicioso. La actualización recomendada por SheetJS se distribuye fuera de npm y requiere aprobación explícita del origen, o bien reemplazar el parser en una migración dedicada.
