# Acceso personal y clasificación de fichas antiguas

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
