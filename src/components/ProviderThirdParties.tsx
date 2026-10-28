import { downloadPortalFile, portalAdminRequest } from "../lib/providerPortal";
export function ProviderThirdParties({
  providerId,
  authorizations,
}: {
  providerId: string;
  authorizations: any[];
}) {
  return (
    <section className="mb-4 rounded-xl border bg-white p-3">
      <h4 className="text-sm font-bold">
        Quién factura y cobra por este proveedor
      </h4>
      {!authorizations.length && (
        <p className="mt-1 text-xs text-slate-500">
          Sin autorizaciones firmadas de terceros.
        </p>
      )}
      {authorizations.map((a) => (
        <div key={a.id} className="mt-2 border-t pt-2 text-sm">
          <strong>{a.content.party.name}</strong> · CUIT {a.content.party.cuit}
          <p className="text-xs">Cuenta del titular de la factura: {a.content.party.cbu || a.content.party.alias}</p>
          {a.valid && a.effectiveRoles.includes('payment') && !a.effectiveRoles.includes('invoice') && <p className="text-xs text-amber-800">Falta aprobar la facturación antes de registrar un pago a esta cuenta.</p>}
          {a.content.party.relationship && <p className="text-xs">Relación: {a.content.party.relationship}</p>}
          {a.content.party.activity && <p className="text-xs">Actividad del tercero: {a.content.party.activity}</p>}
          <p className="text-xs text-slate-600">
            {a.valid
              ? a.effectiveRoles
                  .map((r: string) =>
                    r === "invoice"
                      ? "Facturación validada"
                      : "Cobro autorizado",
                  )
                  .join(" · ")
              : a.status === "revoked"
                ? "Revocada"
                : a.status === "pending_review"
                  ? "Pendiente de revisión"
                  : "Sin vigencia"}{" "}
            · Hasta {a.content.expiresOn}
          </p>
          <button
            className="mt-1 text-xs underline"
            onClick={async () => {
              try {
                downloadPortalFile(
                  await portalAdminRequest({
                    action: "declarationFile",
                    providerId,
                    declarationId: a.id,
                    artifact: "signed",
                  }),
                );
              } catch (e: any) {
                alert(e.message);
              }
            }}
          >
            Declaración firmada
          </button>
        </div>
      ))}
    </section>
  );
}
