# Pagos ya realizados con aceptación documental pendiente

Esta entrega prepara el registro administrativo de un hecho pasado. No ordena una transferencia, no genera una factura y no convierte un recibo posterior en autorización previa o futura. La publicación y la carga de datos reales requieren encargos separados.

## Fase 1 implementada

`manageProviderFinance` incorpora `previewReportedPayment`, `recordReportedPayment` y `reportedPaymentState`. El registro está limitado a una fila existente de Áreas, un prestador persona física, ARS, saldo completo y hasta cuatro componentes. Requiere el indicador existente de cobro por tercero y un historial explícitamente vacío. No admite fechas futuras ni gastos presupuestarios internos.

Sólo administración global puede registrar. Una parte de Caja General conserva la lista vigente de tres custodios; ser administrador o dueño de la app no concede esa facultad. La lectura exige acceso actual al proyecto y al área/subcategoría; no requiere edición para consultar comprobantes.

Cada componente describe un depósito de efectivo de Caja General o una transferencia adelantada por una persona física con ficha existente. Declara importe exacto en centavos, operación bancaria, referencia de conciliación ya existente en CT, original y SHA-256. El efectivo requiere una fuente administrativa que confirme su origen: un ticket de depósito no demuestra de dónde salió ese efectivo.

El original se sube por el contrato existente `providerFinance/{providerId}/{recordId}/{fileName}` y se vuelve a verificar en el servidor, incluidos sus bytes. La vista previa devuelve un `previewHash` vinculado al gasto, proveedor, pagador personal, archivos, beneficiario, hechos y actor. Confirmar requiere ese mismo hash y la relectura transaccional de identidad, permisos y estado actual.

La transacción crea un registro nativo `providerFinancialRecords/{id}`, sus entradas protegidas en `paymentHistory`, una sola salida de Caja General por componente de efectivo y el adelanto personal identificado mediante `method=tercero`. Conserva el costo, las facturas, las declaraciones y la autoría de la fila. El historial y las claves nativas impiden duplicar la operación, el comprobante, la referencia CT o el gasto. Repetir el mismo intento devuelve el resultado existente; cambiar su contenido no crea un segundo pago.

El gasto queda `paid=true` porque el hecho está registrado. El documento nativo conserva `documentaryStatus=pending_acceptance`. Esos estados son independientes. No se crea una declaración, firma ni aprobación; no se escribe CT ni se registra un segundo costo. Las referencias CT sirven para conciliar el mismo hecho entre sistemas, no para ejecutar un pago nuevo ni para presumir una integración automática.

La actividad inmutable conserva el actor y la hora real de registro, la fecha informada del pago, sus componentes, originales, referencias, beneficiario, motivo y fuente. Los originales permanecen protegidos por el contrato de Storage existente.

La lectura en Gestión de pagos distingue el pago ya realizado de su aceptación pendiente y permite descargar cada original. El registro no admite anulación, corrección de caja o reintegro por los controles ordinarios: no se permite borrar el antecedente o alterar sus referencias como si fuera un pago nuevo. La devolución del adelanto y las correcciones administrativas de hechos históricos requieren un circuito auditado separado; esta entrega no los implementa.

### Entrada del contrato

La vista previa y la confirmación reciben el mismo objeto:

```ts
{
  action: 'previewReportedPayment' | 'recordReportedPayment',
  id: string, // intento estable, conservar ante respuesta incierta
  projectId: string,
  collectionName: 'areaExpenses',
  itemId: string,
  date: 'YYYY-MM-DD', // fecha real del hecho, nunca la fecha de firma posterior
  alreadyPaid: true,
  reason: string,
  source: string, // fuente de la confirmación humana
  beneficiary: { name: string, cuit: string, account: string },
  parts: [{
    amountCents: number,
    source: 'general_cash' | 'personal_advance',
    method: 'deposit' | 'transfer',
    reference: string,
    ctReference: string,
    cashSourceEvidence?: string,
    payerProviderId?: string,
    originalFileName: string,
    proofSha256: string,
    file: { path: string }
  }],
  previewHash?: string // obligatorio al confirmar
}
```

Los componentes deben tener operaciones, referencias CT y originales distintos. El nombre/CUIT/CBU del beneficiario procede de la documentación revisada; no se toma de una autorización de otro trabajo ni se inventa una cuenta del prestador. El servidor calcula el total y las proyecciones, sin confiar en un `paid` enviado por el cliente.

