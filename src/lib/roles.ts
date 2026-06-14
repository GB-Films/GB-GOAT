export const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  ayudante_admin: 'Ayudante Admin',
  jefe_produccion: 'Jefe de Produccion',
  colaborador: 'Colaborador',
};

export const PROVIDER_ACCESS_ROLES = ['admin', 'jefe_produccion', 'ayudante_admin'];
export const PROVIDER_CREATE_ROLES = ['admin', 'jefe_produccion', 'ayudante_admin'];
export const PROVIDER_UPDATE_ROLES = ['admin', 'ayudante_admin'];

export const roleLabel = (role?: string | null) => ROLE_LABELS[role || ''] || ROLE_LABELS.colaborador;

export const roleSearchText = (role?: string | null) => {
  const value = role || 'colaborador';
  return `${value} ${roleLabel(value)}`.toLowerCase();
};
