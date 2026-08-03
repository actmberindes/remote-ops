import React, { useState, useEffect, useMemo, useRef, createContext, useContext } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import {
  LayoutDashboard, ClipboardList, Calendar, UserCog, Clock, Upload, Sun, Moon, Bell,
  ChevronDown, ChevronLeft, ChevronRight, LogOut, Pencil, Trash2, Plus, X, Check, ShieldAlert,
  Search, CheckCircle2, XCircle, AlertCircle, Play, Square, Users, Home, ArrowLeft, ArrowRight,
  Monitor, Wifi, MapPin, Briefcase, FileText, Eye, Lock, UploadCloud, FileCheck
} from 'lucide-react';
import { api, getToken, setToken } from './lib/api.js';

/* ============================== CONSTANTS ============================== */

const DEPARTMENTS = ['Order Management', 'ART', 'ART-Proofs', 'ART-3D', 'ART-Rendering','IT', 'Purchasing', 'Accounting' ];
const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const HOLIDAYS = { '2026-08-21': 'Ninoy Aquino Day', '2026-08-31': 'National Heroes Day' };
const IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes in milliseconds

/* ============================== HELPERS ============================== */

const nextId = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);

const pad2 = (n) => String(n).padStart(2, '0');
const toISO = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const fromISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addMonths = (d, n) => { const r = new Date(d); r.setMonth(r.getMonth() + n); return r; };
const weekdayKeyOf = (d) => WEEKDAY_KEYS[(d.getDay() + 6) % 7];
const formatHMS = (totalSeconds) => {
  const h = Math.floor(totalSeconds / 3600), m = Math.floor((totalSeconds % 3600) / 60), s = totalSeconds % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
};
const formatNiceDate = (iso) => iso ? fromISO(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
const monthLabel = (d) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

function buildMonthGrid(viewDate) {
  const year = viewDate.getFullYear(), month = viewDate.getMonth();
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function dayTypeFor(app, dateObj) {
  const iso = toISO(dateObj);
  if (HOLIDAYS[iso]) return { type: 'Holiday', label: HOLIDAYS[iso] };
  if (!app || app.status !== 'approved') return null;
  const start = fromISO(app.startDate);
  const end = fromISO(app.temporary ? app.endDate : app.defaultEndDate);
  if (dateObj < start || dateObj > end) return null;
  const t = app.days[weekdayKeyOf(dateObj)];
  return t ? { type: t, label: t } : null;
}

/* ============================== APP CONTEXT ============================== */

const AppCtx = createContext(null);
const useApp = () => useContext(AppCtx);

/* ============================== UI COMPONENTS ============================== */

function StatusDot({ status }) {
  const isAct = status === 'active';
  const isIdle = status === 'idle';
  const color = isAct ? 'var(--success)' : isIdle ? 'var(--warning)' : 'var(--neutral)';
  return (
    <span className="flex items-center gap-1.5">
      <span className={`pulse-dot ${isAct ? 'pulse-active' : ''}`} style={{ background: color }} />
      <span className="capitalize text-xs font-medium" style={{ color }}>{status}</span>
    </span>
  );
}

function Badge({ children, tone = 'neutral' }) {
  const map = {
    success: { bg: 'var(--success-tint)', fg: 'var(--success)' },
    warning: { bg: 'var(--warning-tint)', fg: 'var(--warning)' },
    danger: { bg: 'var(--danger-tint)', fg: 'var(--danger)' },
    info: { bg: 'var(--info-tint)', fg: 'var(--info)' },
    neutral: { bg: 'var(--neutral-tint)', fg: 'var(--neutral)' },
    holiday: { bg: 'rgba(139, 111, 217, 0.15)', fg: 'var(--holiday)' },
  };
  const c = map[tone] || map.neutral;
  return (
    <span className="rounded-md px-2 py-0.5 text-xs font-medium inline-flex items-center gap-1 border border-transparent"
      style={{ background: c.bg, color: c.fg }}>
      {children}
    </span>
  );
}

function Avatar({ name, size = 32 }) {
  const initials = name ? name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase() : '??';
  return (
    <div className="flex items-center justify-center rounded-lg font-bold shrink-0 accent-bg shadow-sm"
      style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials}
    </div>
  );
}

function Card({ children, className = '', style = {} }) {
  return <div className={`card p-5 ${className}`} style={style}>{children}</div>;
}

function Modal({ isOpen, onClose, title, children }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="card w-full max-w-lg p-6 relative border border-[var(--border)] shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-[var(--border)]">
          <h3 className="font-display font-bold text-base">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover-surface text-muted hover:text-[var(--text)] transition-colors">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ToastStack() {
  const { toasts } = useApp();
  const icon = { success: <CheckCircle2 size={16} />, error: <XCircle size={16} />, info: <AlertCircle size={16} /> };
  const tone = { success: 'var(--success)', error: 'var(--danger)', info: 'var(--info)' };
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2" style={{ width: 300 }}>
      {toasts.map(t => (
        <div key={t.id} className="card flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium shadow-lg" style={{ borderLeft: `3px solid ${tone[t.type] || tone.info}` }}>
          <span style={{ color: tone[t.type] || tone.info }}>{icon[t.type] || icon.info}</span>
          {t.message}
        </div>
      ))}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block mb-3">
      <span className="block text-[11px] font-bold mb-1 text-muted uppercase tracking-wider">{label}</span>
      {children}
    </label>
  );
}

const inputCls = "w-full rounded-lg px-3 py-2 text-xs input-surface font-medium focus:outline-none focus:ring-1 focus:ring-[var(--accent)] transition-all";

/* ============================== WFH DETAIL MODAL ============================== */

