import React from 'react';
import { PublicHeader } from '../components/saas/PublicHeader';

const LAST_UPDATED = '9 September 2026';

function LegalLayout({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-50"><PublicHeader/><main id="main-content" className="mx-auto max-w-3xl px-5 py-16 lg:px-8"><p className="text-sm font-bold uppercase tracking-[.18em] text-indigo-600">Jobrin.ai</p><h1 className="mt-3 text-4xl font-black tracking-tight">{title}</h1><p className="mt-3 text-sm leading-6 text-slate-500">{subtitle}</p><p className="mt-1 text-xs text-slate-400">Last updated {LAST_UPDATED}</p><div className="mt-8 space-y-6 text-sm leading-7 text-slate-700">{children}</div></main></div>;
}

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return <section><h2 className="text-base font-bold text-slate-950">{heading}</h2><p className="mt-2">{children}</p></section>;
}

export function PrivacyPage() {
  return <LegalLayout title="Privacy policy" subtitle="This policy explains how Jobrin.ai handles account, business, customer and service-delivery information when Australian trade and service businesses use the platform.">
    <Section heading="Information we handle">We handle account details, workspace and team information, customer contact details, leads, jobs, schedules, quotes, invoices, payment status, messages, call metadata, uploaded job records and the configuration needed to operate the service. Payment card details are handled by Stripe and are not stored by Jobrin.ai.</Section>
    <Section heading="How information is used">Information is used to provide and secure the service, route authorised communications, operate requested AI features, process subscriptions and invoice payments, prevent abuse, diagnose failures and maintain audit records. AI output is advisory and consequential actions remain subject to the permissions and approvals shown in the product.</Section>
    <Section heading="Service providers">Jobrin.ai may send the minimum required information to configured infrastructure, authentication, payment, communications, email and AI providers, including Supabase, Cloudflare, Stripe, Twilio, Resend and OpenAI. A provider is used only when the corresponding feature is configured.</Section>
    <Section heading="Access and retention">Workspace access is restricted by account, membership and role. Business customers control the records they enter and are responsible for having an appropriate basis to collect and use their own customer data. Records are retained while required to provide the service, meet legal obligations, resolve disputes and preserve security or financial audit history.</Section>
    <Section heading="Your choices">You may request access to or correction of personal information, ask a privacy question, or request account closure by emailing support@jobrin.ai. Some financial, security and audit records may need to be retained.</Section>
  </LegalLayout>;
}

export function TermsPage() {
  return <LegalLayout title="Terms of service" subtitle="These terms apply when a business creates or uses a Jobrin.ai workspace. They should be read together with the pricing page and privacy policy.">
    <Section heading="The service">Jobrin.ai provides hosted business operations software. Provider-backed capabilities such as calls, SMS, AI, email and payments are available only when the relevant connection is configured and operational. The service is not an emergency dispatch service and must not be relied on for urgent safety communications.</Section>
    <Section heading="Accounts and authorised use">You are responsible for authorised workspace access, accurate account information, secure credentials and the actions of your team members. You must not use the service unlawfully, attempt to bypass security or usage limits, or send communications without the consent required by applicable law.</Section>
    <Section heading="Subscriptions">After any stated trial, paid plans renew through Stripe according to the billing interval shown at checkout. Plan limits and included usage are shown in the product. You can manage payment methods, plan changes and cancellation through the Stripe billing portal. Cancellation stops future renewal but does not reverse charges already incurred unless required by law.</Section>
    <Section heading="AI and automation">AI-generated responses, summaries and suggestions can be incomplete or incorrect. You remain responsible for reviewing outputs and for business, employment, safety, pricing, legal and financial decisions. Approval controls do not replace your own review obligations.</Section>
    <Section heading="Availability and liability">We aim to operate a reliable service but do not promise uninterrupted availability. To the extent permitted by law, Jobrin.ai is not liable for indirect or consequential loss, lost profits, missed work or decisions made from unreviewed AI output. Rights that cannot lawfully be excluded remain unaffected.</Section>
    <Section heading="Contact">Questions about these terms can be sent to support@jobrin.ai.</Section>
  </LegalLayout>;
}

export function SupportPage() {
  return <LegalLayout title="Support" subtitle="Get help with setup, billing, account access, provider connections or an unexpected product error.">
    <Section heading="Contact support">Email support@jobrin.ai with your workspace name, what you were trying to do and the approximate time of the problem. Do not send passwords, API keys, payment card details or sensitive customer records.</Section>
    <Section heading="Account and billing">Workspace owners can manage subscriptions and payment methods from Billing. For account access problems, email from the address associated with the account so ownership can be verified.</Section>
    <Section heading="Service incidents">For provider-backed features, check the Integrations page first. It reports whether Stripe, Twilio, email, AI and other configured services are available. Emergency or safety-critical matters must be handled through normal emergency and business channels, not Jobrin.ai support.</Section>
  </LegalLayout>;
}
