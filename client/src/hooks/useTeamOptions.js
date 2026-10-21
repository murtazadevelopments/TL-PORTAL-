import { useEffect, useState } from 'react';
import api from '../api/client';
import { mergeTeamNames } from '../utils/teamNames';

export default function useTeamOptions() {
  const [names, setNames] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api
      .get('/api/admin/teams')
      .then(({ data }) => {
        if (!active) return;
        setNames(mergeTeamNames(data));
      })
      .catch(() => {
        if (!active) return;
        setNames([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return { names, loading };
}
