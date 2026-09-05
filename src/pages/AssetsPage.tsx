import { useEffect, useState } from 'react';
import { Package, Plus } from 'lucide-react';
import { useAuth } from '../app/auth';
import { apiFetch } from '../lib/api';
import { Card, EmptyState, Field, PrimaryButton, SecondaryButton, SelectField, Spinner, StatusPill } from '../components/saas/ui';

export function AssetsPage() {
  const { workspaceId } = useAuth();
  const [assets, setAssets] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ customer_id: '', name: '', asset_type: '', make: '', model: '', serial_number: '', installed_at: '', warranty_expires_at: '' });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!workspaceId) return;
    setLoading(true); setError('');
    try {
      const [a, c] = await Promise.all([
        apiFetch<any>('/api/assets', {}, workspaceId),
        apiFetch<any>('/api/crm/customers', {}, workspaceId),
      ]);
      setAssets(a.assets ?? []);
      setCustomers(c.customers ?? []);
    } catch (err: any) { setError(err.message || 'ASSET_LIST_FAILED'); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [workspaceId]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault(); if (!workspaceId) return;
    setBusy(true); setError('');
    try {
      await apiFetch('/api/assets', { method: 'POST', body: JSON.stringify({
        customer_id: form.customer_id, name: form.name, asset_type: form.asset_type,
        make: form.make || null, model: form.model || null, serial_number: form.serial_number || null,
        installed_at: form.installed_at || null, warranty_expires_at: form.warranty_expires_at || null,
      }) }, workspaceId);
      setForm({ customer_id: '', name: '', asset_type: '', make: '', model: '', serial_number: '', installed_at: '', warranty_expires_at: '' });
      setOpen(false); await load();
    } catch (err: any) { setError(err.message || 'ASSET_CREATE_FAILED'); } finally { setBusy(false); }
  };

  return <div>
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-indigo-600">Field Operations</p><h1 className="mt-1 text-3xl font-black tracking-tight">Assets &amp; service history</h1><p className="mt-2 text-sm text-slate-500">Every customer asset with its service history, warranty dates and next-service tracking.</p></div><PrimaryButton onClick={() => setOpen(!open)}><Plus className="mr-2 inline h-4 w-4" />New asset</PrimaryButton></div>
    {open && <Card className="mb-5 p-5"><form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
      <SelectField label="Customer" value={form.customer_id} onChange={e => setForm(v => ({ ...v, customer_id: e.target.value }))} required><option value="">Choose a customer…</option>{customers.map((c: any) => <option key={c.id} value={c.id}>{c.display_name}</option>)}</SelectField>
      <Field label="Asset name" value={form.name} onChange={e => setForm(v => ({ ...v, name: e.target.value }))} required placeholder="Hot water system" />
      <Field label="Asset type" value={form.asset_type} onChange={e => setForm(v => ({ ...v, asset_type: e.target.value }))} required placeholder="Hot water system, switchboard, aircon" />
      <Field label="Make" value={form.make} onChange={e => setForm(v => ({ ...v, make: e.target.value }))} />
      <Field label="Model" value={form.model} onChange={e => setForm(v => ({ ...v, model: e.target.value }))} />
      <Field label="Serial number" value={form.serial_number} onChange={e => setForm(v => ({ ...v, serial_number: e.target.value }))} />
      <Field label="Installed at" type="date" value={form.installed_at} onChange={e => setForm(v => ({ ...v, installed_at: e.target.value }))} />
      <Field label="Warranty expires" type="date" value={form.warranty_expires_at} onChange={e => setForm(v => ({ ...v, warranty_expires_at: e.target.value }))} />
      {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
      <div className="flex justify-end gap-2 sm:col-span-2"><SecondaryButton type="button" onClick={() => setOpen(false)}>Cancel</SecondaryButton><PrimaryButton disabled={busy}>{busy ? 'Saving…' : 'Save asset'}</PrimaryButton></div>
    </form></Card>}
    {loading ? <Spinner label="Loading assets…" /> : error ? <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error}</div> : assets.length ? (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{assets.map((asset: any) => <Card key={asset.id} className="p-5"><div className="flex items-start justify-between gap-2"><div><p className="font-bold">{asset.name}</p><p className="mt-0.5 text-xs text-slate-500">{asset.customers?.display_name || 'Unknown customer'} · {asset.asset_type}</p></div><StatusPill tone="green">{asset.asset_type}</StatusPill></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">{asset.make && <div>Make: {asset.make}</div>}{asset.model && <div>Model: {asset.model}</div>}{asset.serial_number && <div>S/N: {asset.serial_number}</div>}{asset.warranty_expires_at && <div>Warranty: {new Date(asset.warranty_expires_at).toLocaleDateString('en-AU')}</div>}</div></Card>)}</div>
    ) : <EmptyState icon={<Package className="h-5 w-5" />} title="No assets yet" description="Every customer asset with its service history, warranty dates and next-service tracking." steps={['Add an asset for a customer', 'Track warranty dates and service history', 'Schedule recurring maintenance']} />}
  </div>;
}