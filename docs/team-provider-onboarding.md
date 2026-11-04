# Alta de equipo vinculada a proveedor

El alta mediante enlace y ficha vinculada ya está publicada. La incorporación directa desde una ficha registrada, descrita debajo, se prepara en `codex/team-from-provider` y todavía requiere su publicación.

Administración genera un enlace desde Equipo para un correo concreto. El enlace no envía un correo por sí mismo. Al ingresar con Google verificado, el backend comprueba la invitación y busca una ficha personal por correo/identidad verificada. Una coincidencia segura y completa se vincula sin reescribir los datos existentes. Coincidencias múltiples, identidad distinta, una empresa o un acceso revocado requieren revisión; no se vinculan por nombre ni por coincidencia fiscal sola.

Si falta la ficha o está incompleta, se reutiliza el formulario de alta personal. El usuario confirma su cuenta Google y la titularidad de la cuenta provista. La nueva ficha conserva DNI y contacto; CUIT y banco quedan en `teamProviderSubmissions` para revisión administrativa y todavía no se aplican. Enviar la ficha habilita únicamente el rol interno de colaborador; no otorga acceso a proyectos por sí mismo. La confirmación firmada de datos y las declaraciones de empresa/terceros del portal mantienen sus propios procedimientos.

El formulario puede reintentarse. Una transacción vincula la invitación, el perfil, la ficha y los identificadores sin duplicarlos. Los permisos globales y las asignaciones de proyectos continúan administrándose por los controles existentes. Los usuarios anteriores sin marcador se conservan; no hay migración masiva.

## Incorporar una persona ya dada de alta

**Equipo → Incorporar una persona dada de alta** permite buscar por nombre, apellido o cuenta registrada, seleccionar su ficha personal y elegir rol en GOAT sin generar un enlace ni repetir datos. La invitación por correo se conserva colapsada para personas nuevas. Las coincidencias provisorias se señalan como alta pendiente; las empresas no se usan como identidades de equipo.

`manageProviderPortal.teamProviderCandidates/teamProviderPreview/teamAssignProvider` son acciones exclusivas de administración con Google verificado. La cuenta dueña conserva la facultad exclusiva de otorgar administrador general y modificar accesos administrativos; no se modifica su propio rol protegido. Los usuarios ya habilitados se muestran como existentes y se remiten a su rol actual en la tabla, sin una segunda incorporación ni descenso accidental de permisos.

El servidor resuelve la cuenta desde el correo personal/portal registrado (no desde un correo escrito libremente), comprueba Google, correo verificado, UID vigente, cuenta habilitada, alta propia o confirmación histórica aplicada y membresía personal activa. No restaura accesos revocados, usa empresas como personas ni acepta fichas personales duplicadas o perfiles que pertenecen a otra identidad. Un ACL previo con UID distinto, aunque use el mismo correo, también detiene la incorporación hasta resolver esa asociación. La búsqueda devuelve únicamente nombre, correo de acceso y disponibilidad; no envía DNI, CUIT, banco ni documentos. Las consultas se acotan a 2.000 proveedores, 2.000 usuarios, 1.000 proyectos, 500 constancias por ficha y 200 asignaciones previas; excederlos requiere paginación explícita, sin asumir que una búsqueda parcial está completa.

Antes de confirmar se muestran los proyectos que ya estaban asignados (incluida propiedad por UID o ACL sin lista de correo). Conservarlos requiere una casilla expresa. La transacción relee al administrador, ficha, identidad, membresía, perfil, puerta de acceso, invitación anterior y ACL. Una selección desactualizada se detiene. Activa `users` y `teamAccessEmails` con marcador ready y fuente `registered_provider_assignment`, elimina sólo los bloqueos de alta revisados y consume una invitación pendiente compatible si existía. Conserva roles/áreas/permisos de proyecto y todos los datos, bancos, documentos y movimientos del proveedor. No crea un proyecto ni una nueva asignación. Un administrador general, por su rol, mantiene el acceso global habitual.

La constancia privada e inmutable `providerTeamAssignments` registra actor, identidad, rol anterior/nuevo y proyectos conservados. Un reintento con la misma clave recupera el resultado sin duplicar ni revertir un rol que cambió después. La persona entra o recarga GOAT con la misma cuenta; el bootstrap reconoce el alta directa sin exigir token de invitación. El SDK no puede crear esos marcadores ni esas constancias.

