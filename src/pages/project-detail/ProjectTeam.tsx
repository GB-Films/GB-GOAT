import type { Collaborator } from './types';
import { normalizeAllowedTabs } from '../../lib/projectAccess';

const roles = { admin: 'Admin de proyecto', jefe_produccion: 'Jefe de Producción', jefe_area: 'Jefe de Área' };
const tabs: Record<string, string> = { resumen: 'Resumen', presupuesto: 'Presu Ppal', areas: 'Áreas', cajas: 'Cajas', saldos: 'Finanzas', documentos: 'Documentos', resultado: 'Resultado', proveedores: 'Proveedores', equipo: 'Equipo', permisos: 'Permisos' };

export function ProjectTeam({ members, canAdd, canManage, onAdd, onManage }: {
  members: Array<Collaborator & { owner?: boolean; globalAdmin?: boolean }>; canAdd: boolean; canManage: boolean;
  onAdd: () => void; onManage: () => void;
}) {
  return <section className="space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-bold text-slate-900">Equipo del proyecto</h2><p className="text-xs text-slate-500">{members.length} integrantes · roles y permisos actuales</p></div>
      <div className="flex gap-2">{canManage && <button type="button" onClick={onManage} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold">Editar permisos</button>}
        {canAdd && <button type="button" onClick={onAdd} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white">Agregar persona</button>}</div>
    </header>
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
      {members.map(member => <article key={member.email} className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="min-w-0"><h3 className="break-words text-sm font-bold text-slate-900">{member.displayName || member.email}</h3>
          <p className="break-all text-xs text-slate-500">{member.email}</p>
          <span className="mt-2 inline-block rounded bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700">{member.globalAdmin ? `${member.owner ? 'Creador · ' : ''}Admin general` : member.owner ? 'Creador · Admin de proyecto' : roles[member.role]}</span>
        </div>
        <div className="space-y-1 text-xs leading-5 text-slate-600">
          {member.role === 'admin' || member.globalAdmin ? <p>Administración completa de este proyecto: presupuesto, áreas, pagos, cajas y equipo.</p> : <>
            <p><span className="font-bold text-slate-700">Áreas:</span> {member.allowedCategories?.join(', ') || 'Sin áreas asignadas'}</p>
            {!!member.allowedSubcategories?.length && <p><span className="font-bold text-slate-700">Subcategorías delegadas:</span> {member.allowedSubcategories.map(key => key.replace('||', ' / ')).join(', ')}</p>}
            <p><span className="font-bold text-slate-700">Acceso:</span> {normalizeAllowedTabs(member.allowedTabs, member.role).map(tab => tabs[tab] || tab).join(' · ')}</p>
            <p>{member.canEditBudgetAreas === true && normalizeAllowedTabs(member.allowedTabs, member.role).includes('areas') && (member.allowedCategories?.length || member.allowedSubcategories?.length) ? 'Carga y edición en su alcance' : 'Sin edición de gastos de áreas'} · {member.canViewBudgetTotals ? 'Ve totales' : 'Totales restringidos'}</p>
          </>}
        </div>
      </article>)}
      {!members.length && <p className="p-6 text-sm text-slate-500">Todavía no hay integrantes asignados.</p>}
    </div>
    <p className="text-[11px] text-slate-500">Los administradores generales mantienen su acceso global. Se conservan las restricciones para modificar cajas de otras personas. Los proveedores de gastos no reciben acceso por estar cargados en una fila.</p>
  </section>;
}
