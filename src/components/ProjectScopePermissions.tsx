import { canViewProjectSubcategory, hasFullProjectAreaAccess, asStringArray, areaFromSubcategoryKey, toggleProjectAreaAccess, toggleProjectSubcategoryAccess, type ProjectAccess } from '../lib/projectAccess';

export function ProjectScopePermissions({ access, areas, subcategories, onChange }: { access: ProjectAccess; areas: string[];
  subcategories: { key: string; area: string; subcategory: string; budget: number }[];
  onChange: (update: { allowedCategories: string[]; allowedSubcategories: string[]; excludedSubcategories: string[] }) => void }) {
  const admin = access.role === 'admin';
  const chip = 'rounded border px-3 py-1.5 text-[10px] font-bold uppercase tracking-tight transition-colors disabled:cursor-default';
  return <>
    <div><div className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-500">Áreas</div><div className="flex flex-wrap gap-1.5">
      {areas.map(area => { const enabled = admin || asStringArray(access.allowedCategories).includes(area), partial = enabled && !hasFullProjectAreaAccess(admin, access, area);
        return <button type="button" key={area} disabled={admin} aria-pressed={partial ? 'mixed' : enabled} onClick={() => onChange(toggleProjectAreaAccess(access, area))}
          className={`${chip} ${partial ? 'border-amber-400 bg-amber-100 text-amber-950' : enabled ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-200 bg-white text-slate-400 hover:border-emerald-500 hover:text-emerald-700'}`}>
          {area}{partial ? ' · Parcial' : ''}
        </button>;
      })}
    </div></div>
    {!!subcategories.length && <div className="lg:col-span-2"><div className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-500">Subcategorías</div>
      <p className="mb-2 text-xs text-slate-500">El área incluye todas sus subcategorías. Destildá una para excluirla: quedará en amarillo.</p>
      <div className="flex flex-wrap gap-1.5">{subcategories.map(option => {
        const enabled = canViewProjectSubcategory(admin, access, option.area, option.subcategory);
        const excluded = !admin && asStringArray(access.excludedSubcategories).includes(option.key)
          && asStringArray(access.allowedCategories).includes(areaFromSubcategoryKey(option.key));
        return <button type="button" key={option.key} disabled={admin} aria-pressed={enabled}
          aria-label={`${option.area} / ${option.subcategory}: ${excluded ? 'excluida' : enabled ? 'incluida' : 'sin acceso'}`}
          onClick={() => onChange(toggleProjectSubcategoryAccess(access, option.area, option.subcategory))}
          className={`${chip} ${excluded ? 'border-amber-400 bg-amber-100 text-amber-950' : enabled ? 'border-rose-500 bg-rose-500 text-white' : 'border-slate-200 bg-white text-slate-400 hover:border-rose-500 hover:text-rose-700'}`}>
          {option.area} / {option.subcategory}{excluded ? ' · Excluida' : ''}{option.budget > 0 ? ` · $${option.budget.toLocaleString()}` : ''}
        </button>;
      })}</div>
    </div>}
    {admin && <p className="text-xs text-slate-500 lg:col-span-2">Un administrador de proyecto tiene acceso completo.</p>}
  </>;
}
