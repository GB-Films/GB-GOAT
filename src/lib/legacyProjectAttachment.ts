export function legacyProjectAttachment(value: string, bucket: string) {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://firebasestorage.googleapis.com') return null;
    const match = /^\/v0\/b\/([^/]+)\/o\/([^/]+)$/.exec(url.pathname);
    if (!match || decodeURIComponent(match[1]) !== bucket) return null;
    const path = decodeURIComponent(match[2]);
    const [namespace, projectId, ...parts] = path.split('/');
    if (namespace !== 'projects' || !/^[\w-]{1,160}$/.test(projectId || '') || parts.length < 3
      || parts.some(part => !part || part === '.' || part === '..' || part.includes('\\'))) return null;
    return { projectId, path };
  } catch {
    return null;
  }
}
