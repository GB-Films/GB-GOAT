# Alta automática CRM → GOAT

El Code Generator del CRM entrega a GOAT códigos G y códigos B independientes, después de confirmar su registro en `codigos.csv`. Una B con G asociado inequívocamente conserva su asignación BANI en G y no crea otro proyecto B. Una venta puede tener varios códigos. El histórico usa un modo administrativo manual y revisado; no se agrega al repaso automático ni actualiza proyectos existentes.

### B independientes · cambio preparado, sin publicación

G mantiene los contratos v1/v2. El mensaje v3 está reservado a B independientes: los mismos campos comerciales v2 más `bIndependent: {bRow, gRows, gCandidateCount, bCodeCount}`. El emisor relee el CSV completo, verifica la fila elegida y cuenta el código B completo en todo el registro; debe ser único. Busca todos los candidatos G por `codigo_n` o `codigo_discord` de esa operación, nunca por nombre o número solos. El receptor comprueba hash de fila, identidad, mapeo y el conjunto de candidatos declarado por el emisor privado autenticado; la ausencia de G se acredita por esa lectura del emisor y su hash de registro, no por una consulta independiente de GOAT a Dropbox. Si hay identidad fuerte con metadatos completos coincidentes, se excluye B; si los datos se contradicen o hay varios candidatos, queda para revisión. Se admite como máximo diez candidatos y 16k de prueba; no se trunca para declarar independencia.

Una B nueva usa `ct-B-SIGLAS-NUMERO`, `controlTotalOwnerUnit: BANI` y conserva cliente, empresa madre, servicio, importe/moneda de su fila según el mapeo canónico. No se inventa una factura ni se modifica la empresa emisora administrativa. USD confirmado por código se convierte con BNA sólo al crear; ARS existente queda intacto. Nunca genera una partida «Toda la Post» para sí misma, ni un proyecto G, gasto, factura, pago o caja. Proyecto, comercial y recibo se crean juntos; colisiones, proyectos sin código y partidas huérfanas conservan las guardas existentes. Recibos impiden duplicados o resucitar proyectos borrados. Una relación G aparecida después requiere revisión, sin borrar o fusionar el B ya creado.

Las B nuevas quedan optadas al destino GOAT al generarse. Repasos comunes no incorporan B históricas sin marca. El reintento manual de un B concreto permite optar sólo ese destino, en seco primero; el histórico explícito admite B independientes sin precio confirmado, manteniendo desconocidos y apartando precios que requieren autorización particular. El selector manual de Control Total permanece sólo G: esas filas no traen la prueba de relación del CSV completo y no deben convertirse en un atajo que duplique B pareadas.

El caso Clayface B AD0002 tiene confirmación humana de USD5200; el valor histórico4800 no la reemplaza. El emisor conserva los4800 y el hash de la fila original; no fabrica una fila canónica. El modo aislado recibe `confirmacion_importe_goat` y envía sólo `contractOverride: {approvalId}`. Producción debe registrar previamente por su acceso administrativo `crmProjectImportAuthorizations/ct-B-AD-0002`: `schemaVersion:1`, `decision:approved`, `approvalId`, `projectCode`, `saleId`, `rowSha256`, `originalAmount`, `originalCurrency`, `amount`, `currency`, `confirmedAt`, `source` y `sourceSha256`. La referencia y el hash del documento de confirmación provienen de la evidencia humana ya recibida; no se vuelve a consultar el precio ni se usa el budget de la venta. El cliente no puede escribir esa colección (denegación por defecto); el receptor HTTP sólo la lee y jamás crea autorizaciones a partir de una petición.

