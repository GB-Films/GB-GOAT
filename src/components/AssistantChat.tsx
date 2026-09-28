import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, FileSpreadsheet, FileText, Loader2, Paperclip, Send, Sparkles, X } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  buildAssistantSystemPrompt,
  callDeepSeekAssistant,
  continueAssistantTurn,
  runAssistantTurn,
  type AssistantMessage,
  type AssistantPendingAction,
} from '../lib/assistantAgent';
import { buildAssistantTools } from '../lib/assistantTools';
import { formatPdfForAssistant, readAssistantPdf, type AssistantPdf } from '../lib/assistantPdf';
import {
  listAssistantProjects,
  loadAssistantClients,
  loadAssistantProjectFinance,
  loadAssistantProjectContext,
  loadAssistantProviders,
  loadAssistantUsers,
  type AssistantProjectHandle,
} from '../lib/assistantData';
import { hasGlobalRole, PROVIDER_ACCESS_ROLES } from '../lib/roles';
import {
  formatSpreadsheetForAssistant,
  parsePastedTable,
  readAssistantSpreadsheet,
  type AssistantSpreadsheet,
} from '../lib/assistantSpreadsheet';
import { AssistantMessageText } from './AssistantMessageText';

type VisibleMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions?: string[];
  attachmentName?: string;
};

type ChatAttachment =
  | { kind: 'table'; fileName: string; totalRows: number; truncated: boolean; text: string; spreadsheet: AssistantSpreadsheet }
  | { kind: 'pdf'; fileName: string; pageCount: number; truncated: boolean; text: string; pdf: AssistantPdf };

type AssistantChatProps = {
  uid: string;
  email: string;
  globalRole?: string | null;
  currentProjectId?: string | null;
};

const SUGGESTIONS = [
  '¿Qué proyectos tengo?',
  '¿Cómo viene el presupuesto?',
  '¿Cómo cargo un gasto?',
  '¿Qué puedo hacer con mi usuario?',
];

