import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { matchesSmartSearch } from '../lib/smartSearch';

export type SearchableOption = { value: string; label: string; searchText?: string; disabled?: boolean };

export function SearchableSelect({ value, onChange, options, label, placeholder = 'Escribí para buscar...', disabled = false, required = false }: {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  label: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const selected = options.find(option => option.value === value && !option.disabled);
  const filtered = options.filter(option => matchesSmartSearch(query, option.label, option.searchText));
  const expanded = open && !disabled;
  useEffect(() => {
    inputRef.current?.setCustomValidity(required && !selected ? 'Seleccioná una opción de la lista.' : '');
  }, [required, selected]);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  const choose = (option: SearchableOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
    setQuery('');
  };
  return (
    <div className="relative" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <div className="relative">
        <input ref={inputRef} role="combobox" aria-label={label} aria-autocomplete="list"
          aria-expanded={expanded} aria-controls={`${id}-list`}
          aria-activedescendant={expanded && active >= 0 ? `${id}-${active}` : undefined}
          disabled={disabled} required={required} autoComplete="off"
          value={expanded ? query : selected?.label || ''} placeholder={selected?.label || placeholder}
          onFocus={() => { setOpen(true); setQuery(''); setActive(-1); }}
          onClick={() => { if (!open) { setOpen(true); setQuery(''); setActive(-1); } }}
          onChange={event => { setOpen(true); setQuery(event.target.value); setActive(-1); if (value) onChange(''); }}
          onInvalid={() => setOpen(true)}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
              const direction = event.key === 'ArrowDown' ? 1 : -1;
              let next = active === -1 && direction === -1 ? 0 : active;
              for (let i = 0; i < filtered.length; i++) {
                next = (next + direction + filtered.length) % filtered.length;
                if (!filtered[next].disabled) { setActive(next); break; }
              }
            } else if (event.key === 'Enter' && expanded) {
              event.preventDefault();
              const option = active >= 0 ? filtered[active] : filtered.filter(option => !option.disabled).length === 1
                ? filtered.find(option => !option.disabled) : undefined;
              if (option) choose(option);
            } else if (event.key === 'Escape' && expanded) {
              event.preventDefault(); event.stopPropagation(); setOpen(false);
            }
          }}
          className="w-full rounded-lg border border-slate-200 bg-slate-50 py-3 pl-3 pr-9 text-xs focus:outline-none focus:border-blue-500 disabled:opacity-50" />
        <button type="button" disabled={disabled} aria-label={`Abrir ${label}`} tabIndex={-1}
          onMouseDown={event => event.preventDefault()}
          onClick={() => { if (expanded) setOpen(false); else { inputRef.current?.focus(); setQuery(''); setActive(-1); setOpen(true); } }}
          className="absolute inset-y-0 right-0 px-3 text-slate-400"><ChevronDown className="h-4 w-4" /></button>
      </div>
      {expanded && <div ref={listRef} id={`${id}-list`} role="listbox" aria-label={label}
        className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
        {filtered.length ? filtered.map((option, index) => (
          <div key={option.value} id={`${id}-${index}`} role="option" aria-selected={option.value === value}
            aria-disabled={option.disabled || undefined} data-active={index === active}
            onMouseDown={event => event.preventDefault()}
            onMouseEnter={() => { if (!option.disabled) setActive(index); }}
            onClick={() => choose(option)}
            className={`rounded px-3 py-2 text-xs ${option.disabled ? 'text-slate-400 cursor-not-allowed' : 'cursor-pointer text-slate-800'} ${index === active ? 'bg-blue-50' : ''}`}>
            {option.label}
          </div>
        )) : <div role="status" className="px-3 py-3 text-xs text-slate-500">No hay coincidencias.</div>}
      </div>}
    </div>
  );
}
