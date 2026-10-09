# Alta automática CRM → GOAT

El Code Generator del CRM entrega a GOAT sólo códigos G nuevos, después de confirmar su registro en `codigos.csv`. Cada código corresponde a un proyecto; una venta puede tener varios códigos. Las filas B permanecen en sus destinos actuales. No hay importación automática del histórico ni actualización de proyectos existentes.

## Datos y permisos

El mensaje versión 1 usa el mismo mapeo que Control Total: código completo, nombre, cliente que paga, marca, empresa madre, servicio, fechas, importe y moneda de ese código. El budget USD de la venta no reemplaza al contrato del código. ARS inicia el presupuesto operativo de GOAT; USD conserva su importe de referencia y deja el presupuesto ARS en cero hasta su carga manual. Un precio pendiente conserva `contractAmount: null` y moneda vacía. Los proyectos nacen en Presupuesto, con categorías habituales y sin colaboradores; los administradores globales pueden verlos y asignarlos.

`importCrmProject` es una función HTTP privada en `gb-goat`, base Standard `(default)`, región `us-central1`. GitHub Actions obtiene un ID token efímero por Workload Identity Federation. El provider limita el acceso al ID numérico `1324272374`, propietario `280508939`, rama main y workflow `Klausstin/gran-crm/.github/workflows/code-generator.yml@refs/heads/main`. No se exportan llaves permanentes ni archivos de credenciales.

- Cuenta llamadora: `crm-goat-caller@gb-goat.iam.gserviceaccount.com`, sólo invoca este servicio.
- Cuenta del receptor: `crm-project-import@gb-goat.iam.gserviceaccount.com`, rol de lectura y creación en `(default)`, sin permisos de actualización, eliminación o Firebase Auth.
- Los recibos `crmProjectImports/{id}` no están accesibles desde el cliente; el Admin SDK usa IAM.

## Idempotencia y conflictos

Una transacción busca el código exacto y usa el mismo ID `ct-G-SIGLAS-NUMERO` de la importación manual desde CT. Si ya existe, no cambia nombre, presupuesto, pagos, equipo ni estado. Crea un recibo junto con el alta y devuelve el código y el proyecto confirmado. El recibo impide que un reintento resucite un proyecto borrado por un administrador. Con códigos duplicados, ID incompatible, venta distinta o coincidencia ambigua con un proyecto sin código devuelve HTTP 409: revisión manual, sin fusionar ni sobrescribir.

El CRM marca `goat` como pendiente al generar únicamente las nuevas G. Si falla, conserva el código y los otros destinos; el workflow queda en rojo y el repaso actual de seis horas reintenta sólo ese destino. El fallo lo atiende el circuito existente del mecánico del CRM. No se añade cron ni job. Esta deduplicación se aplica al código confirmado; no cambia la numeración ni la puerta de generación del CRM.

La lista Proyectos usa una suscripción en tiempo real con los mismos filtros de permisos. La importación manual desde CT permanece disponible para casos anteriores. Esta integración es de alta: las correcciones posteriores de nombre/cliente/código o contrato se revisan en GOAT, sin actualización automática del presupuesto.

## Configuración y verificación

`node scripts/configure-crm-import.cjs` presenta un plan sin escrituras; `--apply` configura sólo esta integración, preservando políticas y sus versiones. Requiere el CLI de Firebase ya autorizado con la cuenta de la empresa. No cambia planes de facturación. Después de desplegar únicamente `functions:importCrmProject`, repetir para conceder invocación al servicio y obtener su URL. Si cambia la URL/provider, actualizar los valores públicos del workflow CRM y la URL admitida por `goat_destino.py` y el verificador; no son secretos.

Pruebas:

- `npm test --prefix functions`: validación, recibos, existentes, borrados, conflictos y HTTP.
- `firebase emulators:exec --only firestore --project demo-gb-goat-crm-import "node --test functions/crmProjectImport.test.js"`: concurrencia sobre un emulador, nunca producción.
- `node scripts/verify-crm-import.cjs`: comprueba rechazo anónimo y la política IAM privada; no crea ni modifica datos ni requiere ampliar permisos de una persona.
- Modo manual `verificar_goat=true` del workflow CRM: prueba la identidad efímera de Actions con JSON vacío, rechazado por el validador; omite cola, correcciones y planillas.
- CRM: `python code_generator/verificar_goat.py` y `python verificar_repo.py --completo`.

La prueba de punta a punta de negocio queda para el próximo código G real elegido por una persona. No se generan ventas ni códigos ficticios en producción.

## Consumo y reversibilidad

No hay servidores reservados: `minInstances: 0`, máximo dos instancias, 256 MiB, una CPU, concurrencia cuatro, timeout 30 s. Por alta normal: una invocación, hasta cuatro lecturas de verificación y dos creaciones; el reintento confirmado lee sólo el recibo. Los conflictos se acotan con queries de dos resultados. Una entrega por intento, sin ráfagas; el repaso de seis horas ya existente es la red. No se crean jobs de Actions adicionales. La firma agrega segundos al job existente; según el redondeo puede sumar hasta un minuto facturado por corrida (cota de 120 min/mes en los respaldos más altas); medir el incremento real.

Estimación conservadora para 100 altas/mes y 100 reintentos de 30 s: ≤6.000 vCPU-s, ≤1.500 GiB-s, 200 invocaciones, ~600 lecturas y 200 escrituras, más compilación/almacenamiento y tráfico mínimos del despliegue. No garantiza costo cero: cuotas gratuitas se comparten con otros servicios y la cuenta Blaze ya estaba activa. Referencias: [Cloud Run](https://cloud.google.com/run/pricing), [Firestore](https://firebase.google.com/docs/firestore/pricing), [autenticación de Actions](https://github.com/google-github-actions/auth).

Para detener nuevas altas, revertir la incorporación de `goat` para nuevas filas en el CRM; preservar sus pendientes y recibos. Para cortar acceso, retirar sólo el binding run.invoker de la cuenta llamadora. No borrar proyectos ni recibos como rollback de infraestructura.
