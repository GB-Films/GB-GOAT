# Gastos, equipo y cajas

Resumen, Presupuesto, Áreas, Cajas, Finanzas, Documentos y Proveedores utilizan encabezados compactos sin introducciones redundantes. Resumen no repite el nombre del proyecto ni muestra una descripción de relleno. Los avisos financieros de contratos USD/mixtos se mantienen sólo para administración.

La línea comercial de Resumen se renderiza sólo para administradores generales o del proyecto. Los datos comerciales y el presupuesto total se guardan en `projectCommercial/{id}`, con autorización de lectura y escritura independiente en Firestore. Los colaboradores no pueden leerlos por API, aunque tengan habilitada la visualización de totales de sus áreas. El nombre y código siguen siendo identificadores operativos compartidos: el propio ID del proyecto puede contener el código. Ver `security_spec.md` para los límites y la migración.

Contactos clave usa el selector con búsqueda por palabras, sin distinguir tildes o mayúsculas, y datos de contacto/documento. Buscar texto nunca elimina una asignación existente: sólo se persiste una opción elegida o el botón explícito Quitar. El rol que puede asignar contactos no cambia.

En celular, tocar **Total** abre el importe del gasto en Presu Ppal y Áreas. Se ingresa total y cantidad; el precio unitario se deriva sin redondearlo antes de calcular el total. Cantidad inicial: 1 si la fila no tenía una cantidad positiva. Se aceptan coma decimal y separadores de miles. Guardar no registra pagos ni movimientos de caja.

El guardado utiliza las transacciones, validaciones de permisos, versión y auditorías existentes. Con pagos asociados sólo se consulta el importe; los administradores conservan la corrección de filas históricamente bloqueadas pero actualmente sin pagos. Si la fila cambia durante la edición, se pide revisarla; si falla el guardado, se conserva el formulario. Total pagado e importe abonado se muestran en verde; los pagos parciales se identifican por separado.

## Ajustes iPhone y comprobantes — 18/10/2026

El acceso agregado al inicio utiliza el nuevo logo GB GOAT mediante apple-touch-icon (180 px) y manifiesto (192/512 px) con rutas relativas compatibles con GitHub Pages. Logo generado con imagen de referencia GB Films: GB grande y GOAT menor debajo, ambos del mismo ancho, letras geométricas blancas sobre negro. PNG optimizados a paleta de 4 grises. Un acceso ya creado en iOS puede conservar el ícono anterior: volver a agregarlo desde Safari tras publicar. No se incorpora caché offline ni se promete operar sin conexión.

Inicio y fin de rodaje usan campos nativos visibles y táctiles, sin depender de showPicker sobre un input oculto. Mantienen permisos y guardado existentes, con fecha mínima de fin según inicio.

Sólo en las tarjetas de celular de Presu Ppal y Áreas: no se repite «Pagado $…» en filas totalmente pagadas (sí se conserva el importe abonado en pagos parciales); el botón sin saldo completo dice Pagos y la fecha vacía dice Fecha Pago. Un único botón Comprobantes abre una ventana con facturas, carga, enlace del proveedor, otros comprobantes y eliminación según los permisos existentes. Los documentos ligados a un pago se pueden abrir allí y siguen gestionándose desde Pagos, sin eliminar el pago ni cambiar importes por una acción documental. Las columnas de escritorio se mantienen.

Validación: 155 pruebas automatizadas, tipos, sintaxis de reglas y build correctos. Prueba interactiva local con datos ficticios en Edge/Chromium táctil a 320, 390 y 430 px: campo de fecha, apertura/cierre de ventana, enlaces, carga y eliminación simuladas, sin desborde horizontal. No se consultaron ni modificaron datos productivos. Safari/iPhone físico no probado; WebKit no está instalado en este equipo.

## Compactación y carga progresiva — 18/10/2026

En celular, Editar y Exportar conservan sus acciones con íconos accesibles en la esquina superior, sin ocupar una fila aparte. Estado y rodaje comparten una línea cuando hay ancho disponible. Tocar rodaje abre una ventana de fechas y locación con los mismos permisos y guardados existentes; en escritorio se mantienen los campos visibles. Los cuatro totales del resumen usan menos relleno y separación en celular, sin cambiar importes, fórmulas, colores ni acceso por rol.

En el encabezado de Presupuesto, celular conserva sólo Nueva Categoría junto al título, alineado a la derecha. Plantilla, Copiar presupuesto e Importar Excel/CSV siguen disponibles en escritorio.

La lista de Proyectos presenta primero campos operativos autorizados por la consulta y completa los datos comerciales después, con la autorización individual previa. Incluso los campos comerciales legacy se excluyen de esa primera presentación. Un fallo de datos adicionales no vacía toda la lista y se informa; respuestas anteriores no actualizan una pantalla desmontada, otro usuario ni un snapshot nuevo. No se agrega caché persistente ni se modifican reglas o permisos.

Se evita leer clientes hasta abrir Nuevo Proyecto y leer todos los proyectos/fichas de origen hasta abrir Copiar presupuesto. En el detalle, las lecturas auxiliares existentes de colaboradores, documentos, proveedores y clientes corren en paralelo en lugar de secuencialmente. Excel y CSV se descargan al usar importación/exportación, no como dependencias iniciales del detalle. El manifiesto del build verifica esa separación. Esto elimina esperas y tráfico evitables; no es una medición de latencia del backend ni garantiza un tiempo fijo en redes móviles.

Validación de esta tanda: 160 pruebas, tipos, sintaxis de reglas y build. Componentes reales con datos ficticios y APIs simuladas en Edge/Chromium a 320/390/430/1280 px: encabezado compacto, totales, ventana de rodaje, acciones de presupuesto, ningún cambio financiero al entrar y sin desborde horizontal. La lista sigue navegable con la lectura comercial retenida, y se completa al liberarla. No se conectó Firestore ni se modificaron datos de producción para probarlo. Safari/iPhone físico sigue sin probarse.

### Filtros de Áreas en celular

Orden y Buscar gasto comparten una fila con dos columnas de igual ancho en celular. Ambos campos pueden encogerse dentro de su mitad, sin imponer el ancho mínimo de escritorio al buscador. Escritorio conserva su disposición previa. Se mantienen las opciones de orden, la búsqueda y sus manejadores, con etiquetas accesibles. Verificado en componentes reales con datos ficticios a 320/390/430/1280 px: igual ancho y alineación en celular, cambio de orden, escritura de búsqueda y sin desborde; 160 pruebas, tipos y build correctos. Sin escrituras de datos productivos.

Equipo prioriza integrantes con acceso, nombre/email, rol, áreas, subcategorías y pestañas permitidas. Los proveedores de filas no se presentan como usuarios con acceso. Agregar persona abre una ventana con las mismas opciones y autorizaciones previas; Editar permisos abre la gestión existente. No se incorporan personas ni se cambian roles automáticamente por esta reorganización.

Cajas muestra Caja General (sólo para quienes ya podían verla) y responsables con movimientos o saldo, incluyendo pendientes claramente separados del saldo disponible. Elegir una caja muestra su detalle; registrar entregas, transferencias o devoluciones está en un panel desplegable. Se conservan confirmaciones, enlaces a gastos y restricciones vigentes. Quienes dejaron el equipo permanecen como responsables históricos cuando tienen movimientos; no se los habilita como destinatarios de nuevas entregas ni se les otorgan permisos. Caja General muestra salida neta, no un saldo inicial inventado.
