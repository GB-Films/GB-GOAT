// Keep the cash worker independent of unrelated integrations during cold start.
// Discovery and all existing endpoints retain the complete original export map.
module.exports = process.env.FUNCTION_TARGET === 'createCashSubdelivery'
  ? require('./cashSubdeliveryEntrypoint')
  : require('./index');