El circuito administrativo nativo es `node scripts/authorize-crm-contract.cjs <JSON-privado>`: vista previa por defecto; `--apply` registra únicamente esa autorización y la relee. El JSON agrega `operatorEmail`, `sourceFile` (original de la evidencia humana) y `originalRow` (fila CSV original completa). Antes de acceder verifica SHA256 de `sourceFile`; usa la sesión oficial local de Firebase, sin copiar credenciales, y exige un usuario global único con rol `admin` para ese correo. Valida huella y precio originales; no sobrescribe otra autorización y rechaza proyectos o recibos existentes. No crea proyecto, comercial, factura ni pago, no modifica presupuestos ni CSV y no agrega un endpoint público. Producción prepara y revisa ese JSON; este cambio no ejecuta `--apply` sobre datos reales.

Al crear B, la transacción busca siempre esa autorización. Si existe exige su referencia exacta, estado aprobado y coincidencias de código/venta/hash de fila/importe original; si falta referencia o no coincide, falla409 en lugar de usar4800. La cotización y el proyecto utilizan el importe aprobado5200 y el recibo conserva ambos valores y las dos fuentes. Con BNA compra1510/venta1560 del30/10 el caso de prueba produce ARS7.982.000. Los proyectos ya existentes y los recibos previos no se actualizan ni se recrean. No se codifica una excepción por nombre y esta implementación no registra la autorización ni ejecuta ese alta o los lotes reales.

Orden de publicación preparado: `importCrmProject`, verificar fuente/configuración/IAM conservados; después emisor/workflow Code Generator. No requiere frontend, nuevas reglas, IAM, cron ni otro destino. `scripts/test-crm-import-contract.cjs` prueba el emisor Python real G/B contra el receptor Node en un emulador: concurrencia, USD5200 por código, cero/desconocido/histórico, presupuestos editados intactos y ausencia de autoasignación en B.

## Datos y permisos

El mapeo usa código completo, nombre, cliente que paga, marca, empresa madre, servicio, fechas, importe y moneda de ese código. El budget USD de la venta no reemplaza al contrato del código. ARS inicia el presupuesto operativo sin conversión. USD confirmado se convierte sólo al crear con el promedio compra/venta del dólar billetes BNA del día argentino; conserva importe original, fuente, fecha, valores y hash en el recibo privado. Una cotización no verificable o de otra fecha deja el alta pendiente503, sin fallback cero. Un precio pendiente conserva `contractAmount: null` y moneda vacía, con cero operativo rotulado como pendiente en la ficha administrativa. Las nuevas G nacen en Presupuesto, con categorías habituales y sin colaboradores.

La versión2 agrega `importMode` (`new`/`historical`), `projectStatus`, `contractConfirmed` y `sourceEvidence` (`registryPath`, `registrySha256`, `rowSha256`, `verifiedAt`, `note`). El emisor relee bytes del CSV, verifica fila/código/precio y registra sus hashes. Precio confirmado para altas nuevas es PRECIO FINAL informado en la fila `v3-form`, nunca el budget general de la venta. El protocolo versión1 permanece aceptado durante la actualización; su contrato USD por código usa la misma conversión verificada. Las respuestas conservan versión1.

El modo `historical` permite venta/fechas desconocidas (`null` o vacío); las fechas conocidas deben ser ISO válidas. Admite Cerrado/Archivado/Cancelado con fuente, o Histórico cuando el cierre es desconocido. No se interpreta antigüedad como cierre ni fecha de carga como confirmación comercial histórica. La evidencia de creación debe haberse leído dentro de36h y no estar más de5min en el futuro. Proyectos actuales e históricos se filtran en el catálogo; el tablero mantiene cinco columnas y no carga finanzas de históricos.

`importCrmProject` es una función HTTP privada en `gb-goat`, base Standard `(default)`, región `us-central1`. GitHub Actions obtiene un ID token efímero por Workload Identity Federation. El provider limita el acceso al ID numérico `1324272374`, propietario `280508939`, rama main y workflow `Klausstin/gran-crm/.github/workflows/code-generator.yml@refs/heads/main`. No se exportan llaves permanentes ni archivos de credenciales.

