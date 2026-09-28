const { setGlobalOptions } = require('firebase-functions/v2');
const { HttpsError, onCall } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

setGlobalOptions({ region: 'us-central1', maxInstances: 5, memory: '256MiB' });
admin.initializeApp();

const db = admin.firestore();
const deepseekApiKey = defineSecret('DEEPSEEK_API_KEY');

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-flash';
const DAILY_MESSAGE_LIMIT = Math.max(1, Number(process.env.ASSISTANT_DAILY_LIMIT) || 300);
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 12_000;
const MAX_TOOLS = 24;
const MAX_PAYLOAD_BYTES = 200_000;
const REQUEST_TIMEOUT_MS = 90_000;

const todayKey = () => new Date().toISOString().slice(0, 10);

// Cuota diaria por usuario para proteger los créditos de DeepSeek. Se guarda en
// Firestore con el Admin SDK, así el cliente no puede alterarla.
const assertWithinDailyQuota = async (uid) => {
  const usageRef = db.collection('assistantUsage').doc(uid);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(usageRef);
    const data = snapshot.data() || {};
    const date = todayKey();
    const usedToday = data.date === date ? Number(data.count) || 0 : 0;
    if (usedToday >= DAILY_MESSAGE_LIMIT) {
      throw new HttpsError('resource-exhausted', 'Se alcanzó el límite diario de consultas del asistente. Probá mañana o pedile a un administrador que lo amplíe.');
    }
    transaction.set(usageRef, {
      date,
      count: usedToday + 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });
};

const validatePayload = (data) => {
  const messages = Array.isArray(data?.messages) ? data.messages : null;
  if (!messages || messages.length === 0) {
    throw new HttpsError('invalid-argument', 'Falta la conversación para el asistente.');
  }
  if (messages.length > MAX_MESSAGES) {
    throw new HttpsError('invalid-argument', `La conversación supera el máximo de ${MAX_MESSAGES} mensajes.`);
  }
  const tools = Array.isArray(data?.tools) ? data.tools : [];
  if (tools.length > MAX_TOOLS) {
    throw new HttpsError('invalid-argument', `El asistente no puede recibir más de ${MAX_TOOLS} herramientas.`);
  }
  const size = Buffer.byteLength(JSON.stringify({ messages, tools }), 'utf8');
  if (size > MAX_PAYLOAD_BYTES) {
    throw new HttpsError('invalid-argument', 'La consulta es demasiado grande. Probá con una pregunta más corta.');
  }
  return messages.map((message) => {
    const role = ['system', 'user', 'assistant', 'tool'].includes(message?.role) ? message.role : 'user';
    const content = typeof message?.content === 'string' ? message.content.slice(0, MAX_MESSAGE_CHARS) : '';
    return {
      ...message,
      role,
      content,
    };
  });
};

const mapDeepSeekError = (status, payload) => {
  const detail = String(payload?.error?.message || payload?.message || '').slice(0, 300);
  if (status === 401 || status === 403) {
    return new HttpsError('failed-precondition', `La clave de DeepSeek no autoriza la consulta. Revisá el secreto DEEPSEEK_API_KEY.${detail ? ` (${detail})` : ''}`);
  }
  if (status === 429) {
    return new HttpsError('resource-exhausted', `DeepSeek está limitando las consultas en este momento.${detail ? ` (${detail})` : ''}`);
  }
  if (status === 400 || status === 422) {
    return new HttpsError('invalid-argument', `DeepSeek rechazó la consulta.${detail ? ` (${detail})` : ''}`);
  }
  if (status >= 500) {
    return new HttpsError('unavailable', `DeepSeek no está respondiendo bien ahora.${detail ? ` (${detail})` : ''}`);
  }
  return new HttpsError('internal', `No se pudo completar la consulta al asistente.${detail ? ` (${detail})` : ''}`);
};

exports.assistantChat = onCall(
  {
    secrets: [deepseekApiKey],
    cors: true,
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async (request) => {
    try {
      if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Iniciá sesión para usar el asistente.');
      }

    const messages = validatePayload(request.data);
    const tools = Array.isArray(request.data?.tools) ? request.data.tools : [];
    await assertWithinDailyQuota(request.auth.uid);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${deepseekApiKey.value()}`,
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          messages,
          ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
          temperature: 0.3,
          max_tokens: 4096,
          stream: false,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new HttpsError('unavailable', `No se pudo contactar a DeepSeek: ${error?.message || 'error de red'}`);
    } finally {
      clearTimeout(timeout);
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }

    if (!response.ok) {
      console.error('DeepSeek respondió con error', response.status, payload);
      throw mapDeepSeekError(response.status, payload);
    }

    const message = payload?.choices?.[0]?.message;
    if (!message) {
      console.error('DeepSeek devolvió una respuesta sin mensaje', payload);
      throw new HttpsError('internal', 'DeepSeek devolvió una respuesta vacía.');
    }

    return {
      model: payload?.model || DEFAULT_MODEL,
      message: {
        role: message.role || 'assistant',
        content: typeof message.content === 'string' ? message.content : '',
        tool_calls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
      },
      usage: payload?.usage || null,
    };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      console.error('assistantChat falló:', error);
      throw new HttpsError('internal', `Error inesperado del asistente: ${error?.message || 'sin detalle'}`);
    }
  },
);
