import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Calendar, ChevronLeft, ChevronRight, Clock3, Download, Maximize2, Monitor, RefreshCw, User, Wifi, WifiOff, X } from 'lucide-react';
import { api } from '../lib/api.js';

const tabs = ['Activity Logs', 'Screenshots', 'Live View'];
function fmtDateTime(value) { return value ? new Date(value).toLocaleString() : '—'; }
function relativeTime(value) {
  if (!value) return 'Never';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Unknown';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 10) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
function statusColor(status) { return status === 'active' ? 'var(--success)' : status === 'idle' ? 'var(--warning)' : status === 'offline' || status === 'logged-out' ? 'var(--danger)' : 'var(--neutral)'; }
function statusLabel(status) { return status === 'logged-out' ? 'Offline / Logged out' : status ? status.replace(/-/g, ' ') : 'Unknown'; }
function domainUserOf(item) { return item?.domainUser || item?.currentDomainUser || 'Unknown user'; }
function displayLabel(item) { return String(item?.displayName || `DISPLAY${item?.displayIndex ?? ''}`).replace(/^DISPLAY\s*/i, 'DISPLAY').toUpperCase(); }
function screenshotLabel(item) { return `${domainUserOf(item)} · ${displayLabel(item)} · ${new Date(item.capturedAt).toLocaleTimeString()}`; }

function DeviceInfo({ device }) {
  const online = device?.status === 'active' || device?.status === 'idle';
  const status = device?.status || 'unknown';
  return <div className="card p-4"><div className="flex items-center gap-2 mb-3"><Monitor size={16} className="accent-text" /><div className="font-display font-bold text-sm">Device Info</div></div><div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-xs">
    {[['Device Name', device?.deviceName || '—'], ['OS', device?.os || device?.operatingSystem || 'Windows'], ['IP Address', device?.ipAddress || device?.ip || '—'], ['Last Domain User Log', device?.domainUser || device?.currentDomainUser || '—'], ['Agent Version', device?.agentVersion || '—'], ['Last Heartbeat', device?.lastSeenAt ? relativeTime(device.lastSeenAt) : 'Never']].map(([label, value]) => <div key={label} className="min-w-0"><div className="text-[10px] text-muted uppercase tracking-wider font-bold">{label}</div><div className="font-semibold mt-1 truncate" title={label === 'Last Heartbeat' ? fmtDateTime(device?.lastSeenAt) : String(value)}>{value}</div>{label === 'Last Heartbeat' && device?.lastSeenAt && <div className="text-[9px] text-muted mt-0.5 truncate">{fmtDateTime(device.lastSeenAt)}</div>}</div>)}
  </div><div className="mt-3 pt-3 border-t border-[var(--border)] flex flex-wrap items-center gap-3 text-[10px] text-muted"><span className="inline-flex items-center gap-1.5 font-semibold capitalize" style={{ color: online ? 'var(--success)' : 'var(--danger)' }}>{online ? <Wifi size={12} /> : <WifiOff size={12} />}{statusLabel(status)}</span>{device?.hostname && <span className="mono">{device.hostname}</span>}{device?.domain && <span className="mono">{device.domain}</span>}{device?.sessionName && <span className="mono">Session: {device.sessionName}</span>}{device?.isRdp && <span className="px-1.5 py-0.5 rounded bg-[var(--surface-2)]">RDP</span>}</div></div>;
}

// Builds a 7-day x 24-hour matrix of "percent of that hour spent in the
// 'active' workstation state" from the raw state-change history. History
// only records *transitions*, so each entry's active window runs from its
// own timestamp up to the next transition (or "now" for the most recent
// entry) — the same duration-weighted approach the device already used for
// its single-day hourly chart, extended across a rolling 7-day window and
// split per calendar day instead of collapsed into one 24-hour strip.
function lastNDays(n) {
  const days = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    days.push(d);
  }
  return days;
}
function dateKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

