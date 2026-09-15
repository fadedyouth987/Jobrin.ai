import React, { useEffect, useState } from "react";
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  ExternalLink,
  Mail,
  Phone,
  PlugZap,
  RefreshCcw,
} from "lucide-react";
import { useAuth } from "../app/auth";
import { AppLink } from "../app/router";
import { apiFetch } from "../lib/api";
import {
  Card,
  PrimaryButton,
  SecondaryButton,
  Spinner,
  StatusPill,
} from "../components/saas/ui";

type Integration = {
  provider: string;
  status: string;
  external_account_id?: string | null;
  error_code?: string | null;
};
type Readiness = Record<"stripe" | "twilio" | "email" | "openai", boolean>;
type Payload = { integrations: Integration[]; readiness: Readiness };

type PhoneNumber = {
  id: string;
  phone_number: string;
  label: string;
  is_primary: boolean;
  status: "active" | "inactive";
  display_name_override: string | null;
  greeting_override: string | null;
};

const providers = [
  [
    "stripe",
    "Stripe",
    "Subscriptions and customer invoice payments",
    "/app/billing",
  ],
  ["twilio", "Twilio", "SMS inbox, campaigns and AI receptionist calls", null],
  ["email", "Resend email", "Transactional quote and invoice delivery", null],
  [
    "openai",
    "OpenAI",
    "Receptionist replies and Business Brain extraction",
    null,
  ],
  [
    "google_calendar",
    "Google Calendar",
    "Two-way booking conflict and event sync",
    null,
  ],
  [
    "xero",
    "Xero, MYOB & QuickBooks",
    "Accounting customer, invoice and payment sync",
    "/app/coming-soon/accounting-sync",
  ],
  [
    "zapier",
    "Zapier & API",
    "Outbound webhooks and documented workspace API",
    "/app/coming-soon/zapier-api",
  ],
] as const;

const everydayTools = [
  {
    key: "payments",
    title: "Take payments",
    description:
      "Send invoices with secure payment links. Customers pay through a hosted checkout, so card details stay out of Jobrin.ai.",
    readiness: "stripe",
    icon: CreditCard,
    href: "/app/billing",
  },
  {
    key: "phone",
    title: "Business phone and texts",
    description:
      "Route calls and SMS into this workspace using managed business numbers.",
    readiness: "twilio",
    icon: Phone,
    href: null,
  },
  {
    key: "email",
    title: "Send quotes and invoices",
    description:
      "Email customer documents and payment links directly from Jobrin.ai.",
    readiness: "email",
    icon: Mail,
    href: null,
  },
  {
    key: "ai",
    title: "AI receptionist and admin",
    description:
      "Use approved business facts to answer calls, draft replies and prepare controlled admin work.",
    readiness: "openai",
    icon: Bot,
    href: null,
  },
] as const;

function AdvancedPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-lg border border-slate-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4">
        <span>
          <span className="block text-sm font-bold text-slate-950">
            {title}
          </span>
          <span className="mt-0.5 block text-xs leading-5 text-slate-500">
            {description}
          </span>
        </span>
        <ChevronDown className="h-4 w-4 flex-none text-slate-400 transition group-open:rotate-180" />
      </summary>
      <div className="border-t border-slate-100 p-5">{children}</div>
    </details>
  );
}