`reportedPaymentState` recibe `{id, projectId, itemId}` y devuelve sólo el estado documental y la lista mínima de originales del gasto autorizado. `download` admite `fileIndex` para elegir el original dentro del registro; mantiene los controles de alcance existentes. No se agregan reglas, IAM, proveedores de Auth ni nuevos recursos de firma en esta fase.

## Fase 2 diseñada, pendiente de implementación y revisión

El modelo de Legales es un **recibo y ratificación posterior**, firmado únicamente por el acreedor con su cuenta registrada, con fecha auténtica de aceptación. Identifica el proyecto, gasto, prestador, beneficiario real y cuenta, cada operación y su importe. La suma y el alcance corresponden sólo a ese gasto. Expresa que acepta esos pagos como cancelación del concepto identificado; excluye otros honorarios/rendiciones y cualquier autorización para pagos futuros.

El proveedor no certifica el origen contable interno del efectivo ni la conciliación de CT. Esos hechos quedan en la auditoría administrativa, no en una declaración atribuida al proveedor. El texto del recibo muestra el pago por cuenta de la empresa y quién realizó la transferencia personal, según los hechos verificados.

El flujo propuesto es:

1. Administración revisa el registro histórico y solicita su recibo específico mediante un nuevo contrato con huella del registro. No se crean solicitudes de firma al registrar el pago en la fase 1.
2. Un nuevo tipo `payment_acknowledgment` reutiliza el puente existente con GB Sign, un PDF canónico y la firma electrónica. Su contenido incluye una única clave de gasto y las huellas de los pagos y originales. No recibe `effectiveRoles` de facturación/cobro ni se admite como entrada de `authorizedParty`.
3. Mi proveedor muestra una solicitud clara en Documentos → Recibos, agrupada por proyecto, con aviso y contador pendiente. El proveedor revisa y firma el texto con su identidad/DNI ya registrados. No firma el administrador ni se atribuye una firma al beneficiario tercero.
4. La finalización verifica firma, contenido exacto, cuenta asignada, membresía vigente, identidad y fecha real. Relee el registro, el proveedor y los pagos para rechazar documentos obsoletos o de otro gasto.
5. Una transacción idempotente cambia sólo el estado documental a `accepted` y conserva la evidencia y el texto aceptados. No vuelve a modificar `paymentHistory`, caja, adelantos, CT, costo ni declaraciones de otros trabajos.

Una autorización posterior puede ser otra vía de regularización únicamente si su alcance, emisor/beneficiario y cuenta coinciden expresamente con el gasto y los hechos. No se amplía una autorización previa por inferencia. Esa vía no está implementada por este lote. Un rechazo o disputa conserva el pago informado y abre revisión documental, sin simular una devolución ni reabrir automáticamente la deuda.

Archivos previstos para la segunda fase: servicio dedicado de aceptación y PDF en `functions`, integración explícita en `providerPortal`, `providerPortalAdmin` y `providerPortalSign`, categorías/contadores de documentos del portal y del proyecto. No se requiere modificar el repositorio de GB Sign si el contrato existente admite el nuevo documento canónico; debe verificarse esa compatibilidad con pruebas ficticias antes de publicar.

Pruebas necesarias: firma de otro usuario/gasto o versión, membresía revocada, original modificado, DNI discrepante, fecha auténtica, firma aún no completada, intentos repetidos/concurrentes y preservación íntegra de dinero/CT/caja al aceptar. La firma no debe habilitar un pago nuevo ni servir como autorización general.

## Validación y publicación

Las pruebas de la fase 1 usan datos ficticios en emuladores: permisos, fechas, centavos exactos, originales verificados, vista previa sin escrituras, cambios concurrentes, duplicados, idempotencia, caja/adelanto único y preservación de facturas, honorarios y declaraciones ajenas. También comprueban que la creación ordinaria de un pago a tercero sigue exigiendo su autorización.

El backend debe publicarse antes de la web. Requiere revisión y CI del head exacto, autorización concreta de despliegue y nuevo traspaso de fuente nativa verificada a Producción. No hay migración ni escritura de registros reales al desplegar. El formulario de alta del registro histórico y la fase de firma siguen pendientes de definición de interfaz y de implementación; esta PR no los presenta como disponibles.

El canal de Firebase de usuario debe ser válido para la app. Una credencial OAuth de CLI rechazada por audiencia no se convierte en una sesión válida, y la publicación de este contrato no autoriza saltarse la autenticación ni suplantar a un custodio.
