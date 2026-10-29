# Alta de equipo vinculada a proveedor

Implementación preparada en `codex/team-provider-onboarding`. No está publicada.

Administración genera un enlace desde Equipo para un correo concreto. El enlace no envía un correo por sí mismo. Al ingresar con Google verificado, el backend comprueba la invitación y busca una ficha personal por correo/identidad verificada. Una coincidencia segura y completa se vincula sin reescribir los datos existentes. Coincidencias múltiples, identidad distinta, una empresa o un acceso revocado requieren revisión; no se vinculan por nombre ni por coincidencia fiscal sola.

Si falta la ficha o está incompleta, se reutiliza el formulario de alta personal. El usuario confirma su cuenta Google y la titularidad de la cuenta provista. La nueva ficha conserva DNI y contacto; CUIT y banco quedan en `teamProviderSubmissions` para revisión administrativa y todavía no se aplican. Enviar la ficha habilita únicamente el rol interno de colaborador; no otorga acceso a proyectos por sí mismo. La confirmación firmada de datos y las declaraciones de empresa/terceros del portal mantienen sus propios procedimientos.

El formulario puede reintentarse. Una transacción vincula la invitación, el perfil, la ficha y los identificadores sin duplicarlos. Los permisos globales y las asignaciones de proyectos continúan administrándose por los controles existentes. Los usuarios anteriores sin marcador se conservan; no hay migración masiva.

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
