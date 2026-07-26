'use client';

import { useState, useCallback, useEffect } from 'react';
import apiClient from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import type { MyShift, Shift } from '@/types/shift';

export function useMyShift() {
  const { selectedHouse } = useAuth();
  const [shift, setShift] = useState<MyShift | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchShift = useCallback(async () => {
    try {
      const res = await apiClient.get('v1/shifts/my');
      setShift(res.data);
      return res.data;
    } catch {
      setShift(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchShift(); }, [selectedHouse]);

  return { shift, loading, fetchShift };
}

export function useShifts() {
  const { selectedHouse } = useAuth();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(false);

  const headers: Record<string, string> = {};
  if (selectedHouse?.id) headers['X-House-ID'] = String(selectedHouse.id);

  const fetchShifts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('v1/shifts', { headers });
      setShifts(res.data);
      return res.data;
    } catch {
      setShifts([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchShifts(); }, [selectedHouse]);

  return { shifts, loading, fetchShifts };
}
