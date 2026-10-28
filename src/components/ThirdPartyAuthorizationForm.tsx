export function ThirdPartyAuthorizationForm({ provider, works, party, onChange, onPrepare, busy, recovered = false }: {
  provider: any; works: any[]; party: any; onChange: (party: any) => void; onPrepare: (input: any) => Promise<void>; busy: boolean; recovered?: boolean;
}) {
  return <form className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4" onSubmit={event => {
    event.preventDefault();
    const account = String(party.account || party.cbu || party.alias || '').trim();
    void onPrepare({ name: party.name, cuit: party.cuit, holder: party.name, holderCuit: party.cuit,
      cbu: /^\d+$/.test(account) ? account : '', alias: /^\d+$/.test(account) ? '' : account,
      responsibilityConfirmed: party.responsibilityConfirmed, roles: ['invoice', 'payment'], workKeys: party.workKeys, expiresOn: party.expiresOn });
  }}>
    <h2 className="font-bold">Quién factura y cobra por mí</h2>
    <p className="text-sm text-slate-600">Indicá quién emitirá la factura y cobrará por vos. La cuenta debe corresponder al titular de la factura.</p>
    {recovered && <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">Recuperamos los datos de una solicitud anterior. Revisalos y elegí los trabajos y la vigencia antes de preparar la autorización.</p>}
    <fieldset disabled={busy} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">{Object.entries({ name: 'Quién factura y cobra (nombre o razón social)', cuit: 'CUIT del titular de la factura', account: 'CBU/CVU o alias del titular de la factura', expiresOn: 'Vigente hasta' }).map(([key, label]) => <label key={key} className="block text-sm">{label}<input required type={key === 'expiresOn' ? 'date' : 'text'} maxLength={key === 'name' ? 160 : key === 'account' ? 100 : 30}
        className="mt-1 block w-full rounded border p-2" value={key === 'account' ? (party.account || party.cbu || party.alias || '') : party[key] || ''} onChange={event => onChange({ ...party, [key]: event.target.value })} /></label>)}</div>
      <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600"><strong>Tu cuenta propia se conserva por separado:</strong> {provider.bankAccount_cbu || provider.bankAccount_alias || 'Pendiente de completar en Mis datos'}. Para estos trabajos se utilizará la cuenta del titular de la factura que autorizás aquí.</p>
      <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Trabajos que autorizás</legend>{works.map(work => <label key={work.key} className="flex items-start gap-2 rounded border border-slate-100 p-2 text-sm"><input type="checkbox" checked={party.workKeys.includes(work.key)} onChange={event => onChange({ ...party, workKeys: event.target.checked ? [...party.workKeys, work.key] : party.workKeys.filter((key: string) => key !== work.key) })} /><span>{work.projectName} · {work.description}</span></label>)}
        {!works.length && <p className="text-sm text-slate-500">Cuando administración te asigne un trabajo, vas a poder completar esta autorización.</p>}</fieldset>
      <label className="flex items-start gap-2 text-sm"><input required type="checkbox" checked={!!party.responsibilityConfirmed} onChange={event => onChange({ ...party, responsibilityConfirmed: event.target.checked })} /><span>Solicito, bajo mi responsabilidad, que la persona indicada facture y cobre por mí los trabajos seleccionados. Declaro que la cuenta corresponde al titular de la factura y asumo los acuerdos y la distribución posterior de los fondos con esa persona.</span></label>
      <p className="text-xs text-slate-500">Vas a revisar el PDF con estos datos antes de firmar. La autorización conserva la revisión administrativa del encuadre de facturación y del destinatario declarado.</p>
      <button type="submit" disabled={busy || !party.workKeys.length} className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50">Revisar autorización y firmar</button>
    </fieldset>
  </form>;
}
