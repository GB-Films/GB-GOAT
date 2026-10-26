// Keep the cash worker independent of unrelated integrations during cold start.
// Discovery and all existing endpoints retain the complete original export map.
module.exports = ['providerPortal', 'manageProviderPortal'].includes(process.env.FUNCTION_TARGET)
  ? require('./providerPortalEntrypoint')
  : process.env.FUNCTION_TARGET === 'createCashSubdelivery'
  ? require('./cashSubdeliveryEntrypoint')
  : require('./index');

if (!process.env.FUNCTION_TARGET) Object.assign(module.exports, require('./providerPortalEntrypoint'));