function useActivityMatrix(history, days = 7) {
  return useMemo(() => {
    const windowDays = lastNDays(days);
    const indexByKey = new Map(windowDays.map((d, i) => [dateKey(d), i]));
    const buckets = windowDays.map(d => ({ date: d, key: dateKey(d), hours: Array.from({ length: 24 }, () => ({ active: 0, total: 0 })) }));
    const windowStart = windowDays[0].getTime();
    const windowEnd = windowDays[windowDays.length - 1].getTime() + 24 * 60 * 60 * 1000;
    const sorted = [...history].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const now = Date.now();

    sorted.forEach((item, index) => {
      const start = new Date(item.timestamp).getTime();
      const next = index + 1 < sorted.length ? new Date(sorted[index + 1].timestamp).getTime() : now;
      const end = Math.min(next, now);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
      const clampedStart = Math.max(start, windowStart);
      const clampedEnd = Math.min(end, windowEnd);
      if (clampedEnd <= clampedStart) return;
      const active = item.to === 'active';
      let cursor = clampedStart;
      while (cursor < clampedEnd) {
        const d = new Date(cursor);
        const dayIndex = indexByKey.get(dateKey(d));
        const nextHour = new Date(d); nextHour.setMinutes(60, 0, 0);
        const sliceEnd = Math.min(clampedEnd, nextHour.getTime());
        const seconds = Math.max(0, sliceEnd - cursor) / 1000;
        if (dayIndex !== undefined) {
          const bucket = buckets[dayIndex].hours[d.getHours()];
          bucket.total += seconds;
          if (active) bucket.active += seconds;
        }
        cursor = sliceEnd;
      }
    });

    return buckets.map(bucket => {
      const hours = bucket.hours.map((h, hour) => ({ hour, hasData: h.total > 0, percent: h.total ? Math.round((h.active / h.total) * 100) : 0 }));
      const totalActive = bucket.hours.reduce((sum, h) => sum + h.active, 0);
      const totalTracked = bucket.hours.reduce((sum, h) => sum + h.total, 0);
      return {
        key: bucket.key,
        date: bucket.date,
        label: bucket.date.toLocaleDateString(undefined, { month: 'short', day: '2-digit' }),
        weekday: bucket.date.toLocaleDateString(undefined, { weekday: 'short' }),
        hasData: totalTracked > 0,
        percent: totalTracked ? Math.round((totalActive / totalTracked) * 100) : 0,
        hours,
      };
    });
  }, [history, days]);
}

function DailyActivityBars({ history }) {
  const days = useActivityMatrix(history, 7);
  return <div className="card p-4 min-w-0">
    <div className="flex items-center justify-between mb-4"><div className="font-display font-bold text-sm">Activity</div></div>
    <div className="flex items-end gap-2 h-48 pl-5 relative">
      <span className="absolute left-0 bottom-0 text-[10px] text-muted">0</span>
      {days.map(day => <div key={day.key} className="flex flex-col items-center gap-2 flex-1 h-full justify-end" title={day.hasData ? `${day.percent}% active on ${day.label}` : `No data for ${day.label}`}>
        <div className="relative w-6 sm:w-7 flex-1 rounded-full overflow-hidden flex items-end" style={{ background: 'var(--surface-2)' }}>
          <div className="w-full rounded-full transition-all" style={{ height: `${day.hasData ? Math.max(6, day.percent) : 0}%`, background: 'var(--info, #5b9bf7)' }} />
        </div>
        <div className="text-[9px] text-muted font-semibold whitespace-nowrap">{day.label}</div>
      </div>)}
    </div>
  </div>;
}

function HourlyActivityHeatmap({ history }) {
  const days = useActivityMatrix(history, 7);
  function cellColor(hour) {
    if (!hour.hasData) return 'var(--surface-2)';
    const alpha = 0.12 + Math.min(1, Math.max(0, hour.percent / 100)) * 0.78;
    return `rgba(34,197,94,${alpha.toFixed(2)})`;
  }
  return <div className="card p-4 min-w-0 overflow-x-auto">
    <div className="font-display font-bold text-sm">Activity (Keyboard/Mouse) Hourly</div>
    <div className="text-[10px] text-muted mb-3">Based on workstation active vs. idle/locked state, per hour</div>
    <div className="flex gap-3 min-w-[620px]">
      <div className="flex flex-col items-center justify-between py-1 h-[182px] text-[9px] text-muted font-semibold shrink-0">
        <span>100%</span>
        <div className="flex-1 w-2 my-1 rounded-full" style={{ background: 'linear-gradient(to top, rgba(34,197,94,0.12), rgba(34,197,94,0.9))' }} />
        <span>0%</span>
      </div>
      <div className="flex-1">
        <div className="grid gap-[3px]" style={{ gridTemplateColumns: '44px repeat(24, minmax(0,1fr))' }}>
          {days.map(day => <React.Fragment key={day.key}>
            <div className="text-[10px] text-muted font-semibold flex items-center">{day.weekday}</div>
            {day.hours.map(hour => <div key={hour.hour} title={`${day.weekday} ${String(hour.hour).padStart(2, '0')}:00 — ${hour.hasData ? `${hour.percent}% active` : 'No data'}`} className="aspect-square rounded-[3px]" style={{ background: cellColor(hour) }} />)}
          </React.Fragment>)}
          <div />
          {Array.from({ length: 24 }, (_, h) => <div key={h} className="text-[8px] text-muted text-center">{h}</div>)}
        </div>
      </div>
    </div>
  </div>;
}

