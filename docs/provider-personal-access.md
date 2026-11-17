# Acceso personal y clasificación de fichas antiguas

## Acceso propio y revisión son estados distintos

La fila amarilla de gastos usa `expenseRegistrationState`: una ficha manual o
importada es provisoria hasta acreditar alta propia, `personalGoogleAccount`,
origen reconocido de alta o confirmación histórica aplicada con prueba completa.
Las fichas administrativas explícitas son una excepción separada; carga/error de
la comprobación no significa provisional. Una membresía de portal por sí sola no
completa el alta y este cambio no modifica el indicador de gastos.

Una cuenta Google verificada, habilitada y expresamente vinculada puede consultar
su ficha de persona aunque falten DNI, CUIT, contacto o banco. El estado de revisión
no bloquea los trabajos y comprobantes propios ni concede roles internos. El
backend comprueba también la cuenta viva al cargar la cuenta y su resumen.

Para una ficha antigua sin `type`, la asociación ya marcada como representación
personal `own` permite acceso si no hay razón social, identidad verificada
contradictoria ni aprobación/declaración empresarial vigente. Se conserva la ficha
sin completar sus datos o alta; la advertencia incluye su clasificación pendiente.
Una asociación genérica no es evidencia suficiente para inferir que sea persona:
queda visible como pendiente de clasificación y no se anuncia que no tiene trabajos.
No se infiere identidad por nombre, correo de contacto o coincidencia de banco.

Administración tiene un camino por ficha: **Accesos de proveedores → Asociaciones
y publicación de comprobantes → elegir ficha y cuenta ya asociadas → Confirmar
ficha de persona**. La vista previa comprueba cuenta, permisos, versión y huellas;
la confirmación explícita guarda sólo clasificación y fecha más auditoría estable,
sin exigir ni corregir banco y sin forzar la membresía. Empresas, fichas con tipo
ya definido, representación empresarial, revocadas o identidades distintas se
detienen. La persona recarga su portal con su propia cuenta después de corregir
la clasificación. Este camino nativo requiere publicar `manageProviderPortal`.

El aviso amarillo **Tenés datos para revisar** nombra los campos pendientes y
ofrece **Revisar mis datos**. También aparece para fichas manuales con todos los
campos completos que todavía no acreditan alta/confirmación auténtica; no se
limita a comprobar formatos. El banner no imprime números bancarios ni identidad
fiscal, no se descarta marcando registros completos y no reemplaza la firma de
los cambios críticos. La clasificación pendiente queda explicada. La corrección de
datos conserva su validación y aplicación firmada existentes.

Publicación mínima, después de CI y revisión: `providerPortal` (acceso/resumen y
metadatos de revisión), `manageProviderPortal` (acción administrativa acotada), y
después web. No cambia reglas, Auth, IAM o roles ni necesita migración masiva. El
helper local de la sección siguiente permite la reparación puntual autorizada sin
esperar ese despliegue; su ejecución no prueba que el nuevo banner esté publicado.

## Reparación administrativa de clasificación

`scripts/classify-personal-provider.cjs` es una herramienta mantenida de uso
administrativo, no una función pública ni una migración. Producción es el único
operador de datos. Se usa sólo después de una autorización concreta para una ficha
identificada como persona. No modifica ni valida nuevamente su banco para permitir
esta reparación, ni escribe trabajos, pagos, archivos, membresías, Auth o roles.

Requiere la sesión OAuth oficial de Firebase CLI en la computadora del
operador. Comprueba la identidad real del token, el UID y rol global admin vivo y
las cuentas Google verificadas/habilitadas del administrador y de la persona. No
abre sesiones ni inicia login, no crea custom tokens ni usa claves o impersonación.
Reutiliza `getAccessToken` oficial, incluido su refresco OAuth ordinario en memoria,
como los helpers mantenidos de operación administrativa. No confunde un access
token vencido con la necesidad de que el usuario vuelva a iniciar sesión.
La verificación de identidad necesita `email/openid`: se reutiliza un token
vigente que los conserve, o se refresca con los mismos cinco scopes originales
del login oficial de Firebase CLI. Un token reducido a cloud/firebase no sirve
para userinfo. El fallback antiguo que devuelve un refresh token como si fuera
access token se rechaza antes de consultar identidad o Firestore.
El cliente administrativo de Firestore usa REST y OAuth sólo en memoria.

