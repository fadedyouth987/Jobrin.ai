import React, { useEffect, useState } from 'react';
import { navigate } from '../app/router';
import { supabase } from '../lib/supabase';
import { Spinner } from '../components/saas/ui';

export default function AuthCallbackPage() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const code = new URL(window.location.href).searchParams.get('code');
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error && !/code verifier/i.test(error.message)) throw error;
        }
        const { data } = await supabase.auth.getSession();
        if (!data.session) throw new Error('No authenticated session was created. Check the provider redirect configuration.');
        navigate('/app', true);
      } catch (err: any) { setError(err?.message || 'Sign-in callback failed.'); }
    })();
  }, []);
  return <div className="min-h-screen bg-slate-50 p-6">{error?<div className="mx-auto mt-24 max-w-lg rounded-2xl border border-red-200 bg-white p-6"><h1 className="font-bold">Could not complete sign in</h1><p className="mt-2 text-sm text-red-700">{error}</p><button onClick={()=>navigate('/login')} className="mt-5 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Back to login</button></div>:<Spinner label="Securing your Jobryn session…"/>}</div>;
}