function ActivityTimeline({ history, domainUser }) { const rows = history.filter(item => !domainUser || domainUserOf(item) === domainUser).slice(0, 100); return <div className="card p-4"><div className="flex items-center justify-between gap-3 mb-3"><div className="flex items-center gap-2"><Clock3 size={15} className="accent-text" /><div className="font-display font-bold text-sm">Activity Timeline</div></div><div className="text-[10px] text-muted">{rows.length} record{rows.length === 1 ? '' : 's'}</div></div>{rows.length ? <div className="divide-y divide-[var(--border)]">{rows.map(item => { const color = statusColor(item.to); return <div key={item.id} className="py-2.5 flex flex-wrap items-center gap-3 text-xs"><div className="min-w-[155px]"><div className="font-semibold">{fmtDateTime(item.timestamp)}</div><div className="text-[9px] text-muted">{relativeTime(item.timestamp)}</div></div><span className="mono font-semibold truncate max-w-[260px]" title={item.domainUser || 'No domain user'}>{item.domainUser || 'No domain user'}</span><span className="inline-flex items-center gap-1.5 font-semibold px-2 py-1 rounded-full bg-[var(--surface-2)]" style={{ color }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />{statusLabel(item.to)}{item.from ? <span className="opacity-60 font-normal">from {statusLabel(item.from)}</span> : null}</span></div>; })}</div> : <div className="py-8 text-center text-xs text-muted">No activity records for this filter.</div>}</div>; }

function ScreenshotViewer({ item, onClose }) { if (!item) return null; const url = api.uploads.fileUrl(item.url); const label = screenshotLabel(item); return <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}><div className="card p-0 overflow-hidden w-full max-w-6xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}><div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border)]"><div className="font-display font-bold text-sm truncate">{label}</div><div className="flex items-center gap-1"><a href={url} download={item.filename || 'screenshot'} className="p-1.5 rounded-lg hover-surface" title="Download"><Download size={16} /></a><button onClick={onClose} className="p-1.5 rounded-lg hover-surface" title="Close"><X size={16} /></button></div></div><div className="flex-1 min-h-0 overflow-auto flex items-center justify-center p-4 bg-black"><img src={url} alt={label} className="max-w-full max-h-[78vh] object-contain" /></div></div></div>; }

