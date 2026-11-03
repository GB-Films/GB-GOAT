import { useEffect, useState } from 'react';
import { portalRequest } from '../lib/providerPortal';
import { hasProviderRegistration, type RegistrationEvidence } from '../lib/providerRegistration';

const emptyIds: ReadonlySet<string> = new Set();
const waiting: RegistrationEvidence = {status:'loading',registeredIds:emptyIds};
const ready: RegistrationEvidence = {status:'ready',registeredIds:emptyIds};

export function useProviderRegistrationEvidence(providers: any[], scope: string, userId?: string): RegistrationEvidence {
  const idsKey = JSON.stringify(providers.filter(p => !hasProviderRegistration(p)).map(p => p.id).sort());
  const key = JSON.stringify([scope, idsKey]);
  const [result, setResult] = useState<{key:string;value:RegistrationEvidence} | null>(null);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const ids: string[] = JSON.parse(idsKey);
    if (!ids.length) return;
    void (async () => {
      try {
        const registeredIds = new Set<string>();
        for (let offset = 0; offset < ids.length; offset += 500) {
          if (cancelled) return;
          const group = ids.slice(offset,offset+500);
          const reply = await portalRequest({action:'registrationStatuses',providerIds:group});
          if (!Array.isArray(reply.registeredProviderIds) || reply.registeredProviderIds.some((id: unknown) => typeof id !== 'string' || !group.includes(id))) throw Error('Respuesta de estado de alta inválida.');
          reply.registeredProviderIds.forEach((id:string) => registeredIds.add(id));
        }
        if (!cancelled) setResult({key,value:{status:'ready',registeredIds}});
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
