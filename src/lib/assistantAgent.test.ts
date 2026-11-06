import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAssistantCapabilities } from './assistantCapabilities';
import {
  buildAssistantSystemPrompt,
  continueAssistantTurn,
  runAssistantTurn,
  type AssistantMessage,
} from './assistantAgent';
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

test('prepara la lista verificable antes de pedir confirmación y conserva el estado de DeepSeek al continuar', async () => {
  let writes = 0;
  const dateTool: AssistantTool = { name: 'programar_fechas_pago', description: '', parameters: { type: 'object', properties: {} }, requiresConfirmation: true,
    prepare: async () => ({ args: { planId: 'checked' }, summary: 'Persona ficticia: 20/11/2026' }), run: async () => { writes++; return { ok: true }; } };
  const pending = await runAssistantTurn({ history: [], userText: 'Programá las fechas', tools: [dateTool], callModel: async () => ({ message: { role: 'assistant', content: '', reasoning_content: 'private-protocol-state', tool_calls: [
    { id: 'one', type: 'function', function: { name: dateTool.name, arguments: '{}' } },
    { id: 'two', type: 'function', function: { name: dateTool.name, arguments: '{}' } },
  ] } }) });
  assert.equal(writes, 0); assert.equal(pending.reply, ''); assert.equal(pending.pending?.args.planId, 'checked');
  assert.equal(pending.pending?.summary, 'Persona ficticia: 20/11/2026');
  assert(pending.messages.some(message => message.role === 'tool' && message.tool_call_id === 'two' && message.content.includes('No ejecutada')));
  const executed = await dateTool.run(pending.pending!.args);
  const result = await continueAssistantTurn({ history: [...pending.messages, { role: 'tool', tool_call_id: 'one', content: JSON.stringify(executed) }], tools: [dateTool], callModel: async ({ messages }) => {
    assert(messages.some(message => message.reasoning_content === 'private-protocol-state'));
    return { message: { role: 'assistant', content: 'Fechas programadas.' } };
  } });
  assert.equal(writes, 1); assert.equal(result.reply, 'Fechas programadas.'); assert(!result.reply.includes('private-protocol-state'));
});

test('una preparación inválida no ofrece confirmar ni escribe; el día de referencia usa Argentina', async () => {
  const tool: AssistantTool = { name: 'programar_fechas_pago', description: '', parameters: { type: 'object', properties: {} }, requiresConfirmation: true,
    prepare: async () => ({ error: 'Dos gastos coinciden; precisá cuál.' }), run: () => assert.fail('No debe escribir') };
  let round = 0;
  const result = await runAssistantTurn({ history: [], userText: 'Programá Juan', tools: [tool], callModel: async () => ++round === 1
    ? { message: { role: 'assistant', content: '', tool_calls: [{ id: 'one', type: 'function', function: { name: tool.name, arguments: '{}' } }] } }
    : { message: { role: 'assistant', content: 'Indicá el gasto exacto.' } } });
  assert.equal(result.pending, undefined); assert.match(result.reply, /gasto exacto/);
  const prompt = buildAssistantSystemPrompt({ today: new Date('2026-11-07T01:00:00Z') });
  assert.match(prompt, /2026-11-06/); assert.match(prompt, /programar_fechas_pago/); assert.match(prompt, /no lo reemplaces por asignar una fecha/);
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

test('el prompt del sistema explica el alcance, el formato y las confirmaciones', () => {
  const prompt = buildAssistantSystemPrompt({
    globalRole: 'colaborador',
    projectNames: ['Largometraje', 'Spot'],
    currentProjectName: 'Largometraje',
  });

  assert.match(prompt, /español rioplatense/);
  assert.match(prompt, /proyecto "Largometraje"/);
  assert.match(prompt, /Proyectos a los que tiene acceso: Largometraje, Spot/);
  assert.match(prompt, /piden confirmación al usuario/);
  assert.match(prompt, /panel angosto/);
  assert.match(prompt, /Registrar, transferir o ejecutar pagos, reintegros y movimientos de cajas se hace SIEMPRE a mano/);
  assert.match(prompt, /programar_fechas_pago/);
});

test('las acciones de escritura quedan pendientes de confirmación', async () => {
  const writeTools: AssistantTool[] = [
    {
      name: 'crear_gasto_area',
      description: 'Crea un gasto',
      parameters: { type: 'object', properties: {} },
      requiresConfirmation: true,
      summarize: () => 'Cargar gasto en Arte por $1.000',
      run: async () => ({ ok: true, mensaje: 'Gasto cargado.' }),
    },
  ];

  let round = 0;
  const callModel = async ({ messages }: { messages: AssistantMessage[] }) => {
    round += 1;
    if (round === 1) {
      return {
        message: {
          role: 'assistant' as const,
          content: '',
          tool_calls: [{ id: 'call-1', type: 'function' as const, function: { name: 'crear_gasto_area', arguments: JSON.stringify({ area: 'Arte' }) } }],
        },
        model: 'deepseek-flash',
        reasoningEffort: 'high',
      };
    }
    const toolMessage = messages.find((message) => message.role === 'tool');
    return { message: { role: 'assistant' as const, content: toolMessage?.content.includes('ok') ? 'Listo, quedó cargado.' : 'No se pudo.' } };
  };

  const pending = await runAssistantTurn({
    history: [{ role: 'system', content: 'sistema' }],
    userText: 'Cargá un gasto de Arte por mil pesos',
    tools: writeTools,
    callModel,
  });

  assert.equal(pending.reply, '');
  assert.deepEqual(pending.pending, {
    callId: 'call-1',
    name: 'crear_gasto_area',
    args: { area: 'Arte' },
    summary: 'Cargar gasto en Arte por $1.000',
  });
  assert.deepEqual(pending.actions, []);
  assert.equal(pending.model, 'deepseek-flash');

  const executed = await writeTools[0].run({ area: 'Arte' });
  const continued = await continueAssistantTurn({
    history: [
      ...pending.messages,
      { role: 'tool', tool_call_id: pending.pending!.callId, content: JSON.stringify(executed) },
    ],
    tools: writeTools,
    callModel,
  });

  assert.equal(continued.reply, 'Listo, quedó cargado.');
  assert.equal(continued.pending, undefined);
});