function ScreenshotTab({ deviceId, date, setDate, domainUser, setDomainUser, refreshKey }) {
  const [items, setItems] = useState([]); const [users, setUsers] = useState([]); const [page, setPage] = useState(1); const [totalPages, setTotalPages] = useState(1); const [total, setTotal] = useState(0); const [loading, setLoading] = useState(true); const [selected, setSelected] = useState(null); const pageSize = 20;
  useEffect(() => { setPage(1); }, [date, domainUser, deviceId]);
  useEffect(() => { let cancelled = false; setLoading(true); Promise.all([api.agent.deviceScreenshots({ id: deviceId, page, pageSize, date, domainUser }), api.agent.deviceScreenshotUsers(deviceId)]).then(([payload, userPayload]) => { if (cancelled) return; setItems(payload?.items || []); setTotalPages(payload?.totalPages || 1); setTotal(payload?.total || 0); setUsers(userPayload?.users || []); }).catch(() => { if (!cancelled) { setItems([]); setTotalPages(1); setTotal(0); } }).finally(() => { if (!cancelled) setLoading(false); }); return () => { cancelled = true; }; }, [deviceId, page, date, domainUser, refreshKey]);
  return <div className="space-y-4"><div className="card p-4 flex flex-wrap items-end gap-3"><label className="text-xs font-semibold"><span className="block text-[10px] text-muted uppercase mb-1">Date</span><input type="date" value={date} onChange={e => setDate(e.target.value)} className="input-surface rounded-lg px-3 py-2 text-xs" /></label><label className="text-xs font-semibold"><span className="block text-[10px] text-muted uppercase mb-1">Domain User</span><select value={domainUser} onChange={e => setDomainUser(e.target.value)} className="input-surface rounded-lg px-3 py-2 text-xs"><option value="">All domain users</option>{users.map(user => <option key={user} value={user}>{user}</option>)}</select></label><button onClick={() => { setDate(''); setDomainUser(''); setPage(1); }} className="px-3 py-2 rounded-lg text-xs hover-surface">Clear</button><div className="ml-auto text-[10px] text-muted">{total} screenshot{total === 1 ? '' : 's'}</div></div>{loading ? <div className="card py-12 text-center text-xs text-muted">Loading screenshots…</div> : items.length ? <><div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">{items.map(item => <button key={item.id} type="button" className="card p-0 overflow-hidden text-left hover-surface" onClick={() => setSelected(item)}><div className="relative"><img src={api.uploads.fileUrl(item.url)} alt={item.filename || 'Screenshot'} className="w-full aspect-video object-cover" /><span className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-white"><Maximize2 size={12} /></span></div><div className="p-2 text-[10px] truncate font-medium" title={screenshotLabel(item)}>{screenshotLabel(item)}</div></button>)}</div><div className="card p-3 flex items-center justify-center gap-3"><button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className="p-2 rounded-lg hover-surface disabled:opacity-40"><ChevronLeft size={16} /></button><span className="text-xs font-semibold">Page {page} of {totalPages}</span><button disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} className="p-2 rounded-lg hover-surface disabled:opacity-40"><ChevronRight size={16} /></button></div></> : <div className="card py-12 text-center text-xs text-muted">No screenshots match the selected filters.</div>}{selected && <ScreenshotViewer item={selected} onClose={() => setSelected(null)} />}</div>;
}

function LiveViewTab({ device, frames, domainUser, setDomainUser }) {
  const users = [...new Set(frames.map(domainUserOf).filter(Boolean))].sort();
  const list = frames.filter(item => !domainUser || domainUserOf(item) === domainUser);
  const latest = list[0];
  const online = device?.status === 'active' || device?.status === 'idle';

  return <div className="space-y-4"><div className="card p-4 flex flex-wrap items-end gap-3"><label className="text-xs font-semibold"><span className="block text-[10px] text-muted uppercase mb-1">Domain User</span><select value={domainUser} onChange={e => setDomainUser(e.target.value)} className="input-surface rounded-lg px-3 py-2 text-xs"><option value="">All domain users</option>{users.map(user => <option key={user} value={user}>{user}</option>)}</select></label><div className="text-[10px] text-muted">Auto-refreshes every 10 seconds while this tab is open.</div></div>{!online ? <div className="card py-12 text-center"><div className="text-sm font-semibold">Live View unavailable</div><div className="text-xs text-muted mt-1">This device is currently {statusLabel(device?.status)}. No new Live View frames are being sent.</div></div> : latest?.url ? <div className="card p-3"><div className="flex items-center justify-between gap-3 mb-2"><div className="text-xs font-semibold">{domainUserOf(latest)} · {fmtDateTime(latest.capturedAt)}</div><span className="text-[10px] text-muted">{displayLabel(latest)}</span></div><img src={api.uploads.fileUrl(latest.url)} alt={device.deviceName} className="w-full max-h-[70vh] object-contain rounded-lg bg-black" /></div> : <div className="card py-12 text-center text-xs text-muted">No Live View frame is available for this device.</div>}</div>;
}