El JSON de entrada y los respaldos crudos permanecen en `LOCALAPPDATA`, fuera de
Git y carpetas compartidas. Ejemplo de esquema (reemplazar los valores ficticios
con los verificados de la operación, nunca copiar esta plantilla como autorización):

```json
{
  "operationKey": "operacion-autorizada-estable",
  "providerId": "ficha-verificada",
  "targetUid": "uid-persona",
  "targetEmail": "persona@example.test",
  "operatorUid": "uid-admin",
  "operatorEmail": "admin@example.test",
  "confirmedPersonal": true,
  "reason": "Fuente literal y alcance de la autorización para clasificar esta ficha.",
  "authorizationFile": "C:/ruta/a/la/autorizacion.json",
  "firebaseCliPath": "C:/ruta/instalacion-oficial/firebase-tools/lib/bin/firebase.js",
  "authorizationSha256": "huella-sha256-de-64-caracteres",
  "localBackupDir": "C:/Users/operador/AppData/Local/GBAdmin/operations/operacion-autorizada"
}
```

Desde la raíz de GOAT, con el Node y Firebase CLI oficiales ya instalados:

```text
node scripts/classify-personal-provider.cjs <JSON-privado>
node scripts/classify-personal-provider.cjs <mismo-JSON-privado> --apply
```

La primera orden es **vista previa**: no escribe en GOAT. Guarda un respaldo privado
y devuelve `expectedVersion` y `expectedPreservationHash`. Después de revisar la
identidad, el motivo y el plan, agregar esos dos valores al mismo JSON privado.
No cambiar la operación, destino ni fuente entre vista previa y aplicación.

La transacción relee la ficha, operador, vínculo explícito, estado administrativo,
posible representación empresarial y documentos financieros propios. Sólo admite
`type` **ausente**, sin razón social/representación empresarial, con una membresía
propia active/needs_confirmation; rechaza revocadas, suspendidas, cuentas distintas,
deshabilitadas o no Google, versiones y huellas cambiadas. Los originales y sus
hashes incluyen el banco inválido y los campos que no se van a modificar. Consultas
de preservación superiores a 500 documentos por colección o 1000 proyectos se
detienen; no se usa un inventario incompleto ni se crean índices automáticamente.
Se lista el catálogo actual de proyectos con proyección de nombres de documento y
se consultan sus subcolecciones directas, sin índices de collectionGroup ni una
lista histórica fija. Las consultas simples se limitan a los documentos propios.

El único commit contiene dos documentos: update de `providers/{id}` con máscara
`type: persona, updatedAt: serverTimestamp`, y create de una auditoría estable en
`providerPortalAudit/personal_classification_{hash(operationKey)}`. El update tiene
precondición de versión; la auditoría contiene autorización, actor, destino,
versión y hashes. Repetir **la misma** operación reconoce `already_applied`, sin
otra auditoría. Reutilizarla con otro contenido se rechaza.

Después del commit comprueba ficha, membresía, usuario, Auth, trabajos, pagos/cajas,
registros financieros y declaraciones, sin imprimir datos bancarios ni URLs privadas.
Si falla esa comprobación, devuelve `failed_after_commit`: detenerse y releer el
estado; no repetir ni revertir automáticamente. Una actividad simultánea legítima
también puede causar ese checkpoint. Los resultados muestran rutas/huellas y el
respaldo detallado se conserva únicamente en el directorio privado.

La herramienta no llama `bootstrap` como la persona. Tras la reparación, el acceso
natural con su propia cuenta ejecuta el circuito publicado de activación personal;
no necesita firma de representación, usuario interno ni rol de colaborador. Eso
no constituye un alta completa ni una confirmación de datos o banco.

Antes de ejecutar, revisar los triggers publicados: un trigger sobre proveedores
podría ampliar los efectos de un update. La lectura viva del 17/11/2026 sólo tenía
un trigger sobre `projects/{projectId}`, sin trigger sobre proveedores. Este dato
es evidencia de la operación, no una garantía permanente del script.

Pruebas (sólo identidades ficticias y proyecto demo):

```text
node --test functions/providerPersonalClassification.test.js
firebase emulators:exec --only firestore --project demo-goat-person-classification "node tests/providerPersonalClassification.emulator.mjs"
```
