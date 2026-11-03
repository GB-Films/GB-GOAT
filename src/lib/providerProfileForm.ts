export function outdatedProfileDeclaration(declaration: any, provider: Record<string, unknown>) {
  return declaration.kind === 'profile' && declaration.status === 'pending_review'
    && Object.entries(declaration.content?.changes || {}).some(([field, change]: [string, any]) =>
      String(provider[field] ?? '') !== String((declaration.commonApplied || []).includes(field) ? change.after : change.before ?? ''));
}
export function profileDeclarationSuperseded(declaration: any, declarations: any[]) {
  return declarations.some(d => d.kind === 'profile' && d.status === 'applied' && d.owned
    && (Date.parse(d.signedAt) || 0) > (Date.parse(declaration.signedAt) || 0));
}
export function pendingProfileFields(declarations: any[]) {
  const result: Record<string, { after: string; declarationId: string }> = {};
  for (const declaration of [...declarations].filter(d => d.kind === 'profile' && d.owned && d.status === 'pending_review')
    .sort((a, b) => (Date.parse(a.signedAt) || 0) - (Date.parse(b.signedAt) || 0))) {
    for (const [field, change] of Object.entries(declaration.content?.changes || {}) as [string, any][]) {
      if (change.critical && typeof change.after === 'string') result[field] = { after: change.after, declarationId: declaration.id };
    }
  }
  return result;
}
export function proposedProfileValue(field: string, draft: Record<string, string>, provider: any, pending: ReturnType<typeof pendingProfileFields>) {
  return draft[field] ?? pending[field]?.after ?? provider[field] ?? '';
}
