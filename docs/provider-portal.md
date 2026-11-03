# Portal de proveedores y GB Sign

Implementación en dos repositorios: GOAT y GB Sign. El código no activa usuarios ni publica reglas por sí solo. La ausencia de `providerPortalConfig/current.enabled: true` mantiene cerrado el acceso externo. Los colaboradores existentes conservan su inicio de sesión y sus roles.

## Experiencia

### Estado de alta en el listado de gastos

El listado interno consulta `providerPortal.registrationStatuses` para las fichas que no tienen una marca de alta. Una confirmación histórica de perfil aplicada, con prueba completa y versión reconocida, acredita el alta sin exigir que la persona vuelva a entrar o repita el formulario. La respuesta sólo incluye los IDs registrados; no expone declaraciones, firmantes, archivos ni datos bancarios, y no escribe marcas ni cambia accesos. Está restringida a cuentas Google verificadas del equipo habilitado y mantiene el bloqueo del alta de equipo pendiente.

El cliente separa los resultados por cuenta/proyecto y descarta respuestas de una vista anterior. Mientras consulta muestra «Verificando alta»; si falla, «Alta sin verificar». Ninguno de esos estados se presenta como ficha provisoria ni ofrece otro link de alta. La advertencia amarilla se reserva a los proveedores sin evidencia de alta después de la comprobación. Las reglas, el circuito de actualización firmada y los modelos fiscales/bancarios no se modifican. Este cambio requiere backend compatible antes de publicar su frontend.

### Fichas provisorias y alta sobre la misma identidad

Una ficha manual/importada no acredita un alta propia, aunque tenga banco o correo de contacto. En Presu Ppal y Áreas se señala en amarillo **Alta pendiente · ficha provisoria** hasta que tenga evidencia de alta (`personalGoogleAccount`, origen de alta propia anterior o `registration.status: complete`). No se infiere un alta por tener CBU, un nombre o un correo escrito por producción.

El formulario público usa `providerPortal.registerProvider`, con Google verificado, sesión reciente, conformidad de cuenta personal y responsabilidad por datos/cuenta bancaria. El servidor resuelve DNI/CUIT en índices y catálogo histórico (incluido `dni_cuit` con separadores, DNI de 7–9 números y CUIT de 11). Una coincidencia única provisoria completa **el mismo ID**, preservando `createdAt`, creador, demás campos y todos los vínculos; guarda una auditoría privada del estado anterior. El SDK público ya no puede crear proveedores directamente. No se agrega revisión administrativa al alta ordinaria ni se modifican las declaraciones firmadas de actualización de datos.

Cada gasto con proveedor provisorio permite copiar un link personal de alta, también si tiene pagos. Ese link fija proveedor y trabajo; únicamente completa la ficha y no escribe la fila del gasto. El link general también reutiliza una ficha provisoria si coincide el DNI/CUIT. Una ficha sin identificadores puede completarse con el link específico de su gasto; un nombre igual por sí solo nunca fusiona registros. Si el gasto tiene sólo texto y ningún ID, producción debe asociar primero la ficha correcta; el alta no reasigna un gasto pagado por semejanza de nombre.

Si ya existe un acceso preparado, sólo el mismo correo Google puede completarlo. Una membresía propia activa/pendiente es compatible; membresías ajenas o revocadas se conservan y bloquean el alta. Las fichas con alta propia anterior se actualizan desde Mi proveedor, no mediante otra alta. DNI/CUIT que apuntan a registros distintos, índices huérfanos/malformados y tipos incompatibles se detienen sin consumir el link ni sobrescribir datos; requieren corregir la identidad, no aprobar los datos nuevos. No se fusionan automáticamente dos fichas distintas con historial.

Una confirmación antigua de datos aplicada con prueba de firma completa también acredita el alta. El formulario público la detecta y exige que los cambios posteriores sigan el circuito firmado. Al consultarla su titular desde Mi proveedor se guarda únicamente la marca de alta, revalidando declaración y membresía; no se reescriben sus datos, pagos ni originales. Las nuevas confirmaciones firmadas guardan esa marca al aplicarse.

