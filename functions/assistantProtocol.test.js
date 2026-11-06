const test = require('node:test'), assert = require('node:assert/strict');
const { assistantModelConfig, assistantRequestBody, assistantResponseMessage } = require('./assistantProtocol');
test('GOAT defaults to the current Flash alias at low effort, preserving explicit operator configuration', () => {
  assert.deepEqual(assistantModelConfig({}), { model: 'deepseek-flash', effort: 'low' });
  assert.deepEqual(assistantModelConfig({ DEEPSEEK_MODEL: 'deepseek-v4-pro', DEEPSEEK_REASONING_EFFORT: 'medium' }), { model: 'deepseek-v4-pro', effort: 'high' });
  assert.throws(() => assistantModelConfig({ DEEPSEEK_REASONING_EFFORT: 'unknown' }));
});
test('thinking/tool request preserves protocol state and gives batch tool arguments room to finish', () => {
  const messages = [{ role: 'assistant', content: '', reasoning_content: 'protocol-state', tool_calls: [{ id: 'a' }] }];
  const tools = [{ type: 'function', function: { name: 'programar_fechas_pago' } }];
  const body = assistantRequestBody(messages, tools, assistantModelConfig({}));
  assert.equal(body.reasoning_effort, 'low'); assert.deepEqual(body.thinking, { type: 'enabled' });
  assert.equal(body.tool_choice, 'auto'); assert.equal(body.temperature, undefined); assert.equal(body.max_tokens, 8192);
  assert.equal(body.messages[0].reasoning_content, 'protocol-state');
  assert.equal(assistantResponseMessage(messages[0]).reasoning_content, 'protocol-state');
  assert.equal(assistantResponseMessage({ content: 'Listo', reasoning_content: null }).reasoning_content, undefined);
});
