import React, { useEffect, useState } from 'react';
import { AppLink, navigate } from '../app/router';
import { resetPasswordEmail, supabase, updatePassword } from '../lib/supabase';
import { Field, PrimaryButton } from '../components/saas/ui';

export function ForgotPasswordPage() {
  const [email,setEmail]=useState(''); const [done,setDone]=useState(false); const [error,setError]=useState('');
  return <SimpleAuth title="Reset your password" subtitle="We’ll send a secure recovery link to your email."><form className="space-y-4" onSubmit={async e=>{e.preventDefault();setError('');try{await resetPasswordEmail(email);setDone(true)}catch(err:any){setError(err.message)}}}><Field label="Email" type="email" value={email} onChange={e=>setEmail(e.target.value)} required/>{error&&<p className="text-sm text-red-600">{error}</p>}{done?<p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">Recovery link sent. Check your inbox.</p>:<PrimaryButton className="w-full">Send recovery link</PrimaryButton>}</form></SimpleAuth>;
}

export function ResetPasswordPage() {
  return <PasswordPage mode="reset" />;
}

export function SetPasswordPage() {
  return <PasswordPage mode="invite" />;
}

function PasswordPage({ mode }: { mode: 'reset' | 'invite' }) {
  const isInvite = mode === 'invite';
  const [password,setPassword]=useState('');
  const [error,setError]=useState('');
  const [ready,setReady]=useState(false);
  useEffect(()=>{void(async()=>{try{const code=new URL(window.location.href).searchParams.get('code');if(code){const {error:exchangeError}=await supabase.auth.exchangeCodeForSession(code);if(exchangeError)throw exchangeError}const {data}=await supabase.auth.getSession();if(!data.session)throw new Error(isInvite?'This invitation link is invalid or has expired. Ask your workspace owner to send a new invitation.':'This reset link is invalid or has expired. Request a new password-reset email.');setReady(true)}catch(err:any){setError(err?.message||'Could not verify this secure link.')}})()},[isInvite]);
  return <SimpleAuth title={isInvite?'Set your password':'Choose a new password'} subtitle={isInvite?'You have been invited to a Jobrin.ai workspace. Set a password to finish joining.':'Use a new password of at least 12 characters.'}>{!ready?<div className="space-y-4">{error?<><p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>{isInvite?<AppLink href="/login" className="text-sm font-semibold text-indigo-600">Back to login</AppLink>:<AppLink href="/forgot-password" className="text-sm font-semibold text-indigo-600">Request another reset link</AppLink>}</>:<p className="text-sm text-slate-500">Verifying your secure link…</p>}</div>:<form className="space-y-4" onSubmit={async e=>{e.preventDefault();if(password.length<12)return setError('Use at least 12 characters.');try{await updatePassword(password);navigate('/app')}catch(err:any){setError(err.message)}}}><Field label="New password" type="password" minLength={12} value={password} onChange={e=>setPassword(e.target.value)} required/>{error&&<p className="text-sm text-red-600">{error}</p>}<PrimaryButton className="w-full">{isInvite?'Finish joining':'Update password'}</PrimaryButton></form>}</SimpleAuth>;
}

function SimpleAuth({title,subtitle,children}:{title:string;subtitle:string;children:React.ReactNode}) { return <div className="flex min-h-screen items-center justify-center bg-slate-50 px-5"><div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-sm"><AppLink href="/" className="font-black">JOBRIN.AI</AppLink><h1 className="mt-7 text-2xl font-black">{title}</h1><p className="mb-6 mt-2 text-sm text-slate-500">{subtitle}</p>{children}</div></div> }
