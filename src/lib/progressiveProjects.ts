import { splitProjectCommercial } from './projectCommercialFields';

// Render operational fields immediately, but never publish legacy commercial
// fields before their separate authorization checks have finished.
export async function publishProgressiveProjects<T extends Record<string, any>>(
  projects: T[],
  readAuthorized: (project: T) => Promise<Record<string, any>>,
  publish: (projects: Record<string, any>[]) => void,
  isCurrent: () => boolean,
  onError: (error: unknown) => void,
) {
  if (!isCurrent()) return;
  const resolved = projects.map(project => splitProjectCommercial(project).publicData);
  publish([...resolved]);
  // Local to this snapshot: no state shared across users or persistent cache.
  await Promise.all(projects.map(async (project, index) => {
    try {
      const authorized = await readAuthorized(project);
      if (isCurrent()) {
        resolved[index] = authorized;
        publish([...resolved]);
      }
    } catch (error) { if (isCurrent()) onError(error); }
  }));
}
