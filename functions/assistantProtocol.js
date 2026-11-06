function assistantModelConfig(env = process.env) {
  const aliases = { minimal: 'low', medium: 'high', xhigh: 'high', ultra: 'max' };
  const requested = env.DEEPSEEK_REASONING_EFFORT || 'low';
  const effort = aliases[requested] || requested;
  if (!['low', 'high', 'max'].includes(effort)) throw Error('DEEPSEEK_REASONING_EFFORT debe ser low, high o max.');
  return { model: env.DEEPSEEK_MODEL || 'deepseek-flash', effort };
}
function assistantRequestBody(messages, tools, config) {
  return { model: config.model, messages, thinking: { type: 'enabled' }, reasoning_effort: config.effort,
    ...(tools.length ? { tools, tool_choice: 'auto' } : {}), max_tokens: 8192, stream: false };
}
function assistantResponseMessage(message) {
  return { role: message.role || 'assistant', content: typeof message.content === 'string' ? message.content : '',
    tool_calls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
    ...(typeof message.reasoning_content === 'string' ? { reasoning_content: message.reasoning_content } : {}) };
}
module.exports = { assistantModelConfig, assistantRequestBody, assistantResponseMessage };
