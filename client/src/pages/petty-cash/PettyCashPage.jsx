import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuthUser } from '../../context/AuthUserContext';
import { canUsePettyCash } from '../../utils/permissions';
import PettyCashLedger from './PettyCashLedger';

export default function PettyCashPage() {
  const navigate = useNavigate();
  const { user, role, permissions, loading } = useAuthUser();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate('/', { replace: true });
      return;
    }
    if (!canUsePettyCash(role, permissions)) {
      navigate('/dashboard', { replace: true });
      return;
    }
    setReady(true);
  }, [loading, user, role, permissions, navigate]);

  if (!ready) return null;
  return <PettyCashLedger mode="mine" />;
}
