export const GLOBAL_ROLES = ['admin', 'ayudante_admin', 'jefe_produccion', 'colaborador'] as const;
export type GlobalRole = typeof GLOBAL_ROLES[number];

export const ROLE_LABELS: Record<GlobalRole, string> = {
  admin: 'Administrador',
  ayudante_admin: 'Ayudante Admin',
  jefe_produccion: 'Jefe de Produccion',
  colaborador: 'Colaborador',
};

export const PROVIDER_ACCESS_ROLES: readonly GlobalRole[] = ['admin', 'jefe_produccion', 'ayudante_admin'];
export const PROVIDER_CREATE_ROLES: readonly GlobalRole[] = ['admin', 'jefe_produccion', 'ayudante_admin'];
export const PROVIDER_UPDATE_ROLES: readonly GlobalRole[] = ['admin', 'ayudante_admin'];

export const hasGlobalRole = (role: unknown, allowedRoles: readonly GlobalRole[]) => (
  typeof role === 'string' && allowedRoles.includes(role as GlobalRole)
);

export const roleLabel = (role?: string | null) => (
  typeof role === 'string' && GLOBAL_ROLES.includes(role as GlobalRole)
    ? ROLE_LABELS[role as GlobalRole]
    : ROLE_LABELS.colaborador
);

export const roleSearchText = (role?: string | null) => {
  const value = role || 'colaborador';
  return `${value} ${roleLabel(value)}`.toLowerCase();
};
