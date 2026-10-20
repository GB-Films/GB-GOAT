# Actualización de costos GOAT → Control Total

## Alcance de esta versión

Un botón por proyecto permite **comparar, revisar y aplicar** altas, ediciones y
vínculos de costos. No hay tareas en segundo plano ni escrituras al editar una fila.
La primera versión **no crea pagos, no modifica caja y no calcula IVA desde PDFs**.
Muestra el historial de pagos como pendiente de conciliación. CT conserva importes
fiscales, moneda original, reconocimiento, períodos y fórmulas existentes.

La edición de un costo en CT que contradice su vínculo no se devuelve automáticamente
a GOAT: aparece como conflicto. El detalle operativo se corrige con los flujos
normales de GOAT y se vuelve a comparar. El regreso automático de pagos desde CT,
la identificación de transacciones compartidas y las altas de proveedores nuevos
quedan fuera de esta primera entrega.

El servicio global interno BANI se conserva en su circuito propio; esta conexión no
lo crea como otro costo externo. Sus componentes se vinculan/excluyen con motivo,
y los proveedores de post requieren el proyecto B. Los campos obligatorios (importe,
proveedor, fecha) no se convierten en cero ni desaparecen ante un valor faltante:
quedan para revisión. El vaciado automático se limita a texto operativo permitido.

## Uso

1. Ingresar a GOAT con una de las dos cuentas administrativas de CT. El botón no
   aparece para productores, otros administradores o colaboradores.
2. Abrir **Actualizar con CT → Conectar Google y comparar**. Google pide permiso de
   Sheets con la misma cuenta. El acceso OAuth queda sólo en memoria, por tiempo
   limitado; no se guarda en Firebase, archivos, logs ni almacenamiento del navegador.
3. Confirmar el proyecto CT y la fecha de servicio de los costos nuevos. Los códigos
   sólo se eligen del maestro CT; no se crean proyectos comerciales.
4. Revisar nuevos, modificados, coincidencias y pendientes. Un vínculo inicial con
   importe distinto exige decisión explícita. Si el proyecto ya tenía costos CT,
   un gasto no vinculado debe seleccionarse o confirmarse como nuevo: no se adivina
   que falta por nombre o importe. Esto evita sumar sobre rendiciones o sueldos.
5. En **Revisar vínculo**, elegir servicio existente, costo nuevo, incluido en otro
   costo/sueldo/rendición o excluir presupuesto con motivo. Un costo repartido puede
   vincular varios servicios. Se puede seleccionar un beneficiario fiscal distinto
   del prestador y un proyecto B para postproducción.
6. Recalcular la vista previa después de cambiar decisiones. Luego **Aplicar cambios
   revisados**. Los pendientes quedan separados; no se fuerzan para cerrar el proyecto.
7. El resultado confirma sólo el lote leído después de escribir. Si GOAT volvió a
   cambiar, se solicita comparar nuevamente. Se puede descargar un control JSON sin
   tokens ni enlaces privados de descarga.

La primera vinculación requiere revisar el histórico una vez. Después se conservan
IDs y bases de comparación. No editar manualmente las mismas filas CT durante una
aplicación, ni ejecutar otro escritor administrativo externo sobre ese libro.

## Integridad

- Fuente efectiva: `areaExpenses` únicamente para categorías en `activeAreas`;
  `budgetItems` para el resto. Un registro residual no se convierte en costo adicional.
- Identidad: proyecto/colección/gasto → ServicioID. Las filas se resuelven por ID,
  no por posición histórica. `sourceBudgetItemId` conserva la relación al activar áreas.
- Comparación de tres estados: fuente actual, CT actual y último lote verificado.
  Un cambio concurrente obliga a recalcular antes de escribir.
- Se preserva proveedor/beneficiario fiscal existente hasta revisión explícita. Un
  cambio de prestador GOAT exige revisar esa identidad.
- El texto se escribe como `stringValue`, nunca como fórmula. Las fórmulas nuevas
  usan rangos abiertos para proyectos/proveedores/TC. Las fórmulas y formatos
  existentes no se reemplazan por sus resultados calculados.
- El esquema de pestañas/columnas se valida antes de operar. La carga se detiene
  antes de superar la fila 600 de servicios: primero hay que ampliar y verificar
  los rangos de Reporte_Mensual. No se deja un costo fuera del resultado silenciosamente.
