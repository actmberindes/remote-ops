import React, { useEffect, useMemo, useState } from 'react';
import { api } from './lib/api.js';
import { Plus, Eye, Copy, Pencil, History, UserPlus, Trash2, RefreshCw, Search, X, CheckCircle2, AlertCircle } from 'lucide-react';

const fieldClass = 'w-full rounded-lg px-3 py-2 text-xs input-surface font-medium focus:outline-none focus:ring-1 focus:ring-[var(--accent)]';
const emptyForm = { name: '', vendor: '', productKey: '', email: '', seats: 1, purchaseDate: '', expirationDate: '', notes: '' };
const currentDate = () => new Date().toISOString().slice(0, 10);
const statusFor = (license) => license.expirationDate && license.expirationDate < currentDate() ? 'Expired' : 'Active';

function LicenseModal({ title, onClose, children }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"><div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 border border-[var(--border)] shadow-2xl"><div className="flex items-center justify-between pb-3 mb-4 border-b border-[var(--border)]"><h3 className="font-display font-bold text-base">{title}</h3><button onClick={onClose} className="p-1.5 rounded-lg hover-surface"><X size={17}/></button></div>{children}</div></div>;
}

function LicenseForm({ license, onClose, onSaved, notify }) {
  const [form, setForm] = useState(() => ({ ...emptyForm, ...(license || {}) }));
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm(old => ({ ...old, [key]: value }));
  const submit = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      const payload = { ...form, seats: Number(form.seats) };
      const saved = license ? await api.licenses.update(license.id, payload) : await api.licenses.create(payload);
      onSaved(saved, !license); notify(license ? 'License updated.' : 'License created.', 'success'); onClose();
    } catch (error) { notify(error.message, 'error'); } finally { setSaving(false); }
  };
  return <LicenseModal title={license ? 'Edit License' : 'Add License'} onClose={onClose}>
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-[10px] font-bold text-muted uppercase tracking-wider">License Name<input required className={fieldClass+' mt-1 normal-case'} value={form.name} onChange={e=>set('name',e.target.value)} placeholder="e.g. Adobe Creative Cloud"/></label>
        <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Vendor<input className={fieldClass+' mt-1 normal-case'} value={form.vendor} onChange={e=>set('vendor',e.target.value)} placeholder="e.g. Adobe"/></label>
        <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Product Key / Subscription<input className={fieldClass+' mt-1 normal-case'} value={form.productKey} onChange={e=>set('productKey',e.target.value)} placeholder="Key or subscription reference"/></label>
        <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Associated Email<input type="email" className={fieldClass+' mt-1 normal-case'} value={form.email} onChange={e=>set('email',e.target.value)} placeholder="license@company.com"/></label>
        <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Number of Seats / Qty<input type="number" required min="1" step="1" className={fieldClass+' mt-1 normal-case'} value={form.seats} onChange={e=>set('seats',e.target.value)}/></label>
        <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Purchase Date<input type="date" className={fieldClass+' mt-1 normal-case'} value={form.purchaseDate||''} onChange={e=>set('purchaseDate',e.target.value)}/></label>
        <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Expiration Date<input type="date" className={fieldClass+' mt-1 normal-case'} value={form.expirationDate||''} onChange={e=>set('expirationDate',e.target.value)}/></label>
      </div>
      <label className="block text-[10px] font-bold text-muted uppercase tracking-wider">Notes<textarea rows="2" className={fieldClass+' mt-1 normal-case'} value={form.notes||''} onChange={e=>set('notes',e.target.value)}/></label>
      <p className="text-[10px] text-muted">Status is calculated automatically from the expiration date. Leave the date blank for a license without a fixed expiry.</p>
      <button disabled={saving} className="w-full py-2.5 rounded-lg font-bold text-xs accent-bg-solid">{saving?'Saving…':license?'Save Changes':'Add License'}</button>
    </form>
  </LicenseModal>;
}