La transacción conserva el consumo único del link y una constancia por intento: reintentar el mismo envío devuelve el resultado anterior; cambiar sus datos no reescribe un alta ya guardada. Dos cuentas simultáneas no pueden reclamar la misma ficha. La empresa queda pendiente de su declaración de representación, con poder opcional, antes de firmar contratos. El alta no crea usuarios internos ni permisos de producción. El camino antiguo de borradores de tercero reutiliza la misma resolución, conserva el banco propio obligatorio y guarda esos datos de tercero en su colección privada.

Pruebas: `tests/providerIntake.emulator.mjs` comprueba las transacciones reales y las denegaciones del SDK con datos ficticios. El catálogo y la lectura de membresías se limitan a 10.000 documentos cada uno, sin exigir un nuevo índice de colección agrupada; superar el límite detiene el alta y exige paginación, nunca supone que una lectura truncada está completa. Para activar este cambio se necesita una publicación expresamente autorizada de backend, frontend y reglas; el código local no modifica fichas reales ni activa el flujo.

`#/mi-proveedor` muestra la cuenta autenticada y el proveedor representado. Una cuenta puede tener varias representaciones expresamente asignadas. Su selector no concede permisos. El perfil externo nunca se guarda en `users` como un colaborador interno.

Las cinco secciones son Trabajos, Facturas, Pagos y retenciones, Documentos y Mis datos. Incluyen documentos cargados por otras personas, pagos simples y aplicaciones de pagos distribuidos. El comprobante original y sus aplicaciones se distinguen; no se suman otra vez. Un trabajo marcado pagado sin historial se identifica como tal y no se reconstruye un pago ficticio.

### Revisión visual de Mi proveedor · publicada en PR60 (02/11/2026)

La ficha propia de una persona no muestra «Representás a». La aclaración se reserva a una empresa o representación expresamente asignada; si hay varias fichas, se conserva un selector neutral «Ficha de proveedor». Es sólo presentación: no modifica asociaciones ni permisos.

La ayuda «Cómo firmar tus documentos» está plegada en el encabezado. Documentos muestra una insignia amarilla con la cantidad de firmas propias pendientes, sin contar firmas ajenas, solicitudes anuladas ni representaciones personales antiguas. Se actualiza al consultar documentos y durante el refresco del portal visible. Primero aparecen los documentos que requieren atención, luego contratos/constancias y un historial plegado de declaraciones. Original, PDF firmado y certificado conservan sus descargas verificadas; los botones tienen estados de hover, foco y deshabilitado.

Mis datos separa contacto y cuenta propia. Las autorizaciones de terceros y la representación de empresa se consultan al desplegar sus secciones. Una declaración firmada que ya no coincide con la ficha actual se conserva como antecedente: no rellena el formulario con valores anteriores ni ofrece aplicar esos cambios incompatibles. Se propone revisar los datos actuales y firmar una nueva confirmación. Si hay una confirmación posterior ya aplicada, el antecedente no vuelve a exigir la firma. El rechazo transaccional del servidor no se modifica; no se reescriben declaraciones, datos, facturas ni pagos. Los errores de aplicación aparecen junto a la acción con un mensaje breve. Esta revisión de frontend se publicó en `534bb8d` sin cambiar backend ni datos reales.

### Secciones desplegables y documentos por proyecto · publicada en PR61

Mis datos empieza plegado, seguido por «Quién factura y cobra por mí» para personas o la representación para empresas como secciones independientes. Se conserva el formulario montado al plegarlo; los accesos directos a revisar datos lo despliegan. El título «Tu correo en GOAT» se alinea dentro de su bloque, sin cambiar selección ni verificación de cuentas.

Tanto los pendientes como Contratos y constancias se agrupan por `projectId` de GB Sign, con el nombre del proyecto registrado en su solicitud de firma. Nombres iguales no fusionan proyectos distintos. Las declaraciones de datos no se presentan como contratos de un proyecto comercial. Una solicitud histórica sin nombre muestra «Proyecto sin informar», sin inferirlo del título o de otros trabajos.

