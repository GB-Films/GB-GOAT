# Alta manual excepcional con EIN

Las altas públicas continúan requiriendo CUIT/CUIL argentino de 11 dígitos.
Esta excepción es administrativa, individual y no habilita cuentas bancarias
extranjeras. El EIN estadounidense se conserva con sus nueve dígitos reales.

Una operación manual expresamente autorizada puede completar la ficha existente
con `registration.status = complete` y
`registration.method = manual_fiscal_identifier_exception`. Debe conservar el
ID, los trabajos, el índice fiscal y los campos ajenos, respaldar el estado
anterior y crear una entrada en `providerPortalAudit`. No debe simular el alta
por invitación, la aceptación personal de Google ni una firma del proveedor.

La cuenta Google debe existir, estar verificada y coincidir con el correo
previamente asociado a la empresa. Su membresía se crea en
`needs_confirmation`, con origen `manual_administrative_registration`;
no recibe roles internos ni facultades para firmar por esta operación.

La aprobación privada se guarda en
`providerFiscalIdentifierExceptions/{providerId}` con:

- `version: provider-ein-exception-v1`, `status: active`.
- `providerId`, `type: EIN`, `country: US`, `value` de nueve dígitos.
- `accountEmail`, `approvedBy`, `approvedAt`, `operationId` y `reason`.

No existe acceso directo a esta colección desde el cliente, ni para admins.
El backend comprueba la coincidencia con ficha, identificador y cuenta. Ignora
las excepciones que se intenten enviar en una solicitud pública.

Después del alta manual, la persona entra directamente a **Mi proveedor** con
el correo asociado, completa la declaración de representación, adjunta su DNI
y firma. El poder continúa siendo opcional. Sólo una firma válida habilita la
representación; la excepción fiscal no reemplaza este proceso.

La declaración y su PDF identifican el dato como EIN. Los cambios de perfil
pueden conservar ese mismo EIN, incluso con otro formato, pero no introducir
otro identificador de nueve dígitos. Antes de aplicar una declaración firmada
se comprueba nuevamente la aprobación privada vigente.

Publicar el código compatible y ejecutar la operación administrativa son pasos
distintos. Registrar la excepción no cambia por sí solo el código desplegado.
Las pruebas usan empresas, cuentas e identificadores ficticios en emuladores.
