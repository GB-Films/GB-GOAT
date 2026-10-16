import { isGeneralCashMovement } from './cashBoxes';
import { normalizeEmail } from './identity';
import type { Collaborator } from '../pages/project-detail/types';

// Historical custodians remain in the ledger even after leaving the team.
// This is a display list, never a list of recipients authorized for new funds.
export function cashLedgerPeople(responsibles: Collaborator[], movements: any[]): Array<Collaborator & { historicalOnly?: boolean }> {
  const people = new Map<string, Collaborator & { historicalOnly?: boolean }>(responsibles.map(person => [normalizeEmail(person.email), person]));
  const add = (emailValue: unknown, name: string) => {
    const email = normalizeEmail(String(emailValue || ''));
    if (!email || people.has(email)) return;
    people.set(email, { email, displayName: name || email, role: 'jefe_area', allowedTabs: [], allowedCategories: [], historicalOnly: true });
  };
  for (const movement of movements) {
    if (movement.type === 'entrega') add(movement.toUserEmail, movement.toUserName);
    else if (movement.type === 'devolucion') add(movement.fromUserEmail, movement.fromUserName);
    else if (!isGeneralCashMovement(movement)) {
      add(movement.fromUserEmail, movement.fromUserName);
      add(movement.toUserEmail, movement.toUserName);
    }
  }
  return [...people.values()].sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email, 'es'));
}
