import { collection, getDocsFromServer, onSnapshot, query, where, type Firestore } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { canAccessGeneralCash } from './generalCashAccess';

type PersonalReader = (projectId: string) => Promise<any[]>;

export function personalCashRefreshQueries(db: Firestore, projectId: string, email: string) {
  const ledger = collection(db, 'projects', projectId, 'cashMovements');
  const actor = email.trim().toLowerCase();
  return [
    ...['pago', 'reintegro', 'transferencia'].flatMap(type => ['fromUserEmail', 'toUserEmail'].map(field =>
      query(ledger, where('type', '==', type), where('cashAccount', '==', 'personal'), where(field, '==', actor)))),
    query(ledger, where('type', '==', 'entrega'), where('toUserEmail', '==', actor)),
    query(ledger, where('type', '==', 'devolucion'), where('fromUserEmail', '==', actor)),
  ];
}

export async function readProjectCashMovements(db: Firestore, projectId: string, email: string, personalReader?: PersonalReader) {
  if (!email.trim()) throw new Error('Falta la cuenta para consultar la caja.');
  if (canAccessGeneralCash(email)) {
    const snapshot = await getDocsFromServer(collection(db, 'projects', projectId, 'cashMovements'));
    return snapshot.docs.map(row => ({ ...row.data(), id: row.id }));
  }
  // A server-side, identity-bound read preserves legacy personal payments while
  // withholding General cash rows, including ones authored by this account.
  if (personalReader) return personalReader(projectId);
  const result = await httpsCallable<{ action: string; projectId: string }, { movements: any[] }>(getFunctions(db.app), 'manageProviderFinance', { timeout: 30000 })({ action: 'personalCashMovements', projectId });
  return result.data.movements;
}

export function watchProjectCashMovements(db: Firestore, projectId: string, email: string,
  onRows: (rows: any[]) => void, onError: (error: Error) => void) {
  if (canAccessGeneralCash(email)) return onSnapshot(collection(db, 'projects', projectId, 'cashMovements'), snapshot => {
    onRows(snapshot.docs.map(row => ({ ...row.data(), id: row.id })));
  }, onError);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  let refreshing = false;
  let repeat = false;
  const refresh = async () => {
    if (stopped) return;
    if (refreshing) { repeat = true; return; }
    refreshing = true;
    clearTimeout(timer);
    try {
      const rows = await readProjectCashMovements(db, projectId, email);
      if (!stopped) {
        onRows(rows);
        // Current movements refresh from the listeners below; the fallback also
        // catches updates to historical rows with no cashAccount field.
        timer = setTimeout(refresh, 60000);
      }
    } catch (error) { if (!stopped) onError(error as Error); }
    finally {
      refreshing = false;
      if (repeat && !stopped) { repeat = false; void refresh(); }
    }
  };
  const stops = personalCashRefreshQueries(db, projectId, email).map(q => onSnapshot(q, () => {
    clearTimeout(scheduled);
    scheduled = setTimeout(refresh, 50);
  }, error => { if (!stopped) onError(error); }));
  void refresh();
  return () => { stopped = true; clearTimeout(timer); clearTimeout(scheduled); stops.forEach(stop => stop()); };
}
