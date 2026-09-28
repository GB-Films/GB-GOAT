import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Send, Sparkles, X } from 'lucide-react';
import { cn } from '../lib/utils';
import type { AssistantCapabilities } from '../lib/assistantCapabilities';
import {
  buildAssistantSystemPrompt,
  callDeepSeekAssistant,
  runAssistantTurn,
  type AssistantMessage,
} from '../lib/assistantAgent';
import { buildAssistantTools, type AssistantProjectContext } from '../lib/assistantTools';

type VisibleMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions?: string[];
};

type AssistantChatProps = {
  capabilities: AssistantCapabilities;
  context: Omit<AssistantProjectContext, 'capabilities'>;
  onOpenTab?: (tab: string) => void;
};

const SUGGESTIONS = [
  '¿Cómo viene el presupuesto del proyecto?',
  '¿Qué pagos están pendientes?',
  'Resumime las áreas activas',
];

export function AssistantChat({ capabilities, context, onOpenTab }: AssistantChatProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState<VisibleMessage[]>([]);
  const historyRef = useRef<AssistantMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const tools = useMemo(
    () => buildAssistantTools({ ...context, capabilities }),
    [capabilities, context],
  );
  const systemPrompt = useMemo(
    () => buildAssistantSystemPrompt({ projectName: context.projectName, capabilities }),
    [capabilities, context.projectName],
  );

  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [busy, open, visible]);

  const handleSend = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || busy) return;
    setInput('');
    setError('');
    setBusy(true);
    setVisible((current) => [...current, { id: `u-${Date.now()}`, role: 'user', content: text }]);

    try {
      const { messages, reply, actions } = await runAssistantTurn({
        history: [{ role: 'system', content: systemPrompt }, ...historyRef.current],
        userText: text,
        tools,
        callModel: callDeepSeekAssistant,
      });
      historyRef.current = messages.filter((message) => message.role !== 'system');
      setVisible((current) => [...current, {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: reply,
        actions: actions.map((action) => action.name),
      }]);
      const navigation = actions.find((action) => action.name === 'ir_a_pantalla');
      const tab = navigation?.args?.pestana;
      if (tab && onOpenTab) onOpenTab(String(tab));
    } catch (err: any) {
      setError(String(err?.message || 'No se pudo consultar al asistente.').replace(/^FirebaseError:\s*/i, ''));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-4 z-[120] inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white shadow-xl transition-colors hover:bg-black"
          title="Abrir el asistente"
        >
          <Sparkles className="h-4 w-4" />
          Asistente
        </button>
      )}

      {open && (
        <div className="fixed bottom-5 right-4 z-[120] flex max-h-[80vh] w-[min(94vw,430px)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-900 px-4 py-3 text-white">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest">
                <Sparkles className="h-3.5 w-3.5 text-emerald-300" />
                Asistente del proyecto
              </div>
              <div className="mt-0.5 truncate text-[9px] font-bold uppercase tracking-widest text-slate-400">
                {capabilities.role ? `${context.projectName || capabilities.projectId} · ${capabilities.role}` : context.projectName || capabilities.projectId}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {visible.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    historyRef.current = [];
                    setVisible([]);
                    setError('');
                  }}
                  className="rounded px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-slate-300 transition-colors hover:text-white"
                  title="Empezar de nuevo"
                >
                  Limpiar
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-slate-300 transition-colors hover:text-white"
                title="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {visible.length === 0 && (
              <div className="space-y-2">
                <p className="text-[11px] leading-5 text-slate-500">
                  Puedo resumir el proyecto, buscar partidas o gastos de tus áreas y decirte qué pagos están pendientes.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => handleSend(suggestion)}
                      className="rounded-full border border-slate-200 px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-500 transition-colors hover:border-slate-900 hover:text-slate-900"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {visible.map((message) => (
              <div key={message.id} className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[12px] leading-5',
                    message.role === 'user'
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-800',
                  )}
                >
                  {message.content}
                  {message.role === 'assistant' && message.actions && message.actions.length > 0 && (
                    <div className="mt-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-400">
                      Consultó: {message.actions.filter((name) => name !== 'ir_a_pantalla').join(', ') || 'datos del proyecto'}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {busy && (
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Consultando
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[11px] font-bold text-red-600">
                {error}
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    handleSend(input);
                  }
                }}
                rows={2}
                placeholder="Escribí tu consulta..."
                className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-[12px] text-slate-800 outline-none transition-colors focus:border-slate-900"
                disabled={busy}
              />
              <button
                type="button"
                onClick={() => handleSend(input)}
                disabled={busy || !input.trim()}
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-white transition-colors hover:bg-black disabled:bg-slate-300"
                title="Enviar"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
            <div className="mt-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-300">
              Responde con los datos que vos podés ver
            </div>
          </div>
        </div>
      )}
    </>
  );
}
