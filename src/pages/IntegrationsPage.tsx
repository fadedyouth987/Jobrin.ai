import React, { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, PlugZap, RefreshCcw } from "lucide-react";
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

export function IntegrationsPage() {
  const { workspaceId } = useAuth();
  const [data, setData] = useState<Payload>({
    integrations: [],
    readiness: { stripe: false, twilio: false, email: false, openai: false },
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
  useEffect(() => {
    void load();
  }, [workspaceId]);

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
            Provider health
          </p>
          <h1 className="mt-1 text-3xl font-black tracking-tight">
            Integrations
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            Configured means valid server-side credentials are present.
            Connected means the provider is also assigned to this workspace.
            Roadmap providers remain visibly unavailable.
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
    </div>
  );
}