`providerPortal.myDocuments` ya incorporó en PR61 únicamente `projectName` saneado a su respuesta permitida, después de comprobar solicitud y firmante vigente. Reutiliza el dato existente en `signatureRequests`, sin consultas adicionales ni permisos nuevos. Se publicó `providerPortal` (revisión `providerportal-00010-wiz`) y después frontend `136718a`; no se modificaron solicitudes reales.

#### Grupos de proyecto colapsables

Los grupos de proyecto se pueden plegar de forma independiente con su encabezado. Los contratos y constancias guardados empiezan plegados; los grupos con firmas propias pendientes empiezan abiertos y también se pueden cerrar. El nombre y la cantidad de documentos permanecen visibles. Esta ampliación es sólo de frontend: no cambia solicitudes ni descargas y no requiere volver a publicar funciones, reglas o IAM.

### Firma guiada · preparada, pendiente de publicación

La ventana de firma mantiene visible una indicación del próximo paso: cargar el PDF, tocar el recuadro propio en la página indicada, ingresar/confirmar DNI, preparar la firma y aceptar el documento. El acceso directo ubica el recuadro sin seleccionarlo ni firmar por la persona; en pantallas pequeñas también desplaza la sección para dejarlo visible. Los demás accesos enfocan el dato o la confirmación pendiente. El botón de firma sólo se habilita cuando todos los requisitos están completos. Se conservan el consentimiento, la identidad, las coordenadas y el motor de GB Sign.

Durante el envío se informa la conexión o generación del PDF. Si carga o envío superan quince segundos aparece una orientación adicional; una carga fallida o lenta permite reintentar. Las llamadas de firma/generación esperan hasta150 segundos, por encima de los120 segundos del servicio. Si el resultado es incierto por conexión/timeout, o la firma se guardó pero falló la actualización posterior, se bloquea otro envío desde esa ventana y se ofrece volver a Documentos para consultar el estado. Al cerrar se actualizan ficha y documentos. Esto no ejecuta otra firma ni cambia el circuito de recuperación de artefactos existentes.

Las pruebas locales usan exclusivamente PDFs ficticios, navegador aislado sin sesión personal y solicitudes limitadas a127.0.0.1. Cubren escritorio y pantallas móviles, selección explícita, DNI, firma escrita/dibujada, cada orientación, carga fallida/lenta, envío lento y recuperación sin duplicar un intento incierto. La integración con emuladores comprueba las funciones reales de Sign, PDF firmado, certificado y denegaciones. No identifica la causa del incidente de un extra de Bancor sin conocer su cuenta/documento ni verifica OAuth/IAM de producción. Este lote no incluye publicación ni cambios de backend, reglas o IAM.

El único inicio de sesión disponible es Google, tanto en GOAT como en GB Sign. GOAT no ofrece registro con contraseña propia ni vinculación de otros proveedores de identidad. Se exige correo verificado. Google puede pedir autenticar la cuenta cuando no hay una sesión vigente; no se crea otra contraseña para la aplicación. Ningún correo se envía al desplegar o preparar asociaciones.

### Qué correo cargar y cómo se habilita el acceso

Una cuenta Google no es lo mismo que una dirección Gmail. Puede ser Gmail, Google Workspace o una cuenta Google existente que use una dirección de otro proveedor. Por ejemplo, una dirección Hotmail puede ingresar con Google sólo si su titular ya la asoció a una cuenta Google; tener Hotmail por sí solo no alcanza. Si no tiene ninguna cuenta Google, todavía no puede usar este acceso. No se le crea una cuenta ni una contraseña automáticamente.

El alta solicita un único correo personal asociado a Google. La persona inicia sesión con Google, el formulario toma ese correo sin permitir escribir uno distinto y exige declarar que la cuenta le pertenece y es de uso personal. Si actúa por una empresa, utiliza su cuenta personal como representante. Puede crear una cuenta Google con una dirección existente; no necesita crear Gmail ni una contraseña propia de GOAT. `personalGoogleAccount` conserva UID, correo, versión de la declaración y fecha del servidor. Las reglas exigen un token Google verificado y protegen esa constancia y el correo contra cambios posteriores por el SDK. El alta, los identificadores y el consumo del link se guardan en una transacción; no se concede acceso interno ni acceso al portal por completar el alta.

