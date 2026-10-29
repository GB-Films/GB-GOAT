# Corrección de caja de un pago

Un administrador puede editar un pago de la empresa y elegir su caja asignada,
Caja General o «Sin caja · pagado por otro medio». La caja asignada aparece primero
en el selector, tanto al cargar como al editar. Abrir la edición conserva el origen
actual hasta elegir otro; también permite conservar una caja de otro responsable.

Cambiar de caja actualiza el movimiento existente. Agregar caja crea un movimiento
vinculado al mismo pago. Quitarla elimina sólo el movimiento de efectivo y conserva
importe, comprobante, autor e identidad del pago. Pago, movimiento y auditoría se
guardan en una transacción. Los pagos de terceros mantienen su flujo de reintegros.

La validación de saldo de la caja asignada considera el importe del pago original
cuando éste se corrige en la misma caja. Una corrección concurrente de caja, responsable
o medio de pago invalida el formulario abierto para evitar sobreescribirla.

Las reglas exigen permisos administrativos, auditoría nueva y coherencia entre el
pago y el movimiento posterior. El cambio de origen no puede guardarse si falta su
alta, actualización o eliminación de movimiento. Los colaboradores conservan sus
permisos para anexar pagos y pueden corregir los propios por servidor, manteniendo el origen de caja. La callable valida autor original, permisos actuales, versión, saldo y auditoría; no habilita la edición de pagos ajenos ni la escritura directa del historial por el SDK.

## Verificación y publicación

- `npm test`, `npm run lint` y `npm run build`.
- `npm run test:rules`: transiciones sin caja → asignada → general → sin caja →
  asignada, en Presu Ppal y Áreas; rechazos de correcciones incompletas y de colaboradores.
- Verificación del formulario en navegador con datos ficticios, sin guardar datos.

Para activar este flujo se deben publicar las reglas de Firestore y la interfaz.
Publicar primero las reglas mantiene compatible la interfaz anterior; publicar
sólo la interfaz haría que las reglas anteriores rechazaran los cambios de caja.
No requiere migración de datos ni cambios en Storage.
