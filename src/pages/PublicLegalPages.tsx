import React from "react";
import { AppLink } from "../app/router";

const supportEmail = "support@jobrin.ai";

function LegalLayout({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4">
          <AppLink href="/" className="font-black tracking-tight">
            JOBRIN.AI
          </AppLink>
          <AppLink
            href="/support"
            className="text-sm font-semibold text-indigo-700"
          >
            Support
          </AppLink>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-5 py-14">
        <p className="text-xs font-bold uppercase tracking-[.18em] text-indigo-600">
          Jobrin.ai
        </p>
        <h1 className="mt-2 text-4xl font-black tracking-tight">{title}</h1>
        <p className="mt-4 max-w-3xl leading-7 text-slate-600">{summary}</p>
        <p className="mt-3 text-xs text-slate-400">
          Last updated 9 September 2026
        </p>
        <div className="mt-10 space-y-8 text-sm leading-7 text-slate-700">
          {children}
        </div>
      </main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl flex-wrap gap-5 px-5 py-8 text-sm text-slate-500">
          <AppLink href="/">Home</AppLink>
          <AppLink href="/pricing">Pricing</AppLink>
          <AppLink href="/privacy">Privacy</AppLink>
          <AppLink href="/terms">Terms</AppLink>
        </div>
      </footer>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-lg font-bold text-slate-950">{title}</h2>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

export function PrivacyPage() {
  return (
    <LegalLayout
      title="Privacy policy"
      summary="This policy explains how Jobrin.ai handles account, business, customer and service-delivery information when Australian trade and service businesses use the platform."
    >
      <Section title="Information we handle">
        <p>
          We handle account details, workspace and team information, customer
          contact details, leads, jobs, schedules, quotes, invoices, payment
          status, messages, call metadata, uploaded job records and the
          configuration needed to operate the service. Payment card details are
          handled by Stripe and are not stored by Jobrin.ai.
        </p>
      </Section>
      <Section title="How information is used">
        <p>
          Information is used to provide and secure the service, route
          authorised communications, operate requested AI features, process
          subscriptions and invoice payments, prevent abuse, diagnose failures
          and maintain audit records. AI output is advisory and consequential
          actions remain subject to the permissions and approvals shown in the
          product.
        </p>
      </Section>
      <Section title="Service providers">
        <p>
          Jobrin.ai may send the minimum required information to configured
          infrastructure, authentication, payment, communications, email and AI
          providers, including Supabase, Cloudflare, Stripe, Twilio, Resend and
          OpenAI. A provider is used only when the corresponding feature is
          configured.
        </p>
      </Section>
      <Section title="Access and retention">
        <p>
          Workspace access is restricted by account, membership and role.
          Business customers control the records they enter and are responsible
          for having an appropriate basis to collect and use their own customer
          data. Records are retained while required to provide the service, meet
          legal obligations, resolve disputes and preserve security or financial
          audit history.
        </p>
      </Section>
      <Section title="Your choices">
        <p>
          You may request access to or correction of personal information, ask a
          privacy question, or request account closure by emailing{" "}
          <a
            className="font-semibold text-indigo-700"
            href={`mailto:${supportEmail}`}
          >
            {supportEmail}
          </a>
          . Some financial, security and audit records may need to be retained.
        </p>
      </Section>
    </LegalLayout>
  );
}

export function TermsPage() {
  return (
    <LegalLayout
      title="Terms of service"
      summary="These terms apply when a business creates or uses a Jobrin.ai workspace. They should be read together with the pricing page and privacy policy."
    >
      <Section title="The service">
        <p>
          Jobrin.ai provides hosted business operations software.
          Provider-backed capabilities such as calls, SMS, AI, email and
          payments are available only when the relevant connection is configured
          and operational. The service is not an emergency dispatch service and
          must not be relied on for urgent safety communications.
        </p>
      </Section>
      <Section title="Accounts and authorised use">
        <p>
          You are responsible for authorised workspace access, accurate account
          information, secure credentials and the actions of your team members.
          You must not use the service unlawfully, attempt to bypass security or
          usage limits, or send communications without the consent required by
          applicable law.
        </p>
      </Section>
      <Section title="Subscriptions">
        <p>
          After any stated trial, paid plans renew through Stripe according to
          the billing interval shown at checkout. Plan limits and included usage
          are shown in the product. You can manage payment methods, plan changes
          and cancellation through the Stripe billing portal. Cancellation stops
          future renewal but does not reverse charges already incurred unless
          required by law.
        </p>
      </Section>
      <Section title="AI and automation">
        <p>
          AI-generated responses, summaries and suggestions can be incomplete or
          incorrect. You remain responsible for reviewing outputs and for
          business, employment, safety, pricing, legal and financial decisions.
          Approval controls do not replace your own review obligations.
        </p>
      </Section>
      <Section title="Availability and liability">
        <p>
          We aim to operate a reliable service but do not promise uninterrupted
          availability. To the extent permitted by law, Jobrin.ai is not liable
          for indirect or consequential loss, lost profits, missed work or
          decisions made from unreviewed AI output. Rights that cannot lawfully
          be excluded remain unaffected.
        </p>
      </Section>
      <Section title="Contact">
        <p>
          Questions about these terms can be sent to{" "}
          <a
            className="font-semibold text-indigo-700"
            href={`mailto:${supportEmail}`}
          >
            {supportEmail}
          </a>
          .
        </p>
      </Section>
    </LegalLayout>
  );
}

export function SupportPage() {
  return (
    <LegalLayout
      title="Support"
      summary="Get help with setup, billing, account access, provider connections or an unexpected product error."
    >
      <Section title="Contact support">
        <p>
          Email{" "}
          <a
            className="font-semibold text-indigo-700"
            href={`mailto:${supportEmail}`}
          >
            {supportEmail}
          </a>{" "}
          with your workspace name, what you were trying to do and the
          approximate time of the problem. Do not send passwords, API keys,
          payment card details or sensitive customer records.
        </p>
      </Section>
      <Section title="Account and billing">
        <p>
          Workspace owners can manage subscriptions and payment methods from
          Billing. For account access problems, email from the address
          associated with the account so ownership can be verified.
        </p>
      </Section>
      <Section title="Service incidents">
        <p>
          For provider-backed features, check the Integrations page first. It
          reports whether Stripe, Twilio, email, AI and other configured
          services are available. Emergency or safety-critical matters must be
          handled through normal emergency and business channels, not Jobrin.ai
          support.
        </p>
      </Section>
    </LegalLayout>
  );
}
