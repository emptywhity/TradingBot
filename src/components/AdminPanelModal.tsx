import React, { useEffect, useState } from 'react';
import { apiFetch } from '@/services/authClient';
import { useMarketStore } from '@/store/useMarketStore';

type UserRow = {
  id: string;
  email: string;
  role: 'standard' | 'vip' | 'admin';
  vipExpiresAt?: number;
  createdAt: number;
};

function formatVipExpiry(ts?: number) {
  if (!ts) return '—';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '—';
  const iso = date.toISOString().slice(0, 10);
  return ts <= Date.now() ? `${iso} (expired)` : iso;
}

export function AdminPanelModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const role = useMarketStore((s) => s.role);
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (role !== 'admin') return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch('/admin/users');
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? 'Failed to load users.');
        if (!cancelled) setRows(json.users as UserRow[]);
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? 'Failed to load users.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [open, role]);

  const updateRole = async (id: string, nextRole: UserRow['role'], vipDays?: number) => {
    const res = await apiFetch(`/admin/users/${id}/role`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: nextRole, vipDays })
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json?.error ?? 'Failed to update role.');
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === id ? (json.user as UserRow) : r)));
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onMouseDown={onClose}>
      <div
        className="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-950 p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Admin panel"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-100">Admin panel</h3>
            <p className="text-xs text-slate-400 mt-1">Manual role activation for Pro/VIP users. VIP is 30 days.</p>
          </div>
          <button
            className="shrink-0 rounded-md border border-slate-800 bg-slate-900 px-3 py-1 text-xs text-slate-200 hover:border-slate-600"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {role !== 'admin' ? (
          <div className="mt-4 text-xs text-slate-400">Admin role required.</div>
        ) : (
          <>
            {error ? <div className="mt-3 text-xs text-rose-300">{error}</div> : null}
            {loading ? <div className="mt-3 text-xs text-slate-400">Loading...</div> : null}

            <div className="mt-4 border border-slate-800 rounded bg-slate-900/20 overflow-hidden">
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr] text-[11px] text-slate-400 border-b border-slate-800 bg-slate-950/40">
                <div className="px-2 py-1">Email</div>
                <div className="px-2 py-1">Role</div>
                <div className="px-2 py-1">Pro until</div>
                <div className="px-2 py-1">Actions</div>
              </div>
              {rows.length ? (
                rows.map((r) => (
                  <div
                    key={r.id}
                    className="grid grid-cols-[2fr_1fr_1fr_1fr] text-[11px] text-slate-200 border-b border-slate-800 last:border-b-0"
                  >
                    <div className="px-2 py-1">{r.email}</div>
                    <div className="px-2 py-1">
                      <select
                        className="bg-slate-900 text-slate-100 border border-slate-800 rounded px-2 py-1 text-xs"
                        value={r.role}
                        onChange={(e) => {
                          const nextRole = e.target.value as UserRow['role'];
                          updateRole(r.id, nextRole, nextRole === 'vip' ? 30 : undefined);
                        }}
                      >
                        <option value="standard">standard</option>
                        <option value="vip">pro</option>
                        <option value="admin">admin</option>
                      </select>
                    </div>
                    <div className="px-2 py-1 text-slate-400">{formatVipExpiry(r.vipExpiresAt)}</div>
                    <div className="px-2 py-1">
                      <button
                        type="button"
                        onClick={() => updateRole(r.id, 'vip', 30)}
                        className="rounded border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] text-slate-200 hover:border-slate-600"
                      >
                        Pro 30d
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-2 py-2 text-xs text-slate-500">No users yet.</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
