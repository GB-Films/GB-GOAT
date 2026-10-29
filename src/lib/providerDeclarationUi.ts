export type PortalDeclaration = {
  id: string; kind: string; status: string; owned: boolean; signedAt?: string;
  content: any;
};
export type DeclarationDocument = {
  id: string; documentId: string; projectId?: string; providerId?: string; portalManaged?: boolean;
  signed: boolean; artifactsReady: boolean;
};

export function portalDeclarationCompletionInput(doc: { portalManaged?: boolean; providerId?: string; documentId?: string; declarationKind?: string } | null) {
  if (!doc?.portalManaged || !doc.providerId || !doc.documentId || !['profile', 'representation', 'third_party'].includes(doc.declarationKind || '')) return null;
  return { action: 'completeDeclaration', providerId: doc.providerId, declarationId: doc.documentId };
}

export function declarationDocument(declaration: PortalDeclaration, documents: DeclarationDocument[], providerId: string) {
  return documents.find(doc => doc.portalManaged && doc.documentId === declaration.id && doc.providerId === providerId);
}

export function declarationPresentation(d: PortalDeclaration, providerType: string, doc?: DeclarationDocument) {
  const legacy = d.kind === 'representation' && providerType === 'persona';
  const profile = d.kind === 'profile';
  const declaredCompany = d.kind === 'representation' && d.content.version === 'company-representation-v4';
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
    status: legacy ? 'Sin acción pendiente' : declaredCompany && d.status === 'applied' ? 'Representación declarada · habilitada' : statuses[d.status] || d.status,
    explanation: legacy ? 'Esta solicitud de representación pertenece al circuito anterior. No necesitás firmarla para actualizar tus datos personales; hacelo desde Mis datos.'
      : profile && d.status === 'applied' ? 'Estos cambios ya se aplicaron con tu firma. Se conserva el documento como constancia.'
      : profile && d.status === 'pending_review' ? 'Es una solicitud del circuito anterior que ya tiene firma. Podés comprobar su aplicación sin aprobación administrativa. Si la ficha cambió desde entonces, revisá tus datos y prepará una nueva declaración.'
      : profile ? 'Al firmar declarás que los datos son verídicos y autorizás su aplicación automática, sin revisión administrativa posterior.'
      : declaredCompany ? 'Declarás bajo tu responsabilidad que tenés facultades para representar a la empresa y firmar en su nombre. Al completar tu firma se habilita la representación; adjuntar el poder es opcional.'
      : d.kind === 'representation' ? 'Presentación del circuito anterior de representación empresarial. Podés completar la nueva declaración desde Mis datos; el poder es opcional y no requiere esperar una revisión.'
      : 'La autorización de terceros tiene su propia revisión y no reemplaza tus datos personales.',
    action,
    missingDocument: actionable && !action && !doc,
  };
}

export function declarationCompletionMessage(kind: string, status: string) {
  if (status === 'applied') return kind === 'representation' ? 'Firma comprobada. Tu representación quedó habilitada. Los contratos asignados aparecen en Documentos.' : 'Firma comprobada. Los datos ya están aplicados.';
  if (status === 'pending_review') return kind === 'profile'
    ? 'La firma quedó guardada, pero la aplicación todavía no se completó. Revisá tus datos antes de volver a intentarlo.'
    : 'Firma comprobada. Esta autorización quedó pendiente de revisión.';
  if (status === 'pending_signature') return 'Todavía falta completar la firma. Abrí el documento para revisar y firmar.';
  if (status === 'active') return 'La autorización ya está vigente.';
  return 'Consulta completada. Revisá el estado actualizado de la declaración.';
}
