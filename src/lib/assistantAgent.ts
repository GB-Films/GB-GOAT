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
  '- Todavía no modificás datos: solo consultás, resumís y analizás. Si te piden una acción de escritura, contá qué habría que hacer y aclarás que esa función llega más adelante.',
  '- Cuando informes plata, usá el formato $1.234.567 y aclarás el área o la partida.',
  '- Si una herramienta devuelve un error o no hay datos, decilo con claridad en vez de suponer.',
].join('\n');

export const runAssistantTurn = async ({
  history,
  userText,
  tools,
  callModel,
  maxRounds = 4,
}: {
  history: AssistantMessage[];
  userText: string;
  tools: AssistantTool[];
  callModel: AssistantModelCaller;
  maxRounds?: number;
}) => {
  const messages: AssistantMessage[] = [...history, { role: 'user', content: userText }];
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
