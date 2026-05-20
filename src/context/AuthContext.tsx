import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, runTransaction, serverTimestamp, updateDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

interface AuthContextType {
  user: User | null;
  profile: any | null;
  loading: boolean;
  authError: string;
  isOwner: boolean;
  isAdmin: boolean;
}

export const APP_OWNER_EMAIL = 'info@granbertafilms.com';
export const USER_INVITE_TOKEN_KEY = 'gb_goat_invite_token';

const normalizeEmail = (email?: string | null) => (email || '').trim().toLowerCase();

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  authError: '',
  isOwner: false,
  isAdmin: false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  const clearInviteToken = () => {
    window.localStorage.removeItem(USER_INVITE_TOKEN_KEY);
  };

  const rejectLogin = async (message: string) => {
    setAuthError(message);
    setProfile(null);
    setUser(null);
    await signOut(auth);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);
      setUser(firebaseUser);

      try {
        if (!firebaseUser) {
          setProfile(null);
          setLoading(false);
          return;
        }

        setAuthError('');

        const normalizedEmail = normalizeEmail(firebaseUser.email);
        const userRef = doc(db, 'users', firebaseUser.uid);
        const userDoc = await getDoc(userRef);

        if (userDoc.exists()) {
          const data = userDoc.data();

          if (normalizedEmail === APP_OWNER_EMAIL && data.role !== 'admin') {
            await updateDoc(userRef, { role: 'admin' });
            data.role = 'admin';
          }

          if (!data.role) data.role = 'colaborador';
          setProfile(data);
          clearInviteToken();
          setLoading(false);
          return;
        }

        const inviteToken = window.localStorage.getItem(USER_INVITE_TOKEN_KEY) || '';
        const role = normalizedEmail === APP_OWNER_EMAIL ? 'admin' : 'colaborador';
        const newProfile = {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName,
          photoURL: firebaseUser.photoURL,
          role,
          ...(inviteToken ? { inviteToken } : {}),
          createdAt: serverTimestamp(),
        };

        if (normalizedEmail !== APP_OWNER_EMAIL) {
          if (!inviteToken) {
            await rejectLogin('Tu email no tiene una invitación activa para ingresar a GB GOAT.');
            setLoading(false);
            return;
          }

          await runTransaction(db, async (transaction) => {
            const inviteRef = doc(db, 'userInvites', inviteToken);
            const inviteSnap = await transaction.get(inviteRef);

            if (!inviteSnap.exists()) throw new Error('INVITE_NOT_FOUND');

            const invite = inviteSnap.data();
            if (invite.status !== 'pending' || invite.used === true) throw new Error('INVITE_USED');
            if (normalizeEmail(invite.email) !== normalizedEmail) throw new Error('INVITE_EMAIL_MISMATCH');

            transaction.set(userRef, newProfile);
            transaction.update(inviteRef, {
              status: 'used',
              used: true,
              usedAt: serverTimestamp(),
              usedBy: firebaseUser.uid,
              usedByEmail: normalizedEmail,
            });
          });
        } else {
          await runTransaction(db, async (transaction) => {
            transaction.set(userRef, newProfile);
          });
        }

        clearInviteToken();
        setProfile({ ...newProfile, createdAt: new Date().toISOString() });
      } catch (error) {
        console.error('Error loading user profile:', error);

        if (firebaseUser) {
          const messageByCode: Record<string, string> = {
            INVITE_NOT_FOUND: 'Este link de invitación no existe o fue eliminado.',
            INVITE_USED: 'Este link de invitación ya fue usado. Pedí uno nuevo.',
            INVITE_EMAIL_MISMATCH: 'Este link fue creado para otro email. Iniciá sesión con la cuenta invitada.',
          };

          await rejectLogin(messageByCode[(error as Error)?.message] || 'No pudimos validar tu invitación. Pedí un nuevo link de acceso.');
        }
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  const isOwner = normalizeEmail(profile?.email) === APP_OWNER_EMAIL;
  const isAdmin = profile?.role === 'admin';

  return (
    <AuthContext.Provider value={{ user, profile, loading, authError, isOwner, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
