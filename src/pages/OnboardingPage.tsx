import React, { useEffect, useState } from "react";
import { Check, ChevronRight, ShieldCheck } from "lucide-react";
import { useAuth } from "../app/auth";
import { AppLink, navigate } from "../app/router";
import { apiFetch } from "../lib/api";
import {
  Card,
  Field,
  PrimaryButton,
  SecondaryButton,
  SelectField,
  Spinner,
  StatusPill,
  TextareaField,
} from "../components/saas/ui";
import { PLAN_CATALOG, PLAN_KEYS } from "../../shared/plans";
import { clearDraft, hydrateFromDraft, loadDraft, saveDraft } from "../lib/onboardingDraft";

const STEPS = [
  "Workspace",
  "Business",
  "Services",
  "AI safety",
  "Plan",
  "Test & activate",
];

type LaunchState = {
  subscription: { plan?: string; status?: string; trial_ends_at?: string | null } | null;
  stripeConfigured: boolean;
  readiness: Record<"stripe" | "twilio" | "email" | "openai", boolean>;
  twilioConnected: boolean;
};

const emptyLaunch: LaunchState = {
  subscription: null,
  stripeConfigured: false,
  readiness: { stripe: false, twilio: false, email: false, openai: false },
  twilioConnected: false,
};

export default function OnboardingPage() {
  const auth = useAuth();
  const draftStorage = typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  const [step, setStep] = useState(auth.workspaceId ? 1 : 0);
  const [busy, setBusy] = useState(false);
  const [hydrating, setHydrating] = useState(Boolean(auth.workspaceId));
  const [error, setError] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [launch, setLaunch] = useState<LaunchState>(emptyLaunch);
  const [business, setBusiness] = useState({
    trading_name: "",
    legal_name: "",
    abn: "",
    industry: "plumbing",
    phone: "",
    email: auth.user?.email || "",
    website: "",
    timezone: "Australia/Adelaide",
    gst_registered: true,
    description: "",
    street_address: "",
    suburb: "",
    state: "SA",
    postcode: "",
  });
  const [service, setService] = useState({
    name: "",
    description: "",
    booking_type: "bookable",
    default_duration_minutes: 60,
    pricing_mode: "quote",
    base_price_dollars: "",
  });

  useEffect(() => {
    if (!auth.loading && !auth.session) navigate("/login", true);
  }, [auth.loading, auth.session]);

  useEffect(() => {
    if (auth.user?.email)
      setBusiness((value) =>
        value.email ? value : { ...value, email: auth.user!.email! },
      );
  }, [auth.user?.email]);

  // Draft persistence: typed answers survive a failed save or a page refresh.
  // Drafts are scoped to the workspace so one business never leaks into another.
  useEffect(() => { if (step >= 1) saveDraft(draftStorage, { workspaceId: auth.workspaceId ?? undefined, business }); }, [business, step, draftStorage, auth.workspaceId]);
  useEffect(() => { if (step >= 2) saveDraft(draftStorage, { workspaceId: auth.workspaceId ?? undefined, service }); }, [service, step, draftStorage, auth.workspaceId]);
  useEffect(() => { saveDraft(draftStorage, { workspace: workspaceName }); }, [workspaceName, draftStorage]);

  const loadLaunch = async (workspaceId: string) => {
    const [billing, integrations] = await Promise.all([
      apiFetch<any>("/api/billing/status", {}, workspaceId),
      apiFetch<any>("/api/integrations", {}, workspaceId),
    ]);
    const readiness = { ...emptyLaunch.readiness, ...(integrations.readiness || {}) };
    setLaunch({
      subscription: billing.subscription || null,
      stripeConfigured: billing.stripeConfigured === true,
      readiness,
      twilioConnected: (integrations.integrations || []).some(
        (item: any) => item.provider === "twilio" && item.status === "connected",
      ),
    });
  };

  useEffect(() => {
    if (!auth.workspaceId) {
      setHydrating(false);
      setStep(0);
      setWorkspaceName((value) => value || loadDraft(draftStorage).workspace || "");
      return;
    }
    let cancelled = false;
    setHydrating(true);
    Promise.all([
      apiFetch<any>("/api/workspaces/current", {}, auth.workspaceId),
      apiFetch<any>("/api/workspaces/onboarding", {}, auth.workspaceId),
      loadLaunch(auth.workspaceId),
    ])
      .then(([current, progress]) => {
        if (cancelled) return;
        const profile = current.businessProfile || {};
        const draft = loadDraft(draftStorage);
        const scoped = draft.workspaceId && draft.workspaceId === auth.workspaceId ? draft : {};
        setBusiness((value) => hydrateFromDraft({
          ...value,
          ...profile,
          abn: profile.abn || "",
          phone: profile.phone || "",
          email: profile.email || auth.user?.email || "",
          website: profile.website || "",
          description: profile.description || "",
          street_address: profile.street_address || "",
          suburb: profile.suburb || "",
          state: profile.state || "SA",
          postcode: profile.postcode || "",
        }, scoped.business));
        if (scoped.workspace) setWorkspaceName((value) => value || scoped.workspace || "");
        setService((value) => hydrateFromDraft(value, scoped.service));
        const completed = new Set(
          (progress.steps || [])
            .filter((item: any) => item.status === "complete")
            .map((item: any) => item.step_key),
        );
        if (!completed.has("business")) setStep(1);
        else if (!completed.has("services")) setStep(2);
        else if (!completed.has("operator")) setStep(3);
        else if (!completed.has("billing")) setStep(4);
        else setStep(5);
      })
      .catch((cause: any) => {
        if (!cancelled)
          setError(cause?.message || "Could not resume workspace setup.");
      })
      .finally(() => {
        if (!cancelled) setHydrating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [auth.workspaceId]);

  if (auth.loading || hydrating)
    return <div className="min-h-screen bg-slate-50"><Spinner label="Loading onboarding…" /></div>;
  if (!auth.session) return null;

  const createWorkspace = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const created = await apiFetch<{ workspaceId: string }>(
        "/api/workspaces",
        { method: "POST", body: JSON.stringify({ name: workspaceName }) },
      );
      await auth.refreshWorkspaces();
      auth.setWorkspaceId(created.workspaceId);
      setBusiness((value) => ({ ...value, trading_name: workspaceName, legal_name: workspaceName }));
      setStep(1);
    } catch (cause: any) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  const saveBusiness = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!auth.workspaceId) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch(
        "/api/workspaces/business-profile",
        { method: "PUT", body: JSON.stringify({ ...business, abn: business.abn || null, phone: business.phone || null, email: business.email || null, website: business.website || null, street_address: business.street_address || null, suburb: business.suburb || null, postcode: business.postcode || null }) },
        auth.workspaceId,
      );
      setStep(2);
    } catch (cause: any) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  const saveService = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!auth.workspaceId) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch(
        "/api/services",
        { method: "POST", body: JSON.stringify({ ...service, base_price_cents: service.base_price_dollars ? Math.round(Number(service.base_price_dollars) * 100) : null }) },
        auth.workspaceId,
      );
      setStep(3);
    } catch (cause: any) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  const completeStep = async (key: "operator" | "billing" | "activation", next?: number) => {
    if (!auth.workspaceId) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/api/workspaces/onboarding/${key}`, { method: "POST" }, auth.workspaceId);
      if (next != null) setStep(next);
      else {
        clearDraft(draftStorage);
        navigate("/app");
      }
    } catch (cause: any) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };

  const serviceNeedsPrice = service.pricing_mode !== "quote";
  const providerChecks = [
    { label: "Stripe billing", ready: launch.stripeConfigured },
    { label: "Twilio messaging and calls", ready: launch.twilioConnected },
    { label: "Transactional email", ready: launch.readiness.email },
    { label: "OpenAI Admin", ready: launch.readiness.openai },
  ];

  return <div className="min-h-screen bg-slate-50">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4"><span className="font-black tracking-tight">JOBRIN.AI</span><div className="flex items-center gap-2 text-xs font-semibold text-slate-500"><ShieldCheck className="h-4 w-4 text-emerald-600" />Secure workspace setup</div></div></header>
    <main className="mx-auto grid max-w-6xl gap-8 px-5 py-10 lg:grid-cols-[240px_1fr]">
      <aside><p className="mb-4 text-xs font-bold uppercase tracking-[.18em] text-slate-400">Setup</p><div className="space-y-1">{STEPS.map((item, index) => <button key={item} type="button" disabled={index >= step} onClick={() => index < step && setStep(index)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold ${step === index ? "bg-white text-slate-950 shadow-sm" : index < step ? "text-emerald-700 hover:bg-white/70" : "text-slate-400"}`}><span className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-[11px] ${index < step ? "bg-emerald-100" : step === index ? "bg-slate-950 text-white" : "bg-slate-200 text-slate-500"}`}>{index < step ? <Check className="h-3.5 w-3.5" /> : index + 1}</span>{item}</button>)}</div></aside>
      <div className="max-w-3xl">
        {error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {step === 0 && <Card className="p-7"><p className="text-sm font-bold text-indigo-600">Workspace</p><h1 className="mt-2 text-3xl font-black">Create your secure workspace</h1><p className="mt-2 text-sm leading-6 text-slate-500">This creates the private boundary for one business. The next screen collects the business details once—nothing is entered twice.</p><form onSubmit={createWorkspace} className="mt-7 space-y-5"><Field label="Business name" value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} minLength={2} maxLength={100} required placeholder="Bradley Plumbing & Maintenance" /><PrimaryButton disabled={busy}>{busy ? "Creating…" : "Create workspace & continue"}</PrimaryButton></form></Card>}

        {step === 1 && <Card className="p-7"><p className="text-sm font-bold text-indigo-600">Business</p><h1 className="mt-2 text-3xl font-black">Teach Jobrin.ai who you are</h1><p className="mt-2 text-sm leading-6 text-slate-500">These details appear on customer documents and ground the AI Admin. Only the trading name is required now; the rest can be completed later in Settings.</p><form onSubmit={saveBusiness} className="mt-7 grid gap-4 sm:grid-cols-2"><Field label="Trading name" value={business.trading_name} onChange={(event) => setBusiness((value) => ({ ...value, trading_name: event.target.value }))} required /><Field label="Legal name" value={business.legal_name} onChange={(event) => setBusiness((value) => ({ ...value, legal_name: event.target.value }))} /><Field label="ABN" value={business.abn} onChange={(event) => setBusiness((value) => ({ ...value, abn: event.target.value }))} hint="Optional during setup; verify before issuing tax invoices." /><SelectField label="Industry" value={business.industry} onChange={(event) => setBusiness((value) => ({ ...value, industry: event.target.value }))}><option value="plumbing">Plumbing</option><option value="electrical">Electrical</option><option value="hvac">HVAC</option><option value="building">Building</option><option value="cleaning">Cleaning</option><option value="landscaping">Landscaping</option><option value="painting">Painting</option><option value="pest_control">Pest control</option><option value="handyman">Handyman</option><option value="other">Other service</option></SelectField><Field label="Phone" value={business.phone} onChange={(event) => setBusiness((value) => ({ ...value, phone: event.target.value }))} /><Field label="Email" type="email" value={business.email} onChange={(event) => setBusiness((value) => ({ ...value, email: event.target.value }))} /><Field label="Website" type="url" value={business.website} onChange={(event) => setBusiness((value) => ({ ...value, website: event.target.value }))} placeholder="https://" /><SelectField label="Timezone" value={business.timezone} onChange={(event) => setBusiness((value) => ({ ...value, timezone: event.target.value }))}><option>Australia/Adelaide</option><option>Australia/Sydney</option><option>Australia/Brisbane</option><option>Australia/Perth</option><option>Australia/Darwin</option><option>Australia/Hobart</option></SelectField><Field label="Street address" value={business.street_address} onChange={(event) => setBusiness((value) => ({ ...value, street_address: event.target.value }))} /><Field label="Suburb" value={business.suburb} onChange={(event) => setBusiness((value) => ({ ...value, suburb: event.target.value }))} /><Field label="State" value={business.state} onChange={(event) => setBusiness((value) => ({ ...value, state: event.target.value }))} /><Field label="Postcode" value={business.postcode} onChange={(event) => setBusiness((value) => ({ ...value, postcode: event.target.value }))} /><div className="sm:col-span-2"><TextareaField label="Business description" value={business.description} onChange={(event) => setBusiness((value) => ({ ...value, description: event.target.value }))} placeholder="What work do you do, who do you help, and what makes your service different?" /></div><label className="flex items-center gap-2 text-sm font-medium text-slate-700 sm:col-span-2"><input type="checkbox" checked={business.gst_registered} onChange={(event) => setBusiness((value) => ({ ...value, gst_registered: event.target.checked }))} /> GST registered</label><div className="sm:col-span-2 flex items-center justify-between gap-3"><SecondaryButton type="button" onClick={() => setStep(0)}>Back</SecondaryButton><PrimaryButton disabled={busy}>Save & continue <ChevronRight className="ml-1 inline h-4 w-4" /></PrimaryButton></div></form></Card>}

        {step === 2 && <Card className="p-7"><p className="text-sm font-bold text-indigo-600">Services</p><h1 className="mt-2 text-3xl font-black">Add your first service</h1><p className="mt-2 text-sm leading-6 text-slate-500">Customer action controls whether it can be booked. Pricing controls what the AI may describe; quote-only services never expose an estimated price.</p><form onSubmit={saveService} className="mt-7 grid gap-4 sm:grid-cols-2"><Field label="Service name" value={service.name} onChange={(event) => setService((value) => ({ ...value, name: event.target.value }))} required placeholder="Blocked drain callout" /><SelectField label="Customer action" value={service.booking_type} onChange={(event) => setService((value) => ({ ...value, booking_type: event.target.value }))}><option value="bookable">Can request a booking</option><option value="quote">Quote required first</option><option value="enquiry">Enquiry only</option></SelectField><Field label="Typical duration (minutes)" type="number" min={5} max={1440} value={service.default_duration_minutes} onChange={(event) => setService((value) => ({ ...value, default_duration_minutes: Number(event.target.value) }))} /><SelectField label="Pricing" value={service.pricing_mode} onChange={(event) => setService((value) => ({ ...value, pricing_mode: event.target.value }))}><option value="quote">Quote required—no price shown</option><option value="fixed">Fixed price</option><option value="starting_from">Starting from</option><option value="hourly">Hourly</option><option value="callout_hourly">Callout + hourly</option><option value="range">Price range</option></SelectField><Field label="Base price (AUD)" type="number" min={0} step="0.01" required={serviceNeedsPrice} disabled={!serviceNeedsPrice} value={service.base_price_dollars} onChange={(event) => setService((value) => ({ ...value, base_price_dollars: event.target.value }))} hint={serviceNeedsPrice ? "Required for the selected pricing type." : "Not used for quote-only services."} /><div className="sm:col-span-2"><TextareaField label="What is included?" value={service.description} onChange={(event) => setService((value) => ({ ...value, description: event.target.value }))} /></div><div className="sm:col-span-2 flex items-center justify-between gap-3"><SecondaryButton type="button" onClick={() => setStep(1)}>Back</SecondaryButton><PrimaryButton disabled={busy}>Save service & continue</PrimaryButton></div></form></Card>}

        {step === 3 && <Card className="p-7"><p className="text-sm font-bold text-indigo-600">AI safety</p><h1 className="mt-2 text-3xl font-black">Start with safe, visible actions</h1><p className="mt-2 text-sm leading-6 text-slate-500">Jobrin.ai reads only this workspace and approved knowledge. It records its actions, drafts customer-facing work, and pauses anything consequential for a person.</p><div className="mt-6 space-y-3">{["Answer from approved business facts", "Collect customer and job details", "Draft finance, sales, marketing and support work", "Log AI actions and require approval for financial commitments"].map((value) => <div key={value} className="flex items-center gap-3 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800"><Check className="h-4 w-4" />{value}</div>)}<div className="rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-800">Phone answering, sends and live provider actions remain off until their readiness checks pass. AI output is advisory and must not be treated as accounting, tax, legal, safety or emergency advice.</div></div><PrimaryButton disabled={busy} onClick={() => void completeStep("operator", 4)} className="mt-6">Continue to plans</PrimaryButton></Card>}

        {step === 4 && <Card className="p-7"><p className="text-sm font-bold text-indigo-600">Plan</p><h1 className="mt-2 text-3xl font-black">Know the price and limits before activation</h1><p className="mt-2 text-sm leading-6 text-slate-500">Your workspace begins on the 14-day Starter trial without a card. Provider charges from Twilio, OpenAI, Resend and Stripe are separate from these platform limits.</p><div className="mt-6 grid gap-3 lg:grid-cols-3">{PLAN_KEYS.map((key) => { const plan = PLAN_CATALOG[key]; return <div key={key} className={`rounded-2xl border p-4 ${key === "starter" ? "border-indigo-400 bg-indigo-50/50" : "border-slate-200"}`}><div className="flex items-center justify-between gap-2"><h2 className="font-bold">{plan.name}</h2>{key === "starter" && <StatusPill tone="indigo">trial</StatusPill>}</div><p className="mt-2"><span className="text-3xl font-black">${plan.monthlyAud}</span><span className="text-xs text-slate-500"> AUD/month</span></p><p className="mt-2 min-h-12 text-xs leading-5 text-slate-500">{plan.description}</p><ul className="mt-3 space-y-2">{plan.highlights.map((item) => <li key={item} className="flex gap-2 text-xs text-slate-600"><Check className="mt-0.5 h-3.5 w-3.5 flex-none text-emerald-600" />{item}</li>)}</ul></div>; })}</div><p className="mt-4 text-xs leading-5 text-slate-500">An “AI Admin action” is one completed model-assisted task or turn—not raw model tokens. Usage is metered per workspace each calendar month and shown on Billing.</p><PrimaryButton disabled={busy} onClick={() => void completeStep("billing", 5)} className="mt-6">Continue to final checks</PrimaryButton></Card>}

        {step === 5 && <Card className="p-7"><p className="text-sm font-bold text-indigo-600">Test & activate</p><h1 className="mt-2 text-3xl font-black">Your workspace is ready for real work</h1><p className="mt-2 text-sm leading-6 text-slate-500">Core records work on the Starter trial now. External features stay visibly off until the matching provider is connected—this does not block you from entering the app.</p><div className="mt-6 divide-y divide-slate-100 rounded-2xl border border-slate-200"><div className="flex items-center justify-between p-4"><div><p className="text-sm font-semibold">Workspace, business and service</p><p className="text-xs text-slate-500">Saved and isolated to this business.</p></div><StatusPill tone="green">ready</StatusPill></div><div className="flex items-center justify-between p-4"><div><p className="text-sm font-semibold">Starter trial</p><p className="text-xs text-slate-500">{launch.subscription?.status === "trialing" && launch.subscription?.trial_ends_at ? `Ends ${new Date(launch.subscription.trial_ends_at).toLocaleDateString("en-AU")}` : launch.subscription?.status || "Check Billing"}</p></div><StatusPill tone={launch.subscription ? "green" : "amber"}>{launch.subscription ? "ready" : "check"}</StatusPill></div>{providerChecks.map((check) => <div key={check.label} className="flex items-center justify-between gap-4 p-4"><div><p className="text-sm font-semibold">{check.label}</p><p className="text-xs text-slate-500">{check.ready ? "Connected for this workspace." : "Optional now; connect before using this feature live."}</p></div><StatusPill tone={check.ready ? "green" : "slate"}>{check.ready ? "ready" : "setup later"}</StatusPill></div>)}</div><div className="mt-6 flex flex-wrap gap-3"><PrimaryButton disabled={busy} onClick={() => void completeStep("activation")}>{busy ? "Opening…" : "Open Jobrin.ai"}</PrimaryButton><AppLink href="/app/integrations" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700">Provider setup</AppLink><AppLink href="/app/billing" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700">Billing details</AppLink></div></Card>}
      </div>
    </main>
  </div>;
}
