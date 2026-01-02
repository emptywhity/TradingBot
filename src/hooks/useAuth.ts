import { useEffect, useMemo, useState } from 'react';
import { apiFetch, setAuthToken } from '@/services/authClient';
import { useMarketStore } from '@/store/useMarketStore';

export type AuthUser = {
  id: string;
  email: string;
  role: 'standard' | 'vip' | 'admin';
  vipExpiresAt?: number;
  createdAt: number;
};

export type PaymentInfo = {
  address: string;
  asset: string;
  network: string;
};

export function useAuth() {
  const setUser = useMarketStore((s) => s.setUser);
  const user = useMarketStore((s) => s.user);
  const [loading, setLoading] = useState(true);
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await apiFetch('/auth/me');
        if (!res.ok) {
          setAuthToken(null);
          if (!cancelled) setUser(undefined);
        } else {
          const json = await res.json();
          if (!cancelled) setUser(json.user as AuthUser);
        }
      } catch {
        if (!cancelled) setUser(undefined);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [setUser]);

  const login = async (email: string, password: string) => {
    const res = await apiFetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error ?? 'Login failed.');
    setAuthToken(json.token);
    setUser(json.user as AuthUser);
  };

  const register = async (email: string, password: string) => {
    const res = await apiFetch('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error ?? 'Registration failed.');
    setAuthToken(json.token);
    setUser(json.user as AuthUser);
  };

  const logout = async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } finally {
      setAuthToken(null);
      setUser(undefined);
    }
  };

  const refreshPaymentInfo = async () => {
    const res = await apiFetch('/payment-info');
    const json = await res.json();
    if (res.ok) setPaymentInfo(json as PaymentInfo);
  };

  return useMemo(
    () => ({
      user,
      loading,
      paymentInfo,
      login,
      register,
      logout,
      refreshPaymentInfo
    }),
    [user, loading, paymentInfo]
  );
}
