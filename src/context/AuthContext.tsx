import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

interface AuthContextType {
  user: User | null;
  profile: any | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({ user: null, profile: null, loading: true });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      if (user) {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          // Ensure specific emails are always admin
          const normalizedEmail = user.email?.toLowerCase();
          const adminEmails = ['tgboetsch@gmail.com', 'tomas@granberta.com'];
          if (adminEmails.includes(normalizedEmail || '') && data.role !== 'admin') {
            await updateDoc(doc(db, 'users', user.uid), { role: 'admin' });
            data.role = 'admin';
          }
          setProfile(data);
        } else {
          // Create default profile for new user
          // If it matches specific email, make admin
          const normalizedEmail = user.email?.toLowerCase();
          const adminEmails = ['tgboetsch@gmail.com', 'tomas@granberta.com'];
          const role = adminEmails.includes(normalizedEmail || '') ? 'admin' : 'colaborador';
          const newProfile = {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            role: role,
            createdAt: new Date().toISOString()
          };
          await setDoc(doc(db, 'users', user.uid), newProfile);
          setProfile(newProfile);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
