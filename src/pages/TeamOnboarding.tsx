import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { auth } from '../lib/firebase';
import { portalRequest } from '../lib/providerPortal';
import { useAuth, USER_INVITE_TOKEN_KEY } from '../context/AuthContext';
import { needsTeamOnboarding, teamReturnPath } from '../lib/teamOnboarding';
import ProviderInvite from './ProviderInvite';
export default function TeamOnboarding() {
  const { user, profile, loading, refreshProfile } = useAuth();
  const [result,setResult] = useState<any>(null), [error,setError] = useState(''), [busy,setBusy] = useState(false);
  const navigate=useNavigate(), location=useLocation();
  async function check() {
    setBusy(true);setError('');
    try {
      const r=await portalRequest({action:'teamBootstrap',inviteToken:window.localStorage.getItem(USER_INVITE_TOKEN_KEY) || ''});
      setResult(r);
      await refreshProfile();
      if (r.status==='ready' || r.status==='legacy') {
        window.localStorage.removeItem(USER_INVITE_TOKEN_KEY);
        navigate(teamReturnPath(location.state?.from),{replace:true});
      }
    } catch(e:any) {setError(e.message || 'No pudimos consultar tu alta. Volvé a intentar.');}
    finally {setBusy(false);}
  }
  useEffect(()=>{if(user && needsTeamOnboarding(profile)) void check();},[user?.uid]);
  if(loading) return <p className="p-8">Consultando tu alta…</p>;
  if(!user) return <Navigate to="/login" replace />;
  if(!needsTeamOnboarding(profile)) return <Navigate to="/proyectos" replace />;
  if(result?.status==='needs_profile') return <ProviderInvite teamOnboarding={{initialForm:result.form,onReview:check,onComplete:async()=>{await refreshProfile();window.localStorage.removeItem(USER_INVITE_TOKEN_KEY);navigate(teamReturnPath(location.state?.from),{replace:true});}}} />;
  return <main className="mx-auto max-w-xl space-y-4 p-8"><h1 className="text-2xl font-bold">Tu alta de equipo</h1>
    <p>{user.email}</p>
    <p>{result?.status==='needs_review' ? 'Administración debe revisar tu ficha o los permisos previos antes de continuar. No creamos otro proveedor ni cambiamos tu asignación.' : 'Estamos verificando tu ficha de proveedor.'}</p>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <button disabled={busy} onClick={()=>void check()} className="rounded-xl bg-blue-600 px-4 py-2 text-white">{busy ? 'Consultando…' : 'Volver a consultar'}</button>
    <a className="block underline" href="#/mi-proveedor">Mi proveedor</a>
    <button className="block underline" onClick={()=>void auth.signOut()}>Cambiar cuenta Google</button>
  </main>;
}