Flujo: alta con cuenta personal Google y declaración de pertenencia → administración prepara las coincidencias únicas → el servidor compara el correo verificado con la asociación preparada → la persona confirma y firma su representación → obtiene acceso a los trabajos de ese proveedor. Un correo ausente o compartido por varias fichas requiere resolución administrativa; iniciar sesión no abre por sí solo una ficha ni concede un rol interno. Las fichas anteriores se conservan sin inventar aceptación retroactiva: si el correo ya corresponde a una cuenta Google, puede usarla; de lo contrario, administración verifica con el titular y revisa su asociación. No cambiar automáticamente una cuenta por parecido de nombre o dominio. Las nuevas declaraciones de representación incluyen la pertenencia y el uso personal de la cuenta; los documentos firmados anteriormente no se reescriben. Google comprueba el control de la cuenta; no certifica por sí solo DNI ni facultades de representación.

La primera representación empresarial se confirma mediante declaración en GB Sign. La versión `company-representation-v4` exige nombre, DNI, cargo, DNI adjunto y consentimiento expreso de responsabilidad por la identidad y facultades declaradas. El poder o respaldo de representación es opcional (hasta seis archivos); no impide la habilitación ni la firma de contratos. La firma y los artefactos completos habilitan en transacción la membresía y un registro de autoridad con `method: signed_declaration`, sin revisión administrativa posterior. Se compara UID/correo con `personalGoogleAccount` o, para fichas anteriores, el correo de acceso previamente asociado; se rechazan cuentas distintas, accesos revocados y cambios de razón social/CUIT entre preparación y aplicación. El tipo «representante autorizado» recoge la declaración y no certifica facultades societarias. Las revisiones anteriores v2/v3 se conservan y las pendientes pueden reemplazarse operativamente con una nueva declaración, sin reescribir sus originales. Las personas que sólo firman pueden consultar sus documentos sin ficha comercial ni permisos de producción.

Para solicitar la firma de un contrato, el servidor comprueba membresía activa, empresa/cuenta vigente, versión y referencia de autoridad. En v4 también exige la declaración aplicada con prueba completa y hash íntegro; no basta un campo de estado. La misma cuenta Google registrada encuentra el contrato en **Mi proveedor → Documentos**, con su título y **Pendiente de tu firma**. La guía explica revisar PDF, seleccionar recuadro, confirmar DNI, dibujar o escribir la firma, aceptar y pulsar **Firmar y confirmar**, esperar confirmación y descargar PDF/certificado. La preparación del proyecto indica ese destino y aclara que no envía correo automáticamente. Los estados distinguen firma propia, otras firmas faltantes y PDF en preparación.

## Autoridades y datos

- `users/{uid}` conserva exclusivamente los roles internos existentes. Sus catálogos amplios requieren usuario interno y correo verificado. Los permisos de proyecto continúan siendo independientes.
- `providerPortalUsers/{uid}/memberships/{providerId}` contiene representación, estado, email de acceso y evidencia. Se escribe desde servidor; ni el usuario ni un admin pueden forjarla con el SDK.
- `providerPortalCandidates/{hashEmail}` es una preparación administrativa. Un correo compartido por varias fichas no se asocia automáticamente. Una generación incompleta no es activable por el cliente.
- `providers.email` es la cuenta personal Google; `portalAccessEmail` conserva la cuenta aprobada. No se cambia con un campo de texto común. Para elegir otra cuenta se verifica con Google y se firma explícitamente desde el acceso aprobado: el servidor vuelve a comprobar la cuenta elegida y aplica el cambio sin aprobación posterior. No transfiere roles internos ni facultades de representación empresarial.
- `providerPortalDeclarations/{id}` conserva contenido firmado, actor, hash, enlace a Sign y aplicación de datos. Identidad, CUIT/DNI y banco entran en vigencia con la firma de la cuenta aprobada, con auditoría y actualización transaccional de `providerIdentifiers`. Un identificador ajeno o un cambio concurrente detiene toda la aplicación. No modifica facturas ni pagos anteriores. Las declaraciones de representación y terceros mantienen sus controles separados.
- `providerPortalInvoiceUploads/{id}` vincula factura cargada, proveedor, trabajo, ruta y SHA256. El mismo archivo para el mismo trabajo se recupera sin duplicarlo, incluso con un reintento de distinto ID. La carga no crea costo ni pago.
- `providerPortalFileGrants/{id}` aprueba una versión exacta de un original para publicación. Cambiar los bytes invalida la aprobación. Los originales bancarios y los que no prueban su pertenencia al gasto requieren esta revisión; no se revela información de terceros por seguir una URL o confiar en `portalSafe` enviado por cliente.
- `providerPortalProjectLinks/{projectId}` relaciona el proyecto existente con su carpeta de GB Sign. No crea un proyecto comercial ni otro costo.
- `providerPortalAudit` conserva decisiones y cambios de representación.

