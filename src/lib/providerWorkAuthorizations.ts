export type ProviderWorkScope = { projectId: string; collectionName: string; itemId: string; providerId: string };
export type WorkAuthorization = {
  id: string; status: string; valid: boolean; effectiveRoles: string[]; canDownload?: boolean; signedByEmail?: string; signedAt?: string;
  content: { validity?: string; expiresOn?: string; workKeys?: string[]; party: Record<string, string> };
};
export const isCurrentPayoutAuthorization = (a: WorkAuthorization) => a.valid && a.effectiveRoles.includes('invoice') && a.effectiveRoles.includes('payment');
export const authorizationWorkNames = (a: WorkAuthorization, lines: any[]) => lines.filter(line =>
  a.content.workKeys?.includes(`${line.projectId}/${line.collectionName}/${line.expenseId}`))
  .map(line => `${line.projectName} · ${line.description}`);
