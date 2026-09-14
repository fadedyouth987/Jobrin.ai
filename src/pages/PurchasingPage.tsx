import { useEffect, useState } from 'react';
import { ClipboardList, Package, Plus, Truck } from 'lucide-react';
import { useAuth } from '../app/auth';
import { AppLink } from '../app/router';
import { apiFetch } from '../lib/api';
import { Card, EmptyState, Field, Money, PrimaryButton, SecondaryButton, SelectField, Spinner, StatusPill, TextareaField } from '../components/saas/ui';

function poTone(status: string): 'slate' | 'green' | 'amber' | 'red' | 'indigo' {
  if (status === 'received') return 'green';
  if (status === 'ordered') return 'indigo';
  if (status === 'cancelled') return 'red';
  return 'slate';
}

function Page({ title, eyebrow, description, children }: { title: string; eyebrow: string; description?: string; children: React.ReactNode }) {
  return <div><div className="mb-6"><p className="text-xs font-bold uppercase tracking-[.18em] text-indigo-600">{eyebrow}</p><h1 className="mt-1 text-3xl font-black tracking-tight">{title}</h1>{description && <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{description}</p>}</div>{children}</div>;
}

export function PurchasingPage() {
  const { workspaceId } = useAuth();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [priceBook, setPriceBook] = useState<any[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = async () => {
    if (!workspaceId) return;
    setLoading(true); setError('');
    try {
      const [s, pb, po, j] = await Promise.all([
        apiFetch<any>('/api/purchasing/suppliers', {}, workspaceId),
        apiFetch<any>('/api/purchasing/price-book', {}, workspaceId),
        apiFetch<any>('/api/purchasing/purchase-orders', {}, workspaceId),
        apiFetch<any>('/api/operations/jobs', {}, workspaceId),
      ]);
      setSuppliers(s.suppliers ?? []);
      setPriceBook(pb.items ?? []);
      setPurchaseOrders(po.purchaseOrders ?? []);
      setJobs(j.jobs ?? []);
    } catch (err: any) { setError(err.message || 'PURCHASING_LOAD_FAILED'); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [workspaceId]);

  // --- Suppliers ---
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [supplierForm, setSupplierForm] = useState({ name: '', contact_email: '', contact_phone: '', notes: '' });
  const createSupplier = async (e: React.FormEvent) => {
    e.preventDefault(); if (!workspaceId) return;
    setBusy('supplier'); setError('');
    try {
      await apiFetch('/api/purchasing/suppliers', { method: 'POST', body: JSON.stringify({
        name: supplierForm.name, contact_email: supplierForm.contact_email || null, contact_phone: supplierForm.contact_phone || null, notes: supplierForm.notes,
      }) }, workspaceId);
      setSupplierForm({ name: '', contact_email: '', contact_phone: '', notes: '' });
      setSupplierOpen(false); await load();
    } catch (err: any) { setError(err.message || 'SUPPLIER_CREATE_FAILED'); } finally { setBusy(''); }
  };

  // --- Price book ---
  const [priceBookOpen, setPriceBookOpen] = useState(false);
  const [priceBookForm, setPriceBookForm] = useState({ supplier_id: '', sku: '', description: '', unit_cost: '' });
  const createPriceBookItem = async (e: React.FormEvent) => {
    e.preventDefault(); if (!workspaceId) return;
    setBusy('pricebook'); setError('');
    try {
      await apiFetch('/api/purchasing/price-book', { method: 'POST', body: JSON.stringify({
        supplier_id: priceBookForm.supplier_id, sku: priceBookForm.sku || null, description: priceBookForm.description,
        unit_cost_cents: Math.round(Number(priceBookForm.unit_cost || 0) * 100),
      }) }, workspaceId);
      setPriceBookForm({ supplier_id: priceBookForm.supplier_id, sku: '', description: '', unit_cost: '' });
      await load();
    } catch (err: any) { setError(err.message || 'PRICE_BOOK_ITEM_CREATE_FAILED'); } finally { setBusy(''); }
  };

  const [importOpen, setImportOpen] = useState(false);
  const [importSupplier, setImportSupplier] = useState('');
  const [importText, setImportText] = useState('[\n  { "sku": "PART-100", "description": "Example part", "unit_cost_cents": 1250 }\n]');
  const [importNotice, setImportNotice] = useState('');
  const runImport = async (e: React.FormEvent) => {
    e.preventDefault(); if (!workspaceId || !importSupplier) return;
    setBusy('import'); setError(''); setImportNotice('');
    try {
      const rows = JSON.parse(importText);
      const result = await apiFetch<any>('/api/purchasing/price-book/import', { method: 'POST', body: JSON.stringify({ supplier_id: importSupplier, rows }) }, workspaceId);
      setImportNotice(`Imported ${result.imported} price book line(s).`);
      await load();
    } catch (err: any) { setError(err.message || 'PRICE_BOOK_IMPORT_FAILED — check the JSON is a valid array of {sku, description, unit_cost_cents} rows'); } finally { setBusy(''); }
  };

  // --- Purchase orders ---
  const [poOpen, setPoOpen] = useState(false);
  const [poForm, setPoForm] = useState({ supplier_id: '', job_id: '' });
  const createPO = async (e: React.FormEvent) => {
    e.preventDefault(); if (!workspaceId) return;
    setBusy('po'); setError('');
    try {
      await apiFetch('/api/purchasing/purchase-orders', { method: 'POST', body: JSON.stringify({
        supplier_id: poForm.supplier_id, job_id: poForm.job_id || null,
      }) }, workspaceId);
      setPoForm({ supplier_id: '', job_id: '' });
      setPoOpen(false); await load();
    } catch (err: any) { setError(err.message || 'PURCHASE_ORDER_CREATE_FAILED'); } finally { setBusy(''); }
  };

  const [expanded, setExpanded] = useState<string | null>(null);
  const [poDetail, setPoDetail] = useState<Record<string, any[]>>({});
  const [itemForm, setItemForm] = useState({ description: '', quantity: '1', unit_cost: '' });
  const toggleExpand = async (id: string) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (!workspaceId || poDetail[id]) return;
    try {
      const result = await apiFetch<any>(`/api/purchasing/purchase-orders/${id}`, {}, workspaceId);
      setPoDetail((v) => ({ ...v, [id]: result.items ?? [] }));
    } catch { /* row still expands; items just won't show */ }
  };
  const addItem = async (e: React.FormEvent, poId: string) => {
    e.preventDefault(); if (!workspaceId) return;
    setBusy(`item:${poId}`); setError('');
    try {
      await apiFetch(`/api/purchasing/purchase-orders/${poId}/items`, { method: 'POST', body: JSON.stringify({
        description: itemForm.description, quantity: Number(itemForm.quantity || 1), unit_cost_cents: Math.round(Number(itemForm.unit_cost || 0) * 100),
      }) }, workspaceId);
      setItemForm({ description: '', quantity: '1', unit_cost: '' });
      const result = await apiFetch<any>(`/api/purchasing/purchase-orders/${poId}`, {}, workspaceId);
      setPoDetail((v) => ({ ...v, [poId]: result.items ?? [] }));
    } catch (err: any) { setError(err.message || 'PURCHASE_ORDER_ITEM_CREATE_FAILED'); } finally { setBusy(''); }
  };
  const setPoStatus = async (poId: string, status: string) => {
    if (!workspaceId) return;
    setBusy(`status:${poId}`); setError('');
    try {
      await apiFetch(`/api/purchasing/purchase-orders/${poId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }, workspaceId);
      await load();
    } catch (err: any) { setError(err.message || 'PURCHASE_ORDER_STATUS_UPDATE_FAILED'); } finally { setBusy(''); }
  };

  if (loading) return <Spinner label="Loading purchasing…" />;

  return <Page title="Supplier purchasing" eyebrow="Field Operations" description="Order parts from suppliers, track purchase orders against jobs, and keep supplier price books up to date so quotes use current costs.">
    {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

    <div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-bold">Suppliers</h2><PrimaryButton onClick={() => setSupplierOpen((v) => !v)}><Plus className="mr-2 inline h-4 w-4" />{supplierOpen ? 'Cancel' : 'New supplier'}</PrimaryButton></div>
    {supplierOpen && <Card className="mb-5 p-5"><form onSubmit={createSupplier} className="grid gap-3 sm:grid-cols-2">
      <Field label="Supplier name" value={supplierForm.name} onChange={(e) => setSupplierForm((v) => ({ ...v, name: e.target.value }))} required placeholder="Reece Plumbing" />
      <Field label="Contact email" type="email" value={supplierForm.contact_email} onChange={(e) => setSupplierForm((v) => ({ ...v, contact_email: e.target.value }))} />
      <Field label="Contact phone" value={supplierForm.contact_phone} onChange={(e) => setSupplierForm((v) => ({ ...v, contact_phone: e.target.value }))} />
      <Field label="Notes" value={supplierForm.notes} onChange={(e) => setSupplierForm((v) => ({ ...v, notes: e.target.value }))} className="sm:col-span-2" />
      <div className="flex justify-end gap-2 sm:col-span-2"><SecondaryButton type="button" onClick={() => setSupplierOpen(false)}>Cancel</SecondaryButton><PrimaryButton disabled={busy === 'supplier'}>{busy === 'supplier' ? 'Saving…' : 'Save supplier'}</PrimaryButton></div>
    </form></Card>}
    {suppliers.length ? <Card className="mb-8 overflow-hidden"><div className="divide-y divide-slate-100">{suppliers.map((s: any) => <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"><div className="min-w-0"><p className="font-semibold">{s.name}</p><p className="text-xs text-slate-500">{[s.contact_email, s.contact_phone].filter(Boolean).join(' · ') || 'No contact details'}</p></div>{s.notes && <p className="max-w-xs truncate text-xs text-slate-400">{s.notes}</p>}</div>)}</div></Card>
      : <div className="mb-8"><EmptyState icon={<Truck className="h-5 w-5" />} title="No suppliers yet" description="Add a supplier before ordering parts or importing a price book." /></div>}

    <div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-bold">Supplier price book</h2><div className="flex gap-2"><SecondaryButton onClick={() => setImportOpen((v) => !v)}>{importOpen ? 'Cancel import' : 'Bulk import'}</SecondaryButton><PrimaryButton onClick={() => setPriceBookOpen((v) => !v)} disabled={!suppliers.length}><Plus className="mr-2 inline h-4 w-4" />{priceBookOpen ? 'Cancel' : 'New price'}</PrimaryButton></div></div>
    {importOpen && <Card className="mb-5 p-5"><form onSubmit={runImport} className="space-y-3">
      <p className="text-sm text-slate-500">Paste a JSON array of rows: <code>{'{ "sku": "optional", "description": "...", "unit_cost_cents": 1250 }'}</code>. Rows with a SKU update the existing line for that supplier; rows without one are always added as new lines.</p>
      <SelectField label="Supplier" required value={importSupplier} onChange={(e) => setImportSupplier(e.target.value)}><option value="">Choose a supplier…</option>{suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectField>
      <TextareaField label="Rows (JSON)" value={importText} onChange={(e) => setImportText(e.target.value)} className="min-h-40 font-mono text-xs" />
      {importNotice && <p className="text-sm text-emerald-700">{importNotice}</p>}
      <div className="flex justify-end gap-2"><SecondaryButton type="button" onClick={() => setImportOpen(false)}>Cancel</SecondaryButton><PrimaryButton disabled={busy === 'import' || !importSupplier}>{busy === 'import' ? 'Importing…' : 'Import rows'}</PrimaryButton></div>
    </form></Card>}
    {priceBookOpen && <Card className="mb-5 p-5"><form onSubmit={createPriceBookItem} className="grid gap-3 sm:grid-cols-2">
      <SelectField label="Supplier" required value={priceBookForm.supplier_id} onChange={(e) => setPriceBookForm((v) => ({ ...v, supplier_id: e.target.value }))}><option value="">Choose a supplier…</option>{suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectField>
      <Field label="SKU (optional)" value={priceBookForm.sku} onChange={(e) => setPriceBookForm((v) => ({ ...v, sku: e.target.value }))} />
      <Field label="Description" value={priceBookForm.description} onChange={(e) => setPriceBookForm((v) => ({ ...v, description: e.target.value }))} required className="sm:col-span-2" />
      <Field label="Unit cost ($)" type="number" min="0" step="0.01" value={priceBookForm.unit_cost} onChange={(e) => setPriceBookForm((v) => ({ ...v, unit_cost: e.target.value }))} required />
      <div className="flex justify-end gap-2 sm:col-span-2"><SecondaryButton type="button" onClick={() => setPriceBookOpen(false)}>Cancel</SecondaryButton><PrimaryButton disabled={busy === 'pricebook' || !priceBookForm.supplier_id}>{busy === 'pricebook' ? 'Saving…' : 'Save price'}</PrimaryButton></div>
    </form></Card>}
    {priceBook.length ? <Card className="mb-8 overflow-hidden"><div className="divide-y divide-slate-100">{priceBook.map((item: any) => <div key={item.id} className="flex items-center justify-between gap-3 px-5 py-3"><div className="min-w-0"><p className="font-semibold">{item.description}</p><p className="text-xs text-slate-500">{item.suppliers?.name || 'Supplier'}{item.sku ? ` · SKU ${item.sku}` : ''}</p></div><Money cents={item.unit_cost_cents} className="flex-none text-sm font-bold" /></div>)}</div></Card>
      : <div className="mb-8"><EmptyState icon={<Package className="h-5 w-5" />} title="No price book items yet" description="Add supplier costs one at a time, or bulk import a price list so quotes use up-to-date costs." /></div>}

    <div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-bold">Purchase orders</h2><PrimaryButton onClick={() => setPoOpen((v) => !v)} disabled={!suppliers.length}><Plus className="mr-2 inline h-4 w-4" />{poOpen ? 'Cancel' : 'New purchase order'}</PrimaryButton></div>
    {poOpen && <Card className="mb-5 p-5"><form onSubmit={createPO} className="grid gap-3 sm:grid-cols-2">
      <SelectField label="Supplier" required value={poForm.supplier_id} onChange={(e) => setPoForm((v) => ({ ...v, supplier_id: e.target.value }))}><option value="">Choose a supplier…</option>{suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectField>
      <SelectField label="Link to job (optional)" value={poForm.job_id} onChange={(e) => setPoForm((v) => ({ ...v, job_id: e.target.value }))}><option value="">No job</option>{jobs.map((j: any) => <option key={j.id} value={j.id}>#{j.job_number} — {j.title}</option>)}</SelectField>
      <div className="flex justify-end gap-2 sm:col-span-2"><SecondaryButton type="button" onClick={() => setPoOpen(false)}>Cancel</SecondaryButton><PrimaryButton disabled={busy === 'po' || !poForm.supplier_id}>{busy === 'po' ? 'Creating…' : 'Create draft'}</PrimaryButton></div>
    </form></Card>}
    {purchaseOrders.length ? <Card className="overflow-hidden"><div className="divide-y divide-slate-100">{purchaseOrders.map((po: any) => <div key={po.id} className="px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 cursor-pointer" onClick={() => void toggleExpand(po.id)}>
          <p className="font-semibold">{po.suppliers?.name || 'Supplier'}</p>
          <p className="mt-0.5 text-xs text-slate-500">{po.jobs ? <>Linked to <span onClick={(e) => e.stopPropagation()} className="inline"><AppLink href={`/app/jobs/${po.job_id}`} className="font-semibold text-indigo-600 hover:underline">Job #{po.jobs.job_number}</AppLink></span></> : 'Not linked to a job'} · Created {new Date(po.created_at).toLocaleDateString('en-AU')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={poTone(po.status)}>{po.status}</StatusPill>
          {po.status === 'draft' && <SecondaryButton disabled={busy === `status:${po.id}`} onClick={() => void setPoStatus(po.id, 'ordered')}>Mark ordered</SecondaryButton>}
          {po.status === 'ordered' && <SecondaryButton disabled={busy === `status:${po.id}`} onClick={() => void setPoStatus(po.id, 'received')}>Mark received</SecondaryButton>}
          {['draft', 'ordered'].includes(po.status) && <SecondaryButton disabled={busy === `status:${po.id}`} onClick={() => void setPoStatus(po.id, 'cancelled')}>Cancel</SecondaryButton>}
          <SecondaryButton onClick={() => void toggleExpand(po.id)}>{expanded === po.id ? 'Hide items' : 'View items'}</SecondaryButton>
        </div>
      </div>
      {expanded === po.id && <div className="mt-3 rounded-xl bg-slate-50 p-3">
        {(poDetail[po.id] ?? []).length ? <div className="mb-3 space-y-1.5">{(poDetail[po.id] ?? []).map((item: any) => <div key={item.id} className="flex items-center justify-between text-sm"><span>{item.description} × {item.quantity}</span><Money cents={item.unit_cost_cents * item.quantity} /></div>)}</div> : <p className="mb-3 text-xs text-slate-400">No line items yet.</p>}
        {po.status === 'draft' && <form onSubmit={(e) => addItem(e, po.id)} className="grid gap-2 sm:grid-cols-4">
          <input placeholder="Part / description" required value={itemForm.description} onChange={(e) => setItemForm((v) => ({ ...v, description: e.target.value }))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm sm:col-span-2" />
          <input type="number" min="0.001" step="0.001" placeholder="Qty" value={itemForm.quantity} onChange={(e) => setItemForm((v) => ({ ...v, quantity: e.target.value }))} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
          <div className="flex gap-2"><input type="number" min="0" step="0.01" placeholder="Unit cost $" required value={itemForm.unit_cost} onChange={(e) => setItemForm((v) => ({ ...v, unit_cost: e.target.value }))} className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm" /><PrimaryButton disabled={busy === `item:${po.id}`}>{busy === `item:${po.id}` ? 'Adding…' : 'Add'}</PrimaryButton></div>
        </form>}
      </div>}
    </div>)}</div></Card>
      : <EmptyState icon={<ClipboardList className="h-5 w-5" />} title="No purchase orders yet" description="Create a purchase order for a supplier, optionally link it to a job, and track it through ordered and received." />}
  </Page>;
}
