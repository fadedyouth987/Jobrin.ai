// Multiple-phone-numbers support: pure helpers used by both the inbound
// Twilio webhooks (server/routes/receptionist.ts, server/routes/
// communications.ts) and the number-management routes (server/routes/
// integrations.ts). Kept side-effect free and DB-client free so they are
// unit testable without mocking Supabase.

export const PHONE_NUMBER_E164 = /^\+[1-9]\d{7,14}$/;

export type WorkspacePhoneNumberRow = {
  id: string;
  workspace_id: string;
  phone_number: string;
  label: string;
  is_primary: boolean;
  status: 'active' | 'inactive';
  display_name_override: string | null;
  greeting_override: string | null;
  voice_provider_override: 'Google' | 'Amazon' | 'ElevenLabs' | null;
  voice_id_override: string | null;
  language_override: string | null;
  after_hours_message_override: string | null;
};

export type ReceptionistProfileLike = {
  display_name: string;
  greeting: string;
  voice_provider: string;
  voice_id: string;
  language: string;
  after_hours_message: string;
  [key: string]: unknown;
};

// The exact set of caller-facing fields a number is allowed to override.
// Everything else (business_instructions, transfer_number, limits, etc.)
// always comes from the workspace's single receptionist_profiles row --
// only what a caller actually hears/sees differs per number.
export function mergeNumberOverrides<T extends ReceptionistProfileLike>(
  profile: T,
  number: WorkspacePhoneNumberRow | null | undefined,
): T {
  if (!number) return profile;
  return {
    ...profile,
    display_name: number.display_name_override ?? profile.display_name,
    greeting: number.greeting_override ?? profile.greeting,
    voice_provider: number.voice_provider_override ?? profile.voice_provider,
    voice_id: number.voice_id_override ?? profile.voice_id,
    language: number.language_override ?? profile.language,
    after_hours_message: number.after_hours_message_override ?? profile.after_hours_message,
  };
}
