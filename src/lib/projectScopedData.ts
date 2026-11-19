import { providerFinanceRequest } from './providerFinance';
import type { AreaExpense, BudgetItem, CashMovement, Collaborator } from '../pages/project-detail/types';

export function projectAttachmentLink(projectId: string, collectionName: string, itemId: string, kind: string, fileId?: string) {
  return 'goat-file:' + encodeURIComponent(JSON.stringify({ projectId, collectionName, itemId, kind, fileId }));
}

export async function editScopedAreaExpense(projectId: string, itemId: string, updatedAt: unknown, updates: Record<string, unknown>) {
  const version = updatedAt as { seconds?: number; nanoseconds?: number } | null | undefined;
  const expectedUpdatedAt = Number.isInteger(version?.seconds) ? [version?.seconds, version?.nanoseconds || 0] : null;
  return (await providerFinanceRequest({ action: 'editScopedAreaExpense', projectId, itemId, expectedUpdatedAt, updates }) as { expense: AreaExpense }).expense;
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

export async function readScopedCash(projectId: string) {
  const result = await providerFinanceRequest({ action: 'personalCashMovements', projectId }) as { movements: CashMovement[] };
  return result.movements;
}