export function AssistantChat({ uid, email, globalRole, currentProjectId }: AssistantChatProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState<VisibleMessage[]>([]);
  const [projects, setProjects] = useState<AssistantProjectHandle[]>([]);
  const [engine, setEngine] = useState('');
  const [pendingAction, setPendingAction] = useState<AssistantPendingAction | null>(null);
  const [attachment, setAttachment] = useState<ChatAttachment | null>(null);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const pendingFileRef = useRef<File | null>(null);
  const historyRef = useRef<AssistantMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const listProjects = useMemo(
    () => () => listAssistantProjects({ uid, email, isAppAdmin: globalRole === 'admin' }),
    [email, globalRole, uid],
  );

  const projectNames = useMemo(() => projects.map((project) => project.name), [projects]);
  const currentProjectName = useMemo(() => (
    currentProjectId
      ? projects.find((project) => project.id === currentProjectId)?.name || null
      : null
  ), [currentProjectId, projects]);

  const tools = useMemo(() => buildAssistantTools({
    listProjects,
    loadProject: (projectId) => loadAssistantProjectContext({ projectId, uid, email, globalRole }),
    loadProjectFinance: loadAssistantProjectFinance,
    loadClients: loadAssistantClients,
    loadUsers: loadAssistantUsers,
    getPendingFile: () => pendingFileRef.current,
    isAppAdmin: globalRole === 'admin',
    loadProviders: loadAssistantProviders,
    canAccessProviders: hasGlobalRole(globalRole, PROVIDER_ACCESS_ROLES),
    currentProjectId: currentProjectId || null,
    userId: uid,
    userEmail: email,
  }), [currentProjectId, email, globalRole, listProjects, uid]);

  const systemPrompt = useMemo(() => buildAssistantSystemPrompt({
    globalRole,
    isAppAdmin: globalRole === 'admin',
    projectNames,
    currentProjectName,
  }), [currentProjectName, globalRole, projectNames]);

  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((loaded) => {
        if (cancelled) return;
        setProjects(loaded);
      })
      .catch((loadError) => console.warn('No pude listar los proyectos del asistente:', loadError));
    return () => {
      cancelled = true;
    };
  }, [listProjects]);

  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [busy, open, pendingAction, visible]);

  const applyEngine = (model?: string, reasoningEffort?: string) => {
    if (model) setEngine(`${model}${reasoningEffort ? ` · esfuerzo ${reasoningEffort}` : ''}`);
  };

  const applyNavigation = (actions: Array<{ name: string; output: unknown }>) => {
    const navigation = actions.find((action) => (action.output as any)?.abrirProyecto);
    if (!navigation) return;
    const destination = navigation.output as { abrirProyecto: string; pestana?: string };
    navigate(`/proyectos/${destination.abrirProyecto}${destination.pestana ? `?tab=${destination.pestana}` : ''}`);
  };

  const handleSend = async (rawText: string) => {
    const text = rawText.trim();
    if ((!text && !attachment) || busy) return;
    const attached = attachment;
    setInput('');
    setError('');
    setBusy(true);
    setPendingAction(null);
    setAttachment(null);
    setVisible((current) => [...current, {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
      attachmentName: attached?.fileName,
    }]);

    const promptText = attached
      ? `${text || 'Te adjunto una planilla para que la uses.'}\n\n${attached.text}`
      : text;

    try {
      const result = await runAssistantTurn({
        history: [{ role: 'system', content: systemPrompt }, ...historyRef.current],
        userText: promptText,
        tools,
        callModel: callDeepSeekAssistant,
      });
      historyRef.current = result.messages.filter((message) => message.role !== 'system');
      applyEngine(result.model, result.reasoningEffort);
      if (result.pending) {
        setPendingAction(result.pending);
      } else {
        setVisible((current) => [...current, {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: result.reply,
          actions: result.actions.map((action) => action.name),
        }]);
        applyNavigation(result.actions);
      }
    } catch (err: any) {
      setError(String(err?.message || 'No se pudo consultar al asistente.').replace(/^FirebaseError:\s*/i, ''));
    } finally {
      setBusy(false);
    }
  };

  const finishPendingAction = async (pending: AssistantPendingAction, output: unknown) => {
    try {
      const history = [
        ...historyRef.current,
        { role: 'tool' as const, tool_call_id: pending.callId, content: JSON.stringify(output ?? null).slice(0, 30_000) },
      ];
      const result = await continueAssistantTurn({ history, tools, callModel: callDeepSeekAssistant });
      historyRef.current = result.messages.filter((message) => message.role !== 'system');
      applyEngine(result.model, result.reasoningEffort);
      if (result.pending) {
        setPendingAction(result.pending);
        return;
      }
      setVisible((current) => [...current, {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: result.reply,
        actions: result.actions.map((action) => action.name),
      }]);
      applyNavigation(result.actions);
    } catch (err: any) {
      setError(String(err?.message || 'No se pudo completar la acción.').replace(/^FirebaseError:\s*/i, ''));
    } finally {
      setBusy(false);
    }
  };

  const confirmPendingAction = async () => {
    const pending = pendingAction;
    if (!pending || busy) return;
    setPendingAction(null);
    setError('');
    setBusy(true);
    const tool = tools.find((entry) => entry.name === pending.name);
    let output: unknown;
    try {
      output = tool ? await tool.run(pending.args) : { error: 'La acción ya no está disponible.' };
    } catch (err: any) {
      output = { error: err?.message || 'No se pudo ejecutar la acción.' };
    }
    await finishPendingAction(pending, output);
  };

  const cancelPendingAction = async () => {
    const pending = pendingAction;
    if (!pending || busy) return;
    setPendingAction(null);
    setError('');
    setBusy(true);
    await finishPendingAction(pending, { error: 'El usuario canceló la acción.' });
  };

  const handleAttachmentPick = async (file?: File | null) => {
    if (!file) return;
    setError('');
    setAttachmentBusy(true);
    try {
      const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
      if (isPdf) {
        const pdf = await readAssistantPdf(file);
        pendingFileRef.current = file;
        setAttachment({
          kind: 'pdf',
          fileName: pdf.fileName,
          pageCount: pdf.pageCount,
          truncated: pdf.truncated,
          text: formatPdfForAssistant(pdf),
          pdf,
        });
      } else {
        const spreadsheet = await readAssistantSpreadsheet(file);
        pendingFileRef.current = file;
        setAttachment({
          kind: 'table',
          fileName: spreadsheet.fileName,
          totalRows: spreadsheet.totalRows,
          truncated: spreadsheet.truncated,
          text: formatSpreadsheetForAssistant(spreadsheet),
          spreadsheet,
        });
      }
    } catch (attachmentError: any) {
      setAttachment(null);
      setError(String(attachmentError?.message || 'No se pudo leer la planilla.'));
    } finally {
      setAttachmentBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedText = event.clipboardData?.getData('text/plain') || '';
    const table = parsePastedTable(pastedText);
    if (!table) return;
    event.preventDefault();
    setError('');
    setAttachment({ spreadsheet: table, text: formatSpreadsheetForAssistant(table) });
  };

  const readsOf = (actions: string[] = []) => actions.filter((name) => !name.startsWith('crear_') && name !== 'ir_a_pantalla');
  const writesOf = (actions: string[] = []) => actions.filter((name) => name.startsWith('crear_'));

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
                Asistente
              </div>
              <div className="mt-0.5 truncate text-[9px] font-bold uppercase tracking-widest text-slate-400">
                {currentProjectName
                  ? currentProjectName
                  : globalRole === 'admin' ? 'Todos los proyectos' : 'Tus proyectos'}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {visible.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    historyRef.current = [];
                    setVisible([]);
                    setPendingAction(null);
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
            {visible.length === 0 && !pendingAction && (
              <div className="space-y-2">
                <p className="text-[11px] leading-5 text-slate-500">
                  Puedo resumir proyectos, buscar partidas o gastos, decirte qué pagos están pendientes y cargar
                  partidas o gastos con tu confirmación. Siempre dentro de tus permisos.
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
                    'max-w-[92%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[12px] leading-5',
                    message.role === 'user' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-800',
                  )}
                >
                  {message.attachmentName && (
                    <span className="mb-1.5 inline-flex items-center gap-1.5 rounded bg-white/15 px-2 py-1 text-[9px] font-black uppercase tracking-widest">
                      <FileSpreadsheet className="h-3 w-3" />
                      {message.attachmentName}
                    </span>
                  )}
                  {message.role === 'user'
                    ? (message.content && <span className="block">{message.content}</span>)
                    : <AssistantMessageText text={message.content} />}
                  {message.role === 'assistant' && message.actions && message.actions.length > 0 && (
                    <div className="mt-2 space-y-0.5 text-[9px] font-bold uppercase tracking-widest text-slate-400">
                      {readsOf(message.actions).length > 0 && (
                        <div>Consultó: {readsOf(message.actions).join(', ')}</div>
                      )}
                      {writesOf(message.actions).length > 0 && (
                        <div className="text-emerald-600">Ejecutó: {writesOf(message.actions).join(', ')}</div>
                      )}
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

          {pendingAction && (
            <div className="border-t border-amber-100 bg-amber-50 px-4 py-3">
              <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" />
                Confirmá la acción
              </div>
              <p className="mt-1 text-[12px] font-bold text-slate-800">{pendingAction.summary}</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={confirmPendingAction}
                  disabled={busy}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:bg-black disabled:bg-slate-300"
                >
                  <Check className="h-3.5 w-3.5" />
                  Confirmar
                </button>
                <button
                  type="button"
                  onClick={cancelPendingAction}
                  disabled={busy}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 transition-colors hover:border-slate-400 disabled:text-slate-300"
                >
                  <X className="h-3.5 w-3.5" />
                  Cancelar
                </button>
              </div>
            </div>
          )}

          <div className="border-t border-slate-100 p-3">
            {attachment && (
              <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2">
                <span className="flex min-w-0 items-center gap-2 text-[10px] font-black uppercase tracking-widest text-emerald-700">
                  {attachment.kind === 'pdf'
                    ? <FileText className="h-3.5 w-3.5 shrink-0" />
                    : <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" />}
                  <span className="truncate">
                    {attachment.fileName} ·{' '}
                    {attachment.kind === 'pdf'
                      ? `${attachment.pageCount} página${attachment.pageCount === 1 ? '' : 's'}`
                      : `${attachment.totalRows} filas`}
                    {attachment.truncated ? ' (recortada)' : ''}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  className="shrink-0 rounded p-1 text-emerald-700 transition-colors hover:text-emerald-900"
                  title="Quitar la planilla"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                className="hidden"
                onChange={(event) => handleAttachmentPick(event.target.files?.[0])}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy || attachmentBusy}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition-colors hover:border-slate-900 hover:text-slate-900 disabled:text-slate-300"
                title="Adjuntar planilla (Excel/CSV) o PDF"
              >
                {attachmentBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
              </button>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onPaste={handlePaste}
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
                disabled={busy || (!input.trim() && !attachment)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-white transition-colors hover:bg-black disabled:bg-slate-300"
                title="Enviar"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2 text-[9px] font-bold uppercase tracking-widest text-slate-300">
              <span>La planilla no se guarda: se usa sólo en esta charla</span>
              {engine && <span className="shrink-0">{engine}</span>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
