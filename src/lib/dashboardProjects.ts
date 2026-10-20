import { collection, or, query, where, type Firestore } from 'firebase/firestore';
import { normalizeEmail } from './identity';

export function dashboardProjectsQuery(db: Firestore, scope: { uid: string; email: string; isAdmin: boolean }) {
  const projects = collection(db, 'projects');
  // Firestore orderBy excludes documents without that field. Legacy projects
  // remain visible; sorting happens locally after the authorized query.
  return scope.isAdmin ? query(projects) : query(projects, or(
    where('createdBy', '==', scope.uid),
    where('collaboratorEmails', 'array-contains', normalizeEmail(scope.email)),
  ));
}

export function sortDashboardProjects<T extends { id: string; name?: string; createdAt?: any }>(projects: T[]): T[] {
  const time = (value: any) => {
    const timestamp = typeof value?.toMillis === 'function' ? value.toMillis() :
      typeof value?.toDate === 'function' ? value.toDate().getTime() : new Date(value || 0).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  };
  return [...projects].sort((a, b) => time(b.createdAt) - time(a.createdAt) ||
    String(a.name || '').localeCompare(String(b.name || ''), 'es') || a.id.localeCompare(b.id));
}