- La lectura posterior comprueba unidad de negocio, conversión y costo mensual,
  además de los campos escritos. Si las fórmulas no calculan, el lote queda pendiente
  de verificación y no se avanza la base.
- Un costo eliminado sólo puede anularse con motivo, confirmación administrativa,
  vínculo creado por esta integración y ausencia de pagos/adelantos conocidos.
  Los registros adoptados del histórico no se anulan por ausencia en GOAT.
- Gastos con pagos y diferencias neto/IVA/moneda quedan pendientes de corrección;
  eliminar una fila GOAT no revierte un movimiento bancario real.
- Una lectura parcial o fallida no genera bajas. No se borran documentos originales.

## Backend, autenticación y estado

Callable: `updateProjectControlTotal`, región `us-central1`, sin scheduler.
Valida Firebase Auth, email verificado, lista cerrada de dos cuentas CT y rol
administrativo (excepto el propietario ya reconocido por GOAT). Comprueba que el
token OAuth pertenezca a esa misma cuenta. El libro destino es constante y coincide
con el importador CT existente. No se acepta otro ID de libro desde el navegador.

El servidor lee sólo el proyecto GOAT solicitado y sus proveedores. Lee índices y
datos de las cinco pestañas CT necesarias en una consulta batch. No envía al navegador
cuentas, transacciones ni notas de nómina; sólo opciones de vínculo de servicios.

Colecciones **sólo servidor**, denegadas por defecto a SDKs del navegador con las
reglas actuales (no se amplían reglas):

- `ctSyncProjects/{projectId}`: vínculos, fecha, configuración, base verificada y lote pendiente.
- `ctSyncProjects/{projectId}/runs/{uuid}`: vista previa, antes/después y resultado.
- `ctSyncLocks/control-total`: escritor único del libro, lease y eventual lote incierto.

Una vista previa pertenece a quien la creó y vence a los 15 minutos. Aplicar relee
fuente y destino. Sheets y Firestore no son una transacción común: se registra el
lote antes, se escribe en un batch, se comprueba cada ServicioID y sólo después se
avanza la base. La invocación repetida de un lote verificado es un no-op.

Un timeout no se interpreta como fallo sin efecto. El mismo lote se verifica por
lectura; un resultado incierto impide otros escritores de esta conexión hasta
resolverlo. Recargar la página recupera la vista previa pendiente. Si se detecta
un resultado mezclado o edición manual posterior, no se reintenta a ciegas.

## Publicación acotada y piloto

El código no activa ninguna escritura hasta que se publica y un administrador
autoriza Google y aplica una vista previa.

1. Ejecutar `npm ci`, `npm ci --prefix functions`, `npm test`,
   `npm test --prefix functions`, `npm run lint`, `npm run build`.
2. Revisar cambios y publicar únicamente la callable nueva:
   `firebase deploy --only functions:updateProjectControlTotal --project gb-goat`.
   No desplegar reglas ni otras funciones por este cambio. La API de Google Sheets
   debe estar habilitada como para el importador existente; verificar acceso del usuario.
3. Publicar la interfaz con el flujo habitual de GitHub Pages al integrar la rama.
4. Hacer un piloto en un proyecto existente de pocos costos: comparar, revisar que
   cada vínculo sea correcto, aplicar y releer CT/resultado. La segunda comparación
   no debe proponer nuevos costos ni diferencias monetarias sobre el mismo estado.
5. Registrar fuera de Git el piloto, IDs de lote, permisos efectivos y limitaciones.

No se debe presentar como publicada o probada contra CT real sólo por pasar pruebas
locales. No hacer pagos reales como parte del piloto. Los despliegues y la primera
aplicación real se realizan únicamente dentro de la instrucción de Tomás.

## Pruebas

Las pruebas de dominio y de callable usan datos ficticios y un doble de Sheets.
Cubren autorización, campos vaciados, neto vs total, monedas, sueldos/agrupaciones,
preservación de fórmulas, cambios concurrentes, borrados con pagos, traslados de área,
doble aplicación, bloqueo y recuperación tras pérdida de respuesta. La revisión
visual usa el componente real con conectores sustituidos por datos ficticios;
no autoriza ni modifica un libro real.
