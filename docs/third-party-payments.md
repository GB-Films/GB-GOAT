# Gastos pagados por terceros

Un pago con **Pagó otra persona** cancela la deuda con el proveedor del gasto y abre una deuda de reintegro a la persona seleccionada. No genera una salida de caja de GOAT al registrarse. El costo del proyecto se cuenta una sola vez.

Los reintegros parciales se registran desde el historial del pago, únicamente cuando el dinero salió de una caja de GOAT identificada. Cada reintegro crea una salida de caja vinculada al acreedor y al gasto, y queda auditado. La anulación revierte el reintegro y esa salida. No se puede borrar el pago original mientras tenga reintegros ni corregirlo por debajo del importe ya reintegrado.

**Reintegros bancarios:** la aplicación no tiene una cuenta bancaria integrada para verificar una transferencia. No se debe elegir Caja General o una caja personal para simularla. Si el reintegro sale de una cuenta fuera de estas cajas, la deuda sigue pendiente hasta que Control Total incorpore la cuenta pagadora y su comprobante verificable. El formulario de reintegro avisa este límite.

## Ejemplo ficticio

Una persona registrada paga un servicio del proyecto con dinero propio. Al registrar el pago con **Pagó otra persona**, el proveedor del servicio queda saldado y la persona pasa a figurar como acreedora por el mismo importe. El costo del proyecto no se duplica. Cuando GOAT le devuelve parte del dinero desde una caja identificada, sólo ese reintegro reduce su saldo pendiente.

Si el proveedor del servicio aún no tiene ficha, se puede crear una ficha **provisional** sin inventar CUIT, CBU, alias u otros datos no informados. Antes de crearla, buscar coincidencias por nombre y alias. No registrar un reintegro hasta contar con evidencia del desembolso real y una cuenta pagadora soportada.
