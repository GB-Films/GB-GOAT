export const PROJECT_WORKFLOW_STATUSES = ['Presupuesto', 'Pre Producción', 'Rodaje', 'Post', 'Aprobado'] as const;
export const ARCHIVED_PROJECT_STATUSES = ['Cerrado', 'Archivado', 'Cancelado', 'Histórico'] as const;
export const PROJECT_STATUSES = [...PROJECT_WORKFLOW_STATUSES, ...ARCHIVED_PROJECT_STATUSES] as const;
export const isArchivedProject = (project: { status?: string }) => (ARCHIVED_PROJECT_STATUSES as readonly string[]).includes(project.status || '');
export type ProjectScope = 'current' | 'historical' | 'all';
export const matchesProjectScope = (project: { status?: string }, scope: ProjectScope) => scope === 'all' || isArchivedProject(project) === (scope === 'historical');

export type ProjectStatus = typeof PROJECT_STATUSES[number];

export const DEFAULT_PROJECT_STATUS: ProjectStatus = 'Presupuesto';

