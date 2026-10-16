# Gastos, equipo y cajas

Resumen, Presupuesto, Áreas, Cajas, Finanzas, Documentos y Proveedores utilizan encabezados compactos sin introducciones redundantes. Resumen no repite el nombre del proyecto ni muestra una descripción de relleno. Los avisos financieros de contratos USD/mixtos se mantienen sólo para administración.

La línea comercial de Resumen se renderiza sólo para administradores generales o del proyecto. Los datos comerciales y el presupuesto total se guardan en `projectCommercial/{id}`, con autorización de lectura y escritura independiente en Firestore. Los colaboradores no pueden leerlos por API, aunque tengan habilitada la visualización de totales de sus áreas. El nombre y código siguen siendo identificadores operativos compartidos: el propio ID del proyecto puede contener el código. Ver `security_spec.md` para los límites y la migración.

Contactos clave usa el selector con búsqueda por palabras, sin distinguir tildes o mayúsculas, y datos de contacto/documento. Buscar texto nunca elimina una asignación existente: sólo se persiste una opción elegida o el botón explícito Quitar. El rol que puede asignar contactos no cambia.

En celular, tocar **Total** abre el importe del gasto en Presu Ppal y Áreas. Se ingresa total y cantidad; el precio unitario se deriva sin redondearlo antes de calcular el total. Cantidad inicial: 1 si la fila no tenía una cantidad positiva. Se aceptan coma decimal y separadores de miles. Guardar no registra pagos ni movimientos de caja.

El guardado utiliza las transacciones, validaciones de permisos, versión y auditorías existentes. Con pagos asociados sólo se consulta el importe; los administradores conservan la corrección de filas históricamente bloqueadas pero actualmente sin pagos. Si la fila cambia durante la edición, se pide revisarla; si falla el guardado, se conserva el formulario. Total pagado e importe abonado se muestran en verde; los pagos parciales se identifican por separado.

Equipo prioriza integrantes con acceso, nombre/email, rol, áreas, subcategorías y pestañas permitidas. Los proveedores de filas no se presentan como usuarios con acceso. Agregar persona abre una ventana con las mismas opciones y autorizaciones previas; Editar permisos abre la gestión existente. No se incorporan personas ni se cambian roles automáticamente por esta reorganización.

Cajas muestra Caja General (sólo para quienes ya podían verla) y responsables con movimientos o saldo, incluyendo pendientes claramente separados del saldo disponible. Elegir una caja muestra su detalle; registrar entregas, transferencias o devoluciones está en un panel desplegable. Se conservan confirmaciones, enlaces a gastos y restricciones vigentes. Quienes dejaron el equipo permanecen como responsables históricos cuando tienen movimientos; no se los habilita como destinatarios de nuevas entregas ni se les otorgan permisos. Caja General muestra salida neta, no un saldo inicial inventado.
