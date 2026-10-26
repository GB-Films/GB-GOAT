# Portal de proveedores y GB Sign

Implementación en dos repositorios: GOAT y GB Sign. El código no activa usuarios ni publica reglas por sí solo. La ausencia de `providerPortalConfig/current.enabled: true` mantiene cerrado el acceso externo. Los colaboradores existentes conservan su inicio de sesión y sus roles.

## Experiencia

`#/mi-proveedor` muestra la cuenta autenticada y el proveedor representado. Una cuenta puede tener varias representaciones expresamente asignadas. Su selector no concede permisos. El perfil externo nunca se guarda en `users` como un colaborador interno.

Las cinco secciones son Trabajos, Facturas, Pagos y retenciones, Documentos y Mis datos. Incluyen documentos cargados por otras personas, pagos simples y aplicaciones de pagos distribuidos. El comprobante original y sus aplicaciones se distinguen; no se suman otra vez. Un trabajo marcado pagado sin historial se identifica como tal y no se reconstruye un pago ficticio.

Google y Microsoft se pueden vincular a una misma cuenta conservando el UID. Para un correo que ya usa otro método, el usuario debe ingresar con el método original y vincular el nuevo desde Mis datos. Se exige correo verificado. Si el proveedor de identidad no lo acredita, el usuario puede solicitar la verificación desde la aplicación. Ningún correo se envía al desplegar o preparar asociaciones.

La primera representación se confirma mediante declaración en GB Sign, sin obligar a ratificar datos anteriores que pudieran estar equivocados; luego pueden corregirse en Mis datos. El tipo «representante autorizado» recoge una declaración; no certifica por sí mismo facultades societarias. Las personas que sólo firman pueden consultar sus documentos sin ficha comercial ni permisos de producción.

## Autoridades y datos

- `users/{uid}` conserva exclusivamente los roles internos existentes. Sus catálogos amplios requieren usuario interno y correo verificado. Los permisos de proyecto continúan siendo independientes.
- `providerPortalUsers/{uid}/memberships/{providerId}` contiene representación, estado, email de acceso y evidencia. Se escribe desde servidor; ni el usuario ni un admin pueden forjarla con el SDK.
- `providerPortalCandidates/{hashEmail}` es una preparación administrativa. Un correo compartido por varias fichas no se asocia automáticamente. Una generación incompleta no es activable por el cliente.
- `providers.portalAccessEmail` congela el correo de acceso al preparar por primera vez una coincidencia única. Cambiar `providers.email` modifica el contacto, nunca la cuenta autorizada. Otras representaciones se asignan explícitamente por administración contra un usuario de Authentication existente y verificado.
- `providerPortalDeclarations/{id}` conserva contenido firmado, actor, hash, enlace a Sign, aplicación de datos comunes y decisiones administrativas. Los cambios de CUIT/DNI mantienen los índices únicos `providerIdentifiers` en la misma transacción; un identificador ajeno detiene la aprobación. No cambia el prestador histórico ni las facturas anteriores.
- `providerPortalInvoiceUploads/{id}` vincula factura cargada, proveedor, trabajo, ruta y SHA256. El mismo archivo para el mismo trabajo se recupera sin duplicarlo, incluso con un reintento de distinto ID. La carga no crea costo ni pago.
- `providerPortalFileGrants/{id}` aprueba una versión exacta de un original para publicación. Cambiar los bytes invalida la aprobación. Los originales bancarios y los que no prueban su pertenencia al gasto requieren esta revisión; no se revela información de terceros por seguir una URL o confiar en `portalSafe` enviado por cliente.
- `providerPortalProjectLinks/{projectId}` relaciona el proyecto existente con su carpeta de GB Sign. No crea un proyecto comercial ni otro costo.
- `providerPortalAudit` conserva decisiones y cambios de representación.

Las descargas se verifican en cada callable y entregan bytes, sin devolver tokens permanentes. Las facturas subidas al portal se pueden abrir desde las filas y fichas internas mediante una descarga con ACL de proyecto. El servidor valida también el contenido y la asociación guardada; una referencia de archivo manipulada no permite descargar documentos privados de otro proyecto.

## Cambios de datos y terceros

Editar → revisar PDF → firmar con nombre cursivo o dibujo → aplicar. La fecha de firma es de servidor y el DNI queda declarado, no certificado. Los datos comunes entran en vigencia tras completar firma y artefactos. CUIT, identidad y banco conservan sus valores vigentes hasta revisión administrativa.

La autorización de un tercero identifica prestador, emisor propuesto y beneficiario; se limita a trabajos seleccionados y tiene vencimiento. Facturación y cobro se aprueban por separado. Los arreglos posteriores entre prestador y beneficiario quedan declarados como su responsabilidad. La firma no acredita pago ni valida por sí sola el encuadre fiscal.