function ApplicationDetailModal({ app, user, isOpen, onClose, onUpdateStatus }) {
  if (!app || !user) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="WFH Application Details">
      <div className="space-y-4 text-xs">
        <div className="flex items-center justify-between p-3 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
          <div className="flex items-center gap-3">
            <Avatar name={user.name} size={36} />
            <div>
              <div className="font-bold text-sm">{user.name}</div>
              <div className="text-muted">{user.jobTitle} • {user.department}</div>
            </div>
          </div>
          <Badge tone={app.status === 'approved' ? 'success' : app.status === 'rejected' ? 'danger' : 'warning'}>
            {app.status}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg border border-[var(--border)]">
            <div className="text-[10px] text-muted font-bold uppercase tracking-wider mb-1 flex items-center gap-1">
              <MapPin size={12} /> Work Location
            </div>
            <div className="font-semibold text-xs truncate">{app.location}</div>
          </div>
          <div className="p-3 rounded-lg border border-[var(--border)]">
            <div className="text-[10px] text-muted font-bold uppercase tracking-wider mb-1 flex items-center gap-1">
              <Wifi size={12} /> Internet Infrastructure
            </div>
            <div className="font-semibold text-xs">{app.internetType}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg border border-[var(--border)]">
            <div className="text-[10px] text-muted font-bold uppercase tracking-wider mb-1">Submitted Date</div>
            <div className="font-semibold text-xs">{formatNiceDate(app.submittedDate)}</div>
          </div>
          <div className="p-3 rounded-lg border border-[var(--border)]">
            <div className="text-[10px] text-muted font-bold uppercase tracking-wider mb-1">Effective Window</div>
            <div className="font-semibold text-xs">{formatNiceDate(app.startDate)} - {formatNiceDate(app.temporary ? app.endDate : app.defaultEndDate)}</div>
          </div>
        </div>

        <div className="p-3 rounded-lg border border-[var(--border)]">
          <div className="text-[10px] text-muted font-bold uppercase tracking-wider mb-2">Weekly Work Schedule</div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAY_KEYS.map(k => (
              <div key={k} className="p-1 rounded bg-[var(--bg)] border border-[var(--border)]">
                <div className="text-[9px] font-bold text-muted uppercase">{k}</div>
                <div className={`text-[10px] font-semibold mt-1 ${app.days?.[k] === 'WFH' ? 'accent-text' : app.days?.[k] === 'Office' ? 'text-muted' : 'opacity-40'}`}>
                  {app.days?.[k] || 'Off'}
                </div>
              </div>
            ))}
          </div>
        </div>

        {app.reason && (
          <div className="p-3 rounded-lg border border-[var(--border)]">
            <div className="text-[10px] text-muted font-bold uppercase tracking-wider mb-1">Justification / Remarks</div>
            <p className="text-muted leading-relaxed">{app.reason}</p>
          </div>
        )}

        {app.fileName && (
          <div className="flex items-center justify-between p-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
            <div className="flex items-center gap-2">
              <FileText size={16} className="text-muted" />
              <span className="font-medium text-xs truncate max-w-[200px]">{app.fileName}</span>
            </div>
            <span className="text-[10px] font-bold accent-text">Verified Speedtest</span>
          </div>
        )}

        {onUpdateStatus && app.status === 'pending' && (
          <div className="flex gap-2 pt-2 border-t border-[var(--border)]">
            <button
              onClick={() => { onUpdateStatus(app.id, 'approved'); onClose(); }}
              className="flex-1 py-2 rounded-lg font-semibold text-xs bg-[var(--success)] text-white hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5">
              <Check size={14} /> Approve Application
            </button>
            <button
              onClick={() => { onUpdateStatus(app.id, 'rejected'); onClose(); }}
              className="flex-1 py-2 rounded-lg font-semibold text-xs bg-[var(--danger)] text-white hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5">
              <X size={14} /> Reject Application
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ============================== COMPACT MONTH CALENDAR ============================== */

function ExpandedMonthCalendar({ app, title }) {
  const [viewDate, setViewDate] = useState(new Date(2026, 7, 1));
  const cells = useMemo(() => buildMonthGrid(viewDate), [viewDate]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-[var(--border)]">
        <div>
          <h2 className="font-display font-bold text-base">{title}</h2>
          <p className="text-xs text-muted">{monthLabel(viewDate)}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setViewDate(d => addMonths(d, -1))} className="p-1.5 rounded-lg border border-[var(--border)] hover-surface"><ChevronLeft size={16} /></button>
          <button onClick={() => setViewDate(new Date(2026, 7, 1))} className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-xs font-semibold hover-surface">Current Month</button>
          <button onClick={() => setViewDate(d => addMonths(d, 1))} className="p-1.5 rounded-lg border border-[var(--border)] hover-surface"><ChevronRight size={16} /></button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-bold text-muted uppercase tracking-wider mb-1">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} className="py-1">{d}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-1.5 flex-1">
        {cells.map((d, i) => {
          if (!d) return <div key={i} className="rounded-xl bg-[var(--bg)] opacity-30 min-h-[64px]" />;
          const item = dayTypeFor(app, d);
          const isToday = toISO(d) === '2026-08-03';
          
          let tone = 'neutral';
          if (item?.type === 'WFH') tone = 'success';
          if (item?.type === 'Office') tone = 'info';
          if (item?.type === 'Holiday') tone = 'holiday';

          return (
            <div key={i} className={`rounded-xl p-2 border border-[var(--border)] bg-[var(--surface)] flex flex-col justify-between transition-all min-h-[64px] ${isToday ? 'ring-1 ring-[var(--accent)]' : ''}`}>
              <div className="flex items-center justify-between">
                <span className={`text-xs font-semibold ${isToday ? 'accent-text font-bold' : 'text-muted'}`}>{d.getDate()}</span>
              </div>
              {item ? (
                <div className="mt-1">
                  <Badge tone={tone}>{item.label}</Badge>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================== AUTH PAGE ============================== */

function LoginPage() {
  const { theme, setTheme, login, registerUser } = useApp();
  const [tab, setTab] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [managers, setManagers] = useState([]);
  useEffect(() => { api.managers().then(setManagers).catch(() => setManagers([])); }, []);
  const [regForm, setRegForm] = useState({ name: '', email: '', password: '', confirm: '', department: DEPARTMENTS[0], jobTitle: '', managerId: '' });
  useEffect(() => { if (!regForm.managerId && managers[0]) setRegForm(f => ({ ...f, managerId: managers[0].id })); }, [managers]);
  const setReg = (k, v) => setRegForm(f => ({ ...f, [k]: v }));

  const submitSignIn = (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    setTimeout(async () => {
      const res = await login(email, password);
      if (!res.ok) setError(res.error);
      setLoading(false);
    }, 300);
  };

  const submitSignUp = async (e) => {
    e.preventDefault();
    setError('');
    if (regForm.password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (regForm.password !== regForm.confirm) { setError('Passwords do not match.'); return; }
    setLoading(true);
    const res = await registerUser(regForm);
    setLoading(false);
    if (!res.ok) setError(res.error);
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 app-shell relative">
      <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        className="absolute top-4 right-4 p-2 rounded-xl hover-surface card">
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>

      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center rounded-xl mb-3 accent-bg p-3 shadow-md">
            <Home size={24} />
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Remote Ops</h1>
          <p className="text-xs text-muted mt-1">Enterprise Operations & WFH Management Platform</p>
        </div>

        <Card className="shadow-xl border border-[var(--border)]">
          <div className="flex gap-1 mb-5 p-1 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
            <button onClick={() => { setTab('signin'); setError(''); }} className="flex-1 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider transition-all"
              style={tab === 'signin' ? { background: 'var(--surface)', color: 'var(--text)', boxShadow: 'var(--shadow)' } : { color: 'var(--text-muted)' }}>
              Sign In
            </button>
            <button onClick={() => { setTab('signup'); setError(''); }} className="flex-1 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider transition-all"
              style={tab === 'signup' ? { background: 'var(--surface)', color: 'var(--text)', boxShadow: 'var(--shadow)' } : { color: 'var(--text-muted)' }}>
              Create Account
            </button>
          </div>

          {error && (
            <div className="mb-4 rounded-lg p-2.5 text-xs font-medium flex items-center gap-2" style={{ background: 'var(--danger-tint)', color: 'var(--danger)' }}>
              <AlertCircle size={14} /> {error}
            </div>
          )}

          {tab === 'signin' ? (
            <form onSubmit={submitSignIn}>
              <Field label="Work Email Address">
                <input className={inputCls} type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="name@company.com" />
              </Field>
              <Field label="Password">
                <input className={inputCls} type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
              </Field>
              <button type="submit" disabled={loading} className="w-full rounded-lg py-2.5 font-semibold text-xs accent-bg-solid shadow-sm hover:opacity-90 transition-opacity mt-1">
                {loading ? 'Authenticating…' : 'Sign In'}
              </button>
            </form>
          ) : (
            <form onSubmit={submitSignUp}>
              <Field label="Full Name"><input className={inputCls} required value={regForm.name} onChange={e => setReg('name', e.target.value)} placeholder="Juan Dela Cruz" /></Field>
              <Field label="Work Email Address"><input className={inputCls} type="email" required value={regForm.email} onChange={e => setReg('email', e.target.value)} placeholder="name@company.com" /></Field>
              <Field label="Job Title"><input className={inputCls} required value={regForm.jobTitle} onChange={e => setReg('jobTitle', e.target.value)} placeholder="Software Engineer" /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Department">
                  <select className={inputCls} value={regForm.department} onChange={e => setReg('department', e.target.value)}>
                    {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
                  </select>
                </Field>
                <Field label="Manager">
                  <select className={inputCls} value={regForm.managerId} onChange={e => setReg('managerId', Number(e.target.value))}>
                    {managers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Password"><input className={inputCls} type="password" required value={regForm.password} onChange={e => setReg('password', e.target.value)} placeholder="••••••••" /></Field>
                <Field label="Confirm Password"><input className={inputCls} type="password" required value={regForm.confirm} onChange={e => setReg('confirm', e.target.value)} placeholder="••••••••" /></Field>
              </div>
              <button type="submit" disabled={loading} className="w-full rounded-lg py-2.5 font-semibold text-xs accent-bg-solid shadow-sm hover:opacity-90 transition-opacity mt-1">
                {loading ? 'Creating Account…' : 'Create Account'}
              </button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}



/* ============================== HEADER & SIDEBAR ============================== */

function Header() {
  const { currentUser, logout, theme, setTheme, notifications, markAllRead } = useApp();
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const myNotifs = notifications.filter(n => (n.audience === 'role' && n.role === currentUser.role) || (n.audience === 'user' && n.userId === currentUser.id));
  const unread = myNotifs.filter(n => !n.read).length;

  return (
    <header className="flex items-center justify-between px-6 py-3 header-bar">
      <div className="flex items-center gap-2.5">
        <span className="font-display font-bold text-sm">Remote Ops</span>
        <span className="text-muted font-medium text-xs">/</span>
        <Badge tone="info">{currentUser.role} Dashboard</Badge>
      </div>
      
      <div className="flex items-center gap-2">
        <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="p-2 rounded-lg hover-surface border border-[var(--border)]">
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        <div className="relative">
          <button onClick={() => { setNotifOpen(v => !v); setProfileOpen(false); }} className="p-2 rounded-lg hover-surface border border-[var(--border)] relative">
            <Bell size={16} />
            {unread > 0 && <span className="absolute top-1.5 right-1.5 rounded-full w-2 h-2 bg-[var(--danger)]" />}
          </button>
          {notifOpen && (
            <div className="absolute right-0 mt-2 card p-0 overflow-hidden z-50 shadow-xl w-72 border border-[var(--border)]">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)]">
                <span className="font-semibold text-xs">Notifications</span>
                <button onClick={() => markAllRead()} className="text-[10px] font-bold accent-text">Mark all read</button>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {myNotifs.length === 0 && <div className="p-4 text-xs text-muted text-center">No new notifications.</div>}
                {myNotifs.map(n => (
                  <div key={n.id} className="p-3 text-xs border-b border-[var(--border)]" style={{ background: n.read ? 'transparent' : 'var(--info-tint)' }}>
                    <div className="font-medium text-xs">{n.message}</div>
                    <div className="text-[10px] text-muted mt-0.5">{n.timestamp}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="relative">
          <button onClick={() => { setProfileOpen(v => !v); setNotifOpen(false); }} className="flex items-center gap-2 pl-1.5 pr-2 py-1 rounded-xl hover-surface border border-[var(--border)]">
            <Avatar name={currentUser.name} size={26} />
            <div className="text-left hidden md:block">
              <div className="text-xs font-semibold leading-tight">{currentUser.name}</div>
              <div className="text-[10px] text-muted leading-tight">{currentUser.department}</div>
            </div>
            <ChevronDown size={12} className="text-muted" />
          </button>
          {profileOpen && (
            <div className="absolute right-0 mt-2 card p-0 overflow-hidden z-50 shadow-xl w-56 border border-[var(--border)]">
              <div className="p-3 border-b border-[var(--border)]">
                <div className="font-semibold text-xs">{currentUser.name}</div>
                <div className="text-[11px] text-muted truncate">{currentUser.email}</div>
              </div>
              <button onClick={logout} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-[var(--danger)] hover-surface">
                <LogOut size={14} /> Log Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

const NAV_BY_ROLE = {
  Admin: [
    { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { key: 'applications', label: 'Applications', icon: ClipboardList },
    { key: 'schedules', label: 'Schedules', icon: Calendar },
    { key: 'users', label: 'User Management', icon: UserCog },
  ],
  Manager: [
    { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { key: 'applications', label: 'Applications', icon: ClipboardList },
    { key: 'schedules', label: 'Schedules', icon: Calendar },
  ],
  Employee: [
    { key: 'dashboard', label: 'Time & Attendance', icon: LayoutDashboard },
    { key: 'wfh-application', label: 'WFH Request', icon: ClipboardList },
    { key: 'schedule', label: 'My Schedule', icon: Calendar },
  ],
};

function Sidebar() {
  const { currentUser, page, navigate } = useApp();
  const items = NAV_BY_ROLE[currentUser.role];
  return (
    <aside className="sidebar flex flex-col py-4 px-3 w-56 shrink-0 border-r border-[var(--border)]">
      <div className="flex items-center gap-2.5 px-2 mb-6">
        <div className="rounded-xl flex items-center justify-center accent-bg w-8 h-8 shadow-sm">
          <Home size={16} />
        </div>
        <div>
          <span className="font-display font-bold text-sm block leading-tight">Remote Ops</span>
          <span className="text-[9px] text-muted uppercase font-bold tracking-wider">Enterprise Workspace</span>
        </div>
      </div>

      <nav className="flex flex-col gap-1">
        {items.map(item => {
          const Icon = item.icon;
          const active = page === item.key;
          return (
            <button key={item.key} onClick={() => navigate(currentUser.role.toLowerCase(), item.key)}
              className={`nav-item flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${active ? 'nav-active' : 'hover-surface text-muted'}`}>
              <Icon size={16} /> {item.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

/* ============================== DASHBOARD & METRICS ============================== */

function KpiCard({ icon: Icon, label, value, tone }) {
  return (
    <Card className="flex items-center gap-4 border border-[var(--border)] shadow-sm p-4">
      <div className="rounded-xl flex items-center justify-center p-2.5" style={{ background: `var(--${tone}-tint)`, color: `var(--${tone})` }}>
        <Icon size={20} />
      </div>
      <div>
        <div className="text-2xl font-display font-bold leading-tight">{value}</div>
        <div className="text-[10px] text-muted font-bold uppercase tracking-wider">{label}</div>
      </div>
    </Card>
  );
}

function DashboardShared({ scopeUsers, scopeApps, onViewApplications }) {
  const employees = scopeUsers.filter(u => u.role === 'Employee');
  const total = employees.length;
  const active = employees.filter(u => u.status === 'active').length;
  const idle = employees.filter(u => u.status === 'idle').length;
  const pending = scopeApps.filter(a => a.status === 'pending').length;

  const chartData = useMemo(() => {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return days.map((day) => ({ day, active: active }));
  }, [active]);

  return (
    <div className="flex flex-col gap-5 w-full">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={Users} label="Total Staff" value={total} tone="info" />
        <KpiCard icon={CheckCircle2} label="Active Working" value={active} tone="success" />
        <KpiCard icon={Clock} label="Idle Staff" value={idle} tone="warning" />
        <KpiCard icon={ClipboardList} label="Pending WFH" value={pending} tone="danger" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2">
          <div className="font-display font-bold text-sm mb-0.5">Live Employee Activity</div>
          <div className="text-xs text-muted mb-4">Real-time attendance & state tracking overview</div>
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="active" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3, fill: 'var(--accent)' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <div className="font-display font-bold text-sm mb-3">Live Status Roster</div>
          <div className="flex flex-col gap-2 max-h-56 overflow-y-auto pr-1">
            {employees.map(u => (
              <div key={u.id} className="flex items-center justify-between p-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                <div className="flex items-center gap-2">
                  <Avatar name={u.name} size={28} />
                  <div>
                    <div className="text-xs font-semibold">{u.name}</div>
                    <div className="text-[10px] text-muted">{u.jobTitle}</div>
                  </div>
                </div>
                <StatusDot status={u.status || 'inactive'} />
              </div>
            ))}
            {employees.length === 0 && <div className="text-xs text-muted py-4 text-center">No assigned staff.</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ============================== ADMIN / MANAGER VIEWS ============================== */

function AdminDashboard() {
  const { users, applications, navigate } = useApp();
  return <DashboardShared scopeUsers={users} scopeApps={applications} onViewApplications={() => navigate('admin', 'applications')} />;
}

function AdminApplications() {
  const { users, applications, setApplications, addToast } = useApp();
  const [tab, setTab] = useState('pending');
  const [selectedApp, setSelectedApp] = useState(null);

  const tabs = [['pending', 'Pending', 'warning'], ['approved', 'Approved', 'success'], ['rejected', 'Rejected', 'danger']];
  const list = applications.filter(a => a.status === tab);

  const handleUpdateStatus = async (id, status) => {
    try {
      const updated = await api.applications.patch(id, { status });
      setApplications(prev => prev.map(a => a.id === id ? updated : a));
      addToast(`Application marked as ${status}.`, status === 'approved' ? 'success' : 'info');
    } catch (e) {
      addToast(e.message, 'error');
    }
  };

  return (
    <Card className="w-full">
      <div className="flex gap-2 mb-4 border-b border-[var(--border)] pb-3">
        {tabs.map(([key, label, tone]) => (
          <button key={key} onClick={() => setTab(key)} className="px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all"
            style={tab === key ? { background: `var(--${tone}-tint)`, color: `var(--${tone})` } : { color: 'var(--text-muted)' }}>
            {label} ({applications.filter(a => a.status === key).length})
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="font-bold text-muted uppercase tracking-wider border-b border-[var(--border)]">
              <th className="pb-2.5 px-2">Employee</th>
              <th className="pb-2.5 px-2">Department</th>
              <th className="pb-2.5 px-2">Location</th>
              <th className="pb-2.5 px-2">Submitted</th>
              <th className="pb-2.5 px-2">Internet</th>
              <th className="pb-2.5 px-2">Status</th>
              <th className="pb-2.5 px-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {list.map(a => {
              const u = users.find(x => x.id === a.userId);
              if (!u) return null;
              return (
                <tr key={a.id} className="hover:bg-[var(--bg)] transition-colors">
                  <td className="py-3 px-2 flex items-center gap-2 font-semibold">
                    <Avatar name={u.name} size={26} />
                    <span>{u.name}</span>
                  </td>
                  <td className="py-3 px-2 text-muted">{u.department}</td>
                  <td className="py-3 px-2 text-muted">{a.location}</td>
                  <td className="py-3 px-2 text-muted">{formatNiceDate(a.submittedDate)}</td>
                  <td className="py-3 px-2 text-muted">{a.internetType}</td>
                  <td className="py-3 px-2"><Badge tone={tab === 'pending' ? 'warning' : tab === 'approved' ? 'success' : 'danger'}>{a.status}</Badge></td>
                  <td className="py-3 px-2 text-right">
                    <button
                      onClick={() => setSelectedApp({ app: a, user: u })}
                      className="p-1.5 rounded-lg hover-surface border border-[var(--border)] inline-flex items-center gap-1 font-semibold text-xs text-muted hover:text-[var(--text)] transition-colors">
                      <Eye size={14} /> Details
                    </button>
                  </td>
                </tr>
              );
            })}
            {list.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-muted">No records match this status filter.</td></tr>}
          </tbody>
        </table>
      </div>

      <ApplicationDetailModal
        isOpen={Boolean(selectedApp)}
        onClose={() => setSelectedApp(null)}
        app={selectedApp?.app}
        user={selectedApp?.user}
        onUpdateStatus={handleUpdateStatus}
      />
    </Card>
  );
}

function SchedulesPage({ scopeUsers }) {
  const { applications } = useApp();
  const [dept, setDept] = useState('All');
  const filteredByDept = dept === 'All' ? scopeUsers : scopeUsers.filter(u => u.department === dept);
  const employeeOnly = filteredByDept.filter(u => u.role === 'Employee');
  const [empId, setEmpId] = useState(employeeOnly[0]?.id || null);

  useEffect(() => { if (!employeeOnly.find(u => u.id === empId)) setEmpId(employeeOnly[0]?.id || null); }, [dept]);
  const selectedUser = employeeOnly.find(u => u.id === empId);
  const app = applications.find(a => a.userId === empId);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-5 w-full">
      <Card className="lg:col-span-1 h-fit">
        <h3 className="font-display font-bold text-sm mb-3">Select Schedule View</h3>
        <Field label="Department">
          <select className={inputCls} value={dept} onChange={e => setDept(e.target.value)}>
            <option>All</option>
            {[...new Set(scopeUsers.map(u => u.department))].map(d => <option key={d}>{d}</option>)}
          </select>
        </Field>
        <Field label="Employee">
          <select className={inputCls} value={empId || ''} onChange={e => setEmpId(Number(e.target.value))}>
            {employeeOnly.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
      </Card>
      <Card className="lg:col-span-3 flex flex-col">
        {selectedUser ? (
          <ExpandedMonthCalendar app={app} title={`${selectedUser.name}'s Schedule`} />
        ) : (
          <div className="text-muted text-xs flex items-center justify-center min-h-[300px]">Select an employee to display schedule.</div>
        )}
      </Card>
    </div>
  );
}

function AdminSchedules() {
  const { users } = useApp();
  return <SchedulesPage scopeUsers={users} />;
}

/* ============================== USER MANAGEMENT (EDIT/DELETE) ============================== */

function AdminUserManagement() {
  const { users, setUsers, currentUser, addToast } = useApp();
  const [query, setQuery] = useState('');
  const [editingUser, setEditingUser] = useState(null);

  const filtered = users.filter(u => (u.name + u.email + u.department + u.jobTitle).toLowerCase().includes(query.toLowerCase()));

  const handleSaveUser = async (e) => {
    e.preventDefault();
    try {
      const updated = await api.users.update(editingUser.id, editingUser);
      setUsers(prev => prev.map(u => u.id === editingUser.id ? updated : u));
      addToast(`User profile for ${editingUser.name} updated.`, 'success');
      setEditingUser(null);
    } catch (e) {
      addToast(e.message, 'error');
    }
  };

  const handleDeleteUser = async (user) => {
    if (user.id === currentUser.id) {
      addToast("You cannot delete your own active administrator account.", 'error');
      return;
    }
    if (window.confirm(`Are you sure you want to permanently delete user account: ${user.name}?`)) {
      try {
        await api.users.remove(user.id);
        setUsers(prev => prev.filter(u => u.id !== user.id));
        addToast(`User ${user.name} removed successfully.`, 'info');
      } catch (e) {
        addToast(e.message, 'error');
      }
    }
  };

  return (
    <Card className="w-full">
      <div className="flex items-center justify-between mb-4">
        <div className="relative w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className={`${inputCls} pl-8`} placeholder="Search users by name or department…" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="font-bold text-muted uppercase tracking-wider border-b border-[var(--border)]">
              <th className="pb-2.5 px-2">Name</th>
              <th className="pb-2.5 px-2">Email</th>
              <th className="pb-2.5 px-2">Role</th>
              <th className="pb-2.5 px-2">Department</th>
              <th className="pb-2.5 px-2">Job Title</th>
              <th className="pb-2.5 px-2">Live Status</th>
              <th className="pb-2.5 px-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {filtered.map(u => (
              <tr key={u.id} className="hover:bg-[var(--bg)] transition-colors">
                <td className="py-3 px-2 flex items-center gap-2 font-semibold">
                  <Avatar name={u.name} size={26} />
                  <span>{u.name}</span>
                </td>
                <td className="py-3 px-2 text-muted">{u.email}</td>
                <td className="py-3 px-2"><Badge tone="info">{u.role}</Badge></td>
                <td className="py-3 px-2 text-muted">{u.department}</td>
                <td className="py-3 px-2 text-muted">{u.jobTitle}</td>
                <td className="py-3 px-2"><StatusDot status={u.status || 'inactive'} /></td>
                <td className="py-3 px-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => setEditingUser({ ...u })}
                      className="p-1.5 rounded-lg hover-surface border border-[var(--border)] text-muted hover:text-[var(--text)] transition-colors">
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => handleDeleteUser(u)}
                      className="p-1.5 rounded-lg hover-surface border border-[var(--border)] text-muted hover:text-[var(--danger)] transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="py-6 text-center text-muted">No users found matching query.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal isOpen={Boolean(editingUser)} onClose={() => setEditingUser(null)} title="Edit User Account">
        {editingUser && (
          <form onSubmit={handleSaveUser}>
            <Field label="Full Name">
              <input className={inputCls} required value={editingUser.name} onChange={e => setEditingUser({ ...editingUser, name: e.target.value })} />
            </Field>
            <Field label="Work Email Address">
              <input className={inputCls} type="email" required value={editingUser.email} onChange={e => setEditingUser({ ...editingUser, email: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Role">
                <select className={inputCls} value={editingUser.role} onChange={e => setEditingUser({ ...editingUser, role: e.target.value })}>
                  <option value="Admin">Admin</option>
                  <option value="Manager">Manager</option>
                  <option value="Employee">Employee</option>
                </select>
              </Field>
              <Field label="Department">
                <select className={inputCls} value={editingUser.department} onChange={e => setEditingUser({ ...editingUser, department: e.target.value })}>
                  {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Job Title">
              <input className={inputCls} required value={editingUser.jobTitle} onChange={e => setEditingUser({ ...editingUser, jobTitle: e.target.value })} />
            </Field>
            <div className="flex gap-2 justify-end mt-4">
              <button type="button" onClick={() => setEditingUser(null)} className="px-4 py-2 rounded-lg text-xs font-semibold hover-surface border border-[var(--border)]">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-lg text-xs font-semibold accent-bg-solid shadow-sm">Save Changes</button>
            </div>
          </form>
        )}
      </Modal>
    </Card>
  );
}

function ManagerDashboard() {
  const { users, applications, currentUser, navigate } = useApp();
  const team = users.filter(u => u.managerId === currentUser.id);
  const teamIds = new Set(team.map(u => u.id));
  const teamApps = applications.filter(a => teamIds.has(a.userId));
  return <DashboardShared scopeUsers={team} scopeApps={teamApps} onViewApplications={() => navigate('manager', 'applications')} />;
}

function ManagerApplications() {
  const { users, applications, setApplications, currentUser, addToast } = useApp();
  const [selectedApp, setSelectedApp] = useState(null);

  const team = users.filter(u => u.managerId === currentUser.id);
  const teamApps = applications.filter(a => team.some(u => u.id === a.userId));

  const handleUpdateStatus = async (id, status) => {
    try {
      const updated = await api.applications.patch(id, { status });
      setApplications(prev => prev.map(a => a.id === id ? updated : a));
      addToast(`Application updated to ${status}.`, status === 'approved' ? 'success' : 'info');
    } catch (e) {
      addToast(e.message, 'error');
    }
  };

  return (
    <Card className="w-full">
      <h3 className="font-display font-bold text-base mb-3">Team WFH Applications</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="font-bold text-muted uppercase tracking-wider border-b border-[var(--border)]">
              <th className="pb-2.5 px-2">Employee</th>
              <th className="pb-2.5 px-2">Location</th>
              <th className="pb-2.5 px-2">Status</th>
              <th className="pb-2.5 px-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {teamApps.map(a => {
              const u = users.find(x => x.id === a.userId);
              return (
                <tr key={a.id} className="hover:bg-[var(--bg)] transition-colors">
                  <td className="py-3 px-2 font-semibold flex items-center gap-2">
                    <Avatar name={u?.name} size={24} />
                    <span>{u?.name}</span>
                  </td>
                  <td className="py-3 px-2 text-muted">{a.location}</td>
                  <td className="py-3 px-2"><Badge tone={a.status === 'approved' ? 'success' : a.status === 'rejected' ? 'danger' : 'warning'}>{a.status}</Badge></td>
                  <td className="py-3 px-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setSelectedApp({ app: a, user: u })}
                        className="p-1.5 rounded-lg hover-surface border border-[var(--border)] inline-flex items-center gap-1 font-semibold text-xs text-muted hover:text-[var(--text)] transition-colors">
                        <Eye size={14} /> Details
                      </button>
                      {a.status === 'pending' && (
                        <button onClick={() => handleUpdateStatus(a.id, 'approved')} className="px-2.5 py-1 rounded-md text-xs font-semibold accent-bg-solid">Approve</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {teamApps.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-muted">No WFH applications submitted by team members.</td></tr>}
          </tbody>
        </table>
      </div>

      <ApplicationDetailModal
        isOpen={Boolean(selectedApp)}
        onClose={() => setSelectedApp(null)}
        app={selectedApp?.app}
        user={selectedApp?.user}
        onUpdateStatus={handleUpdateStatus}
      />
    </Card>
  );
}

function ManagerSchedules() {
  const { users, currentUser } = useApp();
  const team = users.filter(u => u.managerId === currentUser.id);
  return <SchedulesPage scopeUsers={team} />;
}

/* ============================== EMPLOYEE VIEWS & DYNAMIC TRACKING ============================== */

function DynamicTimeTracker() {
  const { currentUser, setUsers, setTimeSessions, applications, addToast } = useApp();
  const [tracking, setTracking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [isIdle, setIsIdle] = useState(false);
  const lastActivity = useRef(Date.now());
  const startedAt = useRef(null);

  const userApp = applications.find(a => a.userId === currentUser.id);
  const isApproved = userApp?.status === 'approved';

  const pushStatus = (status) => {
    setUsers(prev => prev.map(u => u.id === currentUser.id ? { ...u, status } : u));
    api.users.setMyStatus(status).catch(() => {});
  };

  useEffect(() => {
    if (!isApproved) return;
    const bumpActivity = () => {
      lastActivity.current = Date.now();
      if (isIdle && tracking) {
        setIsIdle(false);
        pushStatus('active');
      }
    };
    window.addEventListener('mousemove', bumpActivity);
    window.addEventListener('keydown', bumpActivity);
    return () => {
      window.removeEventListener('mousemove', bumpActivity);
      window.removeEventListener('keydown', bumpActivity);
    };
  }, [isIdle, tracking, currentUser.id, isApproved]);

  useEffect(() => {
    if (!tracking || !isApproved) return;
    const interval = setInterval(() => {
      const now = Date.now();
      const idleTime = now - lastActivity.current;

      if (idleTime >= IDLE_THRESHOLD_MS && !isIdle) {
        setIsIdle(true);
        pushStatus('idle');
      }

      if (!isIdle) {
        setElapsed(e => e + 1);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [tracking, isIdle, currentUser.id, isApproved]);

  const toggleTracking = async () => {
    if (!isApproved) {
      addToast('Cannot start tracking: Your WFH application is not approved.', 'error');
      return;
    }

    if (!tracking) {
      setTracking(true);
      setElapsed(0);
      setIsIdle(false);
      startedAt.current = new Date();
      lastActivity.current = Date.now();
      pushStatus('active');
      addToast('Time tracking started.', 'info');
    } else {
      setTracking(false);
      const end = new Date();
      const totalHours = Math.max(0.01, Math.round((elapsed / 3600) * 100) / 100);
      const payload = {
        date: toISO(end),
        startTime: startedAt.current.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        endTime: end.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        totalHours,
      };
      try {
        const saved = await api.timeSessions.create(payload);
        setTimeSessions(prev => [saved, ...prev]);
        addToast(`Session saved (${totalHours} hrs).`, 'success');
      } catch (e) {
        addToast(e.message, 'error');
      }
      pushStatus('inactive');
      setElapsed(0);
    }
  };

  return (
    <Card className="flex flex-col sm:flex-row items-center justify-between gap-4 rail border border-[var(--border)] shadow-md">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <StatusDot status={isApproved ? (tracking ? (isIdle ? 'idle' : 'active') : 'inactive') : 'inactive'} />
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
            {!userApp 
              ? 'No WFH Application Submitted' 
              : userApp.status === 'pending' 
              ? 'WFH Application Pending Approval' 
              : userApp.status === 'rejected'
              ? 'WFH Application Rejected'
              : (tracking ? (isIdle ? 'Idle — Away > 5 mins' : 'Live Active Tracking') : 'Clocked Out')}
          </span>
        </div>
        <div className="font-display font-bold text-3xl tracking-tight mono">{formatHMS(elapsed)}</div>
      </div>
      
      <button 
        onClick={toggleTracking}
        disabled={!isApproved}
        className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-xs shadow-md transition-all ${
          !isApproved 
            ? 'opacity-50 cursor-not-allowed bg-[var(--border)] text-muted' 
            : tracking 
            ? 'bg-[var(--danger)] text-white active:scale-95' 
            : 'bg-[var(--success)] text-white active:scale-95'
        }`}>
        {tracking ? <><Square size={14} /> Stop Session</> : <><Play size={14} /> Start Session</>}
      </button>
    </Card>
  );
}

function EmployeeDashboard() {
  const { currentUser, timeSessions } = useApp();
  const mine = timeSessions.filter(s => s.userId === currentUser.id);

  return (
    <div className="flex flex-col gap-5 w-full">
      <DynamicTimeTracker />
      <Card>
        <h3 className="font-display font-bold text-base mb-3">Logged Work Sessions</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="font-bold text-muted uppercase tracking-wider border-b border-[var(--border)]">
                <th className="pb-2.5 px-2">Date</th>
                <th className="pb-2.5 px-2">Start Time</th>
                <th className="pb-2.5 px-2">End Time</th>
                <th className="pb-2.5 px-2">Hours Logged</th>
                <th className="pb-2.5 px-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {mine.map(s => (
                <tr key={s.id}>
                  <td className="py-3 px-2 font-semibold">{formatNiceDate(s.date)}</td>
                  <td className="py-3 px-2 text-muted mono">{s.startTime}</td>
                  <td className="py-3 px-2 text-muted mono">{s.endTime}</td>
                  <td className="py-3 px-2 font-bold">{s.totalHours} hrs</td>
                  <td className="py-3 px-2"><Badge tone="success">{s.status}</Badge></td>
                </tr>
              ))}
              {mine.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted">No sessions logged yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ============================== INTERACTIVE MULTI-STEP WFH APPLICATION ============================== */

function EmployeeWFHApplication() {
  const { currentUser, users, applications, setApplications, addToast } = useApp();
  const existing = applications.find(a => a.userId === currentUser.id && a.status !== 'rejected');
  
  const todayIso = toISO(new Date(2026, 7, 3));
  const defaultEndIso = toISO(addMonths(fromISO(todayIso), 3));

  const manager = useMemo(() => {
    return users.find(u => u.id === currentUser.managerId) || { name: 'Direct Supervisor' };
  }, [users, currentUser]);

  const storageKey = `wfh_form_draft_${currentUser.id}`;

  const defaultFormState = {
    location: '',
    startDate: todayIso,
    temporary: false,
    endDate: defaultEndIso,
    days: { mon: 'WFH', tue: 'WFH', wed: 'WFH', thu: 'WFH', fri: 'WFH', sat: 'Off', sun: 'Off' },
    internetType: 'Fiber',
    fileName: '',
    reason: '',
    acknowledgedPolicy: false,
  };

  const [step, setStep] = useState(1);
  const [form, setForm] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : defaultFormState;
    } catch {
      return defaultFormState;
    }
  });

  const [submitting, setSubmitting] = useState(false);

  // Sync state persistence to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(form));
    } catch (e) {
      console.error('Failed saving form state:', e);
    }
  }, [form, storageKey]);

  if (existing) {
    return (
      <Card className="w-full max-w-2xl">
        <div className="flex items-center gap-3 mb-4 pb-3 border-b border-[var(--border)]">
          <div className="p-2.5 rounded-xl accent-bg">
            <ClipboardList size={22} />
          </div>
          <div>
            <h3 className="font-display font-bold text-base">WFH Application On File</h3>
            <p className="text-xs text-muted">You already have an active or pending work-from-home application.</p>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg)] flex items-center justify-between">
          <div className="space-y-1 text-xs">
            <div className="font-bold text-sm flex items-center gap-1.5">
              <MapPin size={14} className="accent-text" /> {existing.location}
            </div>
            <div className="text-muted">
              Submitted on <span className="font-semibold text-[var(--text)]">{formatNiceDate(existing.submittedDate)}</span>
            </div>
            <div className="text-muted">
              Effective Window: <span className="font-semibold text-[var(--text)]">{formatNiceDate(existing.startDate)} - {formatNiceDate(existing.temporary ? existing.endDate : existing.defaultEndDate)}</span>
            </div>
          </div>
          <Badge tone={existing.status === 'approved' ? 'success' : 'warning'}>{existing.status}</Badge>
        </div>
      </Card>
    );
  }

  const updateForm = (key, val) => setForm(prev => ({ ...prev, [key]: val }));
  const updateDay = (dayKey, val) => setForm(prev => ({ ...prev, days: { ...prev.days, [dayKey]: val } }));

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      updateForm('fileName', file.name);
      addToast(`Attached Speedtest evidence: ${file.name}`, 'info');
    }
  };

  const handleNext = () => {
    if (step === 2 && !form.location.trim()) {
      addToast('Please enter your primary WFH location.', 'error');
      return;
    }
    if (step === 3 && !form.fileName) {
      addToast('Please upload a screenshot of your Speedtest results.', 'error');
      return;
    }
    setStep(prev => Math.min(prev + 1, 4));
  };

  const handleBack = () => setStep(prev => Math.max(prev - 1, 1));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.acknowledgedPolicy) {
      addToast('You must acknowledge and accept the IT Security Declaration.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        location: form.location,
        startDate: form.startDate,
        defaultEndDate: defaultEndIso,
        temporary: form.temporary,
        endDate: form.temporary ? form.endDate : defaultEndIso,
        days: form.days,
        internetType: form.internetType,
        fileName: form.fileName,
        reason: form.reason,
      };

      const created = await api.applications.create(payload);
      setApplications(prev => [...prev, created]);
      localStorage.removeItem(storageKey);
      addToast('WFH Application submitted successfully.', 'success');
    } catch (err) {
      addToast(err.message || 'Failed submitting application.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const stepsHeader = [
    { num: 1, title: 'Profile' },
    { num: 2, title: 'Schedule' },
    { num: 3, title: 'Connectivity' },
    { num: 4, title: 'Compliance' },
  ];

  return (
    <Card className="w-full max-w-2xl border border-[var(--border)] shadow-xl">
      <div className="mb-6">
        <h2 className="font-display font-bold text-lg">Work From Home Application</h2>
        <p className="text-xs text-muted">Complete all verification steps to apply for regular remote work approval.</p>
      </div>

      {/* Stepper Progress Header */}
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-[var(--border)]">
        {stepsHeader.map((s, idx) => {
          const isDone = step > s.num;
          const isCurr = step === s.num;
          return (
            <React.Fragment key={s.num}>
              <div className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs transition-all ${
                  isDone ? 'accent-bg-solid' : isCurr ? 'ring-2 ring-[var(--accent)] accent-bg' : 'bg-[var(--bg)] border border-[var(--border)] text-muted'
                }`}>
                  {isDone ? <Check size={14} /> : s.num}
                </div>
                <span className={`text-xs font-semibold hidden sm:inline ${isCurr ? 'text-[var(--text)]' : 'text-muted'}`}>{s.title}</span>
              </div>
              {idx < stepsHeader.length - 1 && <div className="flex-1 h-[2px] bg-[var(--border)] mx-2" />}
            </React.Fragment>
          );
        })}
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Step 1: Profile Info (Read-Only Context) */}
        {step === 1 && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <div className="p-3 rounded-lg bg-[var(--info-tint)] border border-[var(--info)]/20 text-xs text-[var(--info)] flex items-center gap-2">
              <AlertCircle size={16} className="shrink-0" />
              <span>Verify your logged-in profile context. Updates must be requested via HR.</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Employee Name">
                <input className={`${inputCls} opacity-70 cursor-not-allowed`} disabled value={currentUser.name} />
              </Field>
              <Field label="Employee ID">
                <input className={`${inputCls} opacity-70 cursor-not-allowed`} disabled value={`EMP-${currentUser.id}`} />
              </Field>
              <Field label="Job Title">
                <input className={`${inputCls} opacity-70 cursor-not-allowed`} disabled value={currentUser.jobTitle || 'N/A'} />
              </Field>
              <Field label="Department">
                <input className={`${inputCls} opacity-70 cursor-not-allowed`} disabled value={currentUser.department || 'N/A'} />
              </Field>
              <Field label="Email Address">
                <input className={`${inputCls} opacity-70 cursor-not-allowed`} disabled value={currentUser.email} />
              </Field>
              <Field label="Assigned Manager">
                <input className={`${inputCls} opacity-70 cursor-not-allowed`} disabled value={manager.name} />
              </Field>
            </div>
          </div>
        )}

        {/* Step 2: WFH Schedule Details */}
        {step === 2 && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <Field label="Primary WFH Location">
              <input
                className={inputCls}
                required
                placeholder="e.g. Home Residence, Cebu City"
                value={form.location}
                onChange={e => updateForm('location', e.target.value)}
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Effective Start Date">
                <input className={inputCls} type="date" value={form.startDate} onChange={e => updateForm('startDate', e.target.value)} />
              </Field>
              <Field label={form.temporary ? "Custom End Date" : "Default End Date (3 Months)"}>
                <input
                  className={`${inputCls} ${!form.temporary ? 'opacity-70 cursor-not-allowed' : ''}`}
                  type="date"
                  disabled={!form.temporary}
                  value={form.temporary ? form.endDate : defaultEndIso}
                  onChange={e => updateForm('endDate', e.target.value)}
                />
              </Field>
            </div>

            <div className="flex items-center gap-2 py-1">
              <input
                type="checkbox"
                id="tempToggle"
                checked={form.temporary}
                onChange={e => updateForm('temporary', e.target.checked)}
                className="rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]"
              />
              <label htmlFor="tempToggle" className="text-xs font-medium cursor-pointer">
                Temporary WFH Arrangement (Enable Custom End Date)
              </label>
            </div>

            {/* Day-of-Week Cards */}
            <div>
              <span className="block text-[11px] font-bold mb-2 text-muted uppercase tracking-wider">Weekly Work Pattern</span>
              <div className="grid grid-cols-2 sm:grid-cols-7 gap-2">
                {WEEKDAY_KEYS.map(k => (
                  <div key={k} className="p-2.5 rounded-xl border border-[var(--border)] bg-[var(--bg)] flex flex-col items-center gap-2 text-center">
                    <span className="text-[10px] font-bold uppercase text-muted">{k}</span>
                    <select
                      className="w-full text-[11px] font-semibold bg-transparent text-[var(--text)] border-none focus:ring-0 p-0 text-center cursor-pointer"
                      value={form.days[k]}
                      onChange={e => updateDay(k, e.target.value)}
                    >
                      <option value="WFH" className="bg-[var(--surface)]">WFH</option>
                      <option value="Office" className="bg-[var(--surface)]">Office</option>
                      <option value="Off" className="bg-[var(--surface)]">Off</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Connectivity & Verification */}
        {step === 3 && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <Field label="Internet Connection Type">
              <select className={inputCls} value={form.internetType} onChange={e => updateForm('internetType', e.target.value)}>
                <option value="Fiber">Fiber Internet</option>
                <option value="DSL">DSL</option>
                <option value="Cable">Cable</option>
                <option value="Mobile Data">5G Mobile Data</option>
                <option value="Other">Other Connection</option>
              </select>
            </Field>

            <Field label="Speedtest Evidence Upload">
              <label className="border-2 border-dashed border-[var(--border)] hover:border-[var(--accent)] transition-colors rounded-xl p-5 flex flex-col items-center justify-center gap-2 cursor-pointer bg-[var(--bg)]">
                <UploadCloud size={24} className="accent-text" />
                <span className="text-xs font-semibold">
                  {form.fileName ? `Selected file: ${form.fileName}` : 'Click to upload Speedtest screenshot'}
                </span>
                <span className="text-[10px] text-muted">Supports PNG, JPG, or PDF proof</span>
                <input type="file" accept="image/*,.pdf" onChange={handleFileUpload} className="hidden" />
              </label>
            </Field>

            <Field label="Additional Business Justification / Notes">
              <textarea
                className={inputCls}
                rows={3}
                placeholder="Optional notes regarding your home workspace set-up..."
                value={form.reason}
                onChange={e => updateForm('reason', e.target.value)}
              />
            </Field>
          </div>
        )}

        {/* Step 4: Security & Compliance */}
        {step === 4 && (
          <div className="space-y-4 animate-in fade-in duration-150">
            <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg)] space-y-3">
              <div className="flex items-center gap-2 font-bold text-xs">
                <ShieldAlert size={16} className="text-[var(--warning)]" />
                <span>IT Asset & Security Declaration Policy</span>
              </div>
              <blockquote className="text-[11px] leading-relaxed text-muted p-3 bg-[var(--surface)] rounded-lg border border-[var(--border)] italic">
                "I acknowledge that the IT assets provided are the property of the company and will be used strictly for official purposes. I agree to follow company IT and information security policies, not share company data or assets with unauthorized persons, maintain the safety and confidentiality of assigned assets, and return all assets upon request or separation."
              </blockquote>
            </div>

            <label className="flex items-start gap-2.5 p-3 rounded-lg border border-[var(--border)] hover-surface cursor-pointer">
              <input
                type="checkbox"
                required
                checked={form.acknowledgedPolicy}
                onChange={e => updateForm('acknowledgedPolicy', e.target.checked)}
                className="mt-0.5 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)]"
              />
              <span className="text-xs font-medium leading-tight">
                I have read, understood, and agree to strictly comply with the IT Asset & Security Declaration.
              </span>
            </label>
          </div>
        )}

        {/* Stepper Controls */}
        <div className="flex items-center justify-between pt-4 border-t border-[var(--border)]">
          {step > 1 ? (
            <button
              type="button"
              onClick={handleBack}
              className="px-4 py-2 rounded-lg text-xs font-semibold border border-[var(--border)] hover-surface flex items-center gap-1.5"
            >
              <ArrowLeft size={14} /> Back
            </button>
          ) : <div />}

          {step < 4 ? (
            <button
              type="button"
              onClick={handleNext}
              className="px-5 py-2 rounded-lg text-xs font-semibold accent-bg-solid shadow-sm flex items-center gap-1.5"
            >
              Next <ArrowRight size={14} />
            </button>
          ) : (
            <button
              type="submit"
              disabled={submitting || !form.acknowledgedPolicy}
              className={`px-6 py-2 rounded-lg text-xs font-bold shadow-md transition-all flex items-center gap-1.5 ${
                form.acknowledgedPolicy && !submitting
                  ? 'accent-bg-solid active:scale-95'
                  : 'opacity-50 cursor-not-allowed bg-[var(--border)] text-muted'
              }`}
            >
              <FileCheck size={14} /> {submitting ? 'Submitting Application…' : 'Submit Application'}
            </button>
          )}
        </div>
      </form>
    </Card>
  );
}

function EmployeeSchedule() {
  const { currentUser, applications } = useApp();
  const app = applications.find(a => a.userId === currentUser.id && a.status === 'approved');

  return (
    <Card className="w-full">
      <ExpandedMonthCalendar app={app} title="My Monthly Working Schedule" />
    </Card>
  );
}

/* ============================== LAYOUT GUARD & ENTRYPOINT ============================== */

const PAGES = {
  admin: { dashboard: AdminDashboard, applications: AdminApplications, schedules: AdminSchedules, users: AdminUserManagement },
  manager: { dashboard: ManagerDashboard, applications: ManagerApplications, schedules: ManagerSchedules },
  employee: { dashboard: EmployeeDashboard, 'wfh-application': EmployeeWFHApplication, schedule: EmployeeSchedule },
};

function AuthenticatedLayout() {
  const { currentUser, section, page } = useApp();
  const PageComp = PAGES[section]?.[page];

  return (
    <div className="flex h-screen w-full overflow-hidden app-shell">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <Header />
        <main className="p-5 flex-1 overflow-y-auto w-full">
          {PageComp ? <PageComp /> : <AdminDashboard />}
        </main>
      </div>
      <ToastStack />
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useState('dark');
  const [currentUser, setCurrentUser] = useState(null);
  const [section, setSection] = useState('login');
  const [page, setPage] = useState('dashboard');
  const [dataLoaded, setDataLoaded] = useState(false);

  const [users, setUsers] = useState([]);
  const [applications, setApplications] = useState([]);
  const [timeSessions, setTimeSessions] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [toasts, setToasts] = useState([]);

  const addToast = (message, type = 'info') => {
    const id = nextId();
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  };

  const navigate = (sec, pg) => { setSection(sec); setPage(pg); };

  const loadWorkspace = async () => {
    const [u, a, s, n] = await Promise.all([
      api.users.list(), api.applications.list(), api.timeSessions.list(), api.notifications.list(),
    ]);
    setUsers(u); setApplications(a); setTimeSessions(s); setNotifications(n);
  };

  useEffect(() => {
    (async () => {
      const token = getToken();
      if (token) {
        try {
          const { user } = await api.me();
          setCurrentUser(user);
          await loadWorkspace();
          navigate(user.role.toLowerCase(), 'dashboard');
        } catch (e) {
          setToken(null);
        }
      }
      setDataLoaded(true);
    })();
  }, []);

  const login = async (email, password) => {
    try {
      const { token, user } = await api.login(email, password);
      setToken(token);
      setCurrentUser(user);
      await loadWorkspace();
      navigate(user.role.toLowerCase(), 'dashboard');
      addToast(`Signed in as ${user.name}`, 'success');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };

  const registerUser = async (form) => {
    try {
      const { token, user } = await api.register(form);
      setToken(token);
      setCurrentUser(user);
      await loadWorkspace();
      navigate('employee', 'dashboard');
      addToast('Account created successfully.', 'success');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };

  const logout = async () => {
    if (currentUser) {
      try { await api.users.setMyStatus('inactive'); } catch (e) {}
    }
    setToken(null);
    setCurrentUser(null);
    setSection('login');
    setUsers([]); setApplications([]); setTimeSessions([]); setNotifications([]);
  };

  const markAllRead = async () => {
    try {
      await api.notifications.markAllRead();
      setNotifications(prev => prev.map(n => ((n.audience === 'role' && n.role === currentUser.role) || (n.audience === 'user' && n.userId === currentUser.id)) ? { ...n, read: true } : n));
    } catch (e) {
      addToast(e.message, 'error');
    }
  };

  const ctx = {
    theme, setTheme, currentUser, section, page, navigate, login, logout, registerUser, dataLoaded,
    users, setUsers, applications, setApplications, timeSessions, setTimeSessions,
    notifications, markAllRead, toasts, addToast,
  };

  return (
    <AppCtx.Provider value={ctx}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap');

        *, *::before, *::after {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        html, body, #root {
          width: 100%;
          height: 100%;
          margin: 0;
          padding: 0;
          overflow: hidden;
        }

        .theme-light {
          --bg:#F8FAFC; --surface:#FFFFFF; --border:#E2E8F0; --text:#0F172A; --text-muted:#64748B;
          --accent:#3B82F6; --accent-contrast:#FFFFFF;
          --success:#10B981; --success-tint:#ECFDF5;
          --warning:#F59E0B; --warning-tint:#FEF3C7;
          --danger:#EF4444; --danger-tint:#FEF2F2;
          --info:#06B6D4; --info-tint:#E0F2FE;
          --neutral:#94A3B8; --neutral-tint:#F1F5F9;
          --holiday:#8B5CF6;
          --shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px 0 rgba(0, 0, 0, 0.03);
        }
        .theme-dark {
          --bg:#0B0F19; --surface:#111827; --border:#1F2937; --text:#F9FAFB; --text-muted:#9CA3AF;
          --accent:#60A5FA; --accent-contrast:#0B0F19;
          --success:#34D399; --success-tint:rgba(52, 211, 153, 0.12);
          --warning:#FBBF24; --warning-tint:rgba(251, 191, 36, 0.12);
          --danger:#F87171; --danger-tint:rgba(248, 113, 113, 0.12);
          --info:#38BDF8; --info-tint:rgba(56, 189, 248, 0.12);
          --neutral:#9CA3AF; --neutral-tint:rgba(156, 163, 175, 0.12);
          --holiday:#A78BFA;
          --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.4);
        }
        .app-shell { background: var(--bg); color: var(--text); font-family: 'Plus Jakarta Sans', sans-serif; }
        .font-display { font-family: 'Plus Jakarta Sans', sans-serif; }
        .mono { font-family: 'JetBrains Mono', monospace; }
        .text-muted { color: var(--text-muted); }
        .card { background: var(--surface); border-radius: 14px; box-shadow: var(--shadow); }
        .rail { border-left: 3px solid var(--accent); }
        .header-bar { background: var(--surface); border-bottom: 1px solid var(--border); }
        .sidebar { background: var(--surface); }
        .hover-surface:hover { background: var(--bg); }
        .nav-active { background: var(--info-tint); color: var(--accent); font-weight: 700; }
        .accent-bg { background: var(--info-tint); color: var(--accent); }
        .accent-bg-solid { background: var(--accent); color: var(--accent-contrast); }
        .accent-text { color: var(--accent); }
        .input-surface { background: var(--bg); border: 1px solid var(--border); color: var(--text); }
        .pulse-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
        .pulse-active { animation: pulseGlow 1.8s ease-in-out infinite; }
        @keyframes pulseGlow {
          0% { box-shadow: 0 0 0 0 rgba(52,211,153,0.5); }
          70% { box-shadow: 0 0 0 6px rgba(52,211,153,0); }
          100% { box-shadow: 0 0 0 0 rgba(52,211,153,0); }
        }
      `}</style>
      <div className={`w-full h-full ${theme === 'dark' ? 'theme-dark' : 'theme-light'}`}>
        {!dataLoaded ? (
          <div className="min-h-screen w-full flex items-center justify-center app-shell text-sm text-muted">Loading workspace…</div>
        ) : currentUser ? <AuthenticatedLayout /> : <LoginPage />}
      </div>
    </AppCtx.Provider>
  );
}