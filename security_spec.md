# Especificación de seguridad - GB GOAT

## Principios

1. Las reglas de Firebase son la autoridad; la UI sólo refleja permisos.
2. Los roles globales (`users/{uid}.role`) y los roles de proyecto (`projects/{id}/collaborators/{email}.role`) son independientes.
3. Ser miembro permite leer el contexto del proyecto. La edición se limita por rol, pestaña, área y subcategoría.
4. El historial financiero es append-only para colaboradores. Sólo un administrador del proyecto puede corregir o borrar registros existentes.
5. Facturas y comprobantes se autorizan contra el proyecto, la colección y la fila a la que pertenecen.

## Matriz resumida

| Acción | Admin app/proyecto | Jefe de producción | Jefe de área |
| --- | --- | --- | --- |
| Leer proyecto asignado | Sí | Sí | Sí |
| Editar Presu Ppal | Sí | No | No |
| Crear/editar gasto de Área | Sí | Sólo alcance asignado | Sólo alcance asignado |
| Anexar pago/comprobante | Sí | Sólo alcance asignado | Sólo alcance asignado |
| Editar/borrar historial financiero | Sí | No | No |
| Editar fechas y locación del proyecto | Sí | Sí | No |
| Administrar roles de proyecto | Sí | No | No |
| Delegar áreas | Sí | Sólo áreas propias | No |
| Administrar documentos de proyecto | Sí | Si tiene pestaña Documentos | No |
| Ver reportes globales | Admin app | No | No |

Un jefe de producción sólo puede delegar subcategorías que le hayan sido asignadas explícitamente. Si posee el área completa, puede delegar el área completa; la delegación fina fuera de su lista explícita queda reservada al administrador.

## Invariantes financieras

- Los pagos nuevos deben tener importe mayor que cero y autor/autora iguales a la sesión autenticada.
- Un colaborador sólo puede anexar un pago; no puede reescribir ni acortar `paymentHistory`.
- Un gasto con pagos sólo puede eliminarlo un administrador del proyecto.
- Los movimientos de caja asociados a pagos sólo pueden corregirse o eliminarse administrativamente.
- Un comprobante adicional de colaborador sólo puede agregarse al final y debe registrar su email.

## Invariantes de archivos

- Tamaño máximo: 2 MB.
- Facturas: PDF, JPG o PNG.
- Comprobantes y documentos: PDF, JPG, PNG o WEBP según el flujo.
- La metadata de una factura autenticada debe coincidir con `projectId`, colección, fila y área.
- Los colaboradores pueden crear archivos dentro de su alcance, pero sólo un administrador puede reemplazar o borrar comprobantes financieros existentes.

## Casos negativos mínimos

- Usuario ajeno leyendo o escribiendo un proyecto.
- Colaborador editando Presu Ppal.
- Jefe de área escribiendo fuera de su área/subcategoría.
- Colaborador cambiando o eliminando un pago ya registrado.
- Jefe de producción delegando un área o subcategoría que no posee.
- Carga de factura cuya metadata apunta a otra fila o proyecto.
- Invitación pública usada, vencida o destinada a otra fila.
- Cambio de rol global provocado por una asignación dentro de un proyecto.

La sintaxis se valida localmente con `npm run lint:rules`. La validación funcional completa debe ejecutarse contra Firebase Emulator Suite antes de desplegar reglas.

## Riesgo de dependencia pendiente

La versión de `xlsx` publicada en npm mantiene avisos de seguridad sin corrección disponible en ese registro. Las importaciones quedaron limitadas por tipo y a 5 MB para reducir exposición, pero esto no elimina el riesgo de un archivo malicioso. La actualización recomendada por SheetJS se distribuye fuera de npm y requiere aprobación explícita del origen, o bien reemplazar el parser en una migración dedicada.
