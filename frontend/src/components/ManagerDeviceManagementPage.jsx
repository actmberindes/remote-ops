import React, { useEffect, useState } from 'react';
import { Monitor, RefreshCw, Radio, Wifi, WifiOff } from 'lucide-react';
import { api } from '../lib/api.js';
import DeviceDetailsPage from './DeviceDetailsPage.jsx';

function statusTone(status) {
  return { active: 'var(--success)', idle: 'var(--warning)', locked: 'var(--danger)', offline: 'var(--danger)', revoked: 'var(--danger)', pending: 'var(--info)', 'logged-out': 'var(--neutral)' }[status] || 'var(--neutral)';
}
function statusLabel(status) {
  return { active: 'Active', idle: 'Idle', locked: 'Locked', offline: 'Offline', revoked: 'Revoked', pending: 'Pending Enrollment', 'logged-out': 'No User Logged In' }[status] || status || 'Unknown';
}
function connectionLabel(device) {
  if (device.isRdp || device.connectionType === 'RDP') return 'RDP';
  if (device.currentDomainUser || device.domainUser) return 'Local';
  return '—';
}

export default function ManagerDeviceManagementPage() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const load = async () => {
    setLoading(true); setError('');
    try { setDevices(await api.agent.devices()); } catch (e) { setError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); const timer = setInterval(load, 15000); return () => clearInterval(timer); }, []);
  if (selectedDeviceId) return <DeviceDetailsPage deviceId={selectedDeviceId} onBack={() => setSelectedDeviceId(null)} />;
  return <div className="flex flex-col gap-5 w-full"><div className="card p-5">
    <div className="flex items-center justify-between gap-4 mb-4"><div><h3 className="font-display font-bold text-base flex items-center gap-2"><Monitor size={16} className="accent-text" /> Device Management</h3><p className="text-xs text-muted mt-0.5">View managed devices assigned to your team. Device administration actions are restricted to Administrators.</p></div><button onClick={load} className="p-2 rounded-lg hover-surface" title="Refresh"><RefreshCw size={14} /></button></div>
    {loading ? <div className="py-8 text-center text-sm text-muted">Loading devices…</div> : error ? <div className="py-8 text-center text-sm text-[var(--danger)]">{error}</div> : devices.length === 0 ? <div className="py-8 text-center text-sm text-muted">No managed devices are assigned to your team.</div> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="font-bold text-muted uppercase tracking-wider border-b border-[var(--border)]"><th className="pb-2.5 px-2">Device</th><th className="pb-2.5 px-2">Registered To</th><th className="pb-2.5 px-2">Current User</th><th className="pb-2.5 px-2">Session</th><th className="pb-2.5 px-2">Status</th><th className="pb-2.5 px-2">Last Seen</th><th className="pb-2.5 px-2">Agent</th></tr></thead><tbody className="divide-y divide-[var(--border)]">{devices.map(d => { const tone = statusTone(d.status); const isRdp = d.isRdp || d.connectionType === 'RDP'; return <tr key={d.id} className="hover:bg-[var(--bg)] transition-colors"><td className="py-3 px-2"><button type="button" onClick={() => setSelectedDeviceId(d.id)} className="text-left group"><div className="font-semibold group-hover:accent-text group-hover:underline underline-offset-2">{d.deviceName}</div><div className="text-[10px] text-muted mono mt-0.5">{d.hostname || 'Hostname pending'}</div></button></td><td className="py-3 px-2"><div className="font-semibold">{d.registeredEmployeeName || d.employeeName || '—'}</div><div className="text-[10px] text-muted">Original registration owner</div></td><td className="py-3 px-2">{d.currentEmployeeName ? <><div className="font-semibold">{d.currentEmployeeName}</div><div className="text-[10px] text-muted mono">{d.currentDomainUser || d.domainUser || '—'}</div></> : <span className="text-muted">No user</span>}</td><td className="py-3 px-2"><span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: isRdp ? 'var(--warning)' : 'var(--text-muted)' }}>{isRdp ? <Radio size={13} /> : <Wifi size={13} />}{connectionLabel(d)}</span>{isRdp && d.sessionName && <div className="text-[9px] text-muted mono mt-0.5">{d.sessionName}</div>}</td><td className="py-3 px-2"><span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: tone }}><span className="rounded-full" style={{ width: 7, height: 7, background: tone }} />{statusLabel(d.status)}</span></td><td className="py-3 px-2 text-muted whitespace-nowrap">{d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : 'Never'}</td><td className="py-3 px-2 text-muted">{d.agentVersion || '—'}</td></tr>; })}</tbody></table></div>}
    <div className="mt-4 flex items-center gap-3 text-[10px] text-muted"><span className="inline-flex items-center gap-1.5"><Wifi size={12} /> Local session</span><span className="inline-flex items-center gap-1.5" style={{ color: 'var(--warning)' }}><Radio size={12} /> RDP session</span><span className="inline-flex items-center gap-1.5"><WifiOff size={12} /> Offline / no session</span></div>
  </div></div>;
}
