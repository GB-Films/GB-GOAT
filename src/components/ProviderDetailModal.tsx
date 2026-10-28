import { useAuth } from '../context/AuthContext';
import { ProviderDetailView } from './ProviderDetailView';
import { ProviderFinancePanel } from './ProviderFinancePanel';

export function ProviderDetailModal({ detail, loading, onClose, onChanged }: { detail: any; loading: boolean; onClose: () => void; onChanged?: () => void }) {
  const { profile } = useAuth();
  return <ProviderDetailView detail={detail} loading={loading} onClose={onClose}
    financePanel={!loading && profile?.role === 'admin' ? <ProviderFinancePanel provider={detail.provider} lines={detail.lines} onChanged={onChanged} /> : undefined} />;
}
