import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAssistantCapabilities } from './assistantCapabilities';
import { buildAssistantSystemPrompt, runAssistantTurn, type AssistantMessage } from './assistantAgent';
import type { AssistantTool } from './assistantTools';

const tools: AssistantTool[] = [
  {
    name: 'resumen_proyecto',
    description: 'Resumen',
    parameters: { type: 'object', properties: {} },
    run: () => ({ presupuestoPrincipal: 1000, gastosDeAreas: 250 }),
  },
  {
    name: 'ir_a_pantalla',
    description: 'Navegar',
    parameters: { type: 'object', properties: { pestana: { type: 'string' } } },
    run: (args) => ({ abrirPestana: args?.pestana }),
  },
];

const callWithTool = (calls: AssistantMessage[][]) => async ({ messages }: { messages: AssistantMessage[] }) => {
  calls.push(messages);
  if (calls.length === 1) {
    return {
      message: {
        role: 'assistant' as const,
        content: '',
        tool_calls: [{ id: 'call-1', type: 'function' as const, function: { name: 'resumen_proyecto', arguments: '{}' } }],
      },
    };
  }
  return { message: { role: 'assistant' as const, content: 'El presupuesto es $1.000.' } };
};

test('el asistente ejecuta la herramienta y devuelve la respuesta final', async () => {
  const calls: AssistantMessage[][] = [];
  const result = await runAssistantTurn({
    history: [{ role: 'system', content: 'sistema' }],
    userText: '¿Cómo viene el presupuesto?',
    tools,
    callModel: callWithTool(calls),
  });

  assert.equal(result.reply, 'El presupuesto es $1.000.');
  assert.deepEqual(result.actions.map((action) => action.name), ['resumen_proyecto']);
  const toolMessage = result.messages.find((message) => message.role === 'tool');
  assert.ok(toolMessage?.content.includes('1000'));
  assert.equal(calls.length, 2);
  assert.ok(calls[1].some((message) => message.role === 'tool'));
});

test('el asistente responde sin herramientas cuando no hacen falta', async () => {
  const result = await runAssistantTurn({
    history: [{ role: 'system', content: 'sistema' }],
    userText: 'Hola',
    tools,
    callModel: async () => ({ message: { role: 'assistant', content: '¡Hola! ¿Qué necesitás?' } }),
  });

  assert.equal(result.reply, '¡Hola! ¿Qué necesitás?');
  assert.deepEqual(result.actions, []);
  assert.equal(result.messages.length, 3);
});

test('una herramienta desconocida no rompe la conversación', async () => {
  let round = 0;
  const result = await runAssistantTurn({
    history: [],
    userText: 'Probá algo raro',
    tools,
    callModel: async () => {
      round += 1;
      if (round === 1) {
        return {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ id: 'call-x', type: 'function', function: { name: 'borrar_todo', arguments: '{}' } }],
          },
        };
      }
      return { message: { role: 'assistant', content: 'No tengo esa herramienta.' } };
    },
  });

  assert.equal(result.reply, 'No tengo esa herramienta.');
  assert.deepEqual(result.actions, []);
  const toolMessage = result.messages.find((message) => message.role === 'tool');
  assert.ok(toolMessage?.content.includes('no está disponible'));
});

test('si el modelo no cierra la respuesta se avisa en vez de quedar colgado', async () => {
  const result = await runAssistantTurn({
    history: [],
    userText: 'Dame todo',
    tools,
    callModel: async () => ({
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call-loop', type: 'function', function: { name: 'resumen_proyecto', arguments: '{}' } }],
      },
    }),
    maxRounds: 2,
  });

  assert.match(result.reply, /No pude terminar la consulta/);
});

test('el prompt del sistema explica el alcance y que todavía no escribe datos', () => {
  const prompt = buildAssistantSystemPrompt({
    globalRole: 'colaborador',
    projectNames: ['Largometraje', 'Spot'],
    currentProjectName: 'Largometraje',
  });

  assert.match(prompt, /español rioplatense/);
  assert.match(prompt, /proyecto "Largometraje"/);
  assert.match(prompt, /Proyectos a los que tiene acceso: Largometraje, Spot/);
  assert.match(prompt, /Todavía no modificás datos/);
});
