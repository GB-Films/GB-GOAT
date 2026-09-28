import { getApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { assistantToolsForModel, type AssistantTool } from './assistantTools';

export type AssistantToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type AssistantMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: AssistantToolCall[];
  tool_call_id?: string;
};

export type AssistantPendingAction = {
  callId: string;
  name: string;
  args: any;
  summary: string;
};

export type AssistantTurnResult = {
  messages: AssistantMessage[];
  reply: string;
  actions: Array<{ name: string; args: any; output: unknown }>;
  pending?: AssistantPendingAction;
  model?: string;
  reasoningEffort?: string;
};

export type AssistantModelCaller = (input: {
  messages: AssistantMessage[];
  tools: ReturnType<typeof assistantToolsForModel>;
}) => Promise<{ message: AssistantMessage; model?: string; reasoningEffort?: string }>;

export const ASSISTANT_FUNCTIONS_REGION = 'us-central1';

// Único punto de contacto con el modelo: pasa por la Cloud Function, que es la
// que guarda la API key de DeepSeek y aplica la cuota diaria por usuario.
export const callDeepSeekAssistant: AssistantModelCaller = async ({ messages, tools }) => {
  const callable = httpsCallable(getFunctions(getApp(), ASSISTANT_FUNCTIONS_REGION), 'assistantChat');
  const result = await callable({ messages, tools });
  const data = (result?.data || {}) as any;
  return {
    message: {
      role: 'assistant',
      content: typeof data?.message?.content === 'string' ? data.message.content : '',
      tool_calls: Array.isArray(data?.message?.tool_calls) ? data.message.tool_calls : [],
    },
    model: typeof data?.model === 'string' ? data.model : undefined,
    reasoningEffort: typeof data?.reasoningEffort === 'string' ? data.reasoningEffort : undefined,
  };
};

export const buildAssistantSystemPrompt = ({
  globalRole = null,
  isAppAdmin = false,
  projectNames = [],
  currentProjectName = null,
  today = new Date(),
}: {
  globalRole?: string | null;
  isAppAdmin?: boolean;
  projectNames?: string[];
  currentProjectName?: string | null;
  today?: Date;
}) => [
  'Sos el asistente interno de GB GOAT, la herramienta de gestión de producción de Gran Berta Films.',
  'Hablás en español rioplatense, claro y directo.',
  `Hoy es ${today.toISOString().slice(0, 10)}.`,
  ...(isAppAdmin
    ? ['El usuario es administrador global de la aplicación.']
    : globalRole ? [`Rol global del usuario: ${globalRole}.`] : []),
  ...(currentProjectName ? [`En pantalla está abierto el proyecto "${currentProjectName}". Si el usuario no aclara otro, asumí ese.`] : []),
  ...(projectNames.length > 0
    ? [`Proyectos a los que tiene acceso: ${projectNames.slice(0, 40).join(', ')}.`]
    : ['Si necesitás saber a qué proyectos tiene acceso, usá la herramienta listar_proyectos.']),
  'Reglas:',
  '- Antes de dar números o listados, consultá las herramientas. Nunca inventes cifras.',
  '- Trabajás únicamente con la información que este usuario puede ver: si te piden algo fuera de su alcance, explicá que no tiene permiso.',
  '- Si no sabés a qué proyecto se refiere, preguntale o listá los disponibles.',
  '- Para explicar cómo funciona la app (cualquier pestaña, carga de gastos, proveedores, pagos, permisos, problemas frecuentes) usá `consultar_ayuda`. Esa ayuda es general: no está restringida por permisos, así que podés explicar cómo funciona todo aunque el usuario no pueda ver esos datos.',
  '- Si te preguntan qué puede hacer esa persona, usá `que_puedo_hacer` y contestá según su rol real.',
  '- Podés crear partidas y gastos de área, editar filas, moverlas de categoría o de área/subcategoría, borrarlas (si no tienen pagos), asignar o quitar proveedor, generar links de alta de proveedor, y administrar la estructura: crear/renombrar/borrar categorías, crear/editar/borrar subcategorías con su presupuesto, y activar, desactivar o eliminar áreas. Todas esas acciones piden confirmación al usuario: no afirmes que ya las hiciste hasta que la herramienta devuelva ok.',
  '- Si una herramienta de escritura devuelve un error (por ejemplo una fila con pagos registrados), explicá el motivo en simple y ofrecé la alternativa.',
  '- Los pagos, los reintegros y todo lo que toca cajas se hacen SIEMPRE a mano desde la app: no los ejecutes ni los ofrezcas como acción; explicá dónde se hacen y, si querés, guiá al usuario paso a paso.',
  '- Tampoco hacés documentos ni cambios de permisos: eso se hace desde la app.',
  'Planillas:',
  '- Si el usuario adjunta una planilla o pega una tabla de Excel, tomá las filas del bloque "Planilla adjunta" o "Tabla pegada" como los datos a cargar.',
  '- Antes de proponer la carga revisá cada fila: que el área exista y esté activa en Gestión por Áreas, que tenga descripción, cantidad y precio, y que el proveedor sea reconocible.',
  '- Si algo es ambiguo (área dudosa, proveedor que no figura en la base, falta un precio), preguntale al usuario antes de cargar. No inventes datos.',
  '- Para cargar varias filas usá `cargar_gastos_lote` (una sola confirmación). Si esa herramienta devuelve problemas, mostralos claros y preguntá cómo seguir.',
  'Archivos:',
  '- El usuario puede adjuntar planillas (Excel/CSV) o PDFs. Los PDFs se leen por texto: usá el bloque "PDF adjunto" para entender qué documento es y proponer acciones.',
  '- Si el PDF (o una imagen) es una factura, podés adjuntarla a una fila con `adjuntar_factura` (pide confirmación). No hace falta que el usuario la suba otra vez.',
  '- Si el PDF no es una factura (por ejemplo un contrato o una póliza), explicá que para guardarlo en Documentos se hace desde la pestaña Documentos de la app.',
  'Formato:',
  '- Escribís en un panel angosto: respuestas cortas, en lo posible con listas que empiezan con "-".',
  '- Usá **negritas** sólo para cifras o nombres clave y `código` para ids o nombres de campos.',
  '- No uses tablas anchas ni bloques enormes: si hay muchos datos, resumí y ofrecé el detalle.',
  '- Cuando informes plata, usá el formato $1.234.567 y aclarás el área o la partida.',
  '- Si una herramienta devuelve un error o no hay datos, decilo con claridad en vez de suponer.',
].join('\n');

