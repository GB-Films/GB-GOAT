# Acceso a Caja General

La lista cerrada es `tomas@granberta.com`, `agustin@granberta.com` y `guido@bani-vfx.com`. Se comprueba el correo autenticado y verificado; no hay excepción por rol administrador, creador del proyecto ni cuenta dueña de GOAT. La lista no otorga acceso a proyectos ni atribuciones administrativas que la persona no tuviera.

Sólo esas cuentas pueden consultar el libro completo de movimientos y el resumen General. Entregar, confirmar devoluciones, pagar/reintegrar desde General y corregir/anular esas operaciones requieren además sus permisos financieros existentes. Las restricciones por proyecto de `generalCashDeliveryBlockedEmails` se conservan.

Las demás personas conservan su caja: entregas de las que son destinatarias, devoluciones que originaron y movimientos personales propios. No recuperan pagos General por haberlos creado antes, ni entregas/retornos de otras cajas por haber actuado antes como custodios General. Los comprobantes e historiales de pagos de los gastos conservan sus permisos independientes; este cambio no redefine la visibilidad financiera de las demás pestañas.

Firestore limita las lecturas del libro y protege las operaciones, incluida la modificación del origen General. `manageProviderFinance` aplica la misma política a pagos compartidos, anulaciones y correcciones propias. El asistente omite el resumen General para las cuentas excluidas. La lista existe en cliente, servidor y reglas; una prueba verifica que coincidan.

`personalCashMovements` consulta sólo las participaciones del usuario autenticado, sin aceptar otro correo del cliente, y filtra los movimientos General antes de responder. Conserva pagos personales históricos sin `cashAccount`; no entrega un libro completo para filtrarlo en el navegador. Los listeners de movimientos propios disparan la relectura y hay una recuperación periódica para registros históricos. Se cierra la consulta al abandonar el proyecto y se descartan respuestas de vistas anteriores. Si la consulta no puede completarse, no se muestran saldos parciales.

Las verificaciones administrativas de vínculo de gasto/borrado de proyecto usan `checkCashLinks`: devuelve sólo un booleano, con acceso administrativo al proyecto, sin revelar registros, personas, importes ni saldos General. No sustituye los bloqueos, transacciones y auditorías financieros existentes.

No hay migración, cambio de roles/IAM/Auth ni modificación de fondos. La protección corresponde a la app, SDK y callables; las credenciales privilegiadas de infraestructura mantienen su autoridad fuera de las reglas de clientes.

## Publicación

Publicar primero `manageProviderFinance`, luego el frontend compatible y finalmente las reglas de Firestore. El frontend nuevo necesita los lectores/verificadores del servidor. Las reglas nuevas revocan la consulta completa de los clientes anteriores; esas sesiones tendrán que recargar. No mantener un bypass administrativo para compatibilidad. Storage, otras funciones e IAM no requieren cambios.

## Validación

`tests/generalCashAccess.emulator.mjs` prueba las tres cuentas, rechazos de administrador/dueño, autoría histórica, SDK directo, cuenta sin verificar, proyecto ajeno, consultas de actualización propias, devolución/recepción y callables. Se incluyen las suites financieras y de subentregas para comprobar los permisos de las cajas personales y los pagos auditados. Sólo se usan proyectos demo y datos ficticios.

Los listeners usan filtros de igualdad sin ordenamiento; pueden usar la [combinación de índices simples de Firestore](https://firebase.google.com/docs/firestore/query-data/index-overview#use_index_merging). No se añaden índices ni se prueban consultas con datos productivos para esta implementación.