- Cuenta llamadora: `crm-goat-caller@gb-goat.iam.gserviceaccount.com`, sólo invoca este servicio.
- El invocador se declara explícitamente en `functions/index.js`. No usar `invoker: 'private'` más un permiso manual posterior: el CLI reemplaza el binding `roles/run.invoker` al volver a desplegar y quitaría ese permiso. La prueba `crmProjectDeployment.test.js` inspecciona el manifiesto real del SDK en cada CI para evitar esa regresión. El servicio sigue sin acceso público.
- Cuenta del receptor: `crm-project-import@gb-goat.iam.gserviceaccount.com`, rol de lectura y creación en `(default)`, sin permisos de actualización, eliminación o Firebase Auth.
- Los recibos `crmProjectImports/{id}` no están accesibles desde el cliente; el Admin SDK usa IAM.

## Idempotencia y conflictos

Una transacción busca el código exacto y usa el mismo ID `ct-G-SIGLAS-NUMERO` de la importación manual desde CT. Si ya existe, no cambia nombre, presupuesto, pagos, equipo ni estado. Crea un recibo junto con el alta y devuelve el código y el proyecto confirmado. El recibo impide que un reintento resucite un proyecto borrado por un administrador. Con códigos duplicados, ID incompatible, venta distinta o coincidencia ambigua con un proyecto sin código devuelve HTTP 409: revisión manual, sin fusionar ni sobrescribir.

El CRM marca `goat` como pendiente al generar únicamente las nuevas G. Si falla, conserva el código y los otros destinos; el workflow queda en rojo y el repaso actual de seis horas reintenta sólo ese destino. El fallo lo atiende el circuito existente del mecánico del CRM. No se añade cron ni job. Esta deduplicación se aplica al código confirmado; no cambia la numeración ni la puerta de generación del CRM.

La lista Proyectos usa una suscripción en tiempo real con los mismos filtros de permisos. La importación manual desde CT permanece disponible para casos anteriores. Esta integración es de alta: las correcciones posteriores de nombre/cliente/código o contrato se revisan en GOAT, sin actualización automática del presupuesto.

## Importación administrativa histórica

Mismo endpoint privado POST `https://importcrmproject-xydezfivga-uc.a.run.app`, WIF, identidad y carril exclusivo del workflow CRM; sin permisos nuevos ni UI pública de importación. `code_generator/goat_historicos.py` sólo lee el CSV y entrega payloads v2. El botón `historicos_goat` omite cola, repaso, correcciones, planillas y mensajes. Sin `aplicar_historicos_goat` sólo produce vista previa. Para aplicar exige SHA256 exacto del CSV revisado, registro remoto y GitHub Actions. Antes de cada envío comprueba bytes; si cambian se detiene. Excluye códigos duplicados, alias Fargo ya vinculado y precios históricos que necesitan confirmación. No modifica CSV ni sello de códigos.

Lotes de hasta10, inicio explícito `historicos_desde`, máximo300s antes del margen de cierre. El resultado registra `nextOffset` para continuar sobre el mismo hash o repetir el código incierto. Recibos GOAT hacen seguros los reintentos. Resultado JSON como artifact privado7d; Producción relee proyectos/comerciales/recibos y concilia al terminar. No borrar proyectos como rollback automático: preservar auditoría y recibos.

Orden de publicación: receptor GOAT compatible con v1/v2 y frontend, verificación de código vivo/IAM; después emisor/workflow CRM. Publicar no ejecuta el histórico: Producción inicia vista previa y lotes revisados. Sistemas no ejecuta el backfill.

## Configuración y verificación

### Post interna BANI · paquete en revisión

El emisor v2 agrega el campo opcional `baniPost`: `gRow`, `bRow` y `candidateCount`, tomados del CSV releído. El receptor comprueba la huella de G contra `sourceEvidence`, las identidades completas, `codigo_n`, código base, nombre, cliente, fecha de carga, venta, origen y grupo. La coincidencia del número por sí sola no acredita pareja. B debe ser la fila `Bani VFX`/`Interno`; precio final de esa fila v3, moneda ARS/USD y centavos válidos. Cero explícito se conserva, desconocido no se completa con importe G ni presupuesto de venta.

