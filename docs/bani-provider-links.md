# GOAT → BANI LAB: proveedores vinculados

En GOAT, Administración puede abrir **Vincular con BANI LAB** desde un proveedor y elegir explícitamente una ficha existente por su nombre e identificador. No se enlaza ni se crea un contacto por coincidencia de nombres. Dos documentos de índice, escritos en la misma transacción, impiden asignar el mismo proveedor o contacto dos veces.

GOAT sigue siendo la fuente de nombre y rubro. BANI LAB muestra esos datos de solo lectura junto a la ficha fija o freelance. El alta, los pagos, presupuestos, identificadores fiscales, datos de contacto y bancarios siguen en sus sistemas actuales. El vínculo no cambia permisos, roles, horas ni datos de la ficha. Si un contacto no tiene proveedor, sigue existiendo solo en BANI LAB. Si el proveedor deja de existir, BANI mantiene la ficha e indica que la fuente no está disponible.

La función de GOAT lee una máscara explícita de campos, confirma login verificado de un administrador activo y usa el entorno de servicio existente de la sincronización de proyectos. La vista de BANI lee un documento por contacto; el índice inverso es solo para el servidor. No se modifica la sincronización de proyectos.

Antes de activar: validar en un ambiente de prueba la identidad de ambos proyectos, que el rol de servicio pueda leer los dos directorios y escribir la colección de proyección y que las reglas de BANI nieguen listados y escrituras desde el cliente. Desplegar solamente las dos funciones del vínculo y el cambio de reglas revisado para el proyecto BANI; no ampliar IAM ni cambiar reglas de Finanzas para resolver un bloqueo. Usar proveedores ficticios para validar enlace, cambio y baja; no hacer carga masiva ni usar fichas reales para prueba.

## Activación automática

Cada hora se cruza nombre completo y correo únicos en ambos directorios. Los homónimos, correos compartidos o faltantes no se asocian. Se conserva el contacto de BANI y se proyectan solo nombre y rubro de GOAT. El evento de GOAT y la revisión horaria refrescan vínculos existentes.

Desplegar las tres funciones por separado del codebase general, usando baniProviderEntrypoint.js, baniProviderLink.js, baniProviderAutoLink.js y teamWorkAccess.js. El package.json del paquete aislado usa baniProviderEntrypoint.js como main y solamente las tres variables no secretas BANI_PROJECT_ID, BANI_DATABASE_ID y BANI_OWNER_UID. El codebase se llama bani-provider-link. No copia configuraciones ni credenciales del portal de proveedores. Para BANI aplicar la regla específica a la base nombrada sin sustituir reglas activas ajenas al vínculo.