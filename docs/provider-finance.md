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
El indicador de factura del gasto abre directamente su original cuando tiene una
única fila distinta asignada. Sólo abre la ficha cuando esa misma factura abarca
más de una fila, incluso de distintos proyectos. Las aplicaciones duplicadas de
una misma clave proyecto/colección/gasto cuentan como una sola fila. La cantidad
de facturas en una celda no determina esta decisión: cada original conserva su
propio botón, junto a los archivos legados que ya tuviera el gasto.

El ícono de documento de **Factura de tercero**, con fondo amarillo, borde verde
y esa leyenda al pasar el cursor o consultar su nombre accesible, requiere que el CUIT
real del emisor de la factura difiera del CUIT del prestador. No se deduce del
pagador, nombre o indicador `thirdPartyPayoutRequired`, ni certifica la vigencia de
una autorización. Varias facturas conservan un ícono identificado por original;
la apertura directa o en ficha depende de sus filas, como se describe arriba.
Las facturas propias mantienen el aspecto verde habitual. Este cambio visual no
habilita borrar referencias financieras ni el enlace de carga habitual para un
tercero: el reemplazo conserva el circuito de anulación y la autorización, y los
comprobantes adicionales siguen en su columna existente.

La consulta existente `projectDocuments` devuelve para facturas el emisor y
`distinctExpenseCount`, calculado sobre todas las aplicaciones nativas antes de
filtrar por proyecto. Sólo expone ese total; no devuelve IDs, nombres, importes o
filas de proyectos ajenos. El cliente consulta por lotes de hasta100 registros
por proyecto, no por celda. Invalida su caché al cambiar las relaciones nativas de
los gastos, aunque el conjunto de IDs de factura permanezca igual. No convierte
el número de aplicaciones visibles en un supuesto total global.

La columna de factura y el panel móvil usan la misma decisión. La factura no se
repite debajo del proveedor. Allí se conserva el acceso a la autorización y,
sólo cuando hay un archivo activo de comprobante o pago asociado a esa fila, el
enlace a esos documentos. Un ID de pago sin archivo no genera ese enlace. La
misma consulta por lotes obtiene los metadatos de esos archivos, sin llamadas por
celda. Si faltan archivo, acceso o metadatos suficientes para la factura, muestran
una indicación y permiten reintentar; no abren otra factura ni simulan una URL.
La descarga sigue usando `openProviderFile` y las comprobaciones de acceso
existentes. No se cambian pagos, autorizaciones, referencias ni datos financieros.
Publicar primero la extensión de lectura de `manageProviderFinance` y luego la
web; no hay cambios de reglas, IAM, Storage ni escrituras de datos.

Las aplicaciones de pago aparecen en su historial y sus saldos habituales.

### Declaraciones de facturación y cobro por terceros

La ficha muestra directamente **Quién factura y cobra por este proveedor**, con
estado, trabajos/proyectos incluidos, firmante, fecha y declaración firmada. Ya no
hace falta abrir la ventana de asignación de documentos para encontrarla.

Las filas marcadas `thirdPartyPayoutRequired` muestran **Facturación y cobro por
tercero**. Al pulsar el nombre del prestador o ese indicador se consulta la
autorización para ese gasto exacto. La ventanita separa la cuenta propia del
prestador de nombre, CUIT, titular y CBU/CVU o alias del tercero. Sólo muestra la
cuenta para copiar si hay una única autorización vigente de facturación y cobro;
advierte si falta vigencia o hay más de una. La marca puede conservarse después de
revocar la declaración: no se interpreta como prueba de vigencia.

`manageProviderPortal` ofrece lecturas `workAuthorizations` y
`workAuthorizationFile`, ligadas al usuario verificado, proyecto, proveedor actual
y gasto. No aplican ni aprueban declaraciones. La respuesta omite otras cuentas
propias, trabajos ajenos, referencias privadas y enlaces de firma. Una constancia
que incluya otros proyectos sólo puede descargarse con el acceso administrativo
global existente. Las lecturas y descargas comprueban otra vez el alcance. No se
modifican pagos, importes, cuentas del prestador ni reglas de firma/aplicación.

Publicar primero `manageProviderPortal` y después el frontend. No hay migración,
cambios de reglas, IAM ni Auth. Esta entrega es independiente del control de
acceso de Caja General (PR79).

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

Los registros financieros globales siguen restringidos a administradores. El equipo autorizado de un proyecto puede listar y descargar facturas, pagos y otros comprobantes vinculados a sus gastos mediante las acciones `projectDocuments` y `download` de la callable. Cada descarga comprueba el acceso vigente, la aplicación del registro y la referencia en la fila. La lista sólo devuelve metadatos de las aplicaciones del proyecto consultado; la descarga entrega el original vinculado, que puede abarcar varios proyectos, sin generar URLs públicas permanentes.
Escritura de registros: exclusivamente el servidor. Las referencias del gasto
son legibles por quienes ya tienen acceso a ese proyecto; no conceden acceso a
documentos completos ni a otros proyectos. Los colaboradores conservan las
ediciones operativas y el agregado habitual de pagos, pero no pueden modificar
las referencias, cambiar identidad/importe o borrar un gasto vinculado. Tampoco
se puede reescribir un pago compartido desde la fila, aunque sea admin.

Storage `providerFinance/{providerId}/{operationId}/{file}` acepta PDF, JPG, PNG o
WEBP, máximo 2 MB. El cliente calcula SHA-256 para recuperar una carga interrumpida.
Después de confirmar el registro, el archivo no se sobrescribe ni elimina. Se
descarga mediante la callable, que verifica administración o el vínculo autorizado con el proyecto y
entrega los bytes; no se distribuyen tokens de descarga ni se amplía CORS del bucket.

Un colaborador con permiso de edición en el área puede corregir importe, fecha, detalle y adjunto de un pago propio mediante `correctOwnPayment`. El servidor verifica UID y correo del autor, saldo vivo del gasto y de la caja asignada, concurrencia y archivo del mismo pago. Mantiene el origen de caja y la identidad del pago, guarda el antes/después y conserva los demás pagos. No permite corregir pagos ajenos, aplicaciones compartidas, alterar reintegros ni borrar pagos; los cambios administrativos de origen de caja y anulaciones conservan su circuito.

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
