import { GoogleAuthProvider, reauthenticateWithPopup, type User } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { auth } from './firebase';

export type SyncResolution = { mode: 'new' | 'direct' | 'included' | 'exclude' | 'void'; serviceIds?: string[]; reason?: string; projectId?: string; providerId?: string; serviceDate?: string };
export type SyncSummary = { create: number; update: number; void: number; pending: number; same: number; included: number; paymentsPending: number };
export type SyncResult = { runId: string; at: string; status: 'partial' | 'verified'; sourceChanged?: boolean; summary: SyncSummary };
export type SyncPreview = {
  runId: string; recover?: boolean; summary: SyncSummary; config: { projectId: string; serviceDate: string; serviceDateMode?: 'project' | 'manual' }; lastRun: SyncResult | null;
  resolutions?: Record<string, SyncResolution>;
  items: Array<{ key: string; name: string; provider?: string; amount: number; currency?: string; ctAmount?: number | null; status: string; message: string; canVoid?: boolean; paymentCount?: number; documents?: number }>;
  projects: Array<{ id: string; unit: string }>;
  providers: Array<{ id: string; name: string }>;
  services: Array<{ id: string; projectId: string; name: string; provider: string; amount: number }>;
};

export const canSyncControlTotal = (email?: string | null, isAdmin = false) => isAdmin && !!email;

// Only memory, scoped to a Firebase UID and short expiry. Never localStorage, Firestore, logs or exports.
let grant: { uid: string; token: string; expiresAt: number } | null = null;
export async function authorizeControlTotal(user: User): Promise<string> {
  if (grant?.uid === user.uid && grant.expiresAt > Date.now()) return grant.token;
  const provider = new GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/spreadsheets');
  provider.setCustomParameters({ login_hint: user.email || '', prompt: 'select_account' });
  try {
    const result = await reauthenticateWithPopup(user, provider);
    const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
    if (!token) throw Error('Google no entregó acceso a CT.');
    grant = { uid: user.uid, token, expiresAt: Date.now() + 45 * 60000 };
    return token;
  } catch (error) {
    grant = null;
    const code = (error as { code?: string }).code;
    if (code === 'auth/popup-blocked') throw Error('Permití la ventana de Google para conectar CT.');
    if (code === 'auth/popup-closed-by-user') throw Error('Se canceló el permiso de Google. Podés reintentar.');
    throw error;
  }
}

const call = httpsCallable(getFunctions(auth.app, 'us-central1'), 'updateProjectControlTotal', { timeout: 130000 });
export async function controlTotalRequest<T>(data: Record<string, unknown>): Promise<T> {
  try { return (await call(data)).data as T; }
  catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'functions/unauthenticated' || code === 'functions/permission-denied') grant = null;
    if (code === 'functions/not-found') throw Error('La conexión con CT todavía no está publicada.');
    throw error;
  }
}