Las descargas se verifican en cada callable y entregan bytes, sin devolver tokens permanentes. Las facturas subidas al portal se pueden abrir desde las filas y fichas internas mediante una descarga con ACL de proyecto. El servidor valida también el contenido y la asociación guardada; una referencia de archivo manipulada no permite descargar documentos privados de otro proyecto.

## Cambios de datos y terceros

### Alta de persona sin factura propia — cambio preparado, pendiente de publicación

El alta de persona física ofrece el enlace «No puedo emitir factura», al final del formulario. La ventana conserva el borrador al cerrar, corregir errores o cambiar de tipo; recoge nombre, relación, actividad del tercero, CUIT, titular y CBU/CVU o alias. Al guardar la alternativa, los datos fiscales/bancarios **propios** pasan a ser opcionales. Los valores del tercero nunca reemplazan los del prestador.

Esta variante usa la acción `registerThirdPartyIntake` de `providerPortal`, con Google verificado y autenticación reciente. En una transacción valida invitación/estado/vencimiento, duplicados y fila no asignada/sin pagos; crea la persona y sus índices propios, consume la invitación o incrementa su uso múltiple y vincula la fila existente. Reintentar el mismo intento no crea otra ficha ni vuelve a consumir el enlace. El CUIT del tercero no se agrega al índice del prestador.

La captura queda en `providerPortalIntakeRequests/{providerId}`, sin acceso directo desde SDK (denegación por defecto); no se agrega información bancaria del tercero al catálogo general de proveedores. La ficha conserva sólo el identificador y el hash de la presentación. Se crea una membresía **pendiente de confirmación**, sin rol interno ni lectura del historial: la persona debe firmar la representación existente antes de obtener la vista propia.

El botón «Continuar a la declaración y firma» abre Mi proveedor. Tras firmar la representación, Mis datos recupera la solicitud y el trabajo del enlace. La persona revisa el contenido y elige una vigencia antes de preparar la autorización de terceros. Una invitación general conserva alcance vacío: primero se necesita un trabajo asignado; nunca se presume autorización global. El servidor vuelve a validar que todos los trabajos elegidos pertenecen al prestador. La declaración `third-party-v2` incluye relación y actividad del tercero; el servicio real se conserva en los trabajos. Los dos conceptos se muestran en PDF, revisión y ficha de autorizaciones.

Sólo una ficha con `type: persona` puede crear, aprobar o usar una autorización para operaciones nuevas. Empresas no tienen esta opción en alta/Mis datos ni en los selectores de nuevas operaciones financieras; los antecedentes continúan visibles. Una ficha histórica sin tipo explícito necesita clasificación administrativa antes de crear una autorización: no se reclasifica automáticamente.

Las rutas y tokens de alta no cambian. Se conservan enlaces de uso único/múltiple, vencimientos y formatos históricos sin `expiresAt` o sin `collectionName` (áreas por defecto). No se regeneran enlaces ni se tocan borradores de correo/SENT.

**Límite no resuelto por este cambio:** Gestión de pagos simple no consume autorizaciones de beneficiario tercero; `thirdPartyPayer` sigue siendo el circuito de adelantos/reintegros. La ficha compartida conserva su integración y sus verificaciones cuando se selecciona una autorización. Los campos financieros históricos sin referencia de autorización no se migran ni pasan a imponer autorización universal.

No requiere cambios de IAM, Authentication, índices ni reglas. La variante del SDK de alta normal mantiene su esquema y permisos anteriores. Si se autoriza publicar, deben coordinarse frontend y las funciones `providerPortal`, `manageProviderPortal` y `manageProviderFinance`; el cliente anterior no envía los nuevos campos obligatorios. No se necesita modificar el motor de GB Sign. Esta sección describe código preparado, sin firmas, aprobaciones, migraciones ni despliegue de producción ejecutados por el cambio.

Editar → revisar PDF → firmar con nombre cursivo o dibujo → aplicación automática. La fecha de firma es de servidor y el DNI queda declarado, no certificado. Todos los datos propios se aplican sin revisión administrativa posterior; se comprueba la membresía activa y la firma/evidencia completa antes de escribir. Los cambios ya firmados bajo el circuito anterior pueden completar su aplicación desde Mis datos sin otra firma si sus datos base y accesos siguen vigentes; no hay migración masiva al publicar.

Documentos reúne cada declaración de la ficha con su original, PDF firmado y certificado, sin duplicarla como otra solicitud de firma. Las representaciones personales del alta anterior se identifican como antecedentes sin acción pendiente; no se ofrecen como firmas necesarias. Las representaciones de empresa y las autorizaciones de terceros conservan su circuito propio. Una declaración pendiente abre el documento para firmar; una firma sin PDF ofrece completarlo, y una declaración antigua ya firmada permite comprobar su aplicación. El resultado o error aparece junto a esa constancia y se recargan tanto la ficha como los documentos. Si otra actualización cambió los datos base, el servidor conserva su rechazo y la persona puede revisar la ficha actual antes de preparar otra declaración; no se sobreescriben datos posteriores ni se eliminan antecedentes.

La autorización de un tercero identifica prestador, emisor propuesto y beneficiario; se limita a trabajos seleccionados y tiene vencimiento. Facturación y cobro se aprueban por separado. Los arreglos posteriores entre prestador y beneficiario quedan declarados como su responsabilidad. La firma no acredita pago ni valida por sí sola el encuadre fiscal.

`#/portal-proveedores` permite preparar coincidencias, resolver representaciones, revisar autorizaciones de terceros y publicar comprobantes tras revisar su versión. La ficha financiera del proveedor muestra las autorizaciones firmadas. Al seleccionarlas para una factura o pago distribuido, el servidor vuelve a verificar estado, función aprobada, vencimiento en Buenos Aires, prestador, CUIT/beneficiario y trabajos. El registro conserva la versión usada. Una revocación no modifica pagos ni documentos anteriores.

En Documentos del proyecto se ven contratos y cesiones preparados con el editor existente de GB Sign, firmantes, estado y originales/PDF/evidencia. Se muestran también las declaraciones de terceros vinculadas a ese proyecto. Un colaborador de un proyecto no obtiene el PDF íntegro de una autorización que incluye otros proyectos; administración conserva esa descarga. La consulta se actualiza al abrir y cada 30 segundos mientras está visible; no se promete sincronización de fondo con CT ni con carpetas.

## Integración con Sign

`providerPortal` y `manageProviderPortal` son callables de GOAT. Su entrada de funciones se carga aisladamente para no depender de integraciones ajenas durante un inicio en frío.

GOAT prepara PDFs legibles de declaraciones y los deja inmutables en Sign con su hash de datos y del archivo. Sign conserva la autoridad de firma y los artefactos. `exchangeGoatSession`, en Sign, valida un ID token de **gb-goat**, su revocación, correo verificado, proveedor de identidad admitido y la habilitación del portal. Reutiliza la cuenta de Sign por email o crea su cuenta propia; no concede roles internos. El token de sesión no va en enlaces ni se guarda en almacenamiento persistente del navegador. La sesión secundaria usa persistencia en memoria y se cierra tras firmar.

`signDocument` conserva el motor de firma de Sign, exige consentimiento expreso conocido, comprueba el hash antes de guardar evidencia y congela el documento. Las declaraciones administradas por GOAT no se editan/eliminan desde el SDK. Las regeneraciones guardan versiones diferentes de artefactos y comprueban el conjunto de firmas en transacción para no reemplazar el estado completo con una generación parcial atrasada. Si el PDF falla, el portal ofrece completar su generación sin inventar otra firma.

## Preparación de producción: no ejecutada por estos cambios

1. Revisar ambos PR y la redacción de las declaraciones. Confirmar la configuración actualmente desplegada y respaldar datos/reglas antes de publicar.
2. Comprobar que Google esté habilitado en Firebase Authentication de ambos proyectos. Probar una cuenta Google verificada, una cuenta Google con correo que no sea Gmail, un correo no asociado y una cuenta sin verificación. No se requiere configurar otro proveedor de identidad, registrar una aplicación externa ni crear un secreto OAuth adicional.
3. Definir identidades de ejecución dedicadas y revisar IAM. Los parámetros declarativos son `GOAT_PORTAL_SERVICE_ACCOUNT` (por defecto `goat-provider-portal@gb-goat.iam.gserviceaccount.com`) y `SIGN_GOAT_BRIDGE_SERVICE_ACCOUNT` (por defecto `sign-goat-bridge@gb-sign-e1776.iam.gserviceaccount.com`). Crear esas identidades y autorizar sus permisos es una operación de infraestructura separada; el código no las aprovisiona. GOAT necesita leer/escribir los proyectos/documentos/solicitudes de Sign que administra y leer sus artefactos; Sign necesita verificar tokens/revocación de GOAT y leer el indicador de habilitación. La creación de custom tokens requiere firma de credenciales del servicio de Sign. **Firestore IAM no ofrece un filtro por proveedor equivalente a nuestras reglas de aplicación**: la delegación entre servicios es una decisión de infraestructura y no debe darse por concedida. Restringir objetos de Storage por prefijos cuando sea posible. No compartir claves privadas.
4. Configurar `GB_SIGN_WEB_API_KEY` en el entorno de las funciones GOAT. Es configuración web pública de Sign. La app secundaria usa proyecto `gb-sign-e1776`; GOAT usa `gb-goat`.
5. Agregar los índices de grupo para `budgetItems.providerId` y `areaExpenses.providerId` indicados en `firestore.portal.indexes.json`. Integrarlos con los índices vigentes después de leerlos; no reemplazar ni eliminar los del proyecto.
6. Publicar coordinadamente reglas/backend de Sign y reglas/backend de GOAT, con el portal todavía deshabilitado. El backend nuevo requiere una versión de cliente que envíe el consentimiento vigente; no habilitar declaraciones en un frontend anterior. Verificar interfaces internas antes de publicar los frontends. No activar el portal sobre las reglas antiguas de lectura amplia.
7. Preparar primero el informe de asociaciones desde Revisiones de proveedores. Aplicar sólo tras revisar los casos ausentes/ambiguos; esta operación congela `portalAccessEmail`. No asigna roles de producción, no envía invitaciones y no cambia contactos.
8. Activar `providerPortalConfig/current` con `{enabled:true}` desde un operador autorizado. Probar cuentas de proveedor, productor/proveedor, empresa representada y firmante sin proveedor, además de descargas, cambios y revocaciones. Leer nuevamente el estado publicado. Deshabilitar ese indicador detiene las nuevas operaciones del portal y los intercambios de sesión; no revoca archivos descargados ni cambia permisos internos existentes.

Los saldos y movimientos de CT y los archivos administrativos privados no se migran ni sincronizan automáticamente. Los antecedentes de terceros nunca se presentan como nuevas declaraciones firmadas.

## Verificación

```text
npm ci
npm ci --prefix functions
npm test
npm test --prefix functions
npm run lint
npm run build
```

Para el circuito completo, disponer del checkout de la rama compatible de **GB Sign** con sus dependencias `functions` y Java21. `GB_SIGN_TEST_ROOT` puede indicar su ruta; por defecto se busca el worktree hermano `../GB-Sign-provider-portal`.

```text
npm run test:portal
npm run test:portal-rules
```

El segundo comando arranca cada suite con su proyecto demo correspondiente: Storage consulta Firestore bajo el proyecto del emulador y no debe mezclarse ese contexto. Incluye las pruebas existentes de privacidad comercial, administración, documentos, áreas, finanzas, pagos compartidos, archivos de pago y cajas, más el circuito real de PDF/firma/artefactos de Sign aplicado a GOAT. La prueba rechaza ejecutarse sin emuladores. No constituye una prueba del consentimiento OAuth real ni de la configuración IAM de producción.

Los endpoints mantienen límites explícitos de 500 registros por sección/consulta y 10.000 fichas para una preparación; si se superan, fallan con un aviso y no presentan una lista truncada como completa. Es necesario paginar antes de ampliar esos límites. Carga de facturas: PDF/JPG/PNG de hasta2MB; descarga: formatos admitidos de hasta10MB. El acceso por enlace de email o por contraseña propia no está incluido en esta versión; se requiere una cuenta Google existente.
# Preparar contratos dentro de GOAT

En Documentos → Contratos, la carga manual y los contratos de GB Sign se muestran en una sola lista. Un archivo cargado conserva su original y puede quedar como respaldo de una firma manuscrita; administración puede elegir “Preparar firma” para solicitar firmas electrónicas sin salir de GOAT. No se interpreta una carga como documento firmado.

El editor abre el PDF con desplazamiento entre páginas a la izquierda y los proveedores firmantes a la derecha. Cada proveedor utiliza `portalAccessEmail` o, si falta, su `email`; no se puede sustituir libremente ese correo en la solicitud. La persona confirmará su DNI y consentimiento al firmar con su cuenta de Google. Administración ubica un recuadro por cuenta (máximo diez) y ajusta su página, posición y tamaño; no dibuja ni ejecuta firmas de terceros.

`manageProviderPortal` incorpora `projectContractSource` y `prepareProjectContract`, restringidos a administración global, propietario o administrador del proyecto. Los jefes de producción con Documentos conservan lectura, pero no preparan firmas. El servidor verifica la pertenencia del original al proyecto y documento, formato PDF sin contraseña, hash visto por el administrador, proveedores, correos, páginas y recuadros sin superposición.

La preparación reserva en `providerPortalProjectLinks/{projectId}/contracts/{sourceDocumentId}` un manifiesto privado y un identificador aleatorio del documento remoto. Copia el original inmutable al proyecto determinístico de GB Sign y crea allí documento y solicitudes en una transacción. Las reglas ya existentes protegen los documentos `portalManaged`; no se cambian reglas ni IAM. El manifiesto vincula original, proveedores y recuadros. Reintentos idénticos recuperan la misma preparación sin duplicar solicitudes o reiniciar firmas; si se cierra un intento incompleto, se recuperan sus firmantes y recuadros para reintentarlo. Una preparación distinta requiere una nueva carga; no se modifica un documento solicitado o firmado. La correspondencia de origen se verifica contra ese manifiesto privado, sin confiar en marcas de un documento común de GB Sign, para reunir ambas filas.

El proveedor encuentra la solicitud en sus documentos de GOAT mediante el mismo motor y sesión de GB Sign. Se mantienen firma por usuario, estados parciales/completos, PDF firmado y certificado. No se envían correos, no se crean gastos ni pagos, y la preparación no ejecuta firmas.

La prueba `tests/projectContracts.flow.mjs`, ejecutada dentro de `tests/providerPortal.emulator.mjs`, carga un PDF ficticio, prepara dos firmantes, usa las funciones reales de GB Sign en emuladores y verifica archivos finales, aislamiento, permisos, hash y reintentos. El ejemplo local `tests/fixtures/documentos.html` utiliza los componentes reales con estado simulado y no llama a Firebase.
