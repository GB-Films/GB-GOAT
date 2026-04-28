import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

interface AuthContextType {
  user: User | null;
  profile: any | null;
  loading: boolean;
  isOwner: boolean;
  isAdmin: boolean;
}

export const APP_OWNER_EMAIL = 'info@granbertafilms.com';

const normalizeEmail = (email?: string | null) => (email || '').trim().toLowerCase();

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  isOwner: false,
  isAdmin: false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setLoading(true);
      setUser(user);
      try {
        if (user) {
          const normalizedEmail = normalizeEmail(user.email);
          const userRef = doc(db, 'users', user.uid);
          const userDoc = await getDoc(userRef);

          if (userDoc.exists()) {
            const data = userDoc.data();

            // El dueño de la app siempre queda como admin.
            // El resto conserva el rol guardado en Firestore.
            if (normalizedEmail === APP_OWNER_EMAIL && data.role !== 'admin') {
              await updateDoc(userRef, { role: 'admin' });
              data.role = 'admin';
            }

            if (!data.role) data.role = 'colaborador';
            setProfile(data);
          } else {
            // Todo usuario nuevo empieza como colaborador, salvo el dueño.
            const role = normalizedEmail === APP_OWNER_EMAIL ? 'admin' : 'colaborador';
            const newProfile = {
              uid: user.uid,
              email: user.email,
              displayName: user.displayName,
              photoURL: user.photoURL,
              role,
              createdAt: new Date().toISOString(),
            };
            await setDoc(userRef, newProfile);
            setProfile(newProfile);
          }
        } else {
          setProfile(null);
        }
      } catch (error) {
        console.error('Error loading user profile:', error);
        if (user) {
          const normalizedEmail = normalizeEmail(user.email);
          const role = normalizedEmail === APP_OWNER_EMAIL ? 'admin' : 'colaborador';
          setProfile({
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            role,
            createdAt: new Date().toISOString(),
          });
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
    <AuthContext.Provider value={{ user, profile, loading, isOwner, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
