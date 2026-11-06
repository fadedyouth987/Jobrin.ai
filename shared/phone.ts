// Australian display formatting for E.164 numbers, shared by the owner alert
// SMS and the app: +61412345678 -> 0412 345 678; +61291234567 -> 02 9123 4567.
// Anything else (overseas, malformed) is returned unchanged so nothing is lost.
export function formatAuPhone(value: string | null | undefined): string {
  const raw = (value ?? '').trim();
  const match = raw.match(/^\+61(\d{9})$/);
  if (!match) return raw;
  const local = `0${match[1]}`;
  if (local.startsWith('04') || local.startsWith('05')) return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
  return `${local.slice(0, 2)} ${local.slice(2, 6)} ${local.slice(6)}`;
}
