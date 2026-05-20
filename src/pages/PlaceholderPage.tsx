export default function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between border-b border-slate-200 pb-6">
        <div>
          <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold mb-1">GB GOAT / Módulo</div>
          <h1 className="text-2xl font-light text-slate-900 leading-none">{title}: <span className="font-bold text-black">En desarrollo</span></h1>
          <p className="text-xs text-slate-500 mt-2 max-w-2xl">Sección pendiente de habilitación.</p>
        </div>
      </header>
      <div className="bg-white border border-slate-100 rounded-3xl p-12 text-center">
        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        </div>
        <h2 className="text-xl font-bold text-slate-900">Pronto disponible</h2>
        <p className="text-slate-500 mt-2 max-w-sm mx-auto">Estamos trabajando para habilitar la gestión completa de {title.toLowerCase()} en GB GOAT.</p>
      </div>
    </div>
  );
}
