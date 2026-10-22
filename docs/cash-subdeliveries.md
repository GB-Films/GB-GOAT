# Subentregas de cajas de proyecto

Sólo administradores de proyecto/app (incluido el creador según ACL vigente) pueden crear subentregas. No basta con ser jefe de producción/área ni con tener una caja. El destino es un integrante vigente del proyecto o un administrador global, nunca la misma persona.

En Cajas → Registrar movimiento → Subentrega desde mi caja asignada, el origen no se elige: siempre es la caja propia del usuario autenticado en ese proyecto. Se acredita inmediatamente al destinatario como transferencia entre cajas; no es una entrega pendiente desde Caja General. Se conserva el formato de transferencias históricas para que saldos, movimientos y reportes descuenten una vez al emisor y acrediten una vez al receptor. No genera gastos ni pagos.

La callable `createCashSubdelivery` consulta roles y saldo vivos dentro de una transacción, reserva devoluciones pendientes y serializa subentregas simultáneas. Importes en centavos; clave estable por intento para reintentos idempotentes. El origen, autor y fecha son de servidor. El cliente no puede crear transferencias directamente, ni editar/borrar subentregas ya registradas. Los movimientos históricos no se migran ni borran.

El entrypoint selecciona un worker mínimo para esta callable a través de `FUNCTION_TARGET`. La detección del manifiesto y los demás endpoints conservan el mapa original. Una prueba HTTP aislada verifica arranque y rechazo de solicitudes anónimas sin consultar ni modificar cajas.

`projects/{id}.generalCashDeliveryBlockedEmails` es configuración de servidor: ningún cliente puede crearla o modificarla. Restringe iniciar/editar/eliminar entregas desde Caja General para cuentas seleccionadas; no impide recibir/confirmar una entrega. No cambia sus roles, acceso a proyectos, permisos de pagos ni la operación de otros administradores. `cashSubdeliveryRevision` también es de servidor.

Pruebas: `tests/cashSubdeliveryRules.emulator.mjs`, `functions/cashSubdelivery.test.js`, suite financiera existente y tests de cajas. La nueva operación no cambia reglas de lectura de usuarios ni constituye una auditoría de toda la app. No se ejecutan movimientos reales para probar en producción.

Ataques cubiertos y rechazados: escritura directa de transferencia aun sin marcador, origen/rol elegido por el cliente, actor sin rol admin, cruce de proyecto, destino ajeno o propio, importe cero/negativo/no finito/excesivo/fraccionario, nota excesiva, ruta inválida, reutilización de ID con datos distintos, cambio de política/counter desde un admin cliente y edición/borrado de subentregas. Se conserva la confirmación por el destinatario y la entrega General de administradores no restringidos en otros proyectos. Las consultas existentes y la suite financiera se verifican sin ampliar lecturas.
