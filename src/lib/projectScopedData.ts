import { providerFinanceRequest } from './providerFinance';
import type { AreaExpense, BudgetItem, CashMovement, Collaborator } from '../pages/project-detail/types';

export function projectAttachmentLink(projectId: string, collectionName: string, itemId: string, kind: string, fileId?: string) {
  return 'goat-file:' + encodeURIComponent(JSON.stringify({ projectId, collectionName, itemId, kind, fileId }));
}

function expenseRevision(updatedAt: unknown) {
  const version = updatedAt as { seconds?: number; nanoseconds?: number } | null | undefined;
  return Number.isInteger(version?.seconds) ? [version?.seconds, version?.nanoseconds || 0] : null;
}

export async function editScopedAreaExpense(projectId: string, itemId: string, updatedAt: unknown, updates: Record<string, unknown>, confirmedPaidEdit = false) {
  return (await providerFinanceRequest({
    action: 'editScopedAreaExpense', projectId, itemId, expectedUpdatedAt: expenseRevision(updatedAt), updates, confirmedPaidEdit,
  }) as { expense: AreaExpense }).expense;
}

export type ScopedProviderOption = { id: string; name: string };

export async function searchScopedExpenseProviders(projectId: string, itemId: string, updatedAt: unknown, query: string) {
  const response = await providerFinanceRequest({
    action: 'searchScopedExpenseProviders', projectId, itemId, expectedUpdatedAt: expenseRevision(updatedAt), query,
  }) as { providers: ScopedProviderOption[] };
  return response.providers;
}

export function assignScopedExpenseProvider(projectId: string, itemId: string, updatedAt: unknown, providerId: string, confirmedPaidEdit = false) {
  return providerFinanceRequest({
    action: 'assignScopedExpenseProvider', projectId, itemId, expectedUpdatedAt: expenseRevision(updatedAt), providerId, confirmedPaidEdit,
  }) as Promise<{ expense: AreaExpense; provider: ScopedProviderOption }>;
}

export function restrictedProviderBinding(providerId: unknown, fullCatalogAccess: boolean, original?: { providerId?: unknown; providerIdentityOnly?: boolean }) {
  return providerId && providerId !== original?.providerId && (!fullCatalogAccess || original?.providerIdentityOnly)
    ? { providerIdentityOnly: true } : {};
}

export type ScopedProjectSnapshot = {
  project: any;
  admin: boolean;
  permissions: Collaborator | null;
  budgetItems: BudgetItem[];
  areaExpenses: AreaExpense[];
  providers: any[];
  documents: any[];
  collaborators: Collaborator[];
};

export async function readProjectAccess(projectId: string) {
  return await providerFinanceRequest({ action: 'projectAccess', projectId }) as { admin: boolean };
}

export async function readProjectSummaries() {
  const result = await providerFinanceRequest({ action: 'projectSummaries' }) as { projects: Array<{ id: string; projectAdmin: boolean; status?: string; [key: string]: any }> };
  return result.projects;
}

export async function readScopedProject(projectId: string, purpose?: 'resumen' | 'proveedores') {
  return await providerFinanceRequest({ action: 'projectScopedSnapshot', projectId, purpose: purpose || '' }) as ScopedProjectSnapshot;
}

export async function readScopedProviders() {
  const result = await providerFinanceRequest({ action: 'scopedProviderCatalog' }) as { providers: any[] };
  return result.providers;
}

export async function readProductionProviderDirectory() {
  const providers: any[] = [];
  let cursor = '';
  do {
    const page = await providerFinanceRequest({ action: 'productionProviderDirectory', cursor }) as { providers: any[]; nextCursor: string };
    providers.push(...page.providers);
    cursor = page.nextCursor;
  } while (cursor);
  return providers;
}

export async function readProductionProviderDetail(providerId: string) {
  const response = await providerFinanceRequest({ action: 'productionProviderDetail', providerId }) as { provider: any };
  return response.provider;
}

export async function readScopedCash(projectId: string) {
  const result = await providerFinanceRequest({ action: 'personalCashMovements', projectId }) as { movements: CashMovement[] };
  return result.movements;
}
