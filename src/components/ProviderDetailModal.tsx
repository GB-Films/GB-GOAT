import { useAuth } from '../context/AuthContext';
import { ProviderDetailView } from './ProviderDetailView';
import { ProviderFinancePanel } from './ProviderFinancePanel';
import { ProviderCompanyPanel } from './ProviderCompanyPanel';
import { openProviderFile } from '../lib/providerFinance';
import { useState } from 'react';
import { ProviderAdministrationPanel, type ProviderAdministrationState } from './ProviderAdministrationPanel';

export function ProviderDetailModal({ detail, loading, onClose, onChanged, initialProjectId }: { detail: any; loading: boolean; onClose: () => void; onChanged?: () => void; initialProjectId?: string }) {
  const { profile } = useAuth();
  const [administration, setAdministration] = useState<ProviderAdministrationState | null>(null);
  const administrative = administration?.providerId === detail.provider.id && administration.active;
  return <ProviderDetailView detail={detail} loading={loading} onClose={onClose} initialProjectId={initialProjectId} onOpenSharedDocument={openProviderFile}
    administrative={administrative} administrativeContact={administrative ? administration.contactEmail : undefined}
    administrationPanel={!loading && detail.provider.type === 'empresa' && ['admin', 'ayudante_admin'].includes(profile?.role) ? <ProviderAdministrationPanel providerId={detail.provider.id} onState={setAdministration} onChanged={onChanged} /> : undefined}
    companyPanel={!loading && administration?.providerId === detail.provider.id && !administrative && detail.provider.type === 'empresa' && ['admin', 'ayudante_admin'].includes(profile?.role) ? <ProviderCompanyPanel providerId={detail.provider.id} /> : undefined}
    financePanel={!loading && profile?.role === 'admin' ? <ProviderFinancePanel provider={detail.provider} lines={detail.lines} onChanged={onChanged} /> : undefined} />;
}