export default function DeviceDetailsPage({ deviceId, onBack }) {
  const [payload, setPayload] = useState(null); const [loading, setLoading] = useState(true); const [tab, setTab] = useState('Activity Logs'); const [date, setDate] = useState(''); const [domainUser, setDomainUser] = useState(''); const [error, setError] = useState(''); const [refreshKey, setRefreshKey] = useState(0);
  const load = async ({ silent = false } = {}) => { if (!silent) setLoading(true); setError(''); try { setPayload(await api.agent.deviceDetails(deviceId)); } catch (e) { setError(e.message); } finally { if (!silent) setLoading(false); } };
  useEffect(() => { load(); }, [deviceId]);
  useEffect(() => { if (tab !== 'Live View') return undefined; const timer = setInterval(() => { load({ silent: true }); setRefreshKey(k => k + 1); }, 10000); return () => clearInterval(timer); }, [tab, deviceId]);
  const history = payload?.history || []; const liveFrames = payload?.liveFrames || []; const activityUsers = useMemo(() => [...new Set(history.map(domainUserOf).filter(Boolean))].sort(), [history]); const filteredHistory = useMemo(() => history.filter(item => (!date || item.timestamp?.slice(0, 10) === date) && (!domainUser || domainUserOf(item) === domainUser)), [history, date, domainUser]);
  // The daily/hourly activity views are inherently a rolling 7-day window, so
  // they only honor the domain-user filter (not the single-date filter,
  // which would collapse a 7-day chart down to one bar/row).
  const userFilteredHistory = useMemo(() => history.filter(item => !domainUser || domainUserOf(item) === domainUser), [history, domainUser]);
  if (loading) return <div className="py-16 text-center text-sm text-muted">Loading device details…</div>;
  if (error) return <div className="card p-6"><div className="text-sm font-semibold text-[var(--danger)]">Unable to load device</div><div className="text-xs text-muted mt-1">{error}</div><button onClick={() => load()} className="mt-3 px-3 py-2 rounded-lg text-xs accent-bg-solid">Retry</button></div>;
  const device = payload?.device;
  return <div className="flex flex-col gap-4 w-full"><div className="flex items-center justify-between gap-3"><button onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-semibold hover-surface px-3 py-2 rounded-lg"><ArrowLeft size={14} /> Device Management</button><button onClick={() => load()} className="p-2 rounded-lg hover-surface" title="Refresh"><RefreshCw size={14} /></button></div><div className="flex items-center gap-3"><div className="p-2.5 rounded-xl accent-bg"><Monitor size={20} /></div><div><h2 className="font-display font-bold text-lg">{device?.deviceName}</h2><div className="text-xs text-muted">{device?.hostname || 'Hostname pending'} · {device?.currentDomainUser || device?.domainUser || 'No current domain user'}</div></div></div><DeviceInfo device={device} /><div className="card p-2 flex flex-wrap gap-1">{tabs.map(item => <button key={item} onClick={() => { setTab(item); setDate(''); setDomainUser(''); setRefreshKey(k => k + 1); }} className={`px-4 py-2 rounded-lg text-xs font-bold ${tab === item ? 'accent-bg-solid' : 'hover-surface'}`}>{item}</button>)}</div>{tab === 'Activity Logs' && <div className="space-y-4"><div className="card p-4 flex flex-wrap items-end gap-3"><label className="text-xs font-semibold"><span className="block text-[10px] text-muted uppercase mb-1"><Calendar size={11} className="inline mr-1" />Date</span><input type="date" value={date} onChange={e => setDate(e.target.value)} className="input-surface rounded-lg px-3 py-2 text-xs" /></label><label className="text-xs font-semibold"><span className="block text-[10px] text-muted uppercase mb-1"><User size={11} className="inline mr-1" />Domain User</span><select value={domainUser} onChange={e => setDomainUser(e.target.value)} className="input-surface rounded-lg px-3 py-2 text-xs"><option value="">All domain users</option>{activityUsers.map(user => <option key={user} value={user}>{user}</option>)}</select></label><button onClick={() => { setDate(''); setDomainUser(''); }} className="px-3 py-2 rounded-lg text-xs hover-surface">Clear</button></div><div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4"><DailyActivityBars history={userFilteredHistory} /><HourlyActivityHeatmap history={userFilteredHistory} /></div><ActivityTimeline history={filteredHistory} domainUser={domainUser} /></div>}{tab === 'Screenshots' && <ScreenshotTab deviceId={deviceId} date={date} setDate={setDate} domainUser={domainUser} setDomainUser={setDomainUser} refreshKey={refreshKey} />}{tab === 'Live View' && <LiveViewTab device={device} frames={liveFrames} domainUser={domainUser} setDomainUser={setDomainUser} />}</div>;
}