Referencia de proveedor verificada por Producción: `providers/MuwmMfDvOBC3tQkZLzvz`, BANI VFX LLC, empresa. Se relee en la transacción; nunca se crea/reemplaza un proveedor, se usa a Guido ni se cambia la ficha maestra a externo/interno. La naturaleza interna es de la fila: `economicNature: internal_estimate`.

Sólo al crear una G nueva se crea, si corresponde, `projects/{id}/budgetItems/crm-bani-post-v1`: área Post Producción, proveedor anterior, descripción exacta **Toda la Post**, Unidad, cantidad1, unitPrice/total en ARS y orden1. Guarda código y huella B, importe/moneda originales y conversión. USD usa la misma cotización BNA del día que G si ambos son USD; ARS va directo. Proyecto, comercial, fila estimada y recibo se crean en una transacción única. No se crea otro proyecto B en GOAT, ni areaExpenses, factura, pago o caja. Un recibo impide duplicar/reponer la fila editada o borrada. Una colección huérfana de presupuesto/gastos con padre ausente provoca409, sin crear otro global encima.

Falta o ambigüedad de pareja, importe sin confirmar, proveedor no verificable o cotización exclusiva de B no disponible: crea G válida y deja B pendiente, con motivo en recibo/advertencia administrativa; no crea una fila por cero ficticio. Si el contrato G también requiere USD, su propia cotización sigue siendo condición para crear G. No hay sincronización posterior de B: las correcciones pendientes son revisión administrativa.

La estimación permanece en el presupuesto/resultado estimado, con indicación **Estimación**. No participa como trabajo/deuda externa, gasto incurrido, vencimiento, factura o pago en los consumidores nuevos. El global B conserva su importe en la asignación/resultado estimado: su desglose no se agrega ni sustituye automáticamente el precio interno (FACTURACION_INTERNA_BANI_GB, punto3). Los gastos externos reales conservan su costo/deuda operativos propios. Activar el área no copia la estimación a areaExpenses; copiar presupuesto conserva clasificación. Filas BANI anteriores sin marca conservan interpretación nativa; no se reclasifican34 proyectos ni se añade post a existentes.

Publicación acotada del paquete, después de revisión/CI: consumidores backend `providerPortal`, `manageProviderPortal`, `manageProviderFinance` y frontend; luego `importCrmProject`; después emisor/workflow CRM. Conservar IAM/configuración y exigir recarga del frontend para usar los consumidores nuevos. Una entrega v1 sin pareja durante la transición queda identificada como pendiente, no se completa por inferencia. No desplegar los cambios ajenos de firestore.rules/invitaciones.

Las dos filas Stella autorizadas a Producción se revirtieron al detectarse el límite de los consumidores publicados; G sigue ARS5.500.000 por proyecto. Fuente humana B independiente: ARS1.500.000 por proyecto. Después de publicar soporte semántico, Producción podrá recrear esas dos estimaciones por su flujo autorizado y con clasificación interna; el importador no agrega filas a existentes. El CSV de origen aún dice USD para esas fuentes: corrección canónica pendiente por flujo oficial, sin edición ad hoc ni extrapolación a otros códigos.

`node scripts/configure-crm-import.cjs` presenta un plan sin escrituras; `--apply` configura sólo esta integración, preservando políticas y sus versiones. Requiere el CLI de Firebase ya autorizado con la cuenta de la empresa. No cambia planes de facturación. El despliegue de `functions:importCrmProject` conserva al caller mediante su lista declarativa de `invoker`; no hace falta volver a concederle acceso manualmente. Después comprobar IAM con el verificador. Si cambia la URL/provider, actualizar los valores públicos del workflow CRM y la URL admitida por `goat_destino.py` y el verificador; no son secretos.