const runAssistantLoop = async ({
  messages,
  tools,
  callModel,
  maxRounds = 4,
}: {
  messages: AssistantMessage[];
  tools: AssistantTool[];
  callModel: AssistantModelCaller;
  maxRounds?: number;
}): Promise<AssistantTurnResult> => {
  const actions: Array<{ name: string; args: any; output: unknown }> = [];
  const toolSchemas = assistantToolsForModel(tools);
  let model: string | undefined;
  let reasoningEffort: string | undefined;

  for (let round = 0; round < maxRounds; round += 1) {
    const response = await callModel({ messages, tools: toolSchemas });
    const { message } = response;
    model = response.model || model;
    reasoningEffort = response.reasoningEffort || reasoningEffort;
    const assistantMessage: AssistantMessage = {
      role: 'assistant',
      content: message.content || '',
      ...(message.tool_calls && message.tool_calls.length > 0 ? { tool_calls: message.tool_calls } : {}),
    };
    messages.push(assistantMessage);

    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      return { messages, reply: assistantMessage.content, actions, model, reasoningEffort };
    }

    for (const call of assistantMessage.tool_calls) {
      const tool = tools.find((entry) => entry.name === call.function?.name);
      let args: any = {};
      if (call.function?.arguments) {
        try {
          args = JSON.parse(call.function.arguments);
        } catch {
          args = {};
        }
      }
      let output: unknown;
      if (!tool) {
        output = { error: `La herramienta ${call.function?.name || 'desconocida'} no está disponible para este usuario.` };
      } else if (tool.requiresConfirmation) {
        // Acción de escritura: se frena acá y la app le pide confirmación al usuario.
        return {
          messages,
          reply: '',
          actions,
          model,
          reasoningEffort,
          pending: {
            callId: call.id,
            name: tool.name,
            args,
            summary: tool.summarize ? tool.summarize(args) : tool.name,
          },
        };
      } else {
        try {
          output = await tool.run(args);
        } catch (error: any) {
          output = { error: error?.message || 'Error al ejecutar la consulta.' };
        }
          actions.push({ name: tool.name, args, output });
      }
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(output ?? null).slice(0, 30_000),
      });
    }
  }

  return {
    messages,
    reply: 'No pude terminar la consulta con los datos disponibles. Probá preguntarlo de otra forma.',
    actions,
    model,
    reasoningEffort,
  };
};

export const runAssistantTurn = (input: {
  history: AssistantMessage[];
  userText: string;
  tools: AssistantTool[];
  callModel: AssistantModelCaller;
  maxRounds?: number;
}) => runAssistantLoop({
  messages: [...input.history, { role: 'user', content: input.userText }],
  tools: input.tools,
  callModel: input.callModel,
  maxRounds: input.maxRounds,
});

export const continueAssistantTurn = (input: {
  history: AssistantMessage[];
  tools: AssistantTool[];
  callModel: AssistantModelCaller;
  maxRounds?: number;
}) => runAssistantLoop({
  messages: input.history,
  tools: input.tools,
  callModel: input.callModel,
  maxRounds: input.maxRounds,
});