export default function LicenseManagementTab() {
  const [licenses, setLicenses] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modal, setModal] = useState(null);
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [assignForm, setAssignForm] = useState({ employeeId: '', seats: 1 });
  const [renewDate, setRenewDate] = useState('');
  const [detail, setDetail] = useState(null);
  const notify = (text, type='info') => { setMessage({ text, type }); window.setTimeout(() => setMessage(null), 3500); };
  const load = async () => {
    setBusy(true);
    try {
      const [licenseRows, userRows] = await Promise.all([api.licenses.list(), api.users.list()]);
      setLicenses(licenseRows); setEmployees(userRows.filter(u => u.role === 'Employee'));
    } catch (error) { notify(error.message, 'error'); } finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []);
  const filtered = useMemo(() => licenses.filter(l => {
    const status = statusFor(l);
    if (statusFilter && status !== statusFilter) return false;
    return !query || [l.name,l.vendor,l.email,l.productKey].some(v => String(v||'').toLowerCase().includes(query.toLowerCase()));
  }).sort((a,b) => String(a.name).localeCompare(String(b.name))), [licenses, query, statusFilter]);
  const upsert = (saved, isNew) => setLicenses(old => isNew ? [...old, saved] : old.map(l => l.id===saved.id?saved:l));
  const clone = async (license) => { if (!window.confirm(`Clone license "${license.name}"?`)) return; try { const saved=await api.licenses.clone(license.id); setLicenses(old=>[...old,saved]); notify('License cloned.','success'); } catch(e){notify(e.message,'error');} };
  const remove = async (license) => { if (!window.confirm(`Delete license "${license.name}"? This cannot be undone.`)) return; try { await api.licenses.remove(license.id); setLicenses(old=>old.filter(l=>l.id!==license.id)); notify('License deleted.','success'); } catch(e){notify(e.message,'error');} };
  const showHistory = async (license) => { try { setSelected(license); setHistory(await api.licenses.history(license.id)); setModal('history'); } catch(e){notify(e.message,'error');} };
  const showAssignments = async (license) => { try { setSelected(license); setAssignments(await api.licenses.assignments(license.id)); setAssignForm({employeeId:'',seats:1}); setModal('assign'); } catch(e){notify(e.message,'error');} };
  const assign = async (e) => { e.preventDefault(); try { await api.licenses.assign(selected.id, Number(assignForm.employeeId), Number(assignForm.seats)); setLicenses(await api.licenses.list()); setAssignments(await api.licenses.assignments(selected.id)); setAssignForm({employeeId:'',seats:1}); notify('License seats assigned.','success'); } catch(error){notify(error.message,'error');} };
  const release = async (assignment) => { if(!window.confirm(`Release ${assignment.seats} seat(s) from ${assignment.employeeName}?`)) return; try { await api.licenses.releaseAssignment(selected.id, assignment.id); setLicenses(await api.licenses.list()); setAssignments(await api.licenses.assignments(selected.id)); notify('Assignment released.','success'); } catch(e){notify(e.message,'error');} };
  const renew = async (e) => { e.preventDefault(); try { const saved=await api.licenses.renew(selected.id,{expirationDate:renewDate}); upsert(saved,false); setModal(null); notify('License renewed.','success'); } catch(error){notify(error.message,'error');} };
  const remaining = (license) => Math.max(0, Number(license.seats||0)-Number(license.assignedSeats||0));
  const statusPill = (license) => { const status=statusFor(license); return <span className="px-2 py-1 rounded-md text-[10px] font-bold" style={{background:status==='Active'?'var(--success-tint)':'var(--danger-tint)',color:status==='Active'?'var(--success)':'var(--danger)'}}>{status}</span>; };
  return <div>
    {message && <div className="mb-3 flex items-center gap-2 rounded-lg border border-[var(--border)] p-3 text-xs"><AlertCircle size={14}/>{message.text}</div>}
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div><h3 className="font-display font-bold text-base">Software Licenses</h3><p className="text-xs text-muted mt-0.5">Manage subscriptions, expiry, seat allocation, and license history.</p></div>
      <button onClick={()=>{setSelected(null);setModal('form');}} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold accent-bg-solid"><Plus size={14}/> Add License</button>
    </div>
    <div className="flex flex-wrap gap-2 mb-4">
      <div className="relative flex-1 min-w-[200px]"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"/><input className={fieldClass+' pl-7 h-9'} placeholder="Search licenses, vendor, email, key…" value={query} onChange={e=>setQuery(e.target.value)}/></div>
      <select className={fieldClass+' h-9 w-40'} value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="">All Statuses</option><option>Active</option><option>Expired</option></select>
      <button onClick={load} className="px-3 py-2 rounded-lg border border-[var(--border)] text-xs hover-surface"><RefreshCw size={13}/></button>
    </div>
    <div className="overflow-x-auto rounded-xl border border-[var(--border)]"><table className="w-full text-xs text-left"><thead style={{background:'var(--bg)'}}><tr>{['License','Vendor','Associated Email','Seats','Expiration','Status','Actions'].map(x=><th key={x} className="px-3 py-3 font-bold text-muted whitespace-nowrap">{x}</th>)}</tr></thead><tbody>
      {filtered.map(license=><tr key={license.id} className="border-t border-[var(--border)]"><td className="px-3 py-3"><div className="font-semibold">{license.name}</div><div className="text-[10px] text-muted mt-1">{license.productKey||'No key/subscription reference'}</div></td><td className="px-3 py-3">{license.vendor||'—'}</td><td className="px-3 py-3">{license.email||'—'}</td><td className="px-3 py-3 whitespace-nowrap">{license.assignedSeats||0} / {license.seats} used<div className="text-[10px] text-muted">{remaining(license)} available</div></td><td className="px-3 py-3 whitespace-nowrap">{license.expirationDate||'No expiry'}</td><td className="px-3 py-3">{statusPill(license)}</td><td className="px-3 py-3"><div className="flex items-center gap-1">
        <button title="View" className="p-1.5 rounded-lg hover-surface" onClick={()=>{setSelected(license);setDetail(license);setModal('view');}}><Eye size={13}/></button>
        <button title="Clone" className="p-1.5 rounded-lg hover-surface" onClick={()=>clone(license)}><Copy size={13}/></button>
        <button title="Edit" className="p-1.5 rounded-lg hover-surface" onClick={()=>{setSelected(license);setModal('form');}}><Pencil size={13}/></button>
        <button title="History" className="p-1.5 rounded-lg hover-surface" onClick={()=>showHistory(license)}><History size={13}/></button>
        <button title="Assign" className="p-1.5 rounded-lg hover-surface" disabled={statusFor(license)==='Expired'||remaining(license)===0} onClick={()=>showAssignments(license)}><UserPlus size={13}/></button>
        {statusFor(license)==='Expired'&&<button title="Renew" className="p-1.5 rounded-lg hover-surface" style={{color:'var(--success)'}} onClick={()=>{setSelected(license);setRenewDate(currentDate());setModal('renew');}}><RefreshCw size={13}/></button>}
        <button title="Delete" className="p-1.5 rounded-lg hover-surface" style={{color:'var(--danger)'}} onClick={()=>remove(license)}><Trash2 size={13}/></button>
      </div></td></tr>)}
      {!filtered.length&&<tr><td colSpan={7} className="py-8 text-center text-muted">{busy?'Loading licenses…':'No licenses match your filters.'}</td></tr>}
    </tbody></table></div>
    {modal==='form'&&<LicenseForm license={selected} onClose={()=>setModal(null)} onSaved={upsert} notify={notify}/>}
    {modal==='view'&&selected&&<LicenseModal title="License Details" onClose={()=>setModal(null)}><div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">{[['License Name',selected.name],['Vendor',selected.vendor],['Product Key / Subscription',selected.productKey],['Associated Email',selected.email],['Seats / Qty',selected.seats],['Purchase Date',selected.purchaseDate],['Expiration Date',selected.expirationDate||'No expiry'],['Status',statusFor(selected)],['Seats Assigned',selected.assignedSeats||0],['Seats Available',remaining(selected)],['Notes',selected.notes]].map(([k,v])=><div key={k} className="rounded-lg border border-[var(--border)] p-3"><div className="text-[10px] uppercase text-muted font-bold mb-1">{k}</div><div className="break-words">{v||'—'}</div></div>)}</div></LicenseModal>}
    {modal==='history'&&selected&&<LicenseModal title={`History — ${selected.name}`} onClose={()=>setModal(null)}>{history.length?<div className="space-y-3">{history.map(item=><div key={item.id} className="border-l-2 border-[var(--accent)] pl-3 py-1"><div className="font-bold text-xs">{item.action}</div><div className="text-xs mt-1">{item.message}</div><div className="text-[10px] text-muted mt-1">{item.performedByName} · {new Date(item.timestamp).toLocaleString()}</div></div>)}</div>:<p className="text-xs text-muted">No history yet.</p>}</LicenseModal>}
    {modal==='assign'&&selected&&<LicenseModal title={`Assign — ${selected.name}`} onClose={()=>setModal(null)}><div className="text-xs text-muted mb-3">{remaining(selected)} of {selected.seats} seats available. Assignments are tracked per employee.</div><form onSubmit={assign} className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-5"><select required className={fieldClass} value={assignForm.employeeId} onChange={e=>setAssignForm(f=>({...f,employeeId:e.target.value}))}><option value="">Select employee</option>{employees.map(e=><option key={e.id} value={e.id}>{e.name} — {e.email}</option>)}</select><input required type="number" min="1" max={remaining(selected)} className={fieldClass} value={assignForm.seats} onChange={e=>setAssignForm(f=>({...f,seats:e.target.value}))}/><button className="rounded-lg accent-bg-solid font-bold text-xs px-3 py-2">Assign Seats</button></form><h4 className="text-xs font-bold mb-2">Current Assignments</h4>{assignments.length?assignments.map(a=><div key={a.id} className="flex items-center justify-between gap-3 py-2 border-t border-[var(--border)] text-xs"><div>{a.employeeName}<div className="text-[10px] text-muted">{a.seats} seat(s) · {new Date(a.assignedAt).toLocaleDateString()}</div></div><button onClick={()=>release(a)} className="text-[10px] font-bold" style={{color:'var(--danger)'}}>Release</button></div>):<p className="text-xs text-muted">No active assignments.</p>}</LicenseModal>}
    {modal==='renew'&&selected&&<LicenseModal title={`Renew — ${selected.name}`} onClose={()=>setModal(null)}><form onSubmit={renew} className="space-y-3"><p className="text-xs text-muted">Current expiration: {selected.expirationDate||'Not set'}. Choose the new expiry date to reactivate this license.</p><label className="block text-[10px] font-bold text-muted uppercase">New Expiration Date<input required type="date" min={currentDate()} className={fieldClass+' mt-1'} value={renewDate} onChange={e=>setRenewDate(e.target.value)}/></label><button className="w-full py-2.5 rounded-lg accent-bg-solid font-bold text-xs">Renew License</button></form></LicenseModal>}
  </div>;
}
