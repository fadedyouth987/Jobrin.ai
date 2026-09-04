import React, { useEffect, useState } from 'react';
import { navigate } from '../app/router';
import { supabase } from '../lib/supabase';
import { Field, PrimaryButton, Spinner } from '../components/saas/ui';
import { useAuth } from '../app/auth';

export default function MfaPage() {
  const { session, refreshMfa } = useAuth();
  const [factorId,setFactorId]=useState<string|null>(null); const [code,setCode]=useState(''); const [loading,setLoading]=useState(true); const [error,setError]=useState('');
  useEffect(()=>{void (async()=>{if(!session)return navigate('/login',true);const {data,error}=await supabase.auth.mfa.listFactors();if(error){setError(error.message);setLoading(false);return;}const factor=data.totp.find(f=>f.status==='verified');if(!factor){navigate('/app/settings/security',true);return;}setFactorId(factor.id);setLoading(false)})()},[session]);
  if(loading)return <div className="min-h-screen bg-slate-50"><Spinner label="Checking MFA…"/></div>;
  return <div className="flex min-h-screen items-center justify-center bg-slate-950 px-5"><form className="w-full max-w-sm rounded-3xl bg-white p-7" onSubmit={async e=>{e.preventDefault();setError('');if(!factorId)return;const {error}=await supabase.auth.mfa.challengeAndVerify({factorId,code});if(error)return setError(error.message);await refreshMfa();navigate('/app',true)}}><p className="text-sm font-bold text-indigo-600">Second factor required</p><h1 className="mt-2 text-2xl font-black">Enter your authenticator code</h1><p className="mb-6 mt-2 text-sm leading-6 text-slate-500">Sensitive owner actions can be protected by AAL2 when production enforcement is enabled.</p><Field label="6-digit code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} autoFocus required/>{error&&<p className="mt-3 text-sm text-red-600">{error}</p>}<PrimaryButton className="mt-5 w-full">Verify</PrimaryButton></form></div>;
}
