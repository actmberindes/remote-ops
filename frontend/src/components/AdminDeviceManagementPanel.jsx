import React, { useEffect, useMemo, useState } from 'react';
import { Copy, Monitor, RefreshCw, ShieldOff, Trash2, UserPlus, Wifi, WifiOff, Radio } from 'lucide-react';
import { api } from '../lib/api.js';

function statusTone(status) {
  return {
    active: 'var(--success)',
    idle: 'var(--warning)',
    'logged-out': 'var(--neutral)',
    offline: 'var(--danger)',
    pending: 'var(--info)',
    revoked: 'var(--danger)',
  }[status] || 'var(--neutral)';
}

function statusLabel(status) {
  return {
    active: 'Active',
    idle: 'Idle',
    'logged-out': 'No User Logged In',
    offline: 'Offline',
    pending: 'Pending Enrollment',
    revoked: 'Revoked',
  }[status] || status || 'Unknown';
}

function connectionLabel(device) {
  if (device.isRdp || device.connectionType === 'RDP') return 'RDP';
  if (device.currentDomainUser || device.domainUser) return 'Local';
  return '—';
}

export default function AdminDeviceManagementPanel({ users = [], addToast }) {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [deviceType, setDeviceType] = useState('desktop-agent');
  const [enrollment, setEnrollment] = useState(null);

  const employees = useMemo(
    () => users.filter(u => u.role === 'Employee'),
    [users]
  );

  const load = async () => {
    setLoading(true);
    try {
      setDevices(await api.agent.devices());
    } catch (e) {
      addToast?.(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);

  const register = async e => {
    e.preventDefault();
    if (!employeeId || !deviceName.trim()) return;

    setSaving(true);
    try {
      const result = await api.agent.registerDevice({
        employeeId: Number(employeeId),
        deviceName: deviceName.trim(),
        deviceType,
      });

      setEnrollment(result);
      setDevices(prev => [result, ...prev]);
      setEmployeeId('');
      setDeviceName('');
      setDeviceType('desktop-agent');
      addToast?.('Device registered. Give the enrollment code to the IT deployment process.', 'success');
    } catch (e) {
      addToast?.(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const revoke = async device => {
    if (!window.confirm(`Revoke "${device.deviceName}"? The agent token will stop working immediately.`)) return;
    try {
      const updated = await api.agent.revokeDevice(device.id);
      setDevices(prev => prev.map(d => d.id === device.id ? updated : d));
      addToast?.('Device revoked.', 'success');
    } catch (e) {
      addToast?.(e.message, 'error');
    }
  };

  const remove = async device => {
    if (!window.confirm(`Delete "${device.deviceName}" permanently?`)) return;
    try {
      await api.agent.deleteDevice(device.id);
      setDevices(prev => prev.filter(d => d.id !== device.id));
      setEnrollment(current => current?.id === device.id ? null : current);
      addToast?.('Device deleted permanently.', 'success');
    } catch (e) {
      addToast?.(e.message, 'error');
    }
  };

  const copyCode = async () => {
    if (!enrollment?.enrollmentCode) return;
    await navigator.clipboard.writeText(enrollment.enrollmentCode);
    addToast?.('Enrollment code copied.', 'success');
  };

  return (
    <div className="flex flex-col gap-5 w-full">
      <div className="card p-5">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h3 className="font-display font-bold text-base flex items-center gap-2">
              <Monitor size={16} className="accent-text" /> Device Management
            </h3>
            <p className="text-xs text-muted mt-0.5">
              Register each physical device once. The current Windows user is detected automatically, so one shared device can be used by multiple employees.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} className="p-2 rounded-lg hover-surface" title="Refresh">
              <RefreshCw size={14} />
            </button>
            <button
              onClick={() => setFormOpen(v => !v)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold accent-bg-solid shadow-sm"
            >
              <UserPlus size={14} /> Register Device
            </button>
          </div>
        </div>

        {formOpen && (
          <form onSubmit={register} className="mb-5 p-4 rounded-xl border border-[var(--border)]" style={{ background: 'var(--bg)' }}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="text-xs font-semibold">
                Registration Owner
                <select
                  className="w-full mt-1 rounded-lg px-3 py-2 input-surface text-xs"
                  value={employeeId}
                  onChange={e => setEmployeeId(e.target.value)}
                >
                  <option value="">Select employee…</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name} — {e.department}</option>)}
                </select>
                <span className="block text-[10px] font-normal text-muted mt-1">Used for device inventory. Current usage can switch between employees.</span>
              </label>

              <label className="text-xs font-semibold">
                Device Name
                <input
                  className="w-full mt-1 rounded-lg px-3 py-2 input-surface text-xs"
                  placeholder="e.g. 88F-WS031"
                  value={deviceName}
                  onChange={e => setDeviceName(e.target.value)}
                />
              </label>

              <label className="text-xs font-semibold">
                Device Type
                <select
                  className="w-full mt-1 rounded-lg px-3 py-2 input-surface text-xs"
                  value={deviceType}
                  onChange={e => setDeviceType(e.target.value)}
                >
                  <option value="desktop-agent">Desktop Agent</option>
                  <option value="browser-extension">Browser Extension</option>
                </select>
              </label>
            </div>

            <button
              type="submit"
              disabled={saving || !employeeId || !deviceName.trim()}
              className="mt-3 px-4 py-2 rounded-lg text-xs font-bold accent-bg-solid"
            >
              {saving ? 'Registering…' : 'Create Enrollment Code'}
            </button>
          </form>
        )}

        {enrollment?.enrollmentCode && (
          <div className="mb-5 p-4 rounded-xl border border-[var(--border)]" style={{ background: 'var(--bg)' }}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider font-bold text-muted">Enrollment Code</div>
                <div className="text-2xl font-bold mono tracking-[0.25em] mt-1">{enrollment.enrollmentCode}</div>
                <div className="text-[10px] text-muted mt-1">
                  Expires {new Date(enrollment.enrollmentExpiresAt).toLocaleString()}
                </div>
              </div>
              <button onClick={copyCode} className="p-2 rounded-lg hover-surface" title="Copy code">
                <Copy size={16} />
              </button>
            </div>
            <div className="text-xs text-muted mt-3">
              Use this code only on the intended physical device during the IT enrollment process.
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-8 text-center text-sm text-muted">Loading devices…</div>
        ) : devices.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted">No managed devices registered.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="font-bold text-muted uppercase tracking-wider border-b border-[var(--border)]">
                  <th className="pb-2.5 px-2">Device</th>
                  <th className="pb-2.5 px-2">Registered To</th>
                  <th className="pb-2.5 px-2">Current User</th>
                  <th className="pb-2.5 px-2">Session</th>
                  <th className="pb-2.5 px-2">Status</th>
                  <th className="pb-2.5 px-2">Last Seen</th>
                  <th className="pb-2.5 px-2">Agent</th>
                  <th className="pb-2.5 px-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {devices.map(d => {
                  const tone = statusTone(d.status);
                  const isRdp = d.isRdp || d.connectionType === 'RDP';
                  return (
                    <tr key={d.id} className="hover:bg-[var(--bg)] transition-colors">
                      <td className="py-3 px-2">
                        <div className="font-semibold">{d.deviceName}</div>
                        <div className="text-[10px] text-muted mono mt-0.5">{d.hostname || 'Hostname pending'}</div>
                      </td>
                      <td className="py-3 px-2">
                        <div className="font-semibold">{d.registeredEmployeeName || d.employeeName}</div>
                        <div className="text-[10px] text-muted">Original registration owner</div>
                      </td>
                      <td className="py-3 px-2">
                        {d.currentEmployeeName ? (
                          <>
                            <div className="font-semibold">{d.currentEmployeeName}</div>
                            <div className="text-[10px] text-muted mono">{d.currentDomainUser || d.domainUser || '—'}</div>
                          </>
                        ) : (
                          <span className="text-muted">No user</span>
                        )}
                      </td>
                      <td className="py-3 px-2">
                        <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: isRdp ? 'var(--warning)' : 'var(--text-muted)' }}>
                          {isRdp ? <Radio size={13} /> : <Wifi size={13} />}
                          {connectionLabel(d)}
                        </span>
                        {isRdp && d.sessionName && <div className="text-[9px] text-muted mono mt-0.5">{d.sessionName}</div>}
                      </td>
                      <td className="py-3 px-2">
                        <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: tone }}>
                          <span className="rounded-full" style={{ width: 7, height: 7, background: tone }} />
                          {statusLabel(d.status)}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-muted whitespace-nowrap">
                        {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : 'Never'}
                      </td>
                      <td className="py-3 px-2 text-muted">{d.agentVersion || '—'}</td>
                      <td className="py-3 px-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {!d.revoked && (
                            <button onClick={() => revoke(d)} className="p-1.5 rounded-lg hover-surface text-muted hover:text-[var(--danger)]" title="Revoke">
                              <ShieldOff size={14} />
                            </button>
                          )}
                          <button onClick={() => remove(d)} className="p-1.5 rounded-lg hover-surface text-muted hover:text-[var(--danger)]" title="Delete">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3 text-[10px] text-muted">
          <span className="inline-flex items-center gap-1.5"><Wifi size={12} /> Local session</span>
          <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--warning)' }}><Radio size={12} /> RDP session</span>
          <span className="inline-flex items-center gap-1.5"><WifiOff size={12} /> Offline / no session</span>
        </div>
      </div>
    </div>
  );
}