`#/portal-proveedores` permite preparar coincidencias, resolver representaciones, aprobar/rechazar cambios y publicar comprobantes tras revisar su versión. La ficha financiera del proveedor muestra las autorizaciones firmadas. Al seleccionarlas para una factura o pago distribuido, el servidor vuelve a verificar estado, función aprobada, vencimiento en Buenos Aires, prestador, CUIT/beneficiario y trabajos. El registro conserva la versión usada. Una revocación no modifica pagos ni documentos anteriores.

En Documentos del proyecto se ven contratos y cesiones preparados con el editor existente de GB Sign, firmantes, estado y originales/PDF/evidencia. Se muestran también las declaraciones de terceros vinculadas a ese proyecto. Un colaborador de un proyecto no obtiene el PDF íntegro de una autorización que incluye otros proyectos; administración conserva esa descarga. La consulta se actualiza al abrir y cada 30 segundos mientras está visible; no se promete sincronización de fondo con CT ni con carpetas.

## Integración con Sign

`providerPortal` y `manageProviderPortal` son callables de GOAT. Su entrada de funciones se carga aisladamente para no depender de integraciones ajenas durante un inicio en frío.

GOAT prepara PDFs legibles de declaraciones y los deja inmutables en Sign con su hash de datos y del archivo. Sign conserva la autoridad de firma y los artefactos. `exchangeGoatSession`, en Sign, valida un ID token de **gb-goat**, su revocación, correo verificado, proveedor de identidad admitido y la habilitación del portal. Reutiliza la cuenta de Sign por email o crea su cuenta propia; no concede roles internos. El token de sesión no va en enlaces ni se guarda en almacenamiento persistente del navegador. La sesión secundaria usa persistencia en memoria y se cierra tras firmar.

`signDocument` conserva el motor de firma de Sign, exige consentimiento expreso conocido, comprueba el hash antes de guardar evidencia y congela el documento. Las declaraciones administradas por GOAT no se editan/eliminan desde el SDK. Las regeneraciones guardan versiones diferentes de artefactos y comprueban el conjunto de firmas en transacción para no reemplazar el estado completo con una generación parcial atrasada. Si el PDF falla, el portal ofrece completar su generación sin inventar otra firma.

## Preparación de producción: no ejecutada por estos cambios

1. Revisar ambos PR y la redacción de las declaraciones. Confirmar la configuración actualmente desplegada y respaldar datos/reglas antes de publicar.
2. Configurar Microsoft en **ambos proyectos** de Firebase Authentication. El registro de aplicación Microsoft debe admitir las cuentas personales y laborales que se quieran aceptar y los redirect URI correspondientes. Usar el secreto en la configuración de Authentication, nunca en Git ni en el navegador. Conservar un usuario por correo y probar Google/Microsoft/vinculación con cuentas de prueba.
3. Definir identidades de ejecución dedicadas y revisar IAM. Los parámetros declarativos son `GOAT_PORTAL_SERVICE_ACCOUNT` (por defecto `goat-provider-portal@gb-goat.iam.gserviceaccount.com`) y `SIGN_GOAT_BRIDGE_SERVICE_ACCOUNT` (por defecto `sign-goat-bridge@gb-sign-e1776.iam.gserviceaccount.com`). Crear esas identidades y autorizar sus permisos es una operación de infraestructura separada; el código no las aprovisiona. GOAT necesita leer/escribir los proyectos/documentos/solicitudes de Sign que administra y leer sus artefactos; Sign necesita verificar tokens/revocación de GOAT y leer el indicador de habilitación. La creación de custom tokens requiere firma de credenciales del servicio de Sign. **Firestore IAM no ofrece un filtro por proveedor equivalente a nuestras reglas de aplicación**: la delegación entre servicios es una decisión de infraestructura y no debe darse por concedida. Restringir objetos de Storage por prefijos cuando sea posible. No compartir claves privadas.
4. Configurar `GB_SIGN_WEB_API_KEY` en el entorno de las funciones GOAT. Es configuración web pública de Sign, no un secreto de Microsoft. La app secundaria usa proyecto `gb-sign-e1776`; GOAT usa `gb-goat`.
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

Los endpoints mantienen límites explícitos de 500 registros por sección/consulta y 10.000 fichas para una preparación; si se superan, fallan con un aviso y no presentan una lista truncada como completa. Es necesario paginar antes de ampliar esos límites. Carga de facturas: PDF/JPG/PNG de hasta2MB; descarga: formatos admitidos de hasta10MB. El acceso por enlace de email para proveedores sin Google/Microsoft no está incluido en esta versión.
