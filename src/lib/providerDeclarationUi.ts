export type PortalDeclaration = {
  id: string; kind: string; status: string; owned: boolean; signedAt?: string;
  content: any;
};
export type DeclarationDocument = {
  id: string; documentId: string; projectId?: string; providerId?: string; portalManaged?: boolean;
  signed: boolean; artifactsReady: boolean;
};

export function declarationDocument(declaration: PortalDeclaration, documents: DeclarationDocument[], providerId: string) {
  return documents.find(doc => doc.portalManaged && doc.documentId === declaration.id && doc.providerId === providerId);
}

export function declarationPresentation(d: PortalDeclaration, providerType: string, doc?: DeclarationDocument) {
  const legacy = d.kind === 'representation' && providerType === 'persona';
  const profile = d.kind === 'profile';
  const title = profile ? d.content.confirmation ? 'Confirmación de tus datos' : 'Actualización de tus datos'
    : d.kind === 'representation' ? 'Representación de empresa' : 'Autorización para que un tercero facture o cobre';
  const statuses: Record<string, string> = {
    pending_signature: 'Falta tu firma', preparing: 'Documento en preparación', pending_review: profile ? 'Firma guardada · falta comprobar aplicación' : 'Firmada · pendiente de revisión',
    applied: 'Aplicada', active: 'Vigente', revoked: 'Revocada', rejected: 'Rechazada',
  };
  const actionable = d.owned && !legacy && ['pending_signature', 'preparing', ...(profile ? ['pending_review'] : [])].includes(d.status);
  const action = !actionable ? null : doc && !doc.signed ? 'sign' : doc?.signed && !doc.artifactsReady ? 'recover' : d.status === 'preparing' ? 'prepare' : d.status === 'pending_review' || doc?.signed ? 'apply' : null;
  return {
    title: legacy ? 'Antecedente del alta anterior' : title,
    status: legacy ? 'Sin acción pendiente' : statuses[d.status] || d.status,
    explanation: legacy ? 'Esta solicitud de representación pertenece al circuito anterior. No necesitás firmarla para actualizar tus datos personales; hacelo desde Mis datos.'
      : profile && d.status === 'applied' ? 'Estos cambios ya se aplicaron con tu firma. Se conserva el documento como constancia.'
      : profile && d.status === 'pending_review' ? 'Es una solicitud del circuito anterior que ya tiene firma. Podés comprobar su aplicación sin aprobación administrativa. Si la ficha cambió desde entonces, revisá tus datos y prepará una nueva declaración.'
      : profile ? 'Al firmar declarás que los datos son verídicos y autorizás su aplicación automática, sin revisión administrativa posterior.'
      : d.kind === 'representation' ? 'Esta declaración acredita tu representación de una empresa; es distinta de una actualización de tus datos personales.'
      : 'La autorización de terceros tiene su propia revisión y no reemplaza tus datos personales.',
    action,
    missingDocument: actionable && !action && !doc,
  };
}

export function declarationCompletionMessage(kind: string, status: string) {
  if (status === 'applied') return 'Firma comprobada. Los datos ya están aplicados.';
  if (status === 'pending_review') return kind === 'profile'
    ? 'La firma quedó guardada, pero la aplicación todavía no se completó. Revisá tus datos antes de volver a intentarlo.'
    : 'Firma comprobada. Esta autorización quedó pendiente de revisión.';
  if (status === 'pending_signature') return 'Todavía falta completar la firma. Abrí el documento para revisar y firmar.';
  if (status === 'active') return 'La autorización ya está vigente.';
  return 'Consulta completada. Revisá el estado actualizado de la declaración.';
}
