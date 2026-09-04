import React, { useState } from 'react';
import { Github, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { AppLink, navigate, usePathname } from '../app/router';
import { signInWithEmail, signInWithProvider, signUpWithEmail, type JobrynOAuthProvider } from '../lib/supabase';
import { Field, PrimaryButton, SecondaryButton } from '../components/saas/ui';

const providerEnabled = (provider: string) => String(import.meta.env[`VITE_AUTH_${provider.toUpperCase()}_ENABLED`] ?? 'false') === 'true';

export default function AuthPage() {
  const path = usePathname();
  const signup = path === '/signup';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(null); setMessage(null);
    if (signup && password.length < 12) return setError('Use at least 12 characters for your password.');
    setBusy(true);
    try {
      if (signup) {
        const result = await signUpWithEmail(email, password, name);
        if (!result.session) setMessage('Check your email to verify your Jobryn account, then sign in.');
        else navigate('/onboarding');
      } else {
        await signInWithEmail(email, password);
        navigate('/app');
      }
    } catch (err: any) {
      setError(err?.message || 'Authentication failed.');
    } finally { setBusy(false); }
  };

  const oauth = async (provider: JobrynOAuthProvider) => {
    setBusy(true); setError(null);
    try { await signInWithProvider(provider); } catch (err: any) { setError(err?.message || `Could not start ${provider} sign in.`); setBusy(false); }
  };

  const providers: Array<{ key: JobrynOAuthProvider; label: string; mark: React.ReactNode }> = [
    { key:'google', label:'Google', mark:<span className="font-black text-[#4285F4]">G</span> },
    { key:'github', label:'GitHub', mark:<Github className="h-4 w-4"/> },
    { key:'azure', label:'Microsoft', mark:<span className="grid h-4 w-4 grid-cols-2 gap-[1px]"><i className="bg-slate-900"/><i className="bg-slate-500"/><i className="bg-slate-500"/><i className="bg-slate-900"/></span> },
    { key:'apple', label:'Apple', mark:<span className="font-black">●</span> },
  ];

  return <div className="min-h-screen bg-slate-950 lg:grid lg:grid-cols-2">
    <div className="hidden min-h-screen flex-col justify-between p-12 text-white lg:flex"><AppLink href="/" className="text-xl font-black tracking-tight">JOBRYN</AppLink><div className="max-w-xl"><div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600"><ShieldCheck className="h-6 w-6"/></div><h2 className="text-5xl font-black leading-tight tracking-tight">Revenue operations without giving AI the keys to everything.</h2><p className="mt-5 max-w-lg text-base leading-7 text-slate-300">Your user identity, workspace access, database records and billing are separated by explicit security boundaries.</p></div><p className="text-xs text-slate-500">PKCE OAuth · Supabase Auth · PostgreSQL RLS · Stripe Billing</p></div>
    <div className="flex min-h-screen items-center justify-center bg-white px-5 py-10"><div className="w-full max-w-md"><div className="mb-8 lg:hidden"><AppLink href="/" className="font-black tracking-tight">JOBRYN</AppLink></div><p className="text-sm font-semibold text-indigo-600">{signup?'Create your workspace':'Welcome back'}</p><h1 className="mt-2 text-3xl font-black tracking-tight">{signup?'Start building Jobryn':'Log in to Jobryn'}</h1><p className="mt-2 text-sm leading-6 text-slate-500">{signup?'Create your account with email. You can also use a sign-in option shown below.':'Access your private business workspace.'}</p>
      <div className="mt-7 grid grid-cols-2 gap-2">{providers.filter(p=>providerEnabled(p.key)).map(provider=><SecondaryButton key={provider.key} disabled={busy} onClick={()=>oauth(provider.key)} className="flex items-center justify-center gap-2">{provider.mark}{provider.label}</SecondaryButton>)}</div>
      {providers.filter(p=>providerEnabled(p.key)).length>0&&<div className="my-6 flex items-center gap-3"><span className="h-px flex-1 bg-slate-200"/><span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">or email</span><span className="h-px flex-1 bg-slate-200"/></div>}
      <form onSubmit={submit} className="space-y-4">{signup&&<Field label="Full name" value={name} onChange={e=>setName(e.target.value)} required autoComplete="name" placeholder="Alex Rivera"/>}<Field label="Email" type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="email" placeholder="name@business.com"/><Field label="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={signup?12:1} autoComplete={signup?'new-password':'current-password'} hint={signup?'Minimum 12 characters. Enable MFA after setup for stronger protection.':undefined}/>{error&&<div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</div>}{message&&<div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">{message}</div>}<PrimaryButton disabled={busy} className="w-full">{busy?'Working…':signup?'Create secure account':'Log in'}</PrimaryButton></form>
      {!signup&&<div className="mt-4 text-right"><AppLink href="/forgot-password" className="text-xs font-semibold text-indigo-600">Forgot password?</AppLink></div>}
      <p className="mt-7 text-center text-sm text-slate-500">{signup?'Already have an account?':'New to Jobryn?'} <AppLink href={signup?'/login':'/signup'} className="font-semibold text-slate-950">{signup?'Log in':'Create account'}</AppLink></p>
      <div className="mt-8 flex items-center justify-center gap-2 text-[11px] text-slate-400"><LockKeyhole className="h-3.5 w-3.5"/>Credentials are handled by Supabase Auth; Stripe card data is never handled here.</div>
    </div></div>
  </div>;
}
