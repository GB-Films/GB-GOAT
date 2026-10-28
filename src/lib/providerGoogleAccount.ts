import { deleteApp, initializeApp } from 'firebase/app';
import { browserPopupRedirectResolver, GoogleAuthProvider, initializeAuth, inMemoryPersistence, signInWithPopup, signOut } from 'firebase/auth';
import { auth } from './firebase';
import { portalRequest } from './providerPortal';
import { normalizeEmail } from './identity';

export type AccountVerification = { verificationId: string; email: string };
export async function switchProviderGoogleAccount() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try { await signInWithPopup(auth, provider); }
  catch (error: any) {
    if (['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(error?.code)) throw Error('No se cambió la cuenta. Podés volver a intentarlo.');
    if (error?.code === 'auth/popup-blocked') throw Error('Permití la ventana de Google en tu navegador y volvé a intentar.');
    throw Error('No pudimos ingresar con esa cuenta Google. Volvé a intentarlo.');
  }
}
export async function verifyProviderGoogleAccount(providerId: string, expectedEmail: string): Promise<AccountVerification> {
  const currentUid = auth.currentUser?.uid;
  if (!currentUid) throw Error('Ingresá con Google antes de verificar otra cuenta.');
  const app = initializeApp(auth.app.options, `provider-account-check-${crypto.randomUUID()}`);
  const secondary = initializeAuth(app, { persistence: inMemoryPersistence, popupRedirectResolver: browserPopupRedirectResolver });
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account', login_hint: expectedEmail });
  try {
    const result = await signInWithPopup(secondary, provider);
    if (normalizeEmail(result.user.email) !== normalizeEmail(expectedEmail)) throw Error('Elegiste otra cuenta en Google. Seleccioná el correo que querés usar en esta ficha.');
    if (auth.currentUser?.uid !== currentUid) throw Error('Cambió tu sesión de GOAT. Volvé a ingresar antes de continuar.');
    return await portalRequest({ action: 'verifyAccount', providerId, expectedEmail, idToken: await result.user.getIdToken(true) });
  } catch (error: any) {
    const messages: Record<string, string> = {
      'auth/popup-closed-by-user': 'Verificación cancelada. Tu cuenta actual sigue abierta.',
      'auth/cancelled-popup-request': 'Ya hay una ventana de Google abierta. Completala o cerrala para volver a intentar.',
      'auth/popup-blocked': 'Permití la ventana de Google en tu navegador y volvé a verificar.',
    };
    throw Error(messages[error?.code] || error?.message || 'No pudimos verificar esa cuenta con Google.');
  } finally {
    await signOut(secondary).catch(() => {});
    await deleteApp(app).catch(() => {});
  }
}
