// Go-live review for the AI receptionist. Pure logic, unit-tested without a
// database. The architecture's go-live checklist (AI_RECEPTIONIST_ARCHITECTURE.md)
// requires more than technical readiness: the business profile must be
// complete, approved knowledge must exist, a handoff number must be set, and a
// workspace owner must sign off after reviewing the setup and phase-1 tests.
// A live-answering switch must never unlock on a hidden flag or on technical
// checks alone.

export type GoLiveChecklistItem = { key: string; label: string; ok: boolean; fix: string };

export type GoLiveChecklistInput = {
  profile: {
    transfer_number: string | null;
    recording_enabled: boolean;
    recording_consent_prompt?: string | null;
  } | null;
  businessProfile: {
    trading_name: string | null;
    phone: string | null;
    suburb: string | null;
    state: string | null;
  } | null;
  approvedKnowledgeCount: number;
  technical: { twilio: boolean; ai: boolean; securePublicUrl: boolean; conversationRelay: boolean };
  signoff?: { decided_at: string; decided_by: string; decision_note?: string | null } | null;
};

export type GoLiveChecklist = {
  items: GoLiveChecklistItem[];
  ready: boolean;
  missing: string[];
  signoff: { decided_at: string; decided_by: string; decision_note: string | null } | null;
};

export function evaluateGoLiveChecklist(input: GoLiveChecklistInput): GoLiveChecklist {
  const items: GoLiveChecklistItem[] = [
    { key: 'twilio', label: 'Twilio number connected', ok: input.technical.twilio, fix: 'Add your Twilio credentials and activate your business number under Integrations.' },
    { key: 'ai', label: 'AI engine configured', ok: input.technical.ai, fix: 'Add OPENAI_API_KEY to the server environment — the voice conversation runs on it.' },
    { key: 'https', label: 'Public HTTPS address', ok: input.technical.securePublicUrl, fix: 'Phone providers require HTTPS. APP_URL must be an https:// address once deployed.' },
    { key: 'engine', label: 'Conversation engine attached', ok: input.technical.conversationRelay, fix: 'The conversation service is not attached in this runtime — restart the server or redeploy the Worker.' },
    {
      key: 'profile',
      label: 'Business profile complete',
      ok: Boolean(input.businessProfile?.trading_name && input.businessProfile?.phone),
      fix: 'Complete the business profile (trading name and phone) — the receptionist introduces the business with it.',
    },
    {
      key: 'knowledge',
      label: 'Approved knowledge published',
      ok: input.approvedKnowledgeCount > 0,
      fix: 'Approve at least one knowledge document so the receptionist answers only from verified business facts.',
    },
    {
      key: 'transfer',
      label: 'Warm-transfer number set',
      ok: Boolean(input.profile?.transfer_number),
      fix: 'Set the warm-transfer number so the receptionist can hand off to a person when unsure.',
    },
  ];
  if (input.profile?.recording_enabled) {
    items.push({
      key: 'recording_consent',
      label: 'Recording consent prompt configured',
      ok: Boolean(input.profile.recording_consent_prompt && input.profile.recording_consent_prompt.trim().length >= 10),
      fix: 'Provide the consent prompt played before any recording starts — no consent, no recording.',
    });
  }
  const signoff = input.signoff
    ? { decided_at: input.signoff.decided_at, decided_by: input.signoff.decided_by, decision_note: input.signoff.decision_note ?? null }
    : null;
  items.push({
    key: 'signoff',
    label: 'Owner sign-off recorded',
    ok: Boolean(signoff),
    fix: 'The workspace owner reviews the setup and phase-1 behaviour, then records sign-off. Live answering stays locked without it.',
  });
  const missing = items.filter((item) => !item.ok).map((item) => item.label);
  return { items, ready: missing.length === 0, missing, signoff };
}