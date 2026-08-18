import React, { useState, useEffect, useMemo, useRef, createContext, useContext } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts';
import {
  LayoutDashboard, ClipboardList, Calendar, UserCog, Clock, Upload, Sun, Moon, Bell,
  ChevronDown, ChevronLeft, ChevronRight, LogOut, Pencil, Trash2, Plus, X, Check, ShieldAlert,
  Search, CheckCircle2, XCircle, AlertCircle, Play, Square, Users, Home, ArrowLeft, ArrowRight,
  Monitor, Wifi, MapPin, Briefcase, FileText, Eye, Ticket, Package, Paperclip, Download, ZoomIn,
  Send, UserPlus, RotateCcw, Archive, History, ImageOff, ImagePlus, RefreshCw, Camera, Radio,
  Laptop, ShieldOff, KeyRound, Copy, Globe2
} from 'lucide-react';
import { api, getToken, setToken } from './lib/api.js';
import WebUsageWidget from './components/WebUsageWidget.jsx';

/* ============================== CONSTANTS ============================== */

const DEPARTMENTS = ['Order Management', 'ART', 'ART-Proofs', 'ART-3D', 'ART-Rendering','IT', 'Purchasing', 'Accounting' ];
const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_TYPES = ['WFH', 'Office', 'Off'];
const HOLIDAYS = { '2026-08-21': 'Ninoy Aquino Day', '2026-08-31': 'National Heroes Day' };
const IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes in milliseconds
const DECLARATION_TEXT = "I acknowledge that the IT assets provided are the property of the company and will be used strictly for official purposes. I agree to follow company IT and information security policies, not share company data or assets with unauthorized persons, maintain the safety and confidentiality of assigned assets, and return all assets upon request or separation.";

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

/* Mock data used to live here. It's now owned and seeded by the backend
   (see backend/src/db.js) — the frontend loads everything over the API. */

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

function StepIndicator({ step }) {
  const steps = ['Profile', 'Schedule', 'Connectivity', 'Compliance'];
  return (
    <div className="flex items-center mb-6">
      {steps.map((label, i) => (
        <React.Fragment key={label}>
          <div className="flex items-center gap-2">
            <div className="rounded-full flex items-center justify-center font-bold text-[11px] shrink-0" style={{
              width: 26, height: 26,
              background: i <= step ? 'var(--accent)' : 'var(--border)',
              color: i <= step ? '#fff' : 'var(--text-muted)'
            }}>{i < step ? <Check size={13} /> : i + 1}</div>
            <span className={`text-xs font-semibold hidden sm:inline ${i === step ? '' : 'text-muted'}`}>{label}</span>
          </div>
          {i < steps.length - 1 && <div className="flex-1 h-px mx-3" style={{ background: 'var(--border)' }} />}
        </React.Fragment>
      ))}
    </div>
  );
}

/* ============================== WFH DETAIL MODAL ============================== */

function ApplicationDetailModal({ app, user, isOpen, onClose, onUpdateStatus }) {
  if (!app || !user) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="WFH Application Details">
      <div className="space-y-4 text-xs">
        {/* User Info Header */}
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

        {/* Application Key Metadata */}
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

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg border border-[var(--border)]">
            <div className="text-[10px] text-muted font-bold uppercase tracking-wider mb-1">Submitted Date</div>
            <div className="font-semibold text-xs">{formatNiceDate(app.submittedDate)}</div>
          </div>
          <div className="p-3 rounded-lg border border-[var(--border)]">
            <div className="text-[10px] text-muted font-bold uppercase tracking-wider mb-1">Effective Window</div>
            <div className="font-semibold text-xs">{formatNiceDate(app.startDate)} - {formatNiceDate(app.endDate || app.defaultEndDate)}</div>
          </div>
        </div>

        {/* Working Days Schedule */}
        <div className="p-3 rounded-lg border border-[var(--border)]">
          <div className="text-[10px] text-muted font-bold uppercase tracking-wider mb-2">Weekly Work Schedule</div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAY_KEYS.map(k => (
              <div key={k} className="p-1 rounded bg-[var(--bg)] border border-[var(--border)]">
                <div className="text-[9px] font-bold text-muted uppercase">{k}</div>
                <div className={`text-[10px] font-semibold mt-1 ${app.days[k] === 'WFH' ? 'accent-text' : app.days[k] === 'Office' ? 'text-muted' : 'opacity-40'}`}>
                  {app.days[k]}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Reason / Notes */}
        {app.reason && (
          <div className="p-3 rounded-lg border border-[var(--border)]">
            <div className="text-[10px] text-muted font-bold uppercase tracking-wider mb-1">Justification / Remarks</div>
            <p className="text-muted leading-relaxed">{app.reason}</p>
          </div>
        )}

        {/* Proof Attachment */}
        {app.fileName && (
          <div className="p-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
            <div className="text-[10px] text-muted font-bold uppercase tracking-wider mb-2">Verified Speedtest Evidence</div>
            <ScreenshotEvidence url={app.fileUrl} filename={app.fileName} />
          </div>
        )}

        {/* Dynamic Action Buttons */}
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
  const now = new Date();
  const [viewDate, setViewDate] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
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
          <button onClick={() => setViewDate(new Date(now.getFullYear(), now.getMonth(), 1))} className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-xs font-semibold hover-surface">Current Month</button>
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
          const isToday = toISO(d) === toISO(now);
          
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
    { key: 'applications', label: 'Applications & Schedules', icon: ClipboardList },
    { key: 'users', label: 'User Management', icon: UserCog },
    { key: 'tickets', label: 'Tickets', icon: Ticket },
    { key: 'assets', label: 'Assets', icon: Package },
    { key: 'live-view', label: 'Live View', icon: Radio },
    { key: 'screenshots', label: 'Screenshots', icon: Camera },
    { key: 'web-usage', label: 'Web Usage', icon: Globe2 },
    { key: 'monitoring-settings', label: 'Monitoring Settings', icon: ShieldAlert },
  ],
  Manager: [
    { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { key: 'applications', label: 'Applications & Schedules', icon: ClipboardList },
    { key: 'tickets', label: 'Tickets', icon: Ticket },
    { key: 'assets', label: 'Assigned Assets', icon: Package },
    { key: 'live-view', label: 'Live View', icon: Radio },
    { key: 'screenshots', label: 'Screenshots', icon: Camera },
    { key: 'web-usage', label: 'Web Usage', icon: Globe2 },
  ],
  Employee: [
    { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { key: 'wfh', label: 'WFH & Schedule', icon: ClipboardList },
    { key: 'tickets', label: 'My Tickets', icon: Ticket },
    { key: 'assets', label: 'Assets Assigned', icon: Package },
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

function OpsCharts() {
  const { tickets, assets } = useApp();
  const ticketStatusData = TICKET_STATUSES.map(s => ({ status: s, count: tickets.filter(t => t.status === s).length }));
  const assetStatusList = ['Available', 'In Use', 'Maintenance', 'Retired'];
  const assetStatusData = assetStatusList.map(s => ({ status: s, count: assets.filter(a => a.status === s).length }));
  const pieColors = { Available: 'var(--success)', 'In Use': 'var(--info)', Maintenance: 'var(--warning)', Retired: 'var(--neutral)' };
  const openTickets = tickets.filter(t => t.status !== 'Closed' && t.status !== 'Resolved').length;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-4 gap-4">
        <KpiCard icon={Ticket} label="Open Tickets" value={openTickets} tone="warning" />
        <KpiCard icon={CheckCircle2} label="Resolved Tickets" value={tickets.filter(t => t.status === 'Resolved' || t.status === 'Closed').length} tone="success" />
        <KpiCard icon={Package} label="Assets In Use" value={assets.filter(a => a.status === 'In Use').length} tone="info" />
        <KpiCard icon={Package} label="Assets Available" value={assets.filter(a => a.status === 'Available').length} tone="neutral" />
      </div>
      <div className="grid grid-cols-2 gap-5">
        <Card>
          <div className="font-display font-semibold mb-1">Tickets by Status</div>
          <div className="text-xs text-muted mb-4">Current distribution across the ticket pipeline</div>
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={ticketStatusData} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="status" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} interval={0} angle={-15} textAnchor="end" height={45} />
                <YAxis tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }} />
                <Bar dataKey="count" fill="var(--accent)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <div className="font-display font-semibold mb-1">Assets by Status</div>
          <div className="text-xs text-muted mb-4">Inventory health at a glance</div>
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={assetStatusData} dataKey="count" nameKey="status" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2}>
                  {assetStatusData.map(d => <Cell key={d.status} fill={pieColors[d.status]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-3 mt-1 text-xs font-medium justify-center">
            {assetStatusData.map(d => (
              <span key={d.status} className="flex items-center gap-1.5">
                <span className="rounded-full" style={{ width: 8, height: 8, background: pieColors[d.status] }} />
                {d.status} ({d.count})
              </span>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
function AdminMonitoringSettings() {
  const { addToast } = useApp();

  const [config, setConfig] = useState({
    screenshotIntervalMinutes: 10,
    liveViewFrameIntervalSeconds: 5,
    screenshotRetentionDays: 7,
    liveViewRetentionDays: 7,
    webUsageRetentionDays: 7,
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const saved = await api.agent.getConfig();

        setConfig({
          screenshotIntervalMinutes: saved.screenshotIntervalMinutes ?? 10,
          liveViewFrameIntervalSeconds: saved.liveViewFrameIntervalSeconds ?? 5,
          screenshotRetentionDays: saved.screenshotRetentionDays ?? 7,
          liveViewRetentionDays: saved.liveViewRetentionDays ?? 7,
          webUsageRetentionDays: saved.webUsageRetentionDays ?? 7,
        });
      } catch (e) {
        addToast(e.message, 'error');
      } finally {
        setLoading(false);
      }
    };

    loadConfig();
  }, []);

  const update = (key, value) => {
    setConfig(prev => ({
      ...prev,
      [key]: Number(value),
    }));
  };

  const save = async () => {
    setSaving(true);

    try {
      const saved = await api.agent.updateConfig(config);

      setConfig({
        screenshotIntervalMinutes: saved.screenshotIntervalMinutes ?? config.screenshotIntervalMinutes,
        liveViewFrameIntervalSeconds: saved.liveViewFrameIntervalSeconds ?? config.liveViewFrameIntervalSeconds,
        screenshotRetentionDays: saved.screenshotRetentionDays ?? config.screenshotRetentionDays,
        liveViewRetentionDays: saved.liveViewRetentionDays ?? config.liveViewRetentionDays,
        webUsageRetentionDays: saved.webUsageRetentionDays ?? config.webUsageRetentionDays,
      });

      addToast('Monitoring settings saved successfully.', 'success');
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card className="w-full">
        <div className="py-10 text-center text-sm text-muted">
          Loading monitoring settings…
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5 w-full">
      <Card>
        <div className="mb-5">
          <h3 className="font-display font-bold text-base">
            Monitoring Settings
          </h3>
          <p className="text-xs text-muted mt-1">
            Configure screenshot capture and historical monitoring retention.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          <div className="p-4 rounded-xl border border-[var(--border)]">
            <div className="flex items-center gap-2 mb-1">
              <Camera size={16} className="accent-text" />
              <h4 className="font-semibold text-sm">
                Screenshot Capture Interval
              </h4>
            </div>

            <p className="text-[11px] text-muted mb-3">
              How frequently the desktop agent captures a screenshot.
            </p>

            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="1440"
                className={`${inputCls} max-w-[140px]`}
                value={config.screenshotIntervalMinutes}
                onChange={e =>
                  update('screenshotIntervalMinutes', e.target.value)
                }
              />
              <span className="text-xs text-muted">
                minutes
              </span>
            </div>
          </div>


          <div className="p-4 rounded-xl border border-[var(--border)]">
            <div className="flex items-center gap-2 mb-1">
              <Radio size={16} className="accent-text" />
              <h4 className="font-semibold text-sm">
                Live View Frame Interval
              </h4>
            </div>

            <p className="text-[11px] text-muted mb-3">
              Controls how frequently Live View frames are captured.
            </p>

            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="300"
                className={`${inputCls} max-w-[140px]`}
                value={config.liveViewFrameIntervalSeconds}
                onChange={e =>
                  update('liveViewFrameIntervalSeconds', e.target.value)
                }
              />
              <span className="text-xs text-muted">
                seconds
              </span>
            </div>
          </div>


          <div className="p-4 rounded-xl border border-[var(--border)]">
            <div className="flex items-center gap-2 mb-1">
              <History size={16} className="accent-text" />
              <h4 className="font-semibold text-sm">
                Screenshot Retention
              </h4>
            </div>

            <p className="text-[11px] text-muted mb-3">
              Number of days screenshot history is retained.
            </p>

            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="3650"
                className={`${inputCls} max-w-[140px]`}
                value={config.screenshotRetentionDays}
                onChange={e =>
                  update('screenshotRetentionDays', e.target.value)
                }
              />
              <span className="text-xs text-muted">
                days
              </span>
            </div>

            <div className="text-[10px] text-muted mt-2">
              Default: <strong>7 days</strong>
            </div>
          </div>


          <div className="p-4 rounded-xl border border-[var(--border)]">
            <div className="flex items-center gap-2 mb-1">
              <History size={16} className="accent-text" />
              <h4 className="font-semibold text-sm">
                Live View Retention
              </h4>
            </div>

            <p className="text-[11px] text-muted mb-3">
              Number of days historical Live View frames are retained.
            </p>

            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="3650"
                className={`${inputCls} max-w-[140px]`}
                value={config.liveViewRetentionDays}
                onChange={e =>
                  update('liveViewRetentionDays', e.target.value)
                }
              />
              <span className="text-xs text-muted">
                days
              </span>
            </div>

            <div className="text-[10px] text-muted mt-2">
              Default: <strong>7 days</strong>
            </div>
          </div>

        </div>

        <div className="p-4 rounded-xl border border-[var(--border)]">
          <div className="flex items-center gap-2 mb-1">
            <Globe2 size={16} className="accent-text" />
            <h4 className="font-semibold text-sm">
              Web Usage Retention
            </h4>
          </div>

          <p className="text-[11px] text-muted mb-3">
            Number of days Web Usage / Internet Activity history is retained.
          </p>

          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              max="365"
              className={`${inputCls} max-w-[140px]`}
              value={config.webUsageRetentionDays}
              onChange={e =>
                update('webUsageRetentionDays', e.target.value)
              }
            />
            <span className="text-xs text-muted">
              days
            </span>
          </div>

          <div className="text-[10px] text-muted mt-2">
            Default: <strong>7 days</strong>
          </div>
        </div>

        <div className="flex justify-end mt-5 pt-4 border-t border-[var(--border)]">
          <button
            onClick={save}
            disabled={saving}
            className="px-5 py-2.5 rounded-lg text-xs font-bold accent-bg-solid shadow-sm"
          >
            {saving ? 'Saving…' : 'Save Monitoring Settings'}
          </button>
        </div>
      </Card>

      <Card className="rail">
        <div className="flex items-start gap-3">
          <ShieldAlert size={18} className="accent-text mt-0.5" />

          <div>
            <div className="font-display font-bold text-sm">
              Data Retention Policy
            </div>

            <p className="text-xs text-muted mt-1 leading-relaxed">
              Live View history and screenshot logs are automatically
              retained according to the configured values above.
              The default retention period is one week (7 days).
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}


function AdminDashboard() {
  const { users, applications, navigate } = useApp();

  return (
    <div className="flex flex-col gap-5">
      <DashboardShared
        scopeUsers={users}
        scopeApps={applications}
        onViewApplications={() => navigate('admin', 'applications')}
      />

      <OpsCharts />

      <div className="grid grid-cols-2 gap-5">
        <LiveViewSection
          title="Live Desktop View"
          subtitle="Employees currently active"
          limit={3}
          onViewAll={() => navigate('admin', 'live-view')}
        />

        <ScreenshotsSection
          title="Recent Screenshots"
          subtitle="Latest scheduled captures"
          limit={8}
          onViewAll={() => navigate('admin', 'screenshots')}
        />
      </div>

      <WebUsageWidget
        navigate={navigate}
        routeRole="admin"
      />
    </div>
  );
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

function AdminApplicationsAndSchedules() {
  const [tab, setTab] = useState('applications');
  return (
    <div className="w-full">
      <div className="flex gap-1 mb-4 p-1 rounded-lg w-fit" style={{ background: 'var(--bg)' }}>
        <button onClick={() => setTab('applications')} className="px-4 py-2 rounded-md text-xs font-bold"
          style={tab === 'applications' ? { background: 'var(--surface)', color: 'var(--text)', boxShadow: 'var(--shadow)' } : { color: 'var(--text-muted)' }}>
          Applications
        </button>
        <button onClick={() => setTab('schedules')} className="px-4 py-2 rounded-md text-xs font-bold"
          style={tab === 'schedules' ? { background: 'var(--surface)', color: 'var(--text)', boxShadow: 'var(--shadow)' } : { color: 'var(--text-muted)' }}>
          Schedules
        </button>
      </div>
      {tab === 'applications' ? <AdminApplications /> : <AdminSchedules />}
    </div>
  );
}

/* ============================== USER MANAGEMENT (EDIT/DELETE) ============================== */

function AdminDevicesPanel() {
  const { addToast } = useApp();
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.agent.devices();
      setDevices(data);
    } catch (e) { addToast(e.message, 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const revoke = async (device) => {
    if (!window.confirm(`Revoke "${device.deviceName}"? It will stop sending data immediately.`)) return;
    try {
      await api.agent.revokeDevice(device.id);
      setDevices(prev => prev.map(d => d.id === device.id ? { ...d, revoked: true } : d));
      addToast('Device revoked.', 'success');
    } catch (e) { addToast(e.message, 'error'); }
  };
  const deleteDevice = async (device) => {
    const confirmed = window.confirm(
      `Permanently delete "${device.deviceName}"?\n\n` +
      `This will remove the paired-device record. ` +
      `The device will need to be paired again before it can monitor.`
    );

    if (!confirmed) return;

    try {
      await api.agent.deleteDevice(device.id);

      setDevices(prev =>
        prev.filter(d => d.id !== device.id)
      );

      addToast('Paired device deleted permanently.', 'success');
    } catch (e) {
      addToast(e.message, 'error');
    }
  };

  return (
    <Card className="w-full">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-display font-bold text-base">Paired Devices</h3>
          <p className="text-xs text-muted mt-0.5">Desktop agents and browser extensions linked to employee accounts.</p>
        </div>
        <button onClick={load} className="p-2 rounded-lg hover-surface" title="Refresh"><RefreshCw size={14} /></button>
      </div>
      {loading ? (
        <div className="py-8 text-center text-sm text-muted">Loading…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="font-bold text-muted uppercase tracking-wider border-b border-[var(--border)]">
                <th className="pb-2.5 px-2">Employee</th>
                <th className="pb-2.5 px-2">Device</th>
                <th className="pb-2.5 px-2">Type</th>
                <th className="pb-2.5 px-2">Paired</th>
                <th className="pb-2.5 px-2">Last Seen</th>
                <th className="pb-2.5 px-2">Status</th>
                <th className="pb-2.5 px-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {devices.map(d => (
                <tr key={d.id}>
                  <td className="py-2.5 px-2 font-semibold">{d.employeeName}</td>
                  <td className="py-2.5 px-2 text-muted">{d.deviceName}</td>
                  <td className="py-2.5 px-2 text-muted">{d.type === 'desktop-agent' ? 'Desktop Agent' : 'Browser Extension'}</td>
                  <td className="py-2.5 px-2 text-muted">{d.pairedAt}</td>
                  <td className="py-2.5 px-2 text-muted">{d.lastSeenAt || 'Never'}</td>
                  <td className="py-2.5 px-2">
                    <Badge tone={d.revoked ? 'danger' : 'success'}>{d.revoked ? 'Revoked' : 'Active'}</Badge>
                  </td>
                  <td className="py-2.5 px-2 text-right">
                    <div className="flex items-center justify-end gap-1">

                    {!d.revoked && (
                      <button
                        onClick={() => revoke(d)}
                        className="p-1.5 rounded-lg hover-surface text-muted hover:text-[var(--danger)]"
                        title="Revoke Device"
                      >
                        <ShieldOff size={14} />
                      </button>
                    )}

                    <button
                      onClick={() => deleteDevice(d)}
                      className="p-1.5 rounded-lg hover-surface text-muted hover:text-[var(--danger)]"
                      title="Delete Device"
                    >
                      <Trash2 size={14} />
                    </button>

                  </div>
                </td>
                </tr>
              ))}
              {devices.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-muted">No devices have been paired yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function UserFormModal({ isOpen, onClose, user, onSaved }) {
  const { users, addToast } = useApp();
  const managers = users.filter(u => (u.role === 'Manager' || u.role === 'Admin') && u.id !== user?.id);
  const emptyForm = { name: '', email: '', password: '', role: 'Employee', department: DEPARTMENTS[0], jobTitle: '', managerId: '', status: 'active' };
  const [form, setForm] = useState(user ? { ...user, password: '' } : emptyForm);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setForm(user ? { ...user, password: '' } : emptyForm); }, [user, isOpen]);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      let saved;
      if (user) {
        const payload = { ...form };
        if (!payload.password) delete payload.password;
        saved = await api.users.update(user.id, payload);
        addToast(`User profile for ${saved.name} updated.`, 'success');
      } else {
        if (!form.password || form.password.length < 6) throw new Error('Password must be at least 6 characters.');
        saved = await api.users.create(form);
        addToast(`User ${saved.name} created.`, 'success');
      }
      onSaved(saved, !user);
      onClose();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={user ? 'Edit User Account' : 'Add New User'}>
      <form onSubmit={submit}>
        <Field label="Full Name">
          <input className={inputCls} required value={form.name} onChange={e => set('name', e.target.value)} />
        </Field>
        <Field label="Work Email Address">
          <input className={inputCls} type="email" required value={form.email} onChange={e => set('email', e.target.value)} />
        </Field>
        <Field label={user ? 'Password (leave blank to keep unchanged)' : 'Password'}>
          <input className={inputCls} type="password" required={!user} minLength={6} value={form.password} onChange={e => set('password', e.target.value)} placeholder={user ? '••••••••' : 'At least 6 characters'} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Role">
            <select className={inputCls} value={form.role} onChange={e => set('role', e.target.value)}>
              <option value="Admin">Admin</option>
              <option value="Manager">Manager</option>
              <option value="Employee">Employee</option>
            </select>
          </Field>
          <Field label="Department">
            <select className={inputCls} value={form.department} onChange={e => set('department', e.target.value)}>
              {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Job Title">
          <input className={inputCls} required value={form.jobTitle} onChange={e => set('jobTitle', e.target.value)} />
        </Field>
        {form.role === 'Employee' && (
          <Field label="Reporting Manager">
            <select className={inputCls} value={form.managerId || ''} onChange={e => set('managerId', e.target.value ? Number(e.target.value) : null)}>
              <option value="">No manager assigned</option>
              {managers.map(m => <option key={m.id} value={m.id}>{m.name} ({m.role})</option>)}
            </select>
          </Field>
        )}
        <div className="flex gap-2 justify-end mt-4">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-semibold hover-surface border border-[var(--border)]">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg text-xs font-semibold accent-bg-solid shadow-sm">
            {saving ? 'Saving…' : user ? 'Save Changes' : 'Create User'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AdminUserManagement() {
  const { users, setUsers, currentUser, addToast } = useApp();
  const [query, setQuery] = useState('');
  const [editingUser, setEditingUser] = useState(null);
  const [creating, setCreating] = useState(false);

  const filtered = users.filter(u => (u.name + u.email + u.department + u.jobTitle).toLowerCase().includes(query.toLowerCase()));

  const handleSaved = (saved, isNew) => {
    setUsers(prev => isNew ? [...prev, saved] : prev.map(u => u.id === saved.id ? saved : u));
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
    <div className="flex flex-col gap-5 w-full">
    <Card className="w-full">
      <div className="flex items-center justify-between mb-4">
        <div className="relative w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className={`${inputCls} pl-8`} placeholder="Search users by name or department…" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold accent-bg-solid shadow-sm">
          <Plus size={14} /> Add New User
        </button>
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

      <UserFormModal isOpen={Boolean(editingUser)} onClose={() => setEditingUser(null)} user={editingUser} onSaved={handleSaved} />
      <UserFormModal isOpen={creating} onClose={() => setCreating(false)} user={null} onSaved={handleSaved} />
    </Card>
    <AdminDevicesPanel />
    </div>
  );
}

function ManagerDashboard() {
  const { users, applications, currentUser, navigate } = useApp();

  const team = users.filter(u => u.managerId === currentUser.id);
  const teamIds = new Set(team.map(u => u.id));
  const teamApps = applications.filter(a => teamIds.has(a.userId));

  return (
    <div className="flex flex-col gap-5">
      <DashboardShared
        scopeUsers={team}
        scopeApps={teamApps}
        onViewApplications={() => navigate('manager', 'applications')}
      />

      <div className="grid grid-cols-2 gap-5">
        <LiveViewSection
          title="Team Live View"
          subtitle="Your direct reports currently active"
          limit={3}
          onViewAll={() => navigate('manager', 'live-view')}
        />

        <ScreenshotsSection
          title="Recent Screenshots"
          subtitle="Latest captures from your team"
          limit={8}
          onViewAll={() => navigate('manager', 'screenshots')}
        />
      </div>

      <WebUsageWidget
        navigate={navigate}
        routeRole="manager"
      />
    </div>
  );
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

function ManagerApplicationsAndSchedules() {
  const [tab, setTab] = useState('applications');
  return (
    <div className="w-full">
      <div className="flex gap-1 mb-4 p-1 rounded-lg w-fit" style={{ background: 'var(--bg)' }}>
        <button onClick={() => setTab('applications')} className="px-4 py-2 rounded-md text-xs font-bold"
          style={tab === 'applications' ? { background: 'var(--surface)', color: 'var(--text)', boxShadow: 'var(--shadow)' } : { color: 'var(--text-muted)' }}>
          Applications
        </button>
        <button onClick={() => setTab('schedules')} className="px-4 py-2 rounded-md text-xs font-bold"
          style={tab === 'schedules' ? { background: 'var(--surface)', color: 'var(--text)', boxShadow: 'var(--shadow)' } : { color: 'var(--text-muted)' }}>
          Schedules
        </button>
      </div>
      {tab === 'applications' ? <ManagerApplications /> : <ManagerSchedules />}
    </div>
  );
}

/* ============================== EMPLOYEE VIEWS & DYNAMIC TRACKING ============================== */

function DynamicTimeTracker() {
  const { currentUser, setUsers, setTimeSessions, addToast } = useApp();

  const [tracking, setTracking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [isIdle, setIsIdle] = useState(false);
  const [sessionStartedAt, setSessionStartedAt] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);

  const lastActivity = useRef(Date.now());

  const pushStatus = async (status) => {
    try {
      const updated = await api.users.setMyStatus(status);

      setUsers(prev =>
        prev.map(u =>
          u.id === currentUser.id
            ? { ...u, ...updated }
            : u
        )
      );

      return updated;
    } catch (e) {
      addToast(e.message, 'error');
      throw e;
    }
  };

  // Restore the real session state from the server.
  const syncSession = async () => {
    try {
      const { user } = await api.me();

      const active = user.status === 'active';
      const idle = user.status === 'idle';

      setTracking(active || idle);
      setIsIdle(idle);

      if (user.sessionStartedAt) {
        setSessionStartedAt(user.sessionStartedAt);

        const started = new Date(user.sessionStartedAt).getTime();

        if (!Number.isNaN(started)) {
          setElapsed(
            Math.max(
              0,
              Math.floor((Date.now() - started) / 1000)
            )
          );
        }
      } else {
        setSessionStartedAt(null);
        setElapsed(0);
      }

      setUsers(prev =>
        prev.map(u =>
          u.id === currentUser.id
            ? { ...u, ...user }
            : u
        )
      );
    } catch (e) {
      // Keep the current UI state during a temporary network problem.
    } finally {
      setLoadingSession(false);
    }
  };

  // Restore session immediately and keep the button synchronized
  // with the backend after navigation/refresh.
  useEffect(() => {
    syncSession();

    const interval = setInterval(syncSession, 10000);

    return () => clearInterval(interval);
  }, [currentUser.id]);

  useEffect(() => {
    const bumpActivity = () => {
      lastActivity.current = Date.now();

      if (isIdle && tracking) {
        setIsIdle(false);
        pushStatus('active').catch(() => {});
      }
    };

    window.addEventListener('mousemove', bumpActivity);
    window.addEventListener('keydown', bumpActivity);

    return () => {
      window.removeEventListener('mousemove', bumpActivity);
      window.removeEventListener('keydown', bumpActivity);
    };
  }, [isIdle, tracking, currentUser.id]);

  useEffect(() => {
    if (!tracking) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const idleTime = now - lastActivity.current;

      if (idleTime >= IDLE_THRESHOLD_MS && !isIdle) {
        setIsIdle(true);
        pushStatus('idle').catch(() => {});
      }

      if (sessionStartedAt) {
        const started = new Date(sessionStartedAt).getTime();

        if (!Number.isNaN(started)) {
          setElapsed(
            Math.max(
              0,
              Math.floor((now - started) / 1000)
            )
          );
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [tracking, isIdle, sessionStartedAt, currentUser.id]);

  const toggleTracking = async () => {
    if (tracking) {
      const end = new Date();

      try {
        const updated = await pushStatus('inactive');

        const started = sessionStartedAt
          ? new Date(sessionStartedAt).getTime()
          : end.getTime();

        const totalHours = Math.max(
          0.01,
          Math.round(
            ((end.getTime() - started) / 3600000) * 100
          ) / 100
        );

        const payload = {
          date: toISO(end),
          startTime: sessionStartedAt
            ? new Date(sessionStartedAt).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
              })
            : end.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
              }),
          endTime: end.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
          }),
          totalHours,
        };

        const saved = await api.timeSessions.create(payload);

        setTimeSessions(prev => [saved, ...prev]);

        setTracking(false);
        setIsIdle(false);
        setElapsed(0);
        setSessionStartedAt(null);

        setUsers(prev =>
          prev.map(u =>
            u.id === currentUser.id
              ? { ...u, ...updated, status: 'inactive' }
              : u
          )
        );

        addToast(
          `Session saved (${totalHours} hrs).`,
          'success'
        );
      } catch (e) {
        addToast(e.message, 'error');
      }

      return;
    }

    try {
      const updated = await pushStatus('active');

      const startedAt =
        updated.sessionStartedAt ||
        new Date().toISOString();

      setSessionStartedAt(startedAt);
      setTracking(true);
      setElapsed(0);
      setIsIdle(false);
      lastActivity.current = Date.now();

      addToast(
        'Time tracking started. Monitoring is now active.',
        'info'
      );
    } catch (e) {
      // Error already shown by pushStatus().
    }
  };

  return (
    <Card className="flex flex-col sm:flex-row items-center justify-between gap-4 rail border border-[var(--border)] shadow-md">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <StatusDot
            status={
              loadingSession
                ? 'inactive'
                : tracking
                  ? (isIdle ? 'idle' : 'active')
                  : 'inactive'
            }
          />

          <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
            {loadingSession
              ? 'Checking Session…'
              : tracking
                ? (isIdle
                    ? 'Idle — Away > 5 mins'
                    : 'Live Active Tracking')
                : 'Clocked Out — Ready to Start'}
          </span>
        </div>

        <div className="font-display font-bold text-3xl tracking-tight mono">
          {formatHMS(elapsed)}
        </div>
      </div>

      <button
        onClick={toggleTracking}
        disabled={loadingSession}
        className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-xs shadow-md transition-all ${
          tracking
            ? 'bg-[var(--danger)] text-white active:scale-95'
            : 'bg-[var(--success)] text-white active:scale-95'
        }`}
      >
        {tracking ? (
          <>
            <Square size={14} />
            Stop Session
          </>
        ) : (
          <>
            <Play size={14} />
            Start Session
          </>
        )}
      </button>
    </Card>
  );
}

function DevicePairingCard() {
  const { addToast } = useApp();

  const [devices, setDevices] = useState([]);
  const [code, setCode] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [generating, setGenerating] = useState(false);

  const loadDevices = async () => {
    try {
      const data = await api.agent.myDevices();

      const activeDevices = data.filter(d => !d.revoked);

      setDevices(activeDevices);

      // A successful pairing can happen from the desktop agent
      // or the browser extension. As soon as the server sees the
      // new device, clear the old pairing-code screen immediately.
      if (activeDevices.length > 0 && code) {
        setCode(null);
        setExpiresAt(null);
        setSecondsLeft(0);
      }
    } catch (e) {
      // Don't interrupt the employee dashboard for a temporary
      // device-status request failure.
    } finally {
      setLoadingDevices(false);
    }
  };

  useEffect(() => {
    loadDevices();

    // Detect a successful desktop-agent or browser-extension
    // pairing without requiring the employee to wait for the
    // 10-minute pairing countdown.
    const interval = setInterval(loadDevices, 3000);

    return () => clearInterval(interval);
  }, [code]);

  useEffect(() => {
    if (!expiresAt) return;

    const tick = () => {
      const remaining = Math.max(
        0,
        Math.round(
          (new Date(expiresAt).getTime() - Date.now()) / 1000
        )
      );

      setSecondsLeft(remaining);

      if (remaining === 0) {
        setCode(null);
        setExpiresAt(null);
      }
    };

    tick();

    const interval = setInterval(tick, 1000);

    return () => clearInterval(interval);
  }, [expiresAt]);

  const generate = async () => {
    setGenerating(true);

    try {
      const res = await api.agent.pairingCode();

      setCode(res.code);
      setExpiresAt(res.expiresAtISO);
      setSecondsLeft(
        Math.max(
          0,
          Math.round(
            (new Date(res.expiresAtISO).getTime() - Date.now()) / 1000
          )
        )
      );
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setGenerating(false);
    }
  };

  const copyCode = async () => {
    if (!code) return;

    try {
      await navigator.clipboard.writeText(code);
      addToast('Code copied to clipboard.', 'success');
    } catch (e) {
      addToast('Unable to copy the code.', 'error');
    }
  };

  return (
    <Card className="rail">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="font-display font-bold text-sm flex items-center gap-2">
            <Laptop size={16} className="accent-text" />
            Device Pairing
          </h3>

          <p className="text-xs text-muted mt-0.5">
            Link your desktop agent or browser extension for activity monitoring.
          </p>
        </div>

        <button
          onClick={generate}
          disabled={generating}
          className="px-4 py-2 rounded-lg text-xs font-bold accent-bg-solid shadow-sm shrink-0"
        >
          {generating
            ? 'Generating…'
            : devices.length > 0
              ? 'Pair Another Device'
              : 'Generate Code'}
        </button>
      </div>

      {loadingDevices ? (
        <div className="mt-4 py-4 text-center text-xs text-muted">
          Checking paired devices…
        </div>
      ) : devices.length > 0 ? (
        <div className="mt-4 flex flex-col gap-2">
          <div className="text-[10px] font-bold text-muted uppercase tracking-wider">
            Paired Devices
          </div>

          {devices.map(device => (
            <div
              key={device.id}
              className="flex items-center gap-3 p-3 rounded-lg border border-[var(--border)]"
              style={{ background: 'var(--bg)' }}
            >
              <div className="w-9 h-9 rounded-lg flex items-center justify-center accent-bg shrink-0">
                {device.type === 'desktop-agent' ? (
                  <Laptop size={17} />
                ) : (
                  <Globe2 size={17} />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold truncate">
                  {device.deviceName}
                </div>

                <div className="text-[10px] text-muted">
                  {device.type === 'desktop-agent'
                    ? 'Desktop Agent'
                    : 'Browser Extension'}
                  {' · '}
                  Paired {device.pairedAt}
                </div>

                <div className="flex items-center gap-1.5 mt-1">
                  <span
                    className="rounded-full"
                    style={{
                      width: 6,
                      height: 6,
                      background: 'var(--success)',
                    }}
                  />
                  <span className="text-[10px] font-semibold text-[var(--success)]">
                    Paired
                  </span>
                </div>
              </div>

              <div className="px-3 py-1.5 rounded-lg text-[10px] font-bold border border-[var(--border)] text-muted shrink-0">
                Managed by IT
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4">
          <div
            className="flex items-center gap-2 p-3 rounded-lg border border-[var(--border)]"
            style={{ background: 'var(--bg)' }}
          >
            <ShieldOff size={16} className="text-muted" />

            <div>
              <div className="text-xs font-semibold">
                No paired devices
              </div>

              <div className="text-[10px] text-muted">
                Generate a code to pair your desktop agent or browser extension.
              </div>
            </div>
          </div>
        </div>
      )}

      {code && (
        <div
          className="mt-3 flex items-center gap-3 p-3 rounded-lg border border-[var(--border)]"
          style={{ background: 'var(--bg)' }}
        >
          <KeyRound size={18} className="text-muted shrink-0" />

          <div className="flex-1">
            <div className="text-xl font-bold mono tracking-widest">
              {code}
            </div>

            <div className="text-[10px] text-muted">
              {secondsLeft > 0
                ? `Expires in ${Math.floor(secondsLeft / 60)}:${String(
                    secondsLeft % 60
                  ).padStart(2, '0')}`
                : 'Expired — generate a new code'}
            </div>
          </div>

          <button
            onClick={copyCode}
            className="p-2 rounded-lg hover-surface"
            title="Copy"
          >
            <Copy size={15} />
          </button>

          {secondsLeft <= 0 && (
            <button
              onClick={generate}
              disabled={generating}
              className="px-3 py-1.5 rounded-lg text-xs font-bold accent-bg-solid"
            >
              New Code
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

function AssignedAssetsWidget() {
  const { assets, navigate } = useApp();
  const preview = assets.slice(0, 3);
  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display font-bold text-base flex items-center gap-2"><Package size={16} className="accent-text" /> Assigned Assets</h3>
        <button onClick={() => navigate('employee', 'assets')} className="text-xs font-bold accent-text">View All</button>
      </div>
      {preview.length === 0 ? (
        <p className="text-xs text-muted">No company assets are currently assigned to you.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {preview.map(a => (
            <div key={a.id} className="flex items-center gap-2.5 p-2 rounded-lg border border-[var(--border)]">
              {a.imageUrl ? (
                <img src={api.uploads.fileUrl(a.imageUrl)} alt="" className="w-8 h-8 rounded-md object-cover border border-[var(--border)]" />
              ) : (
                <div className="w-8 h-8 rounded-md flex items-center justify-center border border-[var(--border)]" style={{ background: 'var(--bg)' }}>
                  <Package size={14} className="text-muted" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold truncate">{a.name}</div>
                <div className="text-[10px] text-muted">{a.assetTag} · {a.type}</div>
              </div>
            </div>
          ))}
          {assets.length > 3 && <p className="text-[10px] text-muted text-center pt-1">+{assets.length - 3} more</p>}
        </div>
      )}
    </Card>
  );
}

function EmployeeDashboard() {
  const { currentUser, timeSessions } = useApp();
  const [dateFilter, setDateFilter] = useState('');
  const mine = timeSessions
    .filter(s => s.userId === currentUser.id)
    .filter(s => !dateFilter || s.date === dateFilter);

  return (
    <div className="flex flex-col gap-5 w-full">
      <DynamicTimeTracker />
      <DevicePairingCard />
      <AssignedAssetsWidget />
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display font-bold text-base">Logged Work Sessions</h3>
          <div className="flex items-center gap-2">
            <input type="date" className={`${inputCls} w-auto`} value={dateFilter} onChange={e => setDateFilter(e.target.value)} />
            {dateFilter && <button onClick={() => setDateFilter('')} className="text-xs font-bold text-muted hover:text-[var(--text)]">Clear</button>}
          </div>
        </div>
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
              {mine.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted">{dateFilter ? 'No sessions logged on this date.' : 'No sessions logged yet.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function EmployeeWFHAndSchedule() {
  const [tab, setTab] = useState('request');
  return (
    <div className="w-full">
      <div className="flex gap-1 mb-4 p-1 rounded-lg w-fit" style={{ background: 'var(--bg)' }}>
        <button onClick={() => setTab('request')} className="px-4 py-2 rounded-md text-xs font-bold"
          style={tab === 'request' ? { background: 'var(--surface)', color: 'var(--text)', boxShadow: 'var(--shadow)' } : { color: 'var(--text-muted)' }}>
          WFH Request
        </button>
        <button onClick={() => setTab('schedule')} className="px-4 py-2 rounded-md text-xs font-bold"
          style={tab === 'schedule' ? { background: 'var(--surface)', color: 'var(--text)', boxShadow: 'var(--shadow)' } : { color: 'var(--text-muted)' }}>
          My Schedule
        </button>
      </div>
      {tab === 'request' ? <EmployeeWFHApplication /> : <EmployeeSchedule />}
    </div>
  );
}

function EmployeeWFHApplication() {
  const { currentUser, users, applications, setApplications, addToast } = useApp();
  const manager = users.find(u => u.id === currentUser.managerId);
  const existing = applications.find(a => a.userId === currentUser.id && a.status !== 'rejected');
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const today = toISO(new Date());
  const defaultEnd = toISO(addMonths(new Date(), 3));

  const [form, setForm] = useState({
    location: '', startDate: today, temporary: false, endDate: defaultEnd,
    days: { mon: 'WFH', tue: 'WFH', wed: 'WFH', thu: 'WFH', fri: 'WFH', sat: 'Off', sun: 'Off' },
    internetType: 'Fiber', fileName: '', fileUrl: '', agreed: false,
  });
  const [uploading, setUploading] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const cycleDay = (key) => {
    const idx = DAY_TYPES.indexOf(form.days[key]);
    set('days', { ...form.days, [key]: DAY_TYPES[(idx + 1) % DAY_TYPES.length] });
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await api.uploads.upload(file);
      set('fileName', uploaded.filename);
      set('fileUrl', uploaded.url);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  if (existing) {
    return (
      <Card className="w-full max-w-lg">
        <h3 className="font-display font-bold text-base mb-1">WFH Application Status</h3>
        <p className="text-xs text-muted mb-3">You have an existing application on record.</p>
        <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] flex items-center justify-between mb-3">
          <div>
            <div className="font-semibold text-xs">{existing.location}</div>
            <div className="text-[10px] text-muted">Submitted {formatNiceDate(existing.submittedDate)}</div>
          </div>
          <Badge tone={existing.status === 'approved' ? 'success' : 'warning'}>{existing.status}</Badge>
        </div>
        {existing.fileName && (
          <div>
            <div className="text-[10px] text-muted font-bold uppercase tracking-wider mb-1.5">Submitted Speedtest Evidence</div>
            <ScreenshotEvidence url={existing.fileUrl} filename={existing.fileName} />
          </div>
        )}
      </Card>
    );
  }

  const submit = async () => {
    setSubmitting(true);
    try {
      const created = await api.applications.create({
        location: form.location,
        startDate: form.startDate,
        defaultEndDate: defaultEnd,
        temporary: form.temporary,
        endDate: form.temporary ? form.endDate : defaultEnd,
        days: form.days,
        internetType: form.internetType,
        fileName: form.fileName,
        fileUrl: form.fileUrl,
        reason: '',
      });
      setApplications(prev => [...prev, created]);
      addToast('WFH application submitted for review.', 'success');
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const canAdvance = step !== 1 || form.location.trim().length > 0;

  return (
    <Card className="w-full max-w-2xl">
      <h3 className="font-display font-bold text-base mb-1">Request Remote Work Arrangement</h3>
      <p className="text-xs text-muted mb-5">Complete all steps to submit your WFH application for manager approval.</p>
      <StepIndicator step={step} />

      {step === 0 && (
        <div className="grid grid-cols-2 gap-3">
          {[
            ['Name', currentUser.name],
            ['Employee ID', `EMP-${String(currentUser.id).padStart(4, '0')}`],
            ['Job Title', currentUser.jobTitle],
            ['Department', currentUser.department],
            ['Email', currentUser.email],
            ['Assigned Manager', manager?.name || '—'],
          ].map(([label, val]) => (
            <div key={label} className="p-3 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
              <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1">{label}</div>
              <div className="text-xs font-semibold truncate">{val}</div>
            </div>
          ))}
        </div>
      )}

      {step === 1 && (
        <div>
          <Field label="WFH Location">
            <input className={inputCls} required placeholder="e.g. Cebu City Home Office" value={form.location} onChange={e => set('location', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start Date">
              <input type="date" className={inputCls} value={form.startDate} onChange={e => set('startDate', e.target.value)} />
            </Field>
            <Field label="Default Coverage (3 months)">
              <input className={inputCls} disabled value={formatNiceDate(toISO(addMonths(fromISO(form.startDate || today), 3)))} />
            </Field>
          </div>
          <label className="flex items-center gap-2 mb-4 text-xs font-semibold">
            <input type="checkbox" checked={form.temporary} onChange={e => set('temporary', e.target.checked)} />
            This is a temporary WFH arrangement (set a custom end date)
          </label>
          {form.temporary && (
            <Field label="Custom End Date">
              <input type="date" className={inputCls} value={form.endDate} onChange={e => set('endDate', e.target.value)} />
            </Field>
          )}
          <div className="text-[11px] font-bold text-muted uppercase tracking-wider mb-2 mt-3">
            Weekly Schedule — tap a day to cycle WFH / Office / Off
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {WEEKDAY_KEYS.map(k => {
              const val = form.days[k];
              const tone = val === 'WFH' ? 'success' : val === 'Office' ? 'info' : 'neutral';
              return (
                <button key={k} type="button" onClick={() => cycleDay(k)}
                  className="rounded-lg py-2.5 text-center flex flex-col items-center gap-1.5 border border-[var(--border)] hover-surface transition-all">
                  <span className="text-[9px] font-bold text-muted uppercase">{k}</span>
                  <Badge tone={tone}>{val}</Badge>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <Field label="Internet Type">
            <select className={inputCls} value={form.internetType} onChange={e => set('internetType', e.target.value)}>
              <option>Fiber</option><option>DSL</option><option>Cable</option><option>Mobile Data</option><option>Other</option>
            </select>
          </Field>
          <Field label="Speedtest Screenshot Evidence">
            {form.fileUrl ? (
              <ScreenshotEvidence url={form.fileUrl} filename={form.fileName} />
            ) : (
              <label className="flex items-center gap-3 px-3 py-4 rounded-lg cursor-pointer border border-dashed border-[var(--border)] hover-surface">
                <Upload size={17} className="text-muted shrink-0" />
                <span className="text-xs text-muted truncate">{uploading ? 'Uploading…' : 'Click to upload a screenshot (PNG or JPG)'}</span>
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={uploading} onChange={handleFileChange} />
              </label>
            )}
            {form.fileUrl && (
              <button type="button" onClick={() => { set('fileName', ''); set('fileUrl', ''); }} className="text-[10px] font-bold accent-text mt-1.5">
                Remove and upload a different file
              </button>
            )}
          </Field>
        </div>
      )}

      {step === 3 && (
        <div>
          <div className="rounded-lg p-4 text-xs leading-relaxed mb-4 border border-[var(--border)]" style={{ background: 'var(--bg)' }}>
            {DECLARATION_TEXT}
          </div>
          <label className="flex items-start gap-2.5 text-xs font-semibold">
            <input type="checkbox" className="mt-0.5" checked={form.agreed} onChange={e => set('agreed', e.target.checked)} />
            I have read and agree to the IT Asset &amp; Security Declaration above.
          </label>
        </div>
      )}

      <div className="flex justify-between mt-7 pt-4 border-t border-[var(--border)]">
        <button type="button" disabled={step === 0} onClick={() => setStep(s => s - 1)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold hover-surface border border-[var(--border)]" style={{ opacity: step === 0 ? 0.4 : 1 }}>
          <ArrowLeft size={14} /> Back
        </button>
        {step < 3 ? (
          <button type="button" disabled={!canAdvance} onClick={() => setStep(s => s + 1)}
            className="flex items-center gap-1.5 px-5 py-2 rounded-lg text-xs font-bold accent-bg-solid shadow-sm" style={{ opacity: canAdvance ? 1 : 0.5 }}>
            Next <ArrowRight size={14} />
          </button>
        ) : (
          <button type="button" disabled={!form.agreed || submitting} onClick={submit}
            className="px-5 py-2 rounded-lg text-xs font-bold accent-bg-solid shadow-sm" style={{ opacity: form.agreed ? 1 : 0.5 }}>
            {submitting ? 'Submitting…' : 'Submit Application'}
          </button>
        )}
      </div>
    </Card>
  );
}

function EmployeeSchedule() {
  const { currentUser, applications } = useApp();
  const app = applications.find(a => a.userId === currentUser.id && a.status === 'approved');

  return (
    <Card className="w-full">
      <ExpandedMonthCalendar app={app} title="My Monthly Working Schedule" />
      <div className="flex flex-wrap items-center gap-4 mt-4 pt-4 border-t border-[var(--border)] text-[11px] font-semibold">
        <span className="flex items-center gap-1.5"><span className="rounded-full" style={{ width: 8, height: 8, background: 'var(--success)' }} /> WFH Day</span>
        <span className="flex items-center gap-1.5"><span className="rounded-full" style={{ width: 8, height: 8, background: 'var(--info)' }} /> Office Day</span>
        <span className="flex items-center gap-1.5"><span className="rounded-full" style={{ width: 8, height: 8, background: 'var(--holiday)' }} /> Corporate Holiday</span>
        <span className="flex items-center gap-1.5"><span className="rounded-full" style={{ width: 8, height: 8, background: 'var(--neutral)' }} /> Off / Weekend</span>
      </div>
      {!app && (
        <p className="text-xs text-muted mt-3">
          You don't have an approved WFH application yet, so every working day currently defaults to the office (aside from corporate holidays).
        </p>
      )}
    </Card>
  );
}

/* ============================== SCREENSHOT EVIDENCE (thumbnail + zoom modal) ============================== */

function ScreenshotEvidence({ url, filename, label = 'Speedtest Evidence', variant = 'inline', caption }) {
  const [open, setOpen] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const hasRealFile = !!url && url.startsWith('/uploads/');
  const resolvedUrl = hasRealFile ? api.uploads.fileUrl(url) : null;

  return (
    <>
      {variant === 'tile' ? (
        <button type="button" onClick={() => setOpen(true)} className="rounded-lg overflow-hidden border border-[var(--border)] hover-surface text-left w-full">
          <div className="aspect-video flex items-center justify-center" style={{ background: 'var(--bg)' }}>
            {hasRealFile ? (
              <img src={resolvedUrl} alt={filename || label} className="w-full h-full object-cover" />
            ) : (
              <ImageOff size={20} className="text-muted" />
            )}
          </div>
          {caption && <div className="px-2 py-1.5 text-[10px] font-medium truncate">{caption}</div>}
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)}
          className="flex items-center gap-2.5 p-2 rounded-lg border border-[var(--border)] hover-surface text-left w-full max-w-[240px]">
          {hasRealFile ? (
            <img src={resolvedUrl} alt={filename || label} className="w-10 h-10 rounded-md object-cover shrink-0 border border-[var(--border)]" />
          ) : (
            <div className="w-10 h-10 rounded-md flex items-center justify-center shrink-0 border border-[var(--border)]" style={{ background: 'var(--bg)' }}>
              <ImageOff size={16} className="text-muted" />
            </div>
          )}
          <div className="min-w-0">
            <div className="text-xs font-semibold truncate">{filename || label}</div>
            <div className="text-[10px] text-muted">{hasRealFile ? 'Click to view' : 'No preview available'}</div>
          </div>
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="card p-0 overflow-hidden max-w-3xl w-full max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
              <span className="font-display font-bold text-sm truncate">{filename || label}</span>
              <div className="flex items-center gap-1.5 shrink-0">
                {hasRealFile && (
                  <>
                    <button onClick={() => setZoomed(z => !z)} className="p-1.5 rounded-lg hover-surface" title={zoomed ? 'Zoom out' : 'Zoom in'}><ZoomIn size={16} /></button>
                    <a href={resolvedUrl} download={filename || 'evidence'} className="p-1.5 rounded-lg hover-surface" title="Download"><Download size={16} /></a>
                  </>
                )}
                <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover-surface" title="Close"><X size={16} /></button>
              </div>
            </div>
            <div className="flex-1 overflow-auto flex items-center justify-center p-4" style={{ background: 'var(--bg)' }}>
              {hasRealFile ? (
                <img src={resolvedUrl} alt={filename || label} className={zoomed ? '' : 'max-w-full max-h-full object-contain'} style={zoomed ? { width: '160%', maxWidth: 'none' } : {}} />
              ) : (
                <div className="text-center py-10 text-sm text-muted">
                  <ImageOff size={28} className="mx-auto mb-2" />
                  No preview available for this file.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ============================== SHARED WIDE MODAL ============================== */

function WideModal({ isOpen, onClose, title, children, width = 'max-w-2xl' }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className={`card w-full ${width} p-0 relative border border-[var(--border)] shadow-2xl max-h-[88vh] flex flex-col`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] shrink-0">
          <h3 className="font-display font-bold text-base truncate pr-3">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover-surface text-muted hover:text-[var(--text)] transition-colors shrink-0">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}

/* ============================== TICKETING ENGINE ============================== */

const TICKET_STATUSES = ['Open', 'In Progress', 'Pending', 'Resolved', 'Closed'];
const TICKET_TYPES = ['Request', 'Borrow', 'Incident'];
const TICKET_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

function ticketStatusTone(status) {
  return { Open: 'info', 'In Progress': 'warning', Pending: 'neutral', Resolved: 'success', Closed: 'neutral' }[status] || 'neutral';
}
function ticketPriorityTone(priority) {
  return { Low: 'neutral', Medium: 'info', High: 'warning', Urgent: 'danger' }[priority] || 'neutral';
}

function CreateTicketModal({ isOpen, onClose }) {
  const { setTickets, addToast } = useApp();
  const emptyForm = { subject: '', description: '', type: 'Request', priority: 'Medium' };
  const [form, setForm] = useState(emptyForm);
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.subject.trim() || !form.description.trim()) return;
    setSubmitting(true);
    try {
      let attachment = null;
      if (file) {
        const uploaded = await api.uploads.upload(file);
        attachment = { url: uploaded.url, filename: uploaded.filename };
      }
      const created = await api.tickets.create({ ...form, attachment });
      setTickets(prev => [created, ...prev]);
      addToast(`Ticket ${created.ticketNumber} created.`, 'success');
      setForm(emptyForm);
      setFile(null);
      onClose();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="New Ticket">
      <form onSubmit={submit}>
        <Field label="Subject">
          <input className={inputCls} required value={form.subject} onChange={e => set('subject', e.target.value)} placeholder="Brief summary of the issue or request" />
        </Field>
        <Field label="Description">
          <textarea className={inputCls} rows={4} required value={form.description} onChange={e => set('description', e.target.value)} placeholder="Provide as much detail as possible…" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select className={inputCls} value={form.type} onChange={e => set('type', e.target.value)}>
              {TICKET_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select className={inputCls} value={form.priority} onChange={e => set('priority', e.target.value)}>
              {TICKET_PRIORITIES.map(p => <option key={p}>{p}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Attachment (optional)">
          <label className="flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer border border-dashed border-[var(--border)] hover-surface">
            <Paperclip size={16} className="text-muted shrink-0" />
            <span className="text-xs text-muted truncate">{file ? file.name : 'Attach a screenshot or document'}</span>
            <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" onChange={e => setFile(e.target.files[0] || null)} />
          </label>
        </Field>
        <button type="submit" disabled={submitting} className="w-full py-2.5 rounded-lg font-bold text-xs accent-bg-solid shadow-sm mt-2">
          {submitting ? 'Submitting…' : 'Submit Ticket'}
        </button>
      </form>
    </Modal>
  );
}

function TicketThreadModal({ ticketId, isOpen, onClose }) {
  const { currentUser, users, assets, setTickets, addToast } = useApp();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [reply, setReply] = useState('');
  const [replyFile, setReplyFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [assetToAssign, setAssetToAssign] = useState('');
  const [assigningAsset, setAssigningAsset] = useState(false);
  const [statusDraft, setStatusDraft] = useState('');
  const [assigneeDraft, setAssigneeDraft] = useState('');
  const [savingAdmin, setSavingAdmin] = useState(false);

  const admins = users.filter(u => u.role === 'Admin');
  const availableAssets = assets.filter(a => a.status === 'Available');

  const load = async () => {
    if (!ticketId) return;
    setLoading(true);
    try {
      const data = await api.tickets.get(ticketId);
      setDetail(data);
      setStatusDraft(data.status);
      setAssigneeDraft(data.assignedTo || '');
    } catch (e) {
      addToast(e.message, 'error');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (isOpen) load(); }, [isOpen, ticketId]);

  const syncTicketInList = (updated) => {
    setTickets(prev => prev.map(t => t.id === updated.id ? { ...t, ...updated } : t));
  };

  const sendReply = async (e) => {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    try {
      let attachment = null;
      if (replyFile) {
        const uploaded = await api.uploads.upload(replyFile);
        attachment = { url: uploaded.url, filename: uploaded.filename };
      }
      await api.tickets.addMessage(ticketId, { message: reply.trim(), attachment });
      setReply(''); setReplyFile(null);
      await load();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSending(false);
    }
  };

  const closeTicket = async () => {
    try {
      const updated = await api.tickets.close(ticketId);
      syncTicketInList(updated);
      addToast('Ticket closed.', 'success');
      await load();
    } catch (e) { addToast(e.message, 'error'); }
  };

  const saveAdminControls = async () => {
    setSavingAdmin(true);
    try {
      const updated = await api.tickets.update(ticketId, { status: statusDraft, assignedTo: assigneeDraft ? Number(assigneeDraft) : null });
      syncTicketInList(updated);
      addToast('Ticket updated.', 'success');
      await load();
    } catch (e) { addToast(e.message, 'error'); }
    finally { setSavingAdmin(false); }
  };

  const assignAsset = async () => {
    if (!assetToAssign) return;
    setAssigningAsset(true);
    try {
      const updated = await api.tickets.assignAsset(ticketId, Number(assetToAssign));
      syncTicketInList(updated);
      addToast('Asset assigned and ticket closed.', 'success');
      await load();
    } catch (e) { addToast(e.message, 'error'); }
    finally { setAssigningAsset(false); }
  };

  return (
    <WideModal isOpen={isOpen} onClose={onClose} title={detail ? `${detail.ticketNumber} — ${detail.subject}` : 'Loading…'}>
      {loading || !detail ? (
        <div className="py-10 text-center text-sm text-muted">Loading ticket…</div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={ticketPriorityTone(detail.priority)}>{detail.priority}</Badge>
            <Badge tone="info">{detail.type}</Badge>
            <Badge tone={ticketStatusTone(detail.status)}>{detail.status}</Badge>
            {detail.assignedToName && <Badge tone="neutral">Assigned: {detail.assignedToName}</Badge>}
            <span className="text-[10px] text-muted ml-auto">By {detail.employeeName} • {detail.createdAt}</span>
          </div>

          <div className="p-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-xs leading-relaxed">
            {detail.description}
          </div>

          {detail.attachments?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {detail.attachments.map(a => <ScreenshotEvidence key={a.id} url={a.path} filename={a.filename} />)}
            </div>
          )}

          {currentUser.role === 'Admin' && (
            <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border border-[var(--border)]">
              <Field label="Status">
                <select className={inputCls} value={statusDraft} onChange={e => setStatusDraft(e.target.value)}>
                  {TICKET_STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Assign to Admin">
                <select className={inputCls} value={assigneeDraft} onChange={e => setAssigneeDraft(e.target.value)}>
                  <option value="">Unassigned</option>
                  {admins.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
              <button onClick={saveAdminControls} disabled={savingAdmin} className="col-span-2 py-2 rounded-lg text-xs font-bold accent-bg-solid">
                {savingAdmin ? 'Saving…' : 'Save Changes'}
              </button>

              {detail.type === 'Borrow' && detail.status !== 'Closed' && (
                <div className="col-span-2 pt-3 mt-1 border-t border-[var(--border)]">
                  <Field label="One-Click Asset Assignment (Borrow Request)">
                    <div className="flex gap-2">
                      <select className={inputCls} value={assetToAssign} onChange={e => setAssetToAssign(e.target.value)}>
                        <option value="">Select an available asset…</option>
                        {availableAssets.map(a => <option key={a.id} value={a.id}>{a.assetTag} — {a.name}</option>)}
                      </select>
                      <button onClick={assignAsset} disabled={!assetToAssign || assigningAsset}
                        className="px-4 py-2 rounded-lg text-xs font-bold shrink-0" style={{ background: 'var(--success)', color: '#fff', opacity: assetToAssign ? 1 : 0.5 }}>
                        {assigningAsset ? 'Assigning…' : 'Assign & Close'}
                      </button>
                    </div>
                  </Field>
                </div>
              )}
            </div>
          )}

          {currentUser.role === 'Employee' && detail.employeeId === currentUser.id && detail.status !== 'Closed' && (
            <button onClick={closeTicket} className="self-start px-4 py-2 rounded-lg text-xs font-bold border border-[var(--border)] hover-surface">
              Close Ticket
            </button>
          )}

          <div className="border-t border-[var(--border)] pt-3">
            <div className="text-[10px] text-muted font-bold uppercase tracking-wider mb-2">Conversation</div>
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
              {detail.messages.length === 0 && <div className="text-xs text-muted">No replies yet.</div>}
              {detail.messages.map(m => (
                <div key={m.id} className="p-2.5 rounded-lg border border-[var(--border)]" style={{ background: m.sender === currentUser.id ? 'var(--info-tint)' : 'var(--bg)' }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold">{m.senderName} <span className="font-normal text-muted">({m.senderRole})</span></span>
                    <span className="text-[10px] text-muted">{m.createdAt}</span>
                  </div>
                  <p className="text-xs leading-relaxed">{m.message}</p>
                  {m.attachment && <div className="mt-2"><ScreenshotEvidence url={m.attachment} filename="Attachment" /></div>}
                </div>
              ))}
            </div>
          </div>

          {detail.status !== 'Closed' && (
            <form onSubmit={sendReply} className="flex flex-col gap-2 pt-1">
              <textarea className={inputCls} rows={2} placeholder="Write a reply…" value={reply} onChange={e => setReply(e.target.value)} />
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-[10px] font-bold text-muted cursor-pointer">
                  <Paperclip size={14} />
                  {replyFile ? replyFile.name : 'Attach file'}
                  <input type="file" className="hidden" onChange={e => setReplyFile(e.target.files[0] || null)} />
                </label>
                <button type="submit" disabled={sending || !reply.trim()} className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold accent-bg-solid">
                  <Send size={14} /> {sending ? 'Sending…' : 'Send Reply'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </WideModal>
  );
}

function TicketsTable({ tickets, onOpen }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] font-bold text-muted uppercase tracking-wider border-b border-[var(--border)]">
            <th className="py-2 pr-3">Ticket #</th>
            <th className="py-2 pr-3">Subject</th>
            <th className="py-2 pr-3">Employee</th>
            <th className="py-2 pr-3">Type</th>
            <th className="py-2 pr-3">Priority</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3">Updated</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map(t => (
            <tr key={t.id} onClick={() => onOpen(t.id)} className="cursor-pointer hover-surface border-b border-[var(--border)]">
              <td className="py-2.5 pr-3 font-bold mono">{t.ticketNumber}</td>
              <td className="py-2.5 pr-3 truncate max-w-[240px]">{t.subject}</td>
              <td className="py-2.5 pr-3">{t.employeeName}</td>
              <td className="py-2.5 pr-3">{t.type}</td>
              <td className="py-2.5 pr-3"><Badge tone={ticketPriorityTone(t.priority)}>{t.priority}</Badge></td>
              <td className="py-2.5 pr-3"><Badge tone={ticketStatusTone(t.status)}>{t.status}</Badge></td>
              <td className="py-2.5 pr-3 text-muted">{t.updatedAt}</td>
            </tr>
          ))}
          {tickets.length === 0 && (
            <tr><td colSpan={7} className="py-8 text-center text-muted">No tickets yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function TicketSearchFilterBar({ query, setQuery, typeFilter, setTypeFilter, statusFilter, setStatusFilter, priorityFilter, setPriorityFilter }) {
  return (
  <div className="flex flex-wrap items-end gap-2 mb-4 w-full">
    <div className="flex-1 min-w-[220px]">
      <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1">
        Search
      </label>

      <div className="relative">
        <Search
          size={13}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
        />

        <input
          className={`${inputCls} pl-7 h-9`}
          placeholder="Search tickets…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>
    </div>

    <div className="w-[150px]">
      <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1">
        Type
      </label>

      <select
        className={`${inputCls} h-9`}
        value={typeFilter}
        onChange={e => setTypeFilter(e.target.value)}
      >
        <option value="">All Types</option>
        {TICKET_TYPES.map(t => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </div>

    <div className="w-[160px]">
      <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1">
        Priority
      </label>

      <select
        className={`${inputCls} h-9`}
        value={priorityFilter}
        onChange={e => setPriorityFilter(e.target.value)}
      >
        <option value="">All Priorities</option>
        {TICKET_PRIORITIES.map(p => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
    </div>

    <div className="w-[160px]">
      <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1">
        Status
      </label>

      <select
        className={`${inputCls} h-9`}
        value={statusFilter}
        onChange={e => setStatusFilter(e.target.value)}
      >
        <option value="">All Statuses</option>
        {TICKET_STATUSES.map(s => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </div>
  </div>
);
}

function useTicketFilters(tickets) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const filtered = tickets.filter(t => {
    if (typeFilter && t.type !== typeFilter) return false;
    if (statusFilter && t.status !== statusFilter) return false;
    if (priorityFilter && t.priority !== priorityFilter) return false;
    if (query) {
      const q = query.toLowerCase();
      const haystack = `${t.ticketNumber} ${t.subject} ${t.employeeName}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
  return { query, setQuery, typeFilter, setTypeFilter, statusFilter, setStatusFilter, priorityFilter, setPriorityFilter, filtered };
}

function TicketsPageShell({ title, subtitle, scopeTickets, showFilters }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [openTicketId, setOpenTicketId] = useState(null);
  const { query, setQuery, typeFilter, setTypeFilter, statusFilter, setStatusFilter, priorityFilter, setPriorityFilter, filtered } = useTicketFilters(scopeTickets);

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-display font-bold text-base">{title}</h3>
          {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
        </div>
        <button onClick={() => setCreateOpen(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold accent-bg-solid shadow-sm shrink-0">
          <Plus size={14} /> New Ticket
        </button>
      </div>
      {showFilters && (
        <TicketSearchFilterBar query={query} setQuery={setQuery} typeFilter={typeFilter} setTypeFilter={setTypeFilter}
          statusFilter={statusFilter} setStatusFilter={setStatusFilter} priorityFilter={priorityFilter} setPriorityFilter={setPriorityFilter} />
      )}
      <TicketsTable tickets={showFilters ? filtered : scopeTickets} onOpen={setOpenTicketId} />
      <CreateTicketModal isOpen={createOpen} onClose={() => setCreateOpen(false)} />
      <TicketThreadModal ticketId={openTicketId} isOpen={!!openTicketId} onClose={() => setOpenTicketId(null)} />
    </Card>
  );
}

function EmployeeTickets() {
  const { currentUser, tickets } = useApp();
  const mine = tickets.filter(t => t.employeeId === currentUser.id);
  return <TicketsPageShell title="My Tickets" subtitle="Track requests, borrow items, or report incidents." scopeTickets={mine} />;
}

function ManagerTickets() {
  const { tickets } = useApp();
  return <TicketsPageShell title="Team Tickets" subtitle="Tickets submitted by your direct reports." scopeTickets={tickets} showFilters />;
}

function AdminTickets() {
  const { tickets } = useApp();
  return <TicketsPageShell title="Ticket Management" subtitle="Assign admins, update status, and resolve requests." scopeTickets={tickets} showFilters />;
}

/* ============================== ASSET MANAGEMENT & LIFECYCLE ENGINE ============================== */

const ASSET_TYPES = ['Desktop', 'Laptop', 'Printer', 'Monitor', 'Server', 'UPS', 'Mouse', 'Keyboard', 'Headset', 'Software License', 'Others'];
const CONSUMABLE_TYPES = ['Mouse', 'Keyboard', 'Headset'];
const emptyAssetForm = { name: '', type: ASSET_TYPES[0], brand: '', model: '', serialNumber: '', purchaseDate: '', warrantyExpiry: '', remarks: '', specs: {}, imageUrl: '', quantity: '' };

// Drives the dynamic "Specifications" section of the Add/Edit Asset form — different fields per asset type.
const TYPE_SPEC_FIELDS = {
  Desktop: ['Motherboard', 'CPU', 'RAM', 'Storage Size', 'Video Card', 'OS'],
  Laptop: ['Motherboard', 'CPU', 'RAM', 'Storage Size', 'Video Card', 'OS'],
  Monitor: ['Display Size', 'Panel Type', 'Resolution', 'Viewing Angle', 'Refresh Rate', 'Inputs', 'Wall Mount Compatible'],
  Printer: ['Print Type', 'Connectivity', 'Duty Cycle', 'Paper Size'],
  Server: ['CPU', 'RAM', 'Storage Size', 'RAID Configuration', 'OS'],
  UPS: ['Capacity (VA)', 'Battery Type', 'Runtime', 'Outlets'],
  Mouse: ['Connectivity', 'DPI', 'Buttons'],
  Keyboard: ['Connectivity', 'Layout', 'Switch Type'],
  Headset: ['Connectivity', 'Microphone', 'Noise Cancelling'],
  'Software License': ['License Key', 'Seats Licensed', 'Vendor', 'Expiry Date'],
  Others: ['Specification 1', 'Specification 2', 'Specification 3'],
};

function assetStatusTone(status) {
  return { Available: 'success', 'In Use': 'info', Maintenance: 'warning', Retired: 'neutral', 'Out of Stock': 'danger' }[status] || 'neutral';
}

function AssetFormModal({ isOpen, onClose, asset, onSaved }) {
  const { addToast } = useApp();
  const buildForm = () => asset ? { ...emptyAssetForm, ...asset, specs: { ...(asset.specs || {}) } } : { ...emptyAssetForm, specs: {} };
  const [form, setForm] = useState(buildForm());
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  useEffect(() => { setForm(buildForm()); }, [asset, isOpen]);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setSpec = (k, v) => setForm(f => ({ ...f, specs: { ...f.specs, [k]: v } }));

  const specFields = TYPE_SPEC_FIELDS[form.type] || [];

  const handleImageChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingImage(true);
    try {
      const uploaded = await api.uploads.upload(file);
      set('imageUrl', uploaded.url);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setUploadingImage(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const saved = asset ? await api.assets.update(asset.id, form) : await api.assets.create(form);
      onSaved(saved, !asset);
      addToast(asset ? 'Asset updated.' : 'Asset created.', 'success');
      onClose();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <WideModal isOpen={isOpen} onClose={onClose} title={asset ? 'Edit Asset' : 'Add Asset'}>
      <form onSubmit={submit}>
        <Field label="Asset Image">
          <div className="flex items-center gap-3">
            {form.imageUrl ? (
              <img src={api.uploads.fileUrl(form.imageUrl)} alt="" className="w-16 h-16 rounded-lg object-cover border border-[var(--border)]" />
            ) : (
              <div className="w-16 h-16 rounded-lg flex items-center justify-center border border-dashed border-[var(--border)]" style={{ background: 'var(--bg)' }}>
                <ImagePlus size={20} className="text-muted" />
              </div>
            )}
            <label className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer border border-[var(--border)] hover-surface text-xs font-semibold">
              <Upload size={14} />
              {uploadingImage ? 'Uploading…' : form.imageUrl ? 'Replace Image' : 'Upload Image'}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={uploadingImage} onChange={handleImageChange} />
            </label>
          </div>
        </Field>

        <Field label="Name"><input className={inputCls} required value={form.name} onChange={e => set('name', e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select className={inputCls} value={form.type} onChange={e => set('type', e.target.value)}>
              {ASSET_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Brand"><input className={inputCls} value={form.brand} onChange={e => set('brand', e.target.value)} /></Field>
        </div>
        {CONSUMABLE_TYPES.includes(form.type) && (
          <Field label="Quantity in Stock">
            <input className={inputCls} type="number" min="0" step="1" value={form.quantity} onChange={e => set('quantity', e.target.value)} placeholder="e.g. 10" />
            <p className="text-[10px] text-muted mt-1">Stock auto-decrements by 1 on each assignment. An Admin alert fires when it reaches 0.</p>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Model"><input className={inputCls} value={form.model} onChange={e => set('model', e.target.value)} /></Field>
          <Field label="Serial Number"><input className={inputCls} value={form.serialNumber} onChange={e => set('serialNumber', e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Purchase Date"><input type="date" className={inputCls} value={form.purchaseDate} onChange={e => set('purchaseDate', e.target.value)} /></Field>
          <Field label="Warranty Expiry"><input type="date" className={inputCls} value={form.warrantyExpiry} onChange={e => set('warrantyExpiry', e.target.value)} /></Field>
        </div>

        {specFields.length > 0 && (
          <div className="mb-4">
            <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-2 pt-2 border-t border-[var(--border)]">
              {form.type} Specifications
            </div>
            <div className="grid grid-cols-2 gap-3">
              {specFields.map(fieldName => (
                <Field key={fieldName} label={fieldName}>
                  <input className={inputCls} value={form.specs[fieldName] || ''} onChange={e => setSpec(fieldName, e.target.value)} />
                </Field>
              ))}
            </div>
          </div>
        )}

        <Field label="Remarks"><textarea className={inputCls} rows={2} value={form.remarks} onChange={e => set('remarks', e.target.value)} /></Field>
        <button type="submit" disabled={saving} className="w-full py-2.5 rounded-lg font-bold text-xs accent-bg-solid shadow-sm mt-2">
          {saving ? 'Saving…' : asset ? 'Save Changes' : 'Add Asset'}
        </button>
      </form>
    </WideModal>
  );
}

function AssignAssetModal({ isOpen, onClose, asset, onAssigned }) {
  const { users, addToast } = useApp();
  const employees = users.filter(u => u.role === 'Employee');
  const [employeeId, setEmployeeId] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!employeeId) return;
    setSaving(true);
    try {
      const updated = await api.assets.assign(asset.id, Number(employeeId));
      onAssigned(updated);
      addToast('Asset assigned.', 'success');
      onClose();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Assign ${asset?.name || ''}`}>
      <Field label="Assign to Employee">
        <select className={inputCls} value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
          <option value="">Select an employee…</option>
          {employees.map(e => <option key={e.id} value={e.id}>{e.name} — {e.department}</option>)}
        </select>
      </Field>
      <button onClick={submit} disabled={!employeeId || saving} className="w-full py-2.5 rounded-lg font-bold text-xs accent-bg-solid shadow-sm mt-2">
        {saving ? 'Assigning…' : 'Assign Asset'}
      </button>
    </Modal>
  );
}

function BulkAssignModal({ isOpen, onClose, asset, onAssigned }) {
  const { users, addToast } = useApp();
  const employees = users.filter(u => u.role === 'Employee');
  const alreadyAssigned = new Set((asset?.assignees || []).map(a => a.employeeId));
  const [selected, setSelected] = useState([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setSelected([]); }, [asset, isOpen]);

  const toggle = (id) => setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const submit = async () => {
    if (selected.length === 0) return;
    setSaving(true);
    try {
      const updated = await api.assets.bulkAssign(asset.id, selected);
      onAssigned(updated);
      addToast(`Asset assigned to ${selected.length} employee${selected.length === 1 ? '' : 's'}.`, 'success');
      onClose();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Bulk Assign ${asset?.name || ''}`}>
      <p className="text-xs text-muted mb-3">Select multiple employees to share this asset (e.g. a shared workstation or meeting-room device).</p>
      <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto mb-4">
        {employees.map(e => (
          <label key={e.id} className={`flex items-center gap-2.5 p-2 rounded-lg border border-[var(--border)] text-xs ${alreadyAssigned.has(e.id) ? 'opacity-50' : 'hover-surface cursor-pointer'}`}>
            <input type="checkbox" disabled={alreadyAssigned.has(e.id)} checked={selected.includes(e.id)} onChange={() => toggle(e.id)} />
            <Avatar name={e.name} size={22} />
            <span className="font-medium">{e.name}</span>
            <span className="text-muted ml-auto">{alreadyAssigned.has(e.id) ? 'Already assigned' : e.department}</span>
          </label>
        ))}
        {employees.length === 0 && <p className="text-xs text-muted">No employees available.</p>}
      </div>
      <button onClick={submit} disabled={selected.length === 0 || saving} className="w-full py-2.5 rounded-lg font-bold text-xs accent-bg-solid shadow-sm">
        {saving ? 'Assigning…' : `Assign to ${selected.length || ''} Employee${selected.length === 1 ? '' : 's'}`.trim()}
      </button>
    </Modal>
  );
}

function ReturnAssetModal({ isOpen, onClose, asset, onReturned }) {
  const { addToast } = useApp();
  const [returningId, setReturningId] = useState(null);

  const doReturn = async (employeeId) => {
    setReturningId(employeeId);
    try {
      const updated = await api.assets.return(asset.id, employeeId);
      onReturned(updated);
      addToast('Asset marked as returned.', 'success');
      if (updated.assignedCount === 0) onClose();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setReturningId(null);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Return ${asset?.name || ''}`}>
      <div className="flex flex-col gap-2">
        {(asset?.assignees || []).map(a => (
          <div key={a.employeeId} className="flex items-center justify-between p-2.5 rounded-lg border border-[var(--border)]">
            <div className="flex items-center gap-2">
              <Avatar name={a.employeeName} size={26} />
              <div>
                <div className="text-xs font-semibold">{a.employeeName}</div>
                <div className="text-[10px] text-muted">Assigned {a.assignedDate}</div>
              </div>
            </div>
            <button onClick={() => doReturn(a.employeeId)} disabled={returningId === a.employeeId}
              className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: 'var(--warning-tint)', color: 'var(--warning)' }}>
              {returningId === a.employeeId ? 'Returning…' : 'Mark Returned'}
            </button>
          </div>
        ))}
        {(!asset?.assignees || asset.assignees.length === 0) && <p className="text-xs text-muted">No active assignments.</p>}
      </div>
    </Modal>
  );
}

function AssetHistoryModal({ isOpen, onClose, asset }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (isOpen && asset) api.assets.history(asset.id).then(setData).catch(() => setData({ assignments: [], logs: [] }));
    else setData(null);
  }, [isOpen, asset]);

  return (
    <WideModal isOpen={isOpen} onClose={onClose} title={`Audit History — ${asset?.name || ''}`}>
      {!data ? <div className="py-8 text-center text-sm text-muted">Loading…</div> : (
        <div className="flex flex-col gap-5">
          <div>
            <div className="text-[10px] text-muted font-bold uppercase tracking-wider mb-2">Assignment History</div>
            <div className="flex flex-col gap-2">
              {data.assignments.length === 0 && <div className="text-xs text-muted">No assignment history.</div>}
              {data.assignments.map(a => (
                <div key={a.id} className="p-2.5 rounded-lg border border-[var(--border)] text-xs flex items-center justify-between">
                  <div>
                    <div className="font-semibold">{a.employeeName}</div>
                    <div className="text-muted">{a.assignedDate} {a.returnedDate ? `→ ${a.returnedDate}` : '(active)'}</div>
                  </div>
                  <Badge tone={a.status === 'Active' ? 'info' : 'neutral'}>{a.status}</Badge>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-muted font-bold uppercase tracking-wider mb-2">Activity Log</div>
            <div className="flex flex-col gap-2">
              {data.logs.length === 0 && <div className="text-xs text-muted">No activity logged.</div>}
              {data.logs.map(l => (
                <div key={l.id} className="p-2.5 rounded-lg border border-[var(--border)] text-xs">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge tone="neutral">{l.action}</Badge>
                    <span className="text-muted text-[10px] ml-auto">{l.performedByName} • {l.timestamp}</span>
                  </div>
                  <p className="leading-relaxed">{l.message || l.action}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </WideModal>
  );
}

function AssetDetailModal({ isOpen, onClose, asset }) {
  if (!asset) return null;
  const specFields = TYPE_SPEC_FIELDS[asset.type] || [];
  const specs = asset.specs || {};
  const hasAnySpec = specFields.some(f => specs[f]);
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={asset.name}>
      <div className="flex items-center gap-3 mb-4">
        {asset.imageUrl ? (
          <img src={api.uploads.fileUrl(asset.imageUrl)} alt="" className="w-16 h-16 rounded-lg object-cover border border-[var(--border)]" />
        ) : (
          <div className="w-16 h-16 rounded-lg flex items-center justify-center border border-[var(--border)]" style={{ background: 'var(--bg)' }}>
            <Package size={22} className="text-muted" />
          </div>
        )}
        <div>
          <div className="font-bold text-sm mono">{asset.assetTag}</div>
          <div className="text-xs text-muted">{asset.brand} {asset.model}</div>
          <Badge tone={assetStatusTone(asset.status)}>{asset.status}</Badge>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs mb-3">
        <div><span className="text-muted">Type:</span> {asset.type}</div>
        <div><span className="text-muted">Serial #:</span> {asset.serialNumber || '—'}</div>
        <div><span className="text-muted">Purchased:</span> {asset.purchaseDate || '—'}</div>
        <div><span className="text-muted">Warranty:</span> {asset.warrantyExpiry || '—'}</div>
        {asset.currentAssignment && <div className="col-span-2"><span className="text-muted">Assigned to:</span> {asset.currentAssignment.employeeName}</div>}
      </div>
      {hasAnySpec && (
        <div className="mb-3">
          <div className="text-[10px] font-bold text-muted uppercase tracking-wider mb-2 pt-2 border-t border-[var(--border)]">Specifications</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {specFields.filter(f => specs[f]).map(f => (
              <div key={f}><span className="text-muted">{f}:</span> {specs[f]}</div>
            ))}
          </div>
        </div>
      )}
      {asset.remarks && (
        <div className="text-xs pt-2 border-t border-[var(--border)]">
          <span className="text-muted">Remarks:</span> {asset.remarks}
        </div>
      )}
    </Modal>
  );
}

function AssetImageLightbox({ url, name, onClose }) {
  const [zoomed, setZoomed] = useState(false);
  const resolvedUrl = api.uploads.fileUrl(url);
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="card p-0 overflow-hidden max-w-2xl w-full max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <span className="font-display font-bold text-sm truncate">{name}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={() => setZoomed(z => !z)} className="p-1.5 rounded-lg hover-surface" title={zoomed ? 'Zoom out' : 'Zoom in'}><ZoomIn size={16} /></button>
            <a href={resolvedUrl} download={name} className="p-1.5 rounded-lg hover-surface" title="Download"><Download size={16} /></a>
            <button onClick={onClose} className="p-1.5 rounded-lg hover-surface" title="Close"><X size={16} /></button>
          </div>
        </div>
        <div className="flex-1 overflow-auto flex items-center justify-center p-4" style={{ background: 'var(--bg)' }}>
          <img src={resolvedUrl} alt={name} className={zoomed ? '' : 'max-w-full max-h-full object-contain'} style={zoomed ? { width: '160%', maxWidth: 'none' } : {}} />
        </div>
      </div>
    </div>
  );
}

function AssetsGrid({ assetList, mode, onEdit, onAssign, onBulkAssign, onReturn, onRetire, onDelete, onHistory, onView }) {
  const { addToast } = useApp();
  const [lightbox, setLightbox] = useState(null);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] font-bold text-muted uppercase tracking-wider border-b border-[var(--border)]">
            <th className="py-2 pr-3"></th>
            <th className="py-2 pr-3">Tag</th>
            <th className="py-2 pr-3">Name</th>
            <th className="py-2 pr-3">Type</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3">Assigned To</th>
            <th className="py-2 pr-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {assetList.map(a => {
            const hasQuantity = a.quantity !== null && a.quantity !== undefined;
            return (
            <tr key={a.id} className="border-b border-[var(--border)]">
              <td className="py-2.5 pr-3">
                {a.imageUrl ? (
                  <button type="button" onClick={() => setLightbox(a)} title="Click to view full size">
                    <img src={api.uploads.fileUrl(a.imageUrl)} alt="" className="w-8 h-8 rounded-md object-cover border border-[var(--border)] hover:opacity-80 transition-opacity cursor-zoom-in" />
                  </button>
                ) : (
                  <div className="w-8 h-8 rounded-md flex items-center justify-center border border-[var(--border)]" style={{ background: 'var(--bg)' }}>
                    <Package size={14} className="text-muted" />
                  </div>
                )}
              </td>
              <td className="py-2.5 pr-3 font-bold mono">{a.assetTag}</td>
              <td className="py-2.5 pr-3">
                <div className="font-semibold">{a.name}</div>
                <div className="text-muted text-[10px]">{a.brand} {a.model}</div>
              </td>
              <td className="py-2.5 pr-3">{a.type}</td>
              <td className="py-2.5 pr-3">
                <Badge tone={assetStatusTone(a.status)}>{a.status}</Badge>
                {hasQuantity && <div className="text-[10px] text-muted mt-1">{a.quantityAvailable} of {a.quantity} in stock</div>}
              </td>
              <td className="py-2.5 pr-3">
                {a.assignedCount === 0 ? '—' : a.assignedCount === 1 ? a.currentAssignment.employeeName : `${a.assignedCount} employees`}
              </td>
              <td className="py-2.5 pr-3">
                <div className="flex items-center gap-1">
                  <button onClick={() => onView(a)} className="p-1.5 rounded-lg hover-surface" title="View Details"><Eye size={13} /></button>
                  {mode === 'admin' && (
                    <>
                      <button onClick={() => onEdit(a)} className="p-1.5 rounded-lg hover-surface" title="Edit"><Pencil size={13} /></button>
                      <button
                        onClick={async () => {
                          try {
                            const html = await api.assets.printTag(a.id);

                            const printWindow = window.open('', '_blank');

                            if (!printWindow) {
                              throw new Error('The browser blocked the print window. Please allow pop-ups for Remote Ops.');
                            }

                            printWindow.document.open();
                            printWindow.document.write(html);
                            printWindow.document.close();
                          } catch (e) {
                            addToast(e.message, 'error');
                          }
                        }}
                        className="p-1.5 rounded-lg hover-surface"
                        title="Print Asset Tag"
                      >
                        <FileText size={13} />
                      </button>
                      <button onClick={() => onHistory(a)} className="p-1.5 rounded-lg hover-surface" title="History"><History size={13} /></button>
                      {(a.status === 'Available') && (
                        <button onClick={() => onAssign(a)} className="p-1.5 rounded-lg hover-surface" title="Assign"><UserPlus size={13} /></button>
                      )}
                      {!hasQuantity && a.status === 'Available' && (
                        <button onClick={() => onBulkAssign(a)} className="p-1.5 rounded-lg hover-surface" title="Bulk Assign to Multiple Employees"><Users size={13} /></button>
                      )}
                      {a.assignedCount > 0 && (
                        <button onClick={() => onReturn(a)} className="p-1.5 rounded-lg hover-surface" title="Return"><RotateCcw size={13} /></button>
                      )}
                      {a.status === 'Available' && !hasQuantity && (
                        <button onClick={() => onRetire(a)} className="p-1.5 rounded-lg hover-surface" title="Retire"><Archive size={13} /></button>
                      )}
                      {a.assignedCount === 0 && (
                        <button onClick={() => onDelete(a)} className="p-1.5 rounded-lg hover-surface" style={{ color: 'var(--danger)' }} title="Delete"><Trash2 size={13} /></button>
                      )}
                    </>
                  )}
                  {mode === 'manager-readonly' && onHistory && (
                    <button onClick={() => onHistory(a)} className="p-1.5 rounded-lg hover-surface" title="History"><History size={13} /></button>
                  )}
                </div>
              </td>
            </tr>
          );})}
          {assetList.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-muted">No assets match your filters.</td></tr>}
        </tbody>
      </table>
      {lightbox && <AssetImageLightbox url={lightbox.imageUrl} name={lightbox.name} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function AssetSearchFilterBar({ query, setQuery, typeFilter, setTypeFilter, statusFilter, setStatusFilter, statusOptions }) {
  return (
  <div className="flex flex-wrap items-end gap-2 mb-4 w-full">
    <div className="flex-1 min-w-[220px]">
      <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1">
        Search
      </label>

      <div className="relative">
        <Search
          size={13}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
        />

        <input
          className={`${inputCls} pl-7 h-9`}
          placeholder="Search assets…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>
    </div>

    <div className="w-[160px]">
      <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1">
        Asset Type
      </label>

      <select
        className={`${inputCls} h-9`}
        value={typeFilter}
        onChange={e => setTypeFilter(e.target.value)}
      >
        <option value="">All Types</option>

        {ASSET_TYPES.map(t => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </div>

    <div className="w-[160px]">
      <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1">
        Status
      </label>

      <select
        className={`${inputCls} h-9`}
        value={statusFilter}
        onChange={e => setStatusFilter(e.target.value)}
      >
        <option value="">All Statuses</option>

        {statusOptions.map(s => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </div>
  </div>
);
}

function useAssetFilters(assets) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const filtered = assets.filter(a => {
    if (typeFilter && a.type !== typeFilter) return false;
    if (statusFilter && a.status !== statusFilter) return false;
    if (query) {
      const q = query.toLowerCase();
      const haystack = `${a.name} ${a.assetTag} ${a.brand} ${a.model} ${a.serialNumber}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
  return { query, setQuery, typeFilter, setTypeFilter, statusFilter, setStatusFilter, filtered };
}

function AdminAssets() {
  const { assets, setAssets, addToast } = useApp();
  const [formOpen, setFormOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState(null);
  const [assigning, setAssigning] = useState(null);
  const [bulkAssigning, setBulkAssigning] = useState(null);
  const [returning, setReturning] = useState(null);
  const [historyAsset, setHistoryAsset] = useState(null);
  const [viewingAsset, setViewingAsset] = useState(null);
  const { query, setQuery, typeFilter, setTypeFilter, statusFilter, setStatusFilter, filtered } = useAssetFilters(assets);

  const upsert = (saved, isNew) => {
    setAssets(prev => isNew ? [...prev, saved] : prev.map(a => a.id === saved.id ? saved : a));
  };
  const syncAsset = (updated) => setAssets(prev => prev.map(a => a.id === updated.id ? updated : a));

  const handleRetire = async (asset) => {
    try {
      const updated = await api.assets.retire(asset.id);
      syncAsset(updated);
      addToast('Asset retired.', 'success');
    } catch (e) { addToast(e.message, 'error'); }
  };
  const handleDelete = async (asset) => {
    if (!window.confirm(`Delete asset ${asset.name}? This cannot be undone.`)) return;
    try {
      await api.assets.remove(asset.id);
      setAssets(prev => prev.filter(a => a.id !== asset.id));
      addToast('Asset deleted.', 'info');
    } catch (e) { addToast(e.message, 'error'); }
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-display font-bold text-base">Asset Management</h3>
          <p className="text-xs text-muted mt-0.5">Create, assign, retire, and audit company assets — including peripherals and software licenses.</p>
        </div>
        <button onClick={() => { setEditingAsset(null); setFormOpen(true); }} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold accent-bg-solid shadow-sm shrink-0">
          <Plus size={14} /> Add Asset
        </button>
      </div>
      <AssetSearchFilterBar query={query} setQuery={setQuery} typeFilter={typeFilter} setTypeFilter={setTypeFilter}
        statusFilter={statusFilter} setStatusFilter={setStatusFilter} statusOptions={['Available', 'In Use', 'Out of Stock', 'Maintenance', 'Retired']} />
      <AssetsGrid assetList={filtered} mode="admin"
        onEdit={(a) => { setEditingAsset(a); setFormOpen(true); }}
        onAssign={(a) => setAssigning(a)}
        onBulkAssign={(a) => setBulkAssigning(a)}
        onReturn={(a) => setReturning(a)}
        onRetire={handleRetire}
        onDelete={handleDelete}
        onHistory={(a) => setHistoryAsset(a)}
        onView={(a) => setViewingAsset(a)}
      />
      <AssetFormModal isOpen={formOpen} onClose={() => setFormOpen(false)} asset={editingAsset} onSaved={upsert} />
      <AssignAssetModal isOpen={!!assigning} onClose={() => setAssigning(null)} asset={assigning} onAssigned={syncAsset} />
      <BulkAssignModal isOpen={!!bulkAssigning} onClose={() => setBulkAssigning(null)} asset={bulkAssigning} onAssigned={syncAsset} />
      <ReturnAssetModal isOpen={!!returning} onClose={() => setReturning(null)} asset={returning} onReturned={(updated) => { syncAsset(updated); setReturning(updated); }} />
      <AssetHistoryModal isOpen={!!historyAsset} onClose={() => setHistoryAsset(null)} asset={historyAsset} />
      <AssetDetailModal isOpen={!!viewingAsset} onClose={() => setViewingAsset(null)} asset={viewingAsset} />
    </Card>
  );
}

function ManagerAssetsReadOnly() {
  const { assets } = useApp();
  const [historyAsset, setHistoryAsset] = useState(null);
  const [viewingAsset, setViewingAsset] = useState(null);
  const { query, setQuery, typeFilter, setTypeFilter, statusFilter, setStatusFilter, filtered } = useAssetFilters(assets);

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-display font-bold text-base">Team Assets</h3>
          <p className="text-xs text-muted mt-0.5">Assets currently assigned to your direct reports (read only).</p>
        </div>
        <Badge tone="neutral">Read Only</Badge>
      </div>
      <AssetSearchFilterBar query={query} setQuery={setQuery} typeFilter={typeFilter} setTypeFilter={setTypeFilter}
        statusFilter={statusFilter} setStatusFilter={setStatusFilter} statusOptions={['Available', 'In Use', 'Out of Stock', 'Maintenance', 'Retired']} />
      <AssetsGrid assetList={filtered} mode="manager-readonly" onView={(a) => setViewingAsset(a)} onHistory={(a) => setHistoryAsset(a)} />
      <AssetHistoryModal isOpen={!!historyAsset} onClose={() => setHistoryAsset(null)} asset={historyAsset} />
      <AssetDetailModal isOpen={!!viewingAsset} onClose={() => setViewingAsset(null)} asset={viewingAsset} />
    </Card>
  );
}

function EmployeeAssetsAssigned() {
  const { assets } = useApp();
  const [viewingAsset, setViewingAsset] = useState(null);
  return (
    <Card>
      <h3 className="font-display font-bold text-base mb-1">Assets Assigned to Me</h3>
      <p className="text-xs text-muted mb-4">Company equipment currently checked out under your name.</p>
      <AssetsGrid assetList={assets} mode="employee-readonly" onView={(a) => setViewingAsset(a)} />
      <AssetDetailModal isOpen={!!viewingAsset} onClose={() => setViewingAsset(null)} asset={viewingAsset} />
    </Card>
  );
}

/* ============================== LIVE VIEW & SCREENSHOTS (activity monitoring) ============================== */

function useLiveView(pollMs = 5000) {
  const [tiles, setTiles] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const data = await api.activity.liveView();
        if (alive) setTiles(data);
      } catch (e) { /* transient network hiccups shouldn't crash the view */ }
      finally { if (alive) setLoading(false); }
    };
    poll();
    const interval = setInterval(poll, pollMs);
    return () => { alive = false; clearInterval(interval); };
  }, [pollMs]);
  return { tiles, loading };
}

function LiveTile({ tile }) {
  const resolvedUrl = tile.frameUrl ? api.uploads.fileUrl(tile.frameUrl) : null;
  return (
    <div className="rounded-xl overflow-hidden border border-[var(--border)]">
      <div className="aspect-video flex items-center justify-center relative" style={{ background: 'var(--bg)' }}>
        {resolvedUrl ? (
          <img src={resolvedUrl} alt={tile.employeeName} className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-muted">
            <Laptop size={22} />
            <span className="text-[10px] font-medium">Waiting for first frame…</span>
          </div>
        )}
        <span className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold" style={{ background: 'rgba(0,0,0,0.65)', color: '#fff' }}>
          <span className="pulse-dot pulse-active" style={{ width: 6, height: 6, background: 'var(--success)' }} /> LIVE
        </span>
      </div>
      <div className="p-2.5">
        <div className="text-xs font-semibold truncate">{tile.employeeName}</div>
        <div className="text-[10px] text-muted truncate">{tile.department}</div>
        {tile.capturedAt && <div className="text-[9px] text-muted mt-1">Updated {new Date(tile.capturedAt).toLocaleTimeString()}</div>}
      </div>
    </div>
  );
}

function LiveViewSection({
  title,
  subtitle,
  limit,
  onViewAll,
  showFilters = false,
  employeeOptions = []
}) {
  const { tiles, loading } = useLiveView(5000);

  const [query, setQuery] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');

  const filteredTiles = tiles.filter(tile => {
    if (
      employeeFilter &&
      Number(tile.employeeId) !== Number(employeeFilter)
    ) {
      return false;
    }

    if (query) {
      const q = query.toLowerCase();

      const haystack = `
        ${tile.employeeName || ''}
        ${tile.department || ''}
        ${tile.deviceName || ''}
      `.toLowerCase();

      if (!haystack.includes(q)) {
        return false;
      }
    }

    return true;
  });

  const shown = limit
    ? filteredTiles.slice(0, limit)
    : filteredTiles;

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-display font-bold text-base flex items-center gap-2">
            <Radio size={16} className="accent-text" />
            {title}
          </h3>

          {subtitle && (
            <p className="text-xs text-muted mt-0.5">
              {subtitle}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Badge tone={filteredTiles.length > 0 ? 'success' : 'neutral'}>
            {filteredTiles.length} Active
          </Badge>

          {onViewAll && (
            <button
              onClick={onViewAll}
              className="text-xs font-bold accent-text"
            >
              View All
            </button>
          )}
        </div>
      </div>

      {showFilters && (
        <div className="flex flex-wrap items-end gap-2 mb-4 w-full">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1">
              Search
            </label>

            <div className="relative">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
              />

              <input
                className={`${inputCls} pl-7 h-9`}
                placeholder="Search employee or device…"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="w-[180px]">
            <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1">
              Employee
            </label>

            <select
              className={`${inputCls} h-9`}
              value={employeeFilter}
              onChange={e => setEmployeeFilter(e.target.value)}
            >
              <option value="">All Employees</option>

              {employeeOptions.map(e => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>

          {(query || employeeFilter) && (
            <button
              onClick={() => {
                setQuery('');
                setEmployeeFilter('');
              }}
              className="h-9 px-3 rounded-lg text-xs font-bold border border-[var(--border)] hover-surface"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="py-10 text-center text-sm text-muted">
          Loading…
        </div>
      ) : shown.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted">
          {tiles.length === 0
            ? 'No employees are currently active.'
            : 'No active employees match your filter.'}
        </div>
      ) : (
        <div className={`grid gap-4 ${limit ? 'grid-cols-2' : 'grid-cols-3'}`}>
          {shown.map(t => (
            <LiveTile
              key={t.employeeId}
              tile={t}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function LiveViewPage({ title, subtitle, employeeOptions = [] }) {
  return (
    <LiveViewSection
      title={title}
      subtitle={subtitle}
      showFilters
      employeeOptions={employeeOptions}
    />
  );
}

function ScreenshotsSection({ title, subtitle, limit, employeeOptions, showFilters, onViewAll }) {
  const [shots, setShots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.activity.screenshots({ employeeId: employeeFilter || undefined, date: dateFilter || undefined, limit: limit || 60 });
      setShots(data);
    } catch (e) { /* ignore */ }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [employeeFilter, dateFilter]);

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-display font-bold text-base flex items-center gap-2">
            <Camera size={16} className="accent-text" /> {title}
          </h3>
          {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
        </div>
        {onViewAll && <button onClick={onViewAll} className="text-xs font-bold accent-text shrink-0">View All</button>}
      </div>
      {showFilters && (
  <div className="flex flex-wrap items-end gap-2 mb-4 w-full">
    <div className="flex-1 min-w-[220px]">
      <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1">
        Employee
      </label>

      <select
        className={`${inputCls} h-9`}
        value={employeeFilter}
        onChange={e => setEmployeeFilter(e.target.value)}
      >
        <option value="">All Employees</option>

        {employeeOptions.map(e => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
    </div>

    <div className="w-[180px]">
      <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1">
        Capture Date
      </label>

      <input
        type="date"
        className={`${inputCls} h-9`}
        value={dateFilter}
        onChange={e => setDateFilter(e.target.value)}
      />
    </div>

    {(employeeFilter || dateFilter) && (
      <button
        onClick={() => {
          setEmployeeFilter('');
          setDateFilter('');
        }}
        className="h-9 px-3 rounded-lg text-xs font-bold border border-[var(--border)] hover-surface"
      >
        Clear
      </button>
    )}
  </div>
)}
      {loading ? (
        <div className="py-10 text-center text-sm text-muted">Loading…</div>
      ) : shots.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted">No screenshots match this filter.</div>
      ) : (
        <div className="grid grid-cols-4 gap-3">
          {shots.map(s => (
            <ScreenshotEvidence key={s.id} url={s.url} variant="tile"
              filename={`${s.employeeName} — ${new Date(s.capturedAt).toLocaleString()}`}
              caption={`${s.employeeName} · ${new Date(s.capturedAt).toLocaleTimeString()}`} />
          ))}
        </div>
      )}
    </Card>
  );
}

function ScreenshotsPage({ title, subtitle, employeeOptions: overrideOptions }) {
  const { users, currentUser } = useApp();
  const employeeOptions = overrideOptions || users.filter(u => u.role === 'Employee');
  return <ScreenshotsSection title={title} subtitle={subtitle} employeeOptions={employeeOptions} showFilters />;
}

function AdminLiveView() {
  const { users } = useApp();

  const employeeOptions = users.filter(
    u => u.role === 'Employee'
  );

  return (
    <LiveViewPage
      title="Live Desktop View"
      subtitle="Employees currently in an active work session, organization-wide."
      employeeOptions={employeeOptions}
    />
  );
}
function AdminScreenshots() {
  return <ScreenshotsPage title="Screenshots" subtitle="Scheduled desktop captures across the organization." />;
}
function ManagerLiveView() {
  const { users, currentUser } = useApp();

  const employeeOptions = users.filter(
    u =>
      u.role === 'Employee' &&
      u.managerId === currentUser.id
  );

  return (
    <LiveViewPage
      title="Team Live View"
      subtitle="Your direct reports who are currently in an active work session."
      employeeOptions={employeeOptions}
    />
  );
}
function ManagerScreenshots() {
  const { users, currentUser } = useApp();
  const teamOptions = users.filter(u => u.role === 'Employee' && u.managerId === currentUser.id);
  return <ScreenshotsPage title="Team Screenshots" subtitle="Scheduled desktop captures from your direct reports." employeeOptions={teamOptions} />;
}

function WebUsagePage({
  title = 'Web Usage / Internet Activity',
  subtitle = 'Recorded browser activity from monitored devices.'
}) {
  const { users, currentUser } = useApp();

  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');

  const employeeOptions =
    currentUser.role === 'Manager'
      ? users.filter(
          u => u.role === 'Employee' && u.managerId === currentUser.id
        )
      : users.filter(u => u.role === 'Employee');

  const load = async () => {
    setLoading(true);

    try {
      const data = await api.activity.webUsage({
        employeeId: employeeFilter || undefined,
        date: dateFilter || undefined,
      });

      const visible =
        currentUser.role === 'Manager'
          ? data.filter(log =>
              employeeOptions.some(
                e => Number(e.id) === Number(log.employeeId)
              )
            )
          : data;

      setLogs(visible);
    } catch (e) {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [employeeFilter, dateFilter, currentUser.id]);

  const filteredLogs = logs.filter(log => {
    if (!query) return true;

    const q = query.toLowerCase();

    const haystack = `
      ${log.employeeName || ''}
      ${log.title || ''}
      ${log.url || ''}
      ${log.domain || ''}
    `.toLowerCase();

    return haystack.includes(q);
  });

  const clearFilters = () => {
    setQuery('');
    setEmployeeFilter('');
    setDateFilter('');
  };

  return (
    <Card className="w-full">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-display font-bold text-base flex items-center gap-2">
            <Globe2 size={16} className="accent-text" />
            {title}
          </h3>

          <p className="text-xs text-muted mt-0.5">
            {subtitle}
          </p>
        </div>

        <button
          onClick={load}
          className="p-2 rounded-lg hover-surface"
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2 mb-4 w-full">

        {/* Search */}
        <div className="flex-1 min-w-[240px]">
          <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1">
            Search
          </label>

          <div className="relative">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
            />

            <input
              className={`${inputCls} pl-7 h-9`}
              placeholder="Search employee, website, or URL…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Employee */}
        <div className="w-[190px]">
          <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1">
            Employee
          </label>

          <select
            className={`${inputCls} h-9`}
            value={employeeFilter}
            onChange={e => setEmployeeFilter(e.target.value)}
          >
            <option value="">All Employees</option>

            {employeeOptions.map(employee => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
              </option>
            ))}
          </select>
        </div>

        {/* Date */}
        <div className="w-[180px]">
          <label className="block text-[10px] font-bold text-muted uppercase tracking-wider mb-1">
            Activity Date
          </label>

          <input
            type="date"
            className={`${inputCls} h-9`}
            value={dateFilter}
            onChange={e => setDateFilter(e.target.value)}
          />
        </div>

        {/* Clear */}
        {(query || employeeFilter || dateFilter) && (
          <button
            onClick={clearFilters}
            className="h-9 px-3 rounded-lg text-xs font-bold border border-[var(--border)] hover-surface"
          >
            Clear
          </button>
        )}
      </div>

      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-bold text-muted uppercase tracking-wider">
          {filteredLogs.length} {filteredLogs.length === 1 ? 'Record' : 'Records'}
        </span>
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-muted">
          Loading web activity…
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted">
          {logs.length === 0
            ? 'No web usage records found.'
            : 'No records match your filters.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="font-bold text-muted uppercase tracking-wider border-b border-[var(--border)]">
                <th className="pb-2.5 px-2">Employee</th>
                <th className="pb-2.5 px-2">Website / Activity</th>
                <th className="pb-2.5 px-2">URL</th>
                <th className="pb-2.5 px-2">Time</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-[var(--border)]">
              {filteredLogs.map((log, index) => (
                <tr
                  key={log.id || index}
                  className="hover:bg-[var(--bg)] transition-colors"
                >
                  <td className="py-3 px-2 font-semibold">
                    {log.employeeName || 'Unknown Employee'}
                  </td>

                  <td className="py-3 px-2">
                    <div className="font-semibold">
                      {log.title || log.domain || 'Web Activity'}
                    </div>

                    {log.domain && (
                      <div className="text-[10px] text-muted">
                        {log.domain}
                      </div>
                    )}
                  </td>

                  <td className="py-3 px-2 text-muted max-w-[360px]">
                    <div className="truncate">
                      {log.url || '—'}
                    </div>
                  </td>

                  <td className="py-3 px-2 text-muted whitespace-nowrap">
                    {log.timestamp ||
                      log.createdAt ||
                      log.capturedAt ||
                      '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ============================== LAYOUT GUARD & ENTRYPOINT ============================== */

const PAGES = {
  admin: {
    dashboard: AdminDashboard,
    applications: AdminApplicationsAndSchedules,
    users: AdminUserManagement,
    tickets: AdminTickets,
    assets: AdminAssets,
    'live-view': AdminLiveView,
    screenshots: AdminScreenshots,
    'web-usage': WebUsagePage,
    'monitoring-settings': AdminMonitoringSettings
  },

  manager: {
    dashboard: ManagerDashboard,
    applications: ManagerApplicationsAndSchedules,
    tickets: ManagerTickets,
    assets: ManagerAssetsReadOnly,
    'live-view': ManagerLiveView,
    screenshots: ManagerScreenshots,
    'web-usage': WebUsagePage
  },

  employee: {
    dashboard: EmployeeDashboard,
    wfh: EmployeeWFHAndSchedule,
    tickets: EmployeeTickets,
    assets: EmployeeAssetsAssigned
  },
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
  const [theme, setTheme] = useState(
  () => localStorage.getItem('remote_ops_theme') || 'dark'
  );
  const [currentUser, setCurrentUser] = useState(null);
  const [section, setSection] = useState('login');
  const [page, setPage] = useState('dashboard');
  const [dataLoaded, setDataLoaded] = useState(false);

  useEffect(() => {
  localStorage.setItem('remote_ops_theme', theme);
  }, [theme]);

  const [users, setUsers] = useState([]);
  const [applications, setApplications] = useState([]);
  const [timeSessions, setTimeSessions] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [assets, setAssets] = useState([]);
  const [toasts, setToasts] = useState([]);

  const addToast = (message, type = 'info') => {
    const id = nextId();
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  };

  const navigate = (sec, pg) => { setSection(sec); setPage(pg); };

  const loadWorkspace = async () => {
    const [u, a, s, n, t, ast] = await Promise.all([
      api.users.list(), api.applications.list(), api.timeSessions.list(), api.notifications.list(),
      api.tickets.list(), api.assets.list(),
    ]);
    setUsers(u); setApplications(a); setTimeSessions(s); setNotifications(n); setTickets(t); setAssets(ast);
  };

  // On first mount: if a token is already stored (returning session), restore it.
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
          setToken(null); // stale/expired token
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
      try { await api.users.setMyStatus('inactive'); } catch (e) { /* best-effort */ }
    }
    setToken(null);
    setCurrentUser(null);
    setSection('login');
    setUsers([]); setApplications([]); setTimeSessions([]); setNotifications([]); setTickets([]); setAssets([]);
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
    tickets, setTickets, assets, setAssets,
  };

  return (
    <AppCtx.Provider value={ctx}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap');

        /* CSS Global Reset */
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