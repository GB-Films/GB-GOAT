import { useAuth } from '../context/AuthContext';
import { ProviderDetailView } from './ProviderDetailView';
import { ProviderFinancePanel } from './ProviderFinancePanel';
import { ProviderCompanyPanel } from './ProviderCompanyPanel';
import { openProviderFile } from '../lib/providerFinance';

export function ProviderDetailModal({ detail, loading, onClose, onChanged, initialProjectId }: { detail: any; loading: boolean; onClose: () => void; onChanged?: () => void; initialProjectId?: string }) {
  const { profile } = useAuth();
  return <ProviderDetailView detail={detail} loading={loading} onClose={onClose} initialProjectId={initialProjectId} onOpenSharedDocument={openProviderFile}
    companyPanel={!loading && detail.provider.type === 'empresa' && ['admin', 'ayudante_admin'].includes(profile?.role) ? <ProviderCompanyPanel providerId={detail.provider.id} /> : undefined}
    financePanel={!loading && profile?.role === 'admin' ? <ProviderFinancePanel provider={detail.provider} lines={detail.lines} onChanged={onChanged} /> : undefined} />;
}
