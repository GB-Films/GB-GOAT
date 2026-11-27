import { useEffect, useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';
import { Navigate, useLocation } from 'react-router-dom';
import { USER_INVITE_TOKEN_KEY, useAuth } from '../context/AuthContext';
import { portalRequest } from '../lib/providerPortal';
import { needsTeamOnboarding } from '../lib/teamOnboarding';
import { GoatEntryScreen } from '../components/GoatEntryScreen';

export default function Login() {
  const { user, profile, loading, authError, refreshProfile } = useAuth();
  const location = useLocation();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [hasInviteLink, setHasInviteLink] = useState(false);
  const [acceptingInvite,setAcceptingInvite] = useState(false);

  useEffect(() => {
    const inviteToken = new URLSearchParams(location.search).get('invite');
    if (inviteToken) {
      window.localStorage.setItem(USER_INVITE_TOKEN_KEY, inviteToken);
      setHasInviteLink(true);
    } else {
      setHasInviteLink(!!window.localStorage.getItem(USER_INVITE_TOKEN_KEY));
    }
  }, [location.search]);
  const inviteToken = new URLSearchParams(location.search).get('invite');
  useEffect(()=>{
    if(!user || profile?.role!=='portal' || !inviteToken) return;
    let cancelled=false;setAcceptingInvite(true);
    portalRequest({action:'teamBootstrap',inviteToken}).then(()=>refreshProfile()).catch(e=>setLoginError(e.message)).finally(()=>{if(!cancelled)setAcceptingInvite(false);});
    return ()=>{cancelled=true;};
  },[user?.uid,profile?.role,inviteToken]);

  useEffect(() => {
    if (authError) {
      setLoginError(authError);
      setIsSigningIn(false);
    }
  }, [authError]);

  if (user && profile && !(profile.role==='portal' && inviteToken)) {
    return <Navigate to={needsTeamOnboarding(profile) ? '/alta-equipo' : profile.role === 'portal' || profile.role === 'unverified' ? '/mi-proveedor' : '/'} replace />;
  }

  if (loading || acceptingInvite) {
    return <GoatEntryScreen status="Comprobando el acceso…" />;
  }

  const handleLogin = async () => {
    setIsSigningIn(true);
    setLoginError('');

    try {
      await Promise.race([
        signInWithPopup(auth, googleProvider),
        new Promise((_, reject) => {
          window.setTimeout(() => reject(new Error('AUTH_POPUP_TIMEOUT')), 45000);
        }),
      ]);
    } catch (error: any) {
      console.error('Error signing in:', error);
      const errorCode = error?.code || error?.message;
      const errorMessages: Record<string, string> = {
        'auth/popup-blocked': 'El navegador bloqueó la ventana de Google. Habilitá las ventanas emergentes y probá de nuevo.',
        'auth/popup-closed-by-user': 'Se cerró la ventana de Google antes de completar el ingreso.',
        'auth/cancelled-popup-request': 'Ya hay un inicio de sesión en curso. Cerralo y probá de nuevo.',
        'auth/operation-not-supported-in-this-environment': 'Abrí GB GOAT directamente en Chrome o Safari para iniciar sesión.',
        'auth/web-storage-unsupported': 'El navegador no permite guardar la sesión. Abrí GB GOAT en Chrome o Safari fuera del modo privado.',
        'auth/account-exists-with-different-credential': 'No pudimos usar esta cuenta Google. Contactá a administración para revisar su acceso.',
        'auth/operation-not-allowed': 'Este método todavía no está habilitado. Usá el método disponible o contactá a administración.',
        AUTH_POPUP_TIMEOUT: 'La ventana de Google no respondió. Cerrala, verificá que los popups estén permitidos y probá de nuevo.',
      };
      setLoginError(errorMessages[errorCode] || 'No pudimos iniciar sesión con Google. Abrí GB GOAT en Chrome o Safari y probá de nuevo.');
      setIsSigningIn(false);
    }
  };

  return <GoatEntryScreen login={{ onClick: handleLogin, busy: isSigningIn }}
    status={hasInviteLink ? 'Ingresá con el correo que recibió la invitación de equipo.' : undefined}
    alert={loginError} />;
}