Pruebas:

- `npm test --prefix functions`: validación, recibos, existentes, borrados, conflictos y HTTP.
- `firebase emulators:exec --only firestore --project demo-gb-goat-crm-import "node --test functions/crmProjectImport.test.js"`: concurrencia sobre un emulador, nunca producción.
- `node scripts/verify-crm-import.cjs`: comprueba rechazo anónimo y la política IAM privada; no crea ni modifica datos ni requiere ampliar permisos de una persona.
- Modo manual `verificar_goat=true` del workflow CRM: prueba la identidad efímera de Actions con JSON vacío, rechazado por el validador; omite cola, correcciones y planillas.
- CRM: `python code_generator/verificar_goat.py` y `python verificar_repo.py --completo`.
- Contrato entre repositorios con datos ficticios y emulador: configurar `CRM_REPO_ROOT`, `CRM_TEST_PYTHON` y ejecutar `node scripts/test-crm-import-contract.cjs` dentro de `emulators:exec` con proyecto `demo-*`. Genera payloads con el emisor Python real (ARS, USD, desconocido, histórico y v1), valida con receptor Node real y comprueba concurrencia/recibos/preservación de presupuestos editados.

Prueba real completada el 21/10/2026 con `G GB 0556 GOAT ZOOTOPIA`, elegido por Tomás.
Tras reparar el permiso borrado por el antiguo `invoker: private`, el diagnóstico CRM
[39542512417](https://github.com/Klausstin/gran-crm/actions/runs/39542512417), la vista
previa [39542664978](https://github.com/Klausstin/gran-crm/actions/runs/39542664978) y
la recuperación [39542740323](https://github.com/Klausstin/gran-crm/actions/runs/39542740323)
terminaron correctamente. Lectura posterior confirmó proyecto `ct-G-GB-0556`, datos
comerciales y recibo `created`; consulta por código limitada a dos devolvió uno.
CRM `7f88603` agrega reintento de una G pendiente, en seco por defecto, dentro del mismo
carril exclusivo, sin procesar cola ni otros destinos. No se generaron ventas/códigos
ficticios. Las pruebas locales específicas pasaron; el verificador completo CRM dejó
cuatro controles sin completar por rutas/datos privados locales no configurados en esta PC.

## Consumo y reversibilidad

No hay servidores reservados: `minInstances: 0`, máximo dos instancias, 256 MiB, una CPU, concurrencia cuatro, timeout30s. Por alta: una invocación, lecturas acotadas y tres creaciones (proyecto, comercial, recibo), o cuatro si corresponde estimación BANI. Se comprueba ausencia de partidas/gastos huérfanos y se lee el proveedor sólo con B confirmada. USD relee la transacción después de obtener BNA fuera de ella; G/B usan una cotización por intento. Reintento confirmado lee sólo el recibo. Sin jobs ni cron nuevos. El histórico manual usa lotes10 dentro del tope existente8min:185 candidatos incluidos existentes son19 lotes, hasta152min de cota de workflow más una vista previa8min, una sola vez.

Estimación conservadora para100 altas/mes y100 reintentos de30s: ≤6.000 vCPU-s, ≤1.500 GiB-s,200 invocaciones y hasta400 escrituras con BANI; las lecturas dependen de coincidencias, huérfanos, proveedor y segunda transacción USD, además de compilación/almacenamiento y tráfico. Las cuotas gratuitas se comparten y Blaze ya estaba activo. Referencias: [Cloud Run](https://cloud.google.com/run/pricing), [Firestore](https://firebase.google.com/docs/firestore/pricing), [autenticación de Actions](https://github.com/google-github-actions/auth).

Para detener nuevas altas, revertir la incorporación de `goat` para nuevas filas en el CRM; preservar sus pendientes y recibos. Para cortar acceso, retirar sólo el binding run.invoker de la cuenta llamadora. No borrar proyectos ni recibos como rollback de infraestructura.
