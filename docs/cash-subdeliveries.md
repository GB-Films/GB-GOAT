# Subentregas de cajas de proyecto

Caja General tiene un permiso independiente del rol: sólo `tomas@granberta.com`, `agustin@granberta.com` y `guido@bani-vfx.com`, conservando los permisos del proyecto. Ver [Acceso a Caja General](general-cash-access.md). Los demás administradores mantienen sus cajas personales y las subentregas autorizadas; no obtienen acceso General por su rol.

Cualquier integrante con permiso de Cajas y saldo disponible en su caja asignada puede hacer una entrega personal a otro integrante vigente del proyecto, aunque trabaje en otra área. Las cuentas responsables de Caja General pueden recibir devoluciones si tienen acceso administrativo vigente al proyecto. La lista se consulta en el servidor y muestra sólo nombre y correo de las personas elegibles.

En Cajas → Registrar movimiento → Transferir desde mi caja asignada, el origen siempre es la caja propia del usuario autenticado en ese proyecto. Toda entrega nueva queda pendiente de recepción, también entre cajas personales. El importe queda reservado al emisor y no se acredita al destinatario hasta que éste confirma. La confirmación no vuelve a descontar al emisor y no genera gastos ni pagos.

En pantalla, el saldo del emisor conserva la entrega pendiente hasta la recepción: la caja aparece amarilla con **Por confirmar** y **Disponible**. La destinataria muestra **Por recibir**, sin acreditar todavía esos fondos. Al confirmar se descuenta el saldo visible del emisor y se acredita a la destinataria, desapareciendo el amarillo si no quedan pendientes. Los controles de pagos, nuevas entregas y borrados usan siempre el disponible reservado; el saldo visible no habilita gastar dos veces el importe pendiente.

El destinatario ve el aviso amarillo y **Confirmar recepción** tanto desde Cajas como desde las otras pestañas del proyecto. El servidor valida su identidad y acceso vigente; ni el emisor ni otro administrador pueden confirmar en su lugar. La confirmación guarda persona, correo y fecha, y es idempotente incluso con dos solicitudes simultáneas. Los clientes no pueden editar directamente las subentregas ni falsificar una confirmación.

La creación exige `receiptVersion: 1`; un cliente anterior recibe una indicación de actualizar la página. La callable existente acepta `action: confirm` con proyecto e ID del movimiento, sin importe ni autor elegibles por el cliente. Las transferencias históricas sin este protocolo conservan sus saldos; no se migran masivamente ni se inventan recepciones pasadas. Una reparación particular requiere autorización y comprobar que el saldo del destinatario permite volver a dejarla pendiente.

Si el usuario ya tiene caja asignada en el proyecto, Registrar movimiento abre
primero la transferencia desde su caja cuando ese rol puede realizarla. La lista
ofrece después la entrega desde General a quienes conservan ese permiso. Sin
caja asignada se mantiene la entrega General como primera opción autorizada.
La recepción personal también se puede confirmar desde el aviso del proyecto. Quienes sólo tienen una pestaña no financiera reciben ese aviso para sus entregas pendientes.
La opción de caja propia muestra su saldo actual entre paréntesis, también en
pagos y reintegros. En subentregas se sigue indicando aparte el disponible para
transferir, descontando las devoluciones pendientes.

En pagos nuevos, la caja asignada también aparece primero y queda seleccionada
por defecto, incluso con saldo cero. Si sus datos llegan después de abrir el
formulario, reemplaza la selección automática inicial de General. Una selección
manual de General se respeta mientras siga disponible. Al cerrar, cambiar de
gasto, proyecto o cuenta se restablece la preferencia del contexto nuevo. No se
activa automáticamente el uso de efectivo, ni se cambian pagos existentes,
montos, comprobaciones de saldo o confirmaciones de las entregas.

La callable `createCashSubdelivery` consulta los destinatarios y crea tanto entregas personales como devoluciones a General. Ambas operaciones usan el mismo saldo disponible en una transacción, con importes en centavos y una clave estable para reintentos idénticos. El servidor asigna el origen y la autoría. Las devoluciones conservan la fecha elegida y la confirmación por quien recibe.

Publicación de destinatarios y devoluciones: primero `manageProviderFinance` y `createCashSubdelivery`, después la web y finalmente las reglas de Firestore, que cierran la creación directa de devoluciones. Las pestañas abiertas tienen que actualizarse para usar el flujo respaldado por el servidor.

El entrypoint selecciona un worker mínimo para esta callable a través de `FUNCTION_TARGET`. La detección del manifiesto y los demás endpoints conservan el mapa original. Una prueba HTTP aislada verifica arranque y rechazo de solicitudes anónimas sin consultar ni modificar cajas.

El borrado de una entrega General pasa por la misma callable (`action: deleteDelivery`). Exige acceso General y administración vigente del proyecto, respeta sus restricciones y consulta el libro completo dentro de una transacción. Recalcula el disponible del destinatario sin esa entrega: incluye pagos/reintegros personales, transferencias salientes pendientes o confirmadas y devoluciones pendientes o confirmadas; no usa ingresos pendientes ni movimientos cancelados. Si el disponible quedaría negativo, rechaza sin escribir. Otras entregas confirmadas sí pueden respaldar los compromisos; no hay una vinculación ficticia uno a uno entre ingresos y salidas.

El borrado permitido guarda el documento completo y saldos anterior/posterior en una auditoría inmutable, y avanza la revisión de caja en el mismo commit. Los reintentos no duplican auditoría; dos borrados y las subentregas concurrentes comparten la revisión transaccional. Firestore deniega borrar directamente cualquier entrega, incluidas las históricas o pendientes, para que una web anterior no omita la comprobación. Publicación: primero `createCashSubdelivery`, después las reglas y finalmente la web. No cambia otros endpoints, roles, IAM ni datos históricos. Pruebas específicas: `functions/deleteCashDelivery.test.js` y `tests/cashDeliveryDeletion.emulator.mjs`.

`projects/{id}.generalCashDeliveryBlockedEmails` es configuración de servidor: ningún cliente puede crearla o modificarla. Restringe iniciar/editar/eliminar entregas desde Caja General para cuentas seleccionadas; no impide recibir/confirmar una entrega. No cambia sus roles, acceso a proyectos, permisos de pagos ni la operación de otros administradores. `cashSubdeliveryRevision` también es de servidor.

Pruebas: `tests/cashSubdeliveryRules.emulator.mjs`, `functions/cashSubdelivery.test.js`, suite financiera existente y tests de cajas. La nueva operación no cambia reglas de lectura de usuarios ni constituye una auditoría de toda la app. No se ejecutan movimientos reales para probar en producción.

Las pruebas verifican entrega entre áreas, selección de responsables General, exclusión de cuentas ajenas o pendientes de alta, saldo concurrente entre entrega y devolución, recepción por la persona designada, reintentos, y bloqueo de creación directa y alteraciones del historial.
