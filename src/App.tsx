import React, { lazy, Suspense, useEffect } from 'react';
import { AuthProvider, useAuth } from './app/auth';
import { navigate, usePathname } from './app/router';

// Keep the public first paint lean: the full authenticated operations suite is
// downloaded only after an authorised person enters the workspace.
const PublicHome = lazy(() => import('./pages/PublicHome'));
const PricingPage = lazy(() => import('./pages/PricingPage'));
const AuthPage = lazy(() => import('./pages/AuthPage'));
const AuthCallbackPage = lazy(() => import('./pages/AuthCallbackPage'));
const ForgotPasswordPage = lazy(() => import('./pages/PasswordPages').then(module => ({ default: module.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('./pages/PasswordPages').then(module => ({ default: module.ResetPasswordPage })));
const MfaPage = lazy(() => import('./pages/MfaPage'));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage'));
const PublicQuotePage = lazy(() => import('./pages/PublicQuotePage'));
const PublicBookingPage = lazy(() => import('./pages/PublicBookingPage'));
const AppShell = lazy(() => import('./pages/AppShell'));

export default function App() {
  return <AuthProvider><Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">Loading Jobryn…</div>}><Routes/></Suspense></AuthProvider>;
}

function Routes() {
  const path=usePathname(); const auth=useAuth();
  if(path==='/')return <PublicHome/>;
  if(path==='/pricing')return <PricingPage/>;
  if(path==='/login'||path==='/signup')return <AuthEntry auth={auth}/>;
  if(path==='/auth/callback')return <AuthCallbackPage/>;
  if(path==='/forgot-password')return <ForgotPasswordPage/>;
  if(path==='/reset-password')return <ResetPasswordPage/>;
  if(path==='/payment-complete')return <PaymentOutcome complete/>;
  if(path==='/payment-cancelled')return <PaymentOutcome complete={false}/>;
  if(path==='/mfa')return <MfaPage/>;
  if(path==='/onboarding')return <OnboardingPage/>;
  const quoteMatch=path.match(/^\/quote\/([A-Za-z0-9_-]+)$/);if(quoteMatch)return <PublicQuotePage token={quoteMatch[1]}/>;
  const bookMatch=path.match(/^\/book\/([a-z0-9-]+)$/i);if(bookMatch)return <PublicBookingPage slug={bookMatch[1]}/>;
  if(path.startsWith('/app'))return <AppShell/>;
  return <NotFound/>;
}

function AuthEntry({auth}:{auth:ReturnType<typeof useAuth>}) {
  useEffect(()=>{
    if (!auth.loading && auth.session) navigate(auth.workspaceId ? '/app' : '/onboarding', true);
  },[auth.loading,auth.session,auth.workspaceId]);
  if (auth.loading || auth.session) return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">Checking secure session…</div>;
  return <AuthPage/>;
}

function PaymentOutcome({complete}:{complete:boolean}){return <div className="flex min-h-screen items-center justify-center bg-slate-50 px-5"><div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm"><div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full text-2xl ${complete?'bg-emerald-100 text-emerald-700':'bg-slate-100 text-slate-600'}`}>{complete?'✓':'—'}</div><p className="mt-5 text-sm font-bold uppercase tracking-wider text-indigo-600">Secure Stripe checkout</p><h1 className="mt-2 text-3xl font-black">{complete?'Payment submitted':'Payment cancelled'}</h1><p className="mt-3 text-sm leading-6 text-slate-600">{complete?'Stripe is confirming the payment securely. The business records it only after receiving a signed confirmation from Stripe.':'No payment was recorded by Jobryn. You can return to the original payment link if you still need to pay.'}</p><p className="mt-6 text-xs text-slate-400">Jobryn does not receive or store your card number or security code.</p></div></div>}

function NotFound(){return <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-5 text-center"><p className="text-sm font-bold text-indigo-600">404</p><h1 className="mt-2 text-4xl font-black">Page not found</h1><button onClick={()=>navigate('/')} className="mt-6 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">Back to Jobryn</button></div>}
