export function ShootingDateInput({ label, value, min, onChange }: {
  label: string; value: string; min?: string; onChange: (value: string) => void;
}) {
  // A visible native input can be tapped directly in iOS, without showPicker().
  return <label className="inline-flex min-w-0 items-center gap-1">
    <span className="sr-only">{label}</span>
    <input type="date" aria-label={label} title={label} value={value} min={min}
      onChange={event => onChange(event.target.value)}
      className="min-h-8 min-w-0 w-[110px] rounded border-0 bg-transparent px-0 text-[11px] font-bold text-slate-900 outline-none focus:ring-2 focus:ring-blue-200" />
  </label>;
}
