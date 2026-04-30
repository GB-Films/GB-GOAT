import { useEffect, useState } from 'react';
import { getRedirectResult, signInWithPopup, signInWithRedirect } from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { motion } from 'motion/react';

export default function Login() {
  const { user, loading } = useAuth();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [loginError, setLoginError] = useState('');

  useEffect(() => {
    getRedirectResult(auth).catch((error) => {
      console.error('Error completing Google sign in:', error);
      setLoginError('No pudimos completar el inicio con Google. Probá de nuevo.');
    });
  }, []);

  if (user) {
    return <Navigate to="/" replace />;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="w-10 h-10 border-4 border-black border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const handleLogin = async () => {
    setIsSigningIn(true);
    setLoginError('');

    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      console.error('Error signing in:', error);

      if (error?.code === 'auth/popup-blocked' || error?.code === 'auth/cancelled-popup-request') {
        await signInWithRedirect(auth, googleProvider);
        return;
      }

      setLoginError('No pudimos iniciar sesión con Google. Revisá que el popup no esté bloqueado y probá de nuevo.');
      setIsSigningIn(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white p-8 rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100"
      >
        <div className="flex flex-col items-center text-center mb-8">
          <img
            src="/gb-films-logo.png"
            alt="GB Films"
            className="w-28 h-auto object-contain mb-6"
          />
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">GB GOAT</h1>
          <p className="text-slate-500 mt-2">Gestión profesional para productoras audiovisuales</p>
        </div>

        <div className="space-y-4">
          <button
            onClick={handleLogin}
            disabled={isSigningIn}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white border border-slate-200 rounded-xl font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all active:scale-[0.98]"
          >
            <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
            {isSigningIn ? 'Conectando...' : 'Continuar con Google'}
          </button>
        </div>

        {loginError && (
          <p className="mt-4 text-center text-xs font-medium text-red-500">
            {loginError}
          </p>
        )}

        <p className="mt-8 text-center text-xs text-slate-400">
          Usa tu cuenta corporativa para acceder a tus proyectos
        </p>
      </motion.div>
    </div>
  );
}
