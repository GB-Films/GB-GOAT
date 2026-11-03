import { useEffect, useState } from 'react';
import { portalRequest } from '../lib/providerPortal';
import { hasProviderRegistration, type RegistrationEvidence } from '../lib/providerRegistration';

const emptyIds: ReadonlySet<string> = new Set();
const waiting: RegistrationEvidence = {status:'loading',registeredIds:emptyIds};
const ready: RegistrationEvidence = {status:'ready',registeredIds:emptyIds};

export function useProviderRegistrationEvidence(providers: any[], scope: string, userId?: string): RegistrationEvidence {
  const idsKey = JSON.stringify(providers.filter(p => !hasProviderRegistration(p)).map(p => p.id).sort());
  const [revision, setRevision] = useState(0);
  useEffect(() => { const reload = () => setRevision(value => value + 1); window.addEventListener('provider-administration-changed', reload); return () => window.removeEventListener('provider-administration-changed', reload); }, []);
  const key = JSON.stringify([userId, scope, idsKey, revision]);
  const [result, setResult] = useState<{key:string;value:RegistrationEvidence} | null>(null);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const ids: string[] = JSON.parse(idsKey);
    if (!ids.length) return;
    void (async () => {
      try {
        const registeredIds = new Set<string>();
        const administrativeIds = new Set<string>();
        for (let offset = 0; offset < ids.length; offset += 500) {
          if (cancelled) return;
          const group = ids.slice(offset,offset+500);
          const reply = await portalRequest({action:'registrationStatuses',providerIds:group});
          if (!Array.isArray(reply.registeredProviderIds) || reply.registeredProviderIds.some((id: unknown) => typeof id !== 'string' || !group.includes(id))) throw Error('Respuesta de estado de alta inválida.');
          reply.registeredProviderIds.forEach((id:string) => registeredIds.add(id));
          const administrative = reply.administrativeProviderIds ?? [];
          if (!Array.isArray(administrative) || administrative.some((id: unknown) => typeof id !== 'string' || !group.includes(id))) throw Error('Respuesta de gestión de proveedor inválida.');
          administrative.forEach((id: string) => administrativeIds.add(id));
        }
        if (!cancelled) setResult({key,value:{status:'ready',registeredIds,administrativeIds}});
      } catch (error) {
        console.error('Error checking provider registration history:',error);
        if (!cancelled) setResult({key,value:{status:'error',registeredIds:emptyIds}});
      }
    })();
    return () => { cancelled = true; };
  }, [key, idsKey, userId]);
  if (!userId) return waiting;
  if (idsKey === '[]') return ready;
  return result?.key === key ? result.value : waiting;
}
