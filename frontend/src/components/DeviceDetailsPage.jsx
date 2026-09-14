import React, { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowLeft, Calendar, Clock3, Monitor, RefreshCw, User, Wifi, WifiOff } from 'lucide-react';
import { api } from '../lib/api.js';

const tabs = ['Activity Logs', 'Screenshots', 'Live View'];

function fmtDate(value) {
  return value ? new Date(value).toLocaleDateString() : '—';
}
function fmtDateTime(value) {
  return value ? new Date(value).toLocaleString() : '—';
}
function statusColor(status) {
  return status === 'active' ? 'var(--success)' : status === 'idle' ? 'var(--warning)' : status === 'offline' ? 'var(--danger)' : 'var(--neutral)';
}
function domainUserOf(item) {
  return item?.domainUser || item?.currentDomainUser || 'Unknown user';
}

function DeviceInfo({ device }) {
  const online = device?.status !== 'offline' && device?.status !== 'revoked' && device?.status !== 'pending';
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Monitor size={16} className="accent-text" />
        <div className="font-display font-bold text-sm">Device Info</div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
        {[
          ['Device Name', device?.deviceName || '—'],
          ['OS', device?.os || device?.operatingSystem || 'Windows'],
          ['IP Address', device?.ipAddress || device?.ip || '—'],
          ['Last Domain User Log', device?.domainUser || device?.currentDomainUser || '—'],
          ['Agent Version', device?.agentVersion || '—'],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <div className="text-[10px] text-muted uppercase tracking-wider font-bold">{label}</div>
            <div className="font-semibold mt-1 truncate" title={String(value)}>{value}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 pt-3 border-t border-[var(--border)] flex flex-wrap items-center gap-3 text-[10px] text-muted">
        <span className="inline-flex items-center gap-1.5" style={{ color: online ? 'var(--success)' : 'var(--danger)' }}>
          {online ? <Wifi size={12} /> : <WifiOff size={12} />}
          {device?.status || 'unknown'}
        </span>
        {device?.hostname && <span className="mono">{device.hostname}</span>}
        {device?.domain && <span className="mono">{device.domain}</span>}
        {device?.sessionName && <span className="mono">Session: {device.sessionName}</span>}
      </div>
    </div>
  );
}

function DailyStatusChart({ history }) {
  const data = useMemo(() => {
    const grouped = new Map();
    history.forEach(item => {
      const date = item.timestamp?.slice(0, 10);
      if (!date) return;
      const row = grouped.get(date) || { date, online: 0, offline: 0 };
      const to = item.to || item.state;
      if (to === 'active' || to === 'idle') row.online += 1;
      else row.offline += 1;
      grouped.set(date, row);
    });
    return [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-14).map(row => ({
      ...row,
      label: new Date(`${row.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    }));
  }, [history]);

  return (
    <div className="card p-4 min-w-0">
      <div className="flex items-center justify-between mb-3">
        <div><div className="font-display font-bold text-sm">Recent Activity</div><div className="text-[10px] text-muted">Online / Offline state changes by date</div></div>
      </div>
      <div className="h-56">
        {data.length ? <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
            <Tooltip />
            <Bar dataKey="online" name="Online" fill="var(--success)" radius={[3, 3, 0, 0]} />
            <Bar dataKey="offline" name="Offline" fill="var(--danger)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer> : <div className="h-full flex items-center justify-center text-xs text-muted">No state history yet.</div>}
      </div>
    </div>
  );
}

function HourlyActivityChart({ history }) {
  const data = useMemo(() => {
    const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, active: 0, total: 0 }));
    const sorted = [...history].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    if (!sorted.length) return buckets.map(x => ({ ...x, label: `${x.hour}:00`, percent: 0 }));
    const now = Date.now();
    sorted.forEach((item, index) => {
      const start = new Date(item.timestamp).getTime();
      const end = Math.min(index + 1 < sorted.length ? new Date(sorted[index + 1].timestamp).getTime() : now, start + 24 * 60 * 60 * 1000);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
      const active = item.to === 'active';
      let cursor = start;
      while (cursor < end) {
        const d = new Date(cursor);
        const nextHour = new Date(d); nextHour.setMinutes(60, 0, 0);
        const sliceEnd = Math.min(end, nextHour.getTime());
        const seconds = Math.max(0, sliceEnd - cursor) / 1000;
        const bucket = buckets[d.getHours()];
        bucket.total += seconds;
        if (active) bucket.active += seconds;
        cursor = sliceEnd;
      }
    });
    return buckets.map(x => ({ ...x, label: `${String(x.hour).padStart(2, '0')}:00`, percent: x.total ? Math.round((x.active / x.total) * 100) : 0 }));
  }, [history]);

  return (
    <div className="card p-4 min-w-0">
      <div className="mb-3"><div className="font-display font-bold text-sm">Keyboard / Mouse Hourly Activity</div><div className="text-[10px] text-muted">Dark green = 100% active · light green = 0% active / idle</div></div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={1} />
            <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 10 }} />
            <Tooltip formatter={value => [`${value}%`, 'Active']} />
            <Bar dataKey="percent" name="Active %" fill="var(--success)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ActivityTimeline({ history, domainUser }) {
  const rows = history.filter(item => !domainUser || domainUserOf(item) === domainUser).slice(0, 100);
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3"><Clock3 size={15} className="accent-text" /><div className="font-display font-bold text-sm">Activity Timeline</div></div>
      {rows.length ? <div className="divide-y divide-[var(--border)]">
        {rows.map(item => <div key={item.id} className="py-2.5 flex flex-wrap items-center gap-3 text-xs">
          <span className="text-muted whitespace-nowrap">{fmtDateTime(item.timestamp)}</span>
          <span className="mono font-semibold">{item.domainUser || '—'}</span>
          <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: statusColor(item.to) }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor(item.to) }} />{item.from || '—'} → {item.to || '—'}</span>
        </div>)}
      </div> : <div className="py-8 text-center text-xs text-muted">No activity records for this filter.</div>}
    </div>
  );
}

function ScreenshotTab({ screenshots, date, setDate, domainUser, setDomainUser }) {
  const users = [...new Set(screenshots.map(domainUserOf).filter(Boolean))].sort();
  const list = screenshots.filter(item => (!date || item.capturedAt?.slice(0, 10) === date) && (!domainUser || domainUserOf(item) === domainUser));
  return <div className="space-y-4">
    <div className="card p-4 flex flex-wrap items-end gap-3">
      <label className="text-xs font-semibold"><span className="block text-[10px] text-muted uppercase mb-1">Date</span><input type="date" value={date} onChange={e => setDate(e.target.value)} className="input-surface rounded-lg px-3 py-2 text-xs" /></label>
      <label className="text-xs font-semibold"><span className="block text-[10px] text-muted uppercase mb-1">Domain User</span><select value={domainUser} onChange={e => setDomainUser(e.target.value)} className="input-surface rounded-lg px-3 py-2 text-xs"><option value="">All domain users</option>{users.map(user => <option key={user} value={user}>{user}</option>)}</select></label>
      <button onClick={() => { setDate(''); setDomainUser(''); }} className="px-3 py-2 rounded-lg text-xs hover-surface">Clear</button>
    </div>
    {list.length ? <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
      {list.map(item => <button key={item.id} type="button" className="card p-0 overflow-hidden text-left hover-surface" onClick={() => window.open(api.uploads.fileUrl(item.url), '_blank', 'noopener,noreferrer')}>
        <img src={api.uploads.fileUrl(item.url)} alt={item.filename || 'Screenshot'} className="w-full aspect-video object-cover" />
        <div className="p-2 text-[10px] truncate font-medium">{domainUserOf(item)} · {String(item.displayName || `DISPLAY${item.displayIndex ?? ''}`).replace(/^DISPLAY\s*/i, 'DISPLAY').toUpperCase()} · {new Date(item.capturedAt).toLocaleTimeString()}</div>
      </button>)}
    </div> : <div className="card py-12 text-center text-xs text-muted">No screenshots match the selected filters.</div>}
  </div>;
}

function LiveViewTab({ device, frames, domainUser, setDomainUser }) {
  const users = [...new Set(frames.map(domainUserOf).filter(Boolean))].sort();
  const list = frames.filter(item => !domainUser || domainUserOf(item) === domainUser);
  const latest = list[0];
  return <div className="space-y-4">
    <div className="card p-4 flex flex-wrap items-end gap-3">
      <label className="text-xs font-semibold"><span className="block text-[10px] text-muted uppercase mb-1">Domain User</span><select value={domainUser} onChange={e => setDomainUser(e.target.value)} className="input-surface rounded-lg px-3 py-2 text-xs"><option value="">All domain users</option>{users.map(user => <option key={user} value={user}>{user}</option>)}</select></label>
      <div className="text-[10px] text-muted">Live View shows the most recent retained frame for this device.</div>
    </div>
    {latest?.url ? <div className="card p-3"><div className="text-xs font-semibold mb-2">{domainUserOf(latest)} · {fmtDateTime(latest.capturedAt)}</div><img src={api.uploads.fileUrl(latest.url)} alt={device.deviceName} className="w-full max-h-[70vh] object-contain rounded-lg bg-black" /></div> : <div className="card py-12 text-center text-xs text-muted">No Live View frame is available for this device.</div>}
  </div>;
}

export default function DeviceDetailsPage({ deviceId, onBack }) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('Activity Logs');
  const [date, setDate] = useState('');
  const [domainUser, setDomainUser] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try { setPayload(await api.agent.deviceDetails(deviceId)); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [deviceId]);

  const history = payload?.history || [];
  const screenshots = payload?.screenshots || [];
  const liveFrames = payload?.liveFrames || [];
  const activityUsers = useMemo(() => [...new Set(history.map(domainUserOf).filter(Boolean))].sort(), [history]);
  const filteredHistory = useMemo(() => history.filter(item => (!date || item.timestamp?.slice(0, 10) === date)), [history, date]);

  if (loading) return <div className="py-16 text-center text-sm text-muted">Loading device details…</div>;
  if (error) return <div className="card p-6"><div className="text-sm font-semibold text-[var(--danger)]">Unable to load device</div><div className="text-xs text-muted mt-1">{error}</div><button onClick={load} className="mt-3 px-3 py-2 rounded-lg text-xs accent-bg-solid">Retry</button></div>;

  const device = payload?.device;
  return <div className="flex flex-col gap-4 w-full">
    <div className="flex items-center justify-between gap-3">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-semibold hover-surface px-3 py-2 rounded-lg"><ArrowLeft size={14} /> Device Management</button>
      <button onClick={load} className="p-2 rounded-lg hover-surface" title="Refresh"><RefreshCw size={14} /></button>
    </div>
    <div className="flex items-center gap-3"><div className="p-2.5 rounded-xl accent-bg"><Monitor size={20} /></div><div><h2 className="font-display font-bold text-lg">{device?.deviceName}</h2><div className="text-xs text-muted">{device?.hostname || 'Hostname pending'} · {device?.currentDomainUser || device?.domainUser || 'No current domain user'}</div></div></div>
    <DeviceInfo device={device} />
    <div className="card p-2 flex flex-wrap gap-1">
      {tabs.map(item => <button key={item} onClick={() => { setTab(item); setDate(''); setDomainUser(''); }} className={`px-4 py-2 rounded-lg text-xs font-bold ${tab === item ? 'accent-bg-solid' : 'hover-surface'}`}>{item}</button>)}
    </div>

    {tab === 'Activity Logs' && <div className="space-y-4">
      <div className="card p-4 flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold"><span className="block text-[10px] text-muted uppercase mb-1"><Calendar size={11} className="inline mr-1" />Date</span><input type="date" value={date} onChange={e => setDate(e.target.value)} className="input-surface rounded-lg px-3 py-2 text-xs" /></label>
        <label className="text-xs font-semibold"><span className="block text-[10px] text-muted uppercase mb-1"><User size={11} className="inline mr-1" />Domain User</span><select value={domainUser} onChange={e => setDomainUser(e.target.value)} className="input-surface rounded-lg px-3 py-2 text-xs"><option value="">All domain users</option>{activityUsers.map(user => <option key={user} value={user}>{user}</option>)}</select></label>
        <button onClick={() => { setDate(''); setDomainUser(''); }} className="px-3 py-2 rounded-lg text-xs hover-surface">Clear</button>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4"><DailyStatusChart history={filteredHistory} /><HourlyActivityChart history={filteredHistory} /></div>
      <ActivityTimeline history={filteredHistory} domainUser={domainUser} />
    </div>}
    {tab === 'Screenshots' && <ScreenshotTab screenshots={screenshots} date={date} setDate={setDate} domainUser={domainUser} setDomainUser={setDomainUser} />}
    {tab === 'Live View' && <LiveViewTab device={device} frames={liveFrames} domainUser={domainUser} setDomainUser={setDomainUser} />}
  </div>;
}
