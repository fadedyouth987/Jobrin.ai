// Pure helpers for the owner's "new job" SMS. No I/O, so they are unit-tested
// directly (tests/ownerAlert.test.ts).
import { formatAuPhone } from '../../shared/phone';

export { formatAuPhone };

export type Urgency = 'emergency' | 'urgent' | 'routine';

export function normalizeUrgency(value: unknown): Urgency | null {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return v === 'emergency' || v === 'urgent' || v === 'routine' ? v : null;
}

// Keeps a message in the GSM-7 alphabet. A single em dash, curly quote or
// emoji silently switches an SMS to UCS-2, which more than halves the
// characters per segment (and doubles the cost). Callers' words come through
// speech-to-text and the model, so they can contain any of these.
const GSM_BASIC = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const REPLACEMENTS: Record<string, string> = {
  '\u2018': "'", '\u2019': "'", '\u201A': "'", '\u201B': "'", '\u2032': "'",
  '\u201C': '"', '\u201D': '"', '\u201E': '"', '\u2033': '"',
  '\u2013': '-', '\u2014': '-', '\u2015': '-', '\u2212': '-', '\u2010': '-', '\u2011': '-',
  '\u2026': '...', '\u00A0': ' ', '\u2009': ' ', '\u202F': ' ', '\t': ' ',
};
export function toGsm7(text: string): string {
  let out = '';
  for (const char of text) {
    if (REPLACEMENTS[char] !== undefined) out += REPLACEMENTS[char];
    else if (GSM_BASIC.includes(char)) out += char;
    else {
      const stripped = char.normalize('NFD').replace(/[\u0300-\u036F]/g, '');
      out += GSM_BASIC.includes(stripped) ? stripped : '';
    }
  }
  return out.replace(/ {2,}/g, ' ');
}

export type OwnerAlertInput = {
  callerName?: string | null;
  callerNumber?: string | null;
  suburb?: string | null;
  jobType?: string | null;
  urgency?: Urgency | null;
  note?: string | null;
  leadsUrl: string;
};

// Three SMS segments at most (459 GSM-7 characters).
export const OWNER_ALERT_MAX_LENGTH = 459;

export function buildOwnerAlertSms(input: OwnerAlertInput): string {
  const clean = (value: string | null | undefined, max: number) => toGsm7((value ?? '').replace(/\s+/g, ' ').trim()).slice(0, max).trim();
  const job = clean(input.jobType, 80);
  const suburb = clean(input.suburb, 60);
  const name = clean(input.callerName, 60);
  const number = input.callerNumber ? formatAuPhone(input.callerNumber) : '';
  const prefix = input.urgency === 'emergency' ? 'EMERGENCY - ' : input.urgency === 'urgent' ? 'URGENT - ' : '';

  const headline = job ? `${prefix}New job: ${job}${suburb ? `, ${suburb}` : ''}.` : `${prefix}Missed call${suburb ? ` from ${suburb}` : ''}.`;
  const who = name && number ? `${name}, ${number}.` : name ? `${name} (no number).` : number ? `Caller ${number}.` : 'Number withheld.';
  const action = number ? `Call back on ${number}.` : '';
  const tail = `Jobs: ${input.leadsUrl}`;

  const fixed = ['Jobrin:', headline, who, action, tail].filter(Boolean).join(' ');
  const room = OWNER_ALERT_MAX_LENGTH - fixed.length - 3;
  const note = room > 20 ? clean(input.note, room) : '';
  const body = note
    ? ['Jobrin:', headline, who, `"${note}"`, action, tail].filter(Boolean).join(' ')
    : fixed;
  return body.slice(0, OWNER_ALERT_MAX_LENGTH);
}
