import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// Shared PDF renderer for quotes and invoices. Pure JS (pdf-lib), no native
// bindings and no headless-browser dependency, so it runs unchanged on the
// Node server and inside the Cloudflare Worker.

export type DocumentLineItem = {
  description: string;
  quantity: number;
  unit_price_cents: number;
  gst_rate: number;
};

export type BusinessDetails = {
  trading_name: string | null;
  abn?: string | null;
  gst_registered?: boolean | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  street_address?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
};

export type CustomerDetails = {
  display_name: string | null;
  email?: string | null;
};

export type DocumentPdfInput = {
  kind: 'quote' | 'invoice';
  number: number | string;
  status: string;
  createdAt?: string | null;
  dueOrExpiresAt?: string | null;
  business: BusinessDetails | null;
  customer: CustomerDetails | null;
  items: DocumentLineItem[];
  subtotalCents: number;
  gstCents: number;
  totalCents: number;
  depositCents?: number | null;
  balanceDueCents?: number | null;
  notes?: string | null;
  terms?: string | null;
};

function money(cents: number): string {
  return `$${(Math.round(cents) / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '—';
  }
}

// Generates a one-page A4 PDF for a quote or invoice. Returns the raw bytes
// as a Uint8Array, ready to stream in a response or base64-encode for an
// email attachment.
export async function generateDocumentPdf(input: DocumentPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4 in points
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const margin = 48;
  const pageWidth = page.getWidth();
  const contentWidth = pageWidth - margin * 2;
  let y = page.getHeight() - margin;

  const ink = rgb(0.06, 0.09, 0.16);
  const muted = rgb(0.42, 0.46, 0.53);
  const accent = rgb(0.29, 0.33, 0.93);
  const line = rgb(0.86, 0.88, 0.92);

  const drawText = (text: string, x: number, yy: number, opts: { font?: typeof font; size?: number; color?: ReturnType<typeof rgb> } = {}) => {
    page.drawText(text || '', { x, y: yy, size: opts.size ?? 10, font: opts.font ?? font, color: opts.color ?? ink });
  };

  // Header: business identity + document title/number/status.
  const businessName = input.business?.trading_name || 'Your business';
  drawText(businessName, margin, y, { font: bold, size: 18 });
  const docTitle = input.kind === 'quote' ? 'QUOTE' : 'INVOICE';
  const titleWidth = bold.widthOfTextAtSize(docTitle, 20);
  drawText(docTitle, pageWidth - margin - titleWidth, y + 2, { font: bold, size: 20, color: accent });
  y -= 18;

  const businessLines: string[] = [];
  const addressParts = [input.business?.street_address, input.business?.suburb, input.business?.state, input.business?.postcode].filter(Boolean);
  if (addressParts.length) businessLines.push(addressParts.join(', '));
  if (input.business?.phone) businessLines.push(`Phone: ${input.business.phone}`);
  if (input.business?.email) businessLines.push(input.business.email);
  if (input.business?.website) businessLines.push(input.business.website);
  if (input.business?.abn) businessLines.push(`ABN: ${input.business.abn}`);
  for (const l of businessLines) {
    drawText(l, margin, y, { size: 9, color: muted });
    y -= 13;
  }

  const numberLabel = `#${input.number}`;
  const numberWidth = bold.widthOfTextAtSize(numberLabel, 12);
  drawText(numberLabel, pageWidth - margin - numberWidth, y + businessLines.length * 13 - 13, { font: bold, size: 12 });
  const statusLabel = input.status.toUpperCase();
  const statusWidth = font.widthOfTextAtSize(statusLabel, 9);
  drawText(statusLabel, pageWidth - margin - statusWidth, y + businessLines.length * 13 - 28, { size: 9, color: muted });

  y -= 10;
  page.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: 1, color: line });
  y -= 22;

  // Customer + dates block.
  drawText('Billed to', margin, y, { font: bold, size: 10 });
  drawText(input.kind === 'quote' ? 'Created' : 'Issued', margin + contentWidth * 0.55, y, { font: bold, size: 10 });
  drawText(input.kind === 'quote' ? 'Expires' : 'Due', margin + contentWidth * 0.78, y, { font: bold, size: 10 });
  y -= 15;
  drawText(input.customer?.display_name || 'Customer', margin, y, { size: 10 });
  drawText(formatDate(input.createdAt), margin + contentWidth * 0.55, y, { size: 10 });
  drawText(formatDate(input.dueOrExpiresAt), margin + contentWidth * 0.78, y, { size: 10 });
  if (input.customer?.email) {
    y -= 13;
    drawText(input.customer.email, margin, y, { size: 9, color: muted });
  }
  y -= 26;

  // Line-item table.
  const colDesc = margin;
  const colQty = margin + contentWidth * 0.55;
  const colPrice = margin + contentWidth * 0.7;
  const colTotal = pageWidth - margin;

  const drawRow = (cells: [string, string, string, string], opts: { font?: typeof font; color?: ReturnType<typeof rgb> } = {}) => {
    const f = opts.font ?? font;
    drawText(cells[0], colDesc, y, { font: f, color: opts.color });
    drawText(cells[1], colQty, y, { font: f, color: opts.color });
    drawText(cells[2], colPrice, y, { font: f, color: opts.color });
    const totalWidth = f.widthOfTextAtSize(cells[3], 10);
    drawText(cells[3], colTotal - totalWidth, y, { font: f, color: opts.color });
  };

  drawRow(['Description', 'Qty', 'Unit price', 'Line total'], { font: bold, color: muted });
  y -= 8;
  page.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: 0.75, color: line });
  y -= 16;

  for (const item of input.items) {
    const lineSubtotal = Math.round(item.quantity * item.unit_price_cents);
    const desc = item.description.length > 60 ? `${item.description.slice(0, 57)}...` : item.description;
    drawRow([desc, String(item.quantity), money(item.unit_price_cents), money(lineSubtotal)]);
    y -= 17;
    if (y < 220) break; // Guard against overflow; one-page layout by design.
  }

  y -= 6;
  page.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: 0.75, color: line });
  y -= 20;

  // Totals block, right-aligned.
  const totalsX = margin + contentWidth * 0.6;
  const drawTotalRow = (label: string, value: string, opts: { font?: typeof font; size?: number } = {}) => {
    const f = opts.font ?? font;
    const size = opts.size ?? 10;
    drawText(label, totalsX, y, { font: f, size });
    const valueWidth = f.widthOfTextAtSize(value, size);
    drawText(value, pageWidth - margin - valueWidth, y, { font: f, size });
    y -= 16;
  };

  drawTotalRow('Subtotal', money(input.subtotalCents));
  drawTotalRow(input.business?.gst_registered === false ? 'GST' : 'GST (10%)', money(input.gstCents));
  drawTotalRow('Total', money(input.totalCents), { font: bold, size: 13 });
  if (input.depositCents && input.depositCents > 0) drawTotalRow('Deposit requested', money(input.depositCents));
  if (input.balanceDueCents != null) drawTotalRow('Balance due', money(input.balanceDueCents), { font: bold });

  y -= 10;

  if (input.notes) {
    drawText('Notes', margin, y, { font: bold, size: 10 });
    y -= 14;
    drawText(input.notes.slice(0, 400), margin, y, { size: 9, color: muted });
    y -= 20;
  }
  if (input.terms) {
    drawText('Terms', margin, y, { font: bold, size: 10 });
    y -= 14;
    drawText(input.terms.slice(0, 400), margin, y, { size: 9, color: muted });
  }

  // Footer.
  const footerY = 40;
  page.drawLine({ start: { x: margin, y: footerY + 16 }, end: { x: pageWidth - margin, y: footerY + 16 }, thickness: 0.5, color: line });
  drawText(`Generated by Jobrin.ai for ${businessName}`, margin, footerY, { size: 8, color: muted });

  const bytes = await doc.save();
  return bytes;
}
