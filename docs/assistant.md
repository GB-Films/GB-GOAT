# Asistente de GOAT

## Modelo y diagnóstico

El alias oficial `deepseek-flash` se mantiene: la documentación y el catálogo
consultados el 06/11/2026 lo identifican como DeepSeek V4.1 Flash; la documentación
especifica la revisión 1017. No se cambia por un nombre de modelo inventado ni
se modifican los modelos/esfuerzos de Codex.

El runtime inspeccionado de `assistantChat` (`assistantchat-00008-riy`) tenía
model/effort sin overrides y usaba Flash/high. Una prueba con su credencial en
memoria, herramientas y datos ficticios respondió HTTP200. La continuación con
el protocolo anterior también respondió: no se atribuye a una caída de DeepSeek
el incidente relatado por el productor. La programación de fechas no tenía una
herramienta, y el prompt prohibía pagos sin distinguir su programación.

Tomás eligió `low` al conocer que DeepSeek convierte `medium` en `high`. El nuevo
default es Flash/low con thinking habilitado explícitamente. Se conserva la
configuración explícita del operador y se informa el esfuerzo efectivo. La prueba
del protocolo actualizado, con estado de razonamiento y continuación de una
herramienta ficticia, respondió correctamente. No acredita una prueba interactiva
con la sesión del productor ni modifica su cuota/datos de GOAT.

El estado `reasoning_content` se conserva en memoria para el protocolo de
herramientas y no se pinta en el chat ni se vuelca a logs. La salida admite hasta
8192 tokens para listas de fechas; una respuesta cortada informa el problema y
pide un grupo más chico. La cuota diaria y el timeout del servidor se conservan;
el timeout del cliente contempla la espera del servidor.

Referencias oficiales: [modelo servido por el alias](https://api-docs.deepseek.com/quick_start/pricing),
[niveles de esfuerzo y estado de herramientas](https://api-docs.deepseek.com/guides/thinking_mode/),
[catálogo de modelos](https://api-docs.deepseek.com/api/list-models/).

## Fechas previstas de pago

`programar_fechas_pago` prepara hasta 200 gastos de un mismo proyecto, con una
fecha común o fechas distintas; una cadena vacía quita la fecha. Resuelve ids o
referencias inequívocas, valida fechas reales y comprueba permisos y gestión
vigentes. Excluye espejos de áreas gestionadas y estimaciones internas. Las
partidas de Presu Ppal conservan su permiso administrativo; en Áreas se respeta
el alcance de edición por área/subcategoría, incluidas exclusiones.

La preparación consulta datos actuales y no escribe. La confirmación muestra
todos los gastos, proveedores y fechas; usa un plan opaco en memoria, no un id
inventado por el modelo. Al confirmar, se vuelve a cargar el alcance y una
transacción relee todos los gastos y el proyecto. Cualquier cambio de fila o
gestión aborta el lote; las reglas existentes rechazan permisos revocados. No se
aplican partes sueltas. Sólo se actualizan `paymentDate` y `updatedAt`: no se
crean pagos, reintegros, cajas ni modificaciones de importe, identidad o historial.

Si el modelo devuelve más llamadas junto a una acción pendiente, las posteriores
se responden como no ejecutadas, para que las reprograme después de confirmar;
no se ejecutan a escondidas ni quedan ids de herramienta sin respuesta. La fecha
de referencia del prompt usa Argentina para interpretar hoy/mañana.

## Publicación

Esta entrega requiere publicar `assistantChat` antes del frontend. Los overrides
vivos inspeccionados estaban ausentes, por lo que el default low no requiere
cambiar variables, secretos, IAM ni Auth. Verificar otra vez los overrides al
publicar. No requiere migrar datos ni desplegar reglas u otras funciones.

Validación: pruebas de preparación/confirmación, protocolo y configuración;
emulador de fechas para permisos, atomicidad, filas pagadas e importes intactos.
Las sondas de proveedor usan sólo mensajes ficticios; nunca datos de producción.
