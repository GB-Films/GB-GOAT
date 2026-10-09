export const withDashboardTimeout = async <T>(request: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('DASHBOARD_LOAD_TIMEOUT')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

// Project visibility must not depend on every financial subcollection responding.
export async function loadDashboardData<T, F>(options: {
  loadProjects: () => Promise<T[]>;
  loadFinance: (project: T) => Promise<F>;
  onProjects: (projects: T[]) => void;
  onFinance: (project: T, finance: F) => void;
  onFinanceError: (project: T, error: unknown) => void;
  timeoutMs?: number;
}) {
  const timeoutMs = options.timeoutMs ?? 15000;
  const projects = await withDashboardTimeout(options.loadProjects(), timeoutMs);
  options.onProjects(projects);
  await Promise.all(projects.map(async (project) => {
    try {
      const finance = await withDashboardTimeout(options.loadFinance(project), timeoutMs);
      options.onFinance(project, finance);
    } catch (error) {
      options.onFinanceError(project, error);
    }
  }));
}
