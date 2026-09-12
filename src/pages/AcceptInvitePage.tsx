import React, { useEffect, useState } from 'react';
import { useAuth } from '../app/auth';
import { AppLink, navigate } from '../app/router';
import { Field, PrimaryButton } from '../components/saas/ui';
import { apiFetch } from '../lib/api';
import { supabase, updatePassword } from '../lib/supabase';

export default function AcceptInvitePage() {
  const { refreshWorkspaces } = useAuth();
  const [password, setPassword] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void (async () => {
      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!data.session) throw new Error('This setup link is invalid or has expired. Ask the workspace owner for a new link.');
        setReady(true);
      } catch (err: any) {
        setError(err?.message || 'Could not verify this setup link.');
      }
    })();
  }, []);

  const accept = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 12) return setError('Use at least 12 characters.');
    setBusy(true);
    setError('');
    try {
      await updatePassword(password);
      await apiFetch('/api/team/invites/accept', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await refreshWorkspaces();
      navigate('/app', true);
    } catch (err: any) {
      setError(err?.message || 'Could not finish account setup.');
    } finally {
      setBusy(false);
    }
  };

  return <div className="flex min-h-screen items-center justify-center bg-slate-50 px-5"><div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-sm"><AppLink href="/" className="font-black">JOBRIN.AI</AppLink><h1 className="mt-7 text-2xl font-black">Set up your team account</h1><p className="mb-6 mt-2 text-sm leading-6 text-slate-500">Choose a password to accept your workspace invitation. Your access stays pending until setup finishes.</p>{!ready?<div className="space-y-4">{error?<p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>:<p className="text-sm text-slate-500">Verifying your secure setup link…</p>}</div>:<form className="space-y-4" onSubmit={accept}><Field label="New password" type="password" minLength={12} value={password} onChange={e=>setPassword(e.target.value)} required autoComplete="new-password" hint="Minimum 12 characters."/>{error&&<p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}<PrimaryButton disabled={busy} className="w-full">{busy?'Finishing setup…':'Set password and join workspace'}</PrimaryButton></form>}</div></div>;
}
