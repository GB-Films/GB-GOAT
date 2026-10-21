# Facturas y pagos compartidos de proveedores

## Uso

Desde el nombre de un proveedor en cualquier gasto, abrir **Ver ficha y
comprobantes**. La misma ficha se abre desde Proveedores. Conserva los gastos y
adjuntos anteriores y ofrece tres cargas para administradores globales:

- **Factura:** original fiscal, emisor y CUIT propios, CUIT receptor, tipo/número,
  fecha, moneda, neto y total. Seleccionar gastos existentes y distribuir su neto.
- **Pago:** elegir proyectos con saldo, revisar el importe (por defecto el saldo
  seleccionado), indicar fecha y adjuntar el comprobante o elegir Efectivo y la
  Caja General. Los gastos saldados no aparecen en esta selección. El formulario
  no pide destinatario, cuenta bancaria, referencia, impuestos ni comisiones.
- **Comprobante:** documento general o relacionado con gastos seleccionados,
  por ejemplo un certificado de retención. Las notas identifican la operación.

La ficha distingue el prestador del gasto, el emisor fiscal de la factura y el
beneficiario del pago. Cargar una factura no crea otro costo ni acredita un pago.
El indicador del gasto muestra la factura vinculada y abre la ficha. Las
aplicaciones de pago aparecen en su historial y sus saldos habituales.

El neto aplicado a gastos siempre se expresa en pesos, como los costos de GOAT.
El pago simplificado cancela ese costo operativo, igual que la carga habitual
desde una fila. No reconstruye IVA, retenciones, comisiones ni el débito bancario
a partir del importe aplicado; el comprobante conserva la operación real y CT se
concilia por separado. Los campos fiscales y la moneda de las facturas no cambian.
Los registros previos conservan sus monedas e importes originales.

Un pago parcial cubre los gastos de los proyectos seleccionados en el orden
mostrado, hasta completar su importe. Se vincula automáticamente con la factura
compartida sólo si hay una única factura activa y su aplicación pendiente alcanza
el importe; en casos ambiguos se conserva la aplicación al gasto sin inventar una
relación fiscal. El servidor vuelve a validar los saldos al confirmar.

Una transferencia no mueve cajas de GOAT. Un pago en efectivo pesos crea **una
sola salida de Caja General**, en uno de los proyectos seleccionados; sus
aplicaciones en los otros proyectos no vuelven a sacar efectivo. Este flujo no
registra efectivo USD ni adelantos de cajas personales: esos movimientos siguen
usando sus circuitos específicos. No hace transferencias reales ni escribe CT.
La comparación CT conserva la referencia de la factura compartida; su importador
de costos sigue sin registrar pagos automáticamente.

## Modelo e integridad

`providerFinancialRecords/{operationId}` conserva la operación original, archivo,
aplicaciones, autor, estado y anulación. Un gasto conserva sólo referencias de
factura/comprobante o una aplicación en `paymentHistory`, con `sharedRecordId`.
No se copian archivos ni URLs públicas a los distintos proyectos.

La callable `manageProviderFinance` verifica el rol global contra Firestore,
valida esquema, importes en centavos, proyectos y gestión activa, identidad del
prestador, archivos y saldos vivos, y escribe todas las aplicaciones en una
transacción. Máximo: 30 gastos distintos por operación. Usa un ID estable y
huella de la solicitud para recuperar un reintento sin repetir pagos.

La identidad fiscal (emisor + receptor + tipo/número) se reserva globalmente en
`providerFiscalKeys`. Los pagos reservan cuenta + referencia en
`providerPaymentKeys`. El formulario simplificado calcula automáticamente la
referencia SHA-256 del comprobante con la cuenta técnica «Comprobante bancario»;
esa etiqueta no atribuye una cuenta bancaria real. Un mismo archivo no se carga
otra vez como otro pago activo desde este formulario. Para efectivo se conserva
la cuenta de caja y una referencia única estable durante los reintentos. No
reemplaza la conciliación bancaria ni detecta dos archivos diferentes del mismo
comprobante. Las claves se pueden volver a usar después de anular, conservando
el vínculo con el registro anterior.

Las facturas se rechazan si la fila ya tiene un adjunto fiscal legado; revisar y
retirarlo administrativamente antes de reemplazarlo por una factura compartida.
Nunca se migran o reinterpretan automáticamente adjuntos o pagos históricos.

**Anular** conserva el registro y el original, retira todas las aplicaciones y
actualiza saldos en la misma transacción. Primero se anulan los pagos antes de
anular una factura con pagos vinculados. Para corregir importe, fecha, emisor o
distribución: anular y volver a registrar. El historial de la operación conserva
motivo y autor. Una anulación del registro no revierte un pago bancario real.
Los proveedores y proyectos con este historial no se eliminan físicamente;
se conservan sus referencias aun cuando las operaciones hayan sido anuladas.
Las áreas con aplicaciones activas no pueden cambiar de gestión Presu Ppal/Áreas
ni cambiar de nombre; primero se anulan las aplicaciones desde el proveedor.
Esto evita ocultar la fila vinculada. Se mantiene el reordenamiento y la gestión
de otras áreas sin aplicaciones compartidas.

## Acceso y archivos

Registros globales y archivos compartidos: sólo administradores globales.
Escritura de registros: exclusivamente el servidor. Las referencias del gasto
son legibles por quienes ya tienen acceso a ese proyecto; no conceden acceso a
documentos completos ni a otros proyectos. Los colaboradores conservan las
ediciones operativas y el agregado habitual de pagos, pero no pueden modificar
las referencias, cambiar identidad/importe o borrar un gasto vinculado. Tampoco
se puede reescribir un pago compartido desde la fila, aunque sea admin.

Storage `providerFinance/{providerId}/{operationId}/{file}` acepta PDF, JPG, PNG o
WEBP, máximo 2 MB. El cliente calcula SHA-256 para recuperar una carga interrumpida.
Después de confirmar el registro, el archivo no se sobrescribe ni elimina. Se
descarga mediante la callable, que verifica nuevamente el rol administrador y
entrega los bytes; no se distribuyen tokens de descarga ni se amplía CORS del bucket.

## Verificación y publicación

```sh
npm test
npm run lint
npm run build
npm test --prefix functions
npm run test:provider-finance
npm run test:area-access
npm run test:rules
npm run test:storage
```

El emulador de integración comprueba distribución, idempotencia, deduplicación,
pagos simultáneos, límites de saldos, anulación, Caja General, permisos y archivos
privados. También se ejecuta en el flujo de publicación de la interfaz.

La activación requiere publicar la callable nueva y las reglas Firestore/Storage
antes de integrar la interfaz. Despliegue acotado, con autorización de dirección:

```sh
firebase deploy --only functions:manageProviderFinance,firestore:rules,storage --project gb-goat
```

Luego integrar la PR, verificar GitHub Pages y probar la carga administrativa
con evidencia real autorizada. No publicar otras funciones o migrar datos como
parte de este despliegue.