Pruebas con identidades ficticias y Auth lookup simulado, transacciones/reglas reales en emuladores: roles, dueño protegido, cuenta inválida/revocada/duplicada, permisos previos, concurrencia, recuperación, alta histórica firmada, SDK listo sin proyectos nuevos y conservación del proveedor. No se asignan roles reales ni se usa navegador automatizado. Publicación de este lote: **manageProviderPortal y providerPortal** compatibles antes del frontend, sin cambios de reglas, IAM o configuración de Auth. El reconocimiento de bootstrap pertenece a providerPortal; el acceso normal se resuelve con el perfil ready, sin otro formulario.

Referencias del SDK: [consulta de usuarios](https://firebase.google.com/docs/auth/admin/manage-users) y [transacciones](https://firebase.google.com/docs/firestore/manage-data/transactions).

## Revisiones y acceso

Equipo muestra las altas para revisión, los proyectos y roles previos y las fichas candidatas. Administración revisa permisos preexistentes, resuelve la identidad cuando hay una coincidencia segura y aprueba o rechaza los datos enviados. Si la ficha cambió desde el envío, la aprobación se detiene para no sobrescribir la edición posterior. La persona vuelve a consultar su alta después de una resolución.

`teamAccessEmails` es una puerta de acceso escrita exclusivamente por el backend y actualizada atómicamente con `users.teamOnboarding`. Mientras está pendiente, las reglas impiden trabajar y asignar/promover ese usuario. Los clientes no pueden fabricar el marcador ni consumir la invitación directamente.

Storage permite dos lecturas de Firestore por petición. Para conservar las cargas de comprobantes, la invitación marca los ACL previos con campos de bloqueo exclusivos del servidor; completar la ficha los desbloquea, sin borrar la asignación. Las nuevas asignaciones pendientes se rechazan en reglas. Los enlaces públicos de descarga previamente compartidos conservan su comportamiento anterior: esta mejora no revoca enlaces ya emitidos.

Antes de invitar se consulta la cuenta existente en Firebase Authentication para detectar también proyectos cuyo propietario es el UID, aunque todavía no tengan un perfil `users`. Un fallo de esa consulta detiene la invitación; sólo `auth/user-not-found` se toma como cuenta aún inexistente. También se impide trasladar la propiedad de un proyecto a un usuario pendiente. Reemplazar una invitación cancelada conserva la ficha pendiente y actualiza su token, para permitir retomar el alta.

Los catálogos están acotados a 1.000 proyectos y 2.000 proveedores; superar el límite detiene el flujo con una revisión explícita, sin búsqueda parcial que cree duplicados. El acceso de un proveedor común nunca genera permisos internos. Tener una factura de un tercero tampoco cambia el banco propio automáticamente.

## Verificación y publicación

Pruebas locales: `tests/teamOnboarding.emulator.mjs` con Firestore y Storage, `tests/runPortalRules.mjs`, suites de funciones e interfaz, TypeScript y compilación. Usar siempre proyectos `demo-*`; nunca datos reales. La publicación debe incluir backend, reglas y cliente compatibles; requiere autorización concreta y su propia verificación. No cambiar IAM, proveedores de autenticación ni registros reales para probar este flujo.

La recuperación en BOCHAZ usa Node 24.19.0 incluido en Codex y Java 21 local. El control privado conserva `RECETA_PRUEBAS.ps1` con rutas exactas; modifica sólo las variables del proceso. Las denegaciones esperadas en los casos negativos no equivalen a una suite fallida: comprobar la salida del proceso y el cierre de las aserciones. Un fallo interno del intérprete o una terminación nativa sí deja la prueba sin verificar y debe registrarse antes de reintentar.

## Recuperación del trabajo

Dos turnos del especialista se detuvieron por capacidad del modelo. Administración central recuperó esta rama como único escritor temporal, mantuvo la configuración de modelos y continuó desde los archivos existentes. El control privado `2026-10-28-goat-alta-equipo-proveedor` registra el estado y la evidencia. Una tarea aceptada o una compilación exitosa no significa publicación ni cierre.
