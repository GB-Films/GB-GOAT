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
