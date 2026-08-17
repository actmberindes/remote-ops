import React, { useEffect, useState } from 'react';
import { Globe2, ExternalLink, RefreshCw } from 'lucide-react';
import { api } from '../api.js';

export default function WebUsageWidget({ navigate, scopeUserIds = null, routeRole = 'admin' }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    try {
      const data = await api.activity.webUsage();
      const rows = scopeUserIds ? data.filter(x => scopeUserIds.has(Number(x.employeeId))) : data;
      setLogs(rows.slice(0, 8));
    } catch (_) { setLogs([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  return <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
    <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
      <div className="flex items-center gap-2"><div className="p-2 rounded-lg accent-soft"><Globe2 size={16} /></div><div><h3 className="font-display font-bold text-sm">Web Usage / Internet Activity</h3><p className="text-[11px] text-muted">Recent browser activity</p></div></div>
      <button onClick={load} className="p-1.5 rounded-lg hover-surface" title="Refresh"><RefreshCw size={13} /></button>
    </div>
    <div className="divide-y divide-[var(--border)]">{loading ? <div className="p-5 text-center text-xs text-muted">Loading…</div> : logs.length === 0 ? <div className="p-5 text-center text-xs text-muted">No web activity recorded.</div> : logs.map((log, i) => <div key={log.id || i} className="px-4 py-2.5 flex items-center justify-between gap-3"><div className="min-w-0"><div className="text-xs font-semibold truncate">{log.title || log.url || 'Web activity'}</div><div className="text-[10px] text-muted truncate">{log.employeeName || 'Employee'} · {log.timestamp || log.createdAt || ''}</div></div><ExternalLink size={13} className="text-muted shrink-0" /></div>)}</div>
    <div className="px-4 py-2.5 border-t border-[var(--border)] text-right"><button onClick={() => navigate(routeRole, 'web-usage')} className="text-xs font-bold accent-text hover:underline">View All</button></div>
  </div>;
}
