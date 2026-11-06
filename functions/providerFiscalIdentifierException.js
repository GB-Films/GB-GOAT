const digits = value => String(value || '').replace(/\D/g, '');

// Backend-only administrative approval. A request body or a provider-editable
// field must never grant an exception to the normal CUIT validation.
function approvedEin(providerId, provider, actor, exception) {
  if (!exception || exception.version !== 'provider-ein-exception-v1'
    || exception.status !== 'active' || exception.providerId !== providerId
    || exception.type !== 'EIN' || exception.country !== 'US'
    || !/^\d{9}$/.test(exception.value) || provider.type !== 'empresa'
    || exception.value !== digits(provider.cuit)
    || (provider.cuitNormalized && exception.value !== digits(provider.cuitNormalized))
    || exception.accountEmail !== actor.email
    || String(provider.portalAccessEmail || provider.personalGoogleAccount?.email || '').toLowerCase() !== actor.email) return null;
  return { type: 'EIN', country: 'US', value: exception.value, exceptionId: providerId };
}

module.exports = { approvedEin };
