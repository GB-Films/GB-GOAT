type Destination = { opener: unknown; closed: boolean; location: { replace: (url: string) => void }; close: () => void };

// The empty tab must be opened synchronously from the user's click, before the request.
export async function openSigningProject(projectId: string, dependencies: {
  openWindow: () => Destination | null;
  request: (input: Record<string, unknown>) => Promise<{ url: string }>;
  isCurrent: () => boolean;
}) {
  const destination = dependencies.openWindow();
  if (destination) destination.opener = null;
  try {
    const result = await dependencies.request({ action: 'connectProject', projectId });
    if (!dependencies.isCurrent()) { destination?.close(); return null; }
    const opened = Boolean(destination && !destination.closed);
    if (opened) destination!.location.replace(result.url);
    return { url: result.url, opened };
  } catch (error) {
    destination?.close();
    throw error;
  }
}
