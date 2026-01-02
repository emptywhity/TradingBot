import React, { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { useAuth } from '@/hooks/useAuth';
import { AdminPanelModal } from '@/components/AdminPanelModal';

type Mode = 'login' | 'register';

function formatUtc(ts: number) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

export function AccountModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, login, register, logout, paymentInfo, refreshPaymentInfo } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [expiryNotice, setExpiryNotice] = useState<string | null>(null);
  const [pendingLoginNotice, setPendingLoginNotice] = useState(false);

  useEffect(() => {
    if (open) refreshPaymentInfo().catch(() => undefined);
  }, [open, refreshPaymentInfo]);

  useEffect(() => {
    if (!pendingLoginNotice) return;
    if (user?.role === 'vip' && user.vipExpiresAt) {
      const msLeft = user.vipExpiresAt - Date.now();
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      if (msLeft > 0 && msLeft <= weekMs) {
        const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
        setExpiryNotice(`Pro expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Please renew to keep access.`);
      } else {
        setExpiryNotice(null);
      }
    } else {
      setExpiryNotice(null);
    }
    setPendingLoginNotice(false);
  }, [pendingLoginNotice, user]);

  if (!open) return null;

  const roleLabel = user?.role === 'vip' ? 'pro' : user?.role ?? 'standard';

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password);
      setPassword('');
      setPendingLoginNotice(true);
    } catch (err: any) {
      setError(err?.message ?? 'Request failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onMouseDown={onClose}>
        <div
          className="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-950 p-5 shadow-2xl"
          onMouseDown={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Account"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-slate-100">Account</h3>
              <p className="text-xs text-slate-400 mt-1">
                Manual VIP activation. Send a payment screenshot and your account email to Discord.
              </p>
            </div>
            <button
              className="shrink-0 rounded-md border border-slate-800 bg-slate-900 px-3 py-1 text-xs text-slate-200 hover:border-slate-600"
              onClick={onClose}
            >
              Close
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border border-slate-800 rounded-lg p-3 bg-slate-900/20">
              <div className="flex items-center gap-2 mb-3">
                {(['login', 'register'] as Mode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={clsx(
                      'px-2 py-1 rounded text-xs border',
                      mode === m ? 'bg-slate-800 text-white border-slate-700' : 'bg-slate-900 text-slate-300 border-slate-800'
                    )}
                  >
                    {m === 'login' ? 'Login' : 'Register'}
                  </button>
                ))}
              </div>

              {user ? (
                <div className="text-xs text-slate-300">
                  <div className="text-slate-400">Signed in as</div>
                  <div className="text-slate-100">{user.email}</div>
                  <div className="mt-1 text-slate-400">Role: {roleLabel}</div>
                  {user.role === 'vip' && user.vipExpiresAt ? (
                    <div className="mt-1 text-slate-400">Pro valid until: {formatUtc(user.vipExpiresAt)}</div>
                  ) : null}
                  {expiryNotice ? <div className="mt-2 text-[11px] text-amber-300">{expiryNotice}</div> : null}
                  <div className="mt-1 text-slate-400">Account ID: {user.id}</div>
                  <div className="mt-3 flex items-center gap-2">
                    {user.role === 'admin' ? (
                      <button
                        type="button"
                        onClick={() => setAdminOpen(true)}
                        className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-200 hover:border-slate-600"
                      >
                        Admin panel
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={logout}
                      className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-200 hover:border-slate-600"
                    >
                      Logout
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <input
                      className="w-full bg-slate-900/50 border border-slate-800 rounded px-2 py-1 text-xs text-slate-100"
                      placeholder="Email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                    <input
                      className="w-full bg-slate-900/50 border border-slate-800 rounded px-2 py-1 text-xs text-slate-100"
                      placeholder="Password (min 8 chars)"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    {error ? <div className="text-xs text-rose-300">{error}</div> : null}
                  </div>
                  <div className="mt-3">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={submit}
                      className="rounded-md border border-slate-800 bg-slate-900 px-3 py-1 text-xs text-slate-200 hover:border-slate-600 disabled:opacity-60"
                    >
                      {busy ? 'Please wait...' : mode === 'login' ? 'Login' : 'Create account'}
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className="border border-slate-800 rounded-lg p-3 bg-slate-900/20">
              <div className="text-xs text-slate-400 mb-1">Plans</div>
              <div className="text-xs text-slate-200">
                <div className="font-medium text-slate-100">Free</div>
                <ul className="list-disc list-inside text-slate-400 mt-1 space-y-1">
                  <li>Signals for BTC/ETH only</li>
                  <li>No scanner, no global performance</li>
                  <li>Basic signal panel</li>
                </ul>
                <div className="font-medium text-slate-100 mt-3">Pro</div>
                <ul className="list-disc list-inside text-slate-400 mt-1 space-y-1">
                  <li>Scanner + opportunities</li>
                  <li>Global performance + analytics</li>
                  <li>Meta-model and alerts</li>
                  <li>All symbols/timeframes</li>
                </ul>
              </div>

              <div className="mt-4 border-t border-slate-800 pt-3 text-xs text-slate-300">
                <div className="font-medium text-slate-100">Manual upgrade</div>
                <div className="mt-1 text-slate-400">Monthly Pro plan: 30 USDT. Send USDT (BSC) to this address:</div>
                <div className="mt-1 rounded bg-slate-950/70 border border-slate-800 px-2 py-1 text-[11px] text-slate-200 break-all">
                  {paymentInfo?.address || 'Payment address not configured'}
                </div>
                <div className="mt-2 text-slate-400">
                  Network: {paymentInfo?.network || 'BSC'} | Asset: {paymentInfo?.asset || 'USDT'}
                </div>
                <div className="mt-2 text-slate-400">
                  After payment, send a screenshot and your account email to Discord. I will activate Pro manually.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <AdminPanelModal open={adminOpen} onClose={() => setAdminOpen(false)} />
    </>
  );
}
