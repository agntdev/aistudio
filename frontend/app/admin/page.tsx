'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  Shield,
  UserMinus,
  UserCheck,
  Trash2,
  RefreshCcw,
  AlertTriangle,
  FileWarning,
  KeyRound,
} from 'lucide-react';

interface AdminUser {
  id: string;
  email?: string;
  status: 'active' | 'suspended' | 'deleted';
  suspendedReason?: string;
  createdAt: string;
  modelsCount: number;
  totalRefundsCents: number;
}
interface AdminModel {
  id: string;
  userId: string;
  name: string;
  status: 'active' | 'deleted';
  createdAt: string;
}
interface RefundRecord {
  id: string;
  userId: string;
  amountCents: number;
  reason: string;
  processedBy: string;
  createdAt: string;
}
interface AbuseEvent {
  id: string;
  userId: string;
  kind: string;
  detail: string;
  createdAt: string;
}

const STORAGE_KEY = 'aistudio.adminToken';

export default function AdminPanel() {
  const [token, setToken] = useState<string>('');
  const [authed, setAuthed] = useState(false);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [models, setModels] = useState<AdminModel[]>([]);
  const [refunds, setRefunds] = useState<RefundRecord[]>([]);
  const [abuse, setAbuse] = useState<AbuseEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [refundUser, setRefundUser] = useState<AdminUser | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const t = window.localStorage.getItem(STORAGE_KEY) ?? '';
    if (!t) return;
    // Persisted-token rehydration on mount — intentionally synchronous
    // because it gates the rest of the page from rendering.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(t);
    setAuthed(true);
  }, []);

  const fetchJSON = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const res = await fetch(path, {
        ...init,
        headers: {
          'content-type': 'application/json',
          'x-admin-token': token,
          'x-admin-actor': 'console-admin',
          ...(init?.headers ?? {}),
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed: ${res.status}`);
      }
      return res.json();
    },
    [token]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [u, m, r, a] = await Promise.all([
        fetchJSON<{ users: AdminUser[] }>('/api/admin/users'),
        fetchJSON<{ models: AdminModel[] }>('/api/admin/models'),
        fetchJSON<{ refunds: RefundRecord[] }>('/api/admin/refunds'),
        fetchJSON<{ events: AbuseEvent[] }>('/api/admin/abuse'),
      ]);
      setUsers(u.users);
      setModels(m.models);
      setRefunds(r.refunds);
      setAbuse(a.events);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'load failed';
      toast.error(msg);
      // If unauthorized, drop credentials so the gate re-appears.
      if (msg === 'unauthorized') {
        window.localStorage.removeItem(STORAGE_KEY);
        setAuthed(false);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchJSON]);

  useEffect(() => {
    // Initial + auth-change refresh — refresh() internally drives state
    // through setData/setLoading, which is the desired one-shot fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (authed) refresh();
  }, [authed, refresh]);

  if (!authed) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-6">
        <Card className="w-full max-w-md border-white/10 bg-zinc-900">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" /> Admin sign-in
            </CardTitle>
            <CardDescription>
              Paste your <code className="text-xs">ADMIN_API_TOKEN</code> to unlock the panel.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              type="password"
              placeholder="ADMIN_API_TOKEN"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <Button
              className="w-full"
              disabled={!token}
              onClick={() => {
                window.localStorage.setItem(STORAGE_KEY, token);
                setAuthed(true);
              }}
            >
              Unlock
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const suspend = async (u: AdminUser) => {
    const reason = window.prompt(`Suspend ${u.id}? Enter a reason:`);
    if (!reason) return;
    try {
      await fetchJSON('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ action: 'suspend', userId: u.id, reason }),
      });
      toast.success(`Suspended ${u.id}`);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'suspend failed');
    }
  };

  const unsuspend = async (u: AdminUser) => {
    try {
      await fetchJSON('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ action: 'unsuspend', userId: u.id }),
      });
      toast.success(`Unsuspended ${u.id}`);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'unsuspend failed');
    }
  };

  const eraseUser = async (u: AdminUser) => {
    const reason = window.prompt(
      `GDPR ERASE ${u.id}? This is irreversible. Enter the request reason:`
    );
    if (!reason) return;
    try {
      await fetchJSON(
        `/api/admin/users/${encodeURIComponent(u.id)}?reason=${encodeURIComponent(reason)}`,
        { method: 'DELETE' }
      );
      toast.success(`Erased ${u.id} (GDPR)`);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'erase failed');
    }
  };

  const deleteModelFn = async (m: AdminModel) => {
    if (!window.confirm(`Delete model ${m.id}?`)) return;
    try {
      await fetchJSON('/api/admin/models', {
        method: 'POST',
        body: JSON.stringify({ action: 'delete', modelId: m.id }),
      });
      toast.success(`Deleted model ${m.id}`);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'delete failed');
    }
  };

  const submitRefund = async (form: FormData) => {
    if (!refundUser) return;
    const amount = Number(form.get('amount'));
    const reason = String(form.get('reason') || '');
    if (!amount || amount <= 0 || !reason) {
      toast.error('amount > 0 and reason are required');
      return;
    }
    try {
      await fetchJSON('/api/admin/refunds', {
        method: 'POST',
        body: JSON.stringify({
          userId: refundUser.id,
          amountCents: Math.round(amount * 100),
          reason,
        }),
      });
      toast.success(`Refunded $${amount} to ${refundUser.id}`);
      setRefundUser(null);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'refund failed');
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="border-b border-white/10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="h-5 w-5" />
            <span className="font-semibold text-xl">AIStudio</span>
            <span className="text-zinc-500">/ Admin</span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
              <RefreshCcw className="h-4 w-4 mr-1" /> Refresh
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                window.localStorage.removeItem(STORAGE_KEY);
                setAuthed(false);
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-10 space-y-8">
        <Card className="border-white/10 bg-zinc-900">
          <CardHeader>
            <CardTitle>Users ({users.length})</CardTitle>
            <CardDescription>Suspend abusive accounts. GDPR erase deletes user + models + writes audit record.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-zinc-500 border-b border-white/10">
                <tr>
                  <th className="text-left py-2 pr-4">ID</th>
                  <th className="text-left py-2 pr-4">Email</th>
                  <th className="text-left py-2 pr-4">Status</th>
                  <th className="text-right py-2 pr-4">Models</th>
                  <th className="text-right py-2 pr-4">Refunded</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-white/5 align-top">
                    <td className="py-2 pr-4 font-mono">{u.id}</td>
                    <td className="py-2 pr-4">{u.email ?? '—'}</td>
                    <td className="py-2 pr-4">
                      <StatusPill status={u.status} reason={u.suspendedReason} />
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{u.modelsCount}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">${(u.totalRefundsCents / 100).toFixed(2)}</td>
                    <td className="py-2 text-right space-x-1">
                      {u.status === 'suspended' ? (
                        <Button size="sm" variant="outline" onClick={() => unsuspend(u)}>
                          <UserCheck className="h-4 w-4 mr-1" /> Unsuspend
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => suspend(u)}>
                          <UserMinus className="h-4 w-4 mr-1" /> Suspend
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => setRefundUser(u)}>
                        <RefreshCcw className="h-4 w-4 mr-1" /> Refund
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => eraseUser(u)}>
                        <Trash2 className="h-4 w-4 mr-1" /> GDPR
                      </Button>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-zinc-500">
                      No users yet — register one via POST /api/admin/users {`{ action: 'create' }`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <div className="grid md:grid-cols-2 gap-6">
          <Card className="border-white/10 bg-zinc-900">
            <CardHeader>
              <CardTitle>Trained models ({models.length})</CardTitle>
              <CardDescription>Delete any model from the registry (e.g. legal request).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 max-h-80 overflow-y-auto">
              {models.length === 0 ? (
                <p className="text-zinc-500 text-sm">No models registered.</p>
              ) : (
                models.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between border border-white/10 rounded-lg p-3"
                  >
                    <div>
                      <div className="font-mono text-xs">{m.id}</div>
                      <div className="text-sm">{m.name}</div>
                      <div className="text-xs text-zinc-500">user {m.userId} • {m.status}</div>
                    </div>
                    {m.status === 'active' && (
                      <Button size="sm" variant="destructive" onClick={() => deleteModelFn(m)}>
                        <Trash2 className="h-4 w-4 mr-1" /> Delete
                      </Button>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-zinc-900">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-400" /> Recent abuse signals
              </CardTitle>
              <CardDescription>Events emitted by T06 safety + T11 rate limiter.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 max-h-80 overflow-y-auto">
              {abuse.length === 0 ? (
                <p className="text-zinc-500 text-sm">No abuse events recorded.</p>
              ) : (
                abuse.map((e) => (
                  <div key={e.id} className="border border-amber-500/20 bg-amber-950/20 rounded-lg p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{e.kind}</span>
                      <span className="text-xs text-zinc-500">
                        {new Date(e.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-zinc-400">user {e.userId}</div>
                    <div className="text-xs">{e.detail}</div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="border-white/10 bg-zinc-900">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileWarning className="h-5 w-5" /> Refund ledger ({refunds.length})
            </CardTitle>
            <CardDescription>All refunds initiated through this panel are logged here.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 max-h-72 overflow-y-auto">
            {refunds.length === 0 ? (
              <p className="text-zinc-500 text-sm">No refunds recorded.</p>
            ) : (
              refunds.map((r) => (
                <div key={r.id} className="border border-white/10 rounded-lg p-3 text-sm flex items-center justify-between">
                  <div>
                    <div>${(r.amountCents / 100).toFixed(2)} → user {r.userId}</div>
                    <div className="text-xs text-zinc-500">{r.reason} • by {r.processedBy}</div>
                  </div>
                  <div className="text-xs text-zinc-500">
                    {new Date(r.createdAt).toLocaleString()}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!refundUser} onOpenChange={(open) => !open && setRefundUser(null)}>
        <DialogContent className="bg-zinc-950 border-white/10">
          <DialogHeader>
            <DialogTitle>Issue refund</DialogTitle>
            <DialogDescription>
              Refunding user <span className="font-mono">{refundUser?.id}</span>. Amount in dollars.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            action={(formData) => {
              void submitRefund(formData);
            }}
          >
            <Input
              type="number"
              name="amount"
              step="0.01"
              placeholder="Amount in USD"
              required
            />
            <Input name="reason" placeholder="Reason (chargeback, support, ...)" required />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setRefundUser(null)}>
                Cancel
              </Button>
              <Button type="submit">Issue refund</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusPill({ status, reason }: { status: 'active' | 'suspended' | 'deleted'; reason?: string }) {
  if (status === 'active') {
    return (
      <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
        active
      </span>
    );
  }
  if (status === 'suspended') {
    return (
      <span
        className="text-[11px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-300 border border-red-500/30"
        title={reason}
      >
        suspended
      </span>
    );
  }
  return (
    <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-zinc-500/15 text-zinc-300 border border-zinc-500/30">
      deleted
    </span>
  );
}
