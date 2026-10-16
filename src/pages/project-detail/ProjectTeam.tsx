import type { Collaborator } from './types';
import { normalizeAllowedTabs } from '../../lib/projectAccess';

const roles = { admin: 'Admin de proyecto', jefe_produccion: 'Jefe de Producción', jefe_area: 'Jefe de Área' };
const tabs: Record<string, string> = { resumen: 'Resumen', presupuesto: 'Presu Ppal', areas: 'Áreas', cajas: 'Cajas', saldos: 'Finanzas', documentos: 'Documentos', resultado: 'Resultado', proveedores: 'Proveedores', equipo: 'Equipo', permisos: 'Permisos' };

export function ProjectTeam({ members, canAdd, canManage, onAdd, onManage }: {
  members: Array<Collaborator & { owner?: boolean; globalAdmin?: boolean }>; canAdd: boolean; canManage: boolean;
  onAdd: () => void; onManage: () => void;
}) {
  return <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
    <header className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-bold text-slate-900">Equipo <span className="ml-1 text-xs font-medium text-slate-400">({members.length})</span></h2>
      <div className="flex flex-wrap gap-2">{canManage && <button type="button" onClick={onManage} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold">Editar permisos</button>}
        {canAdd && <button type="button" onClick={onAdd} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white">Agregar persona</button>}</div>
    </header>
    <div className="space-y-2">
      {members.map(member => <article key={member.email} className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="min-w-0"><h3 className="break-words text-sm font-bold text-slate-900">{member.displayName || member.email}</h3>
          <p className="break-all text-xs text-slate-500">{member.email}</p>
          <span className="mt-2 inline-block rounded bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700">{member.globalAdmin ? `${member.owner ? 'Creador · ' : ''}Admin general` : member.owner ? 'Creador · Admin de proyecto' : roles[member.role]}</span>
        </div>
        <div className="space-y-1 text-xs leading-5 text-slate-600">
          {member.role === 'admin' || member.globalAdmin ? <p>Acceso completo al proyecto</p> : <>
            <p><span className="font-bold text-slate-700">Áreas:</span> {member.allowedCategories?.join(', ') || 'Sin áreas asignadas'}</p>
            {!!member.allowedSubcategories?.length && <p><span className="font-bold text-slate-700">Subcategorías delegadas:</span> {member.allowedSubcategories.map(key => key.replace('||', ' / ')).join(', ')}</p>}
            <p><span className="font-bold text-slate-700">Acceso:</span> {normalizeAllowedTabs(member.allowedTabs, member.role).map(tab => tabs[tab] || tab).join(' · ')}</p>
            <p>{member.canEditBudgetAreas === true && normalizeAllowedTabs(member.allowedTabs, member.role).includes('areas') && (member.allowedCategories?.length || member.allowedSubcategories?.length) ? 'Carga y edición en su alcance' : 'Sin edición de gastos de áreas'} · {member.canViewBudgetTotals ? 'Ve totales' : 'Totales restringidos'}</p>
          </>}
        </div>
      </article>)}
      {!members.length && <p className="p-6 text-sm text-slate-500">Todavía no hay integrantes asignados.</p>}
    </div>
  </section>;
}