export function IntegrationsPage() {
  const { workspaceId } = useAuth();
  const [data, setData] = useState<Payload>({
    integrations: [],
    readiness: { stripe: false, twilio: false, email: false, openai: false },
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [numbersError, setNumbersError] = useState("");
  const [numbersBusy, setNumbersBusy] = useState(false);
  const [newNumber, setNewNumber] = useState("");
  const [newLabel, setNewLabel] = useState("");

  const load = async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError("");
    try {
      setData(await apiFetch<Payload>("/api/integrations", {}, workspaceId));
    } catch (err: any) {
      setError(err.message || "Could not load provider readiness.");
    } finally {
      setLoading(false);
    }
  };
  const loadNumbers = async () => {
    if (!workspaceId) return;
    try {
      const payload = await apiFetch<{ numbers: PhoneNumber[] }>(
        "/api/integrations/numbers",
        {},
        workspaceId,
      );
      setNumbers(payload.numbers);
    } catch (err: any) {
      setNumbersError(err.message || "Could not load phone numbers.");
    }
  };
  useEffect(() => {
    void load();
    void loadNumbers();
  }, [workspaceId]);

  const addNumber = async () => {
    if (!workspaceId || !newNumber.trim()) return;
    setNumbersBusy(true);
    setNumbersError("");
    try {
      await apiFetch(
        "/api/integrations/numbers",
        {
          method: "POST",
          body: JSON.stringify({
            phone_number: newNumber.trim(),
            label: newLabel.trim() || "Untitled line",
          }),
        },
        workspaceId,
      );
      setNewNumber("");
      setNewLabel("");
      await loadNumbers();
    } catch (err: any) {
      setNumbersError(err.message || "Could not add that number.");
    } finally {
      setNumbersBusy(false);
    }
  };

  const toggleNumberStatus = async (number: PhoneNumber) => {
    if (!workspaceId) return;
    setNumbersBusy(true);
    setNumbersError("");
    try {
      await apiFetch(
        `/api/integrations/numbers/${number.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            status: number.status === "active" ? "inactive" : "active",
          }),
        },
        workspaceId,
      );
      await loadNumbers();
    } catch (err: any) {
      setNumbersError(err.message || "Could not update that number.");
    } finally {
      setNumbersBusy(false);
    }
  };

  const activateTwilio = async () => {
    if (!workspaceId) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch(
        "/api/integrations/twilio/activate",
        { method: "POST" },
        workspaceId,
      );
      await load();
    } catch (err: any) {
      setError(err.message || "Twilio activation failed.");
    } finally {
      setBusy(false);
    }
  };

  const byProvider = new Map(
    data.integrations.map((item) => [item.provider, item]),
  );
  if (loading) return <Spinner label="Checking provider readiness…" />;
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.18em] text-indigo-600">
            Connected tools
          </p>
          <h1 className="mt-1 text-3xl font-black tracking-tight">
            Integrations
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            Start with the business tools people actually use. Provider names,
            API keys and webhook details are kept in Advanced setup for the
            people who need them.
          </p>
        </div>
        <SecondaryButton onClick={() => void load()}>
          <RefreshCcw className="mr-2 inline h-4 w-4" />
          Refresh
        </SecondaryButton>
      </div>
      {error && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {everydayTools.map((tool) => {
          const ready =
            tool.readiness === "twilio"
              ? byProvider.get("twilio")?.status === "connected"
              : data.readiness[tool.readiness];
          const Icon = tool.icon;
          const card = (
            <Card className="h-full p-5 transition hover:border-indigo-300">
              <div className="flex items-start justify-between gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                  <Icon className="h-5 w-5" />
                </div>
                <StatusPill tone={ready ? "green" : "slate"}>
                  {ready ? "ready" : "setup later"}
                </StatusPill>
              </div>
              <h2 className="mt-4 font-bold">{tool.title}</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                {tool.description}
              </p>
            </Card>
          );
          return tool.href ? (
            <AppLink key={tool.key} href={tool.href} className="block">
              {card}
            </AppLink>
          ) : (
            <div key={tool.key}>{card}</div>
          );
        })}
      </div>

      <Card className="mt-5 p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-bold">Managed by Jobrin.ai by default</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Customers should not need their own payment, SMS, email or AI
              accounts to get started. Use advanced options only when a
              business has its own provider account or a special compliance
              requirement.
            </p>
          </div>
        </div>
      </Card>

      <div className="mt-5">
        <AdvancedPanel
          title="Advanced setup"
          description="Provider health, API-backed features and roadmap integrations."
        >
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {providers.map(([key, name, description, href]) => {
          const record = byProvider.get(key);
          const supportsReadiness = key in data.readiness;
          const configured = supportsReadiness
            ? data.readiness[key as keyof Readiness]
            : false;
          const connected = record?.status === "connected";
          const roadmap = !supportsReadiness;
          const label = connected
            ? "connected"
            : configured
              ? "configured"
              : roadmap
                ? "coming soon"
                : "needs setup";
          const tone =
            connected || configured
              ? "green"
              : record?.status === "failed"
                ? "red"
                : "slate";
          return (
            <Card key={key} className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100">
                  <PlugZap className="h-5 w-5" />
                </div>
                <StatusPill tone={tone}>{label}</StatusPill>
              </div>
              <h2 className="mt-4 font-bold">{name}</h2>
              <p className="mt-1 min-h-12 text-sm leading-6 text-slate-500">
                {description}
              </p>
              {record?.external_account_id && (
                <p className="mt-2 truncate text-xs text-slate-400">
                  {record.external_account_id}
                </p>
              )}
              {key === "twilio" && configured && !connected ? (
                <PrimaryButton
                  disabled={busy}
                  onClick={() => void activateTwilio()}
                  className="mt-4 w-full"
                >
                  {busy ? "Activating…" : "Activate for this workspace"}
                </PrimaryButton>
              ) : href ? (
                <AppLink
                  href={href}
                  className="mt-4 inline-flex w-full items-center justify-center rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700"
                >
                  {roadmap ? "View roadmap" : "Open setup"}{" "}
                  <ExternalLink className="ml-2 h-3.5 w-3.5" />
                </AppLink>
              ) : (
                <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
                  <CheckCircle2 className="h-4 w-4" />
                  {roadmap
                    ? "Roadmap only"
                    : configured
                      ? "Managed through server secrets"
                      : "Add the provider secrets to enable"}
                </div>
              )}
            </Card>
          );
        })}
          </div>
        </AdvancedPanel>
      </div>

      <div className="mt-10">
        <p className="text-xs font-bold uppercase tracking-[.18em] text-indigo-600">
          Business phone
        </p>
        <h2 className="mt-1 text-xl font-black tracking-tight">
          Phone numbers
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
          Every number below routes customer calls and SMS to this workspace.
          Most teams only need to know which number is active; provider setup
          details are tucked away below.
        </p>
        {numbersError && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {numbersError}
          </div>
        )}
        <Card className="mt-4 p-5">
          {numbers.length === 0 ? (
            <p className="text-sm text-slate-500">
              No phone numbers yet. A managed business number can be assigned
              during setup, or an existing provider number can be added below.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {numbers.map((number) => (
                <div
                  key={number.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div>
                    <p className="font-semibold">
                      {number.label}
                      {number.is_primary && (
                        <span className="ml-2 text-xs font-normal text-slate-400">
                          primary
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-slate-500">
                      {number.phone_number}
                      {(number.greeting_override ||
                        number.display_name_override) && (
                        <span className="ml-2 text-xs text-indigo-500">
                          custom greeting
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusPill
                      tone={number.status === "active" ? "green" : "slate"}
                    >
                      {number.status}
                    </StatusPill>
                    <SecondaryButton
                      disabled={numbersBusy}
                      onClick={() => void toggleNumberStatus(number)}
                    >
                      {number.status === "active" ? "Deactivate" : "Activate"}
                    </SecondaryButton>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 border-t border-slate-100 pt-4">
            <AdvancedPanel
              title="Add an existing provider number"
              description="For teams that already have a connected business number."
            >
              <p className="mb-4 text-xs leading-5 text-slate-500">
                The number must already exist in the managed phone provider
                with its voice and messaging webhooks pointed at this app.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500">
                    Phone number (E.164, e.g. +61491234567)
                  </label>
                  <input
                    className="mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={newNumber}
                    onChange={(event) => setNewNumber(event.target.value)}
                    placeholder="+61491234567"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500">
                    Label
                  </label>
                  <input
                    className="mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={newLabel}
                    onChange={(event) => setNewLabel(event.target.value)}
                    placeholder="e.g. Northside branch"
                  />
                </div>
                <PrimaryButton
                  disabled={numbersBusy || !newNumber.trim()}
                  onClick={() => void addNumber()}
                >
                  {numbersBusy ? "Adding…" : "Add number"}
                </PrimaryButton>
              </div>
            </AdvancedPanel>
          </div>
        </Card>
      </div>
    </div>
  );
}
