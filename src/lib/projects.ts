export const PROJECT_STATUSES = ['Presupuesto', 'Pre Producción', 'Rodaje', 'Post', 'Aprobado'] as const;

export type ProjectStatus = typeof PROJECT_STATUSES[number];

export const DEFAULT_PROJECT_STATUS: ProjectStatus = 'Presupuesto';

