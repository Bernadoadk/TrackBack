// ---------- Shared UI primitives ----------
const { useState, useEffect, useRef, useMemo, useCallback, createContext, useContext } = React;

// ---- Icon wrapper around lucide vanilla ----
function Icon({ name, size = 16, className = '', strokeWidth = 2, style }) {
  // Lucide UMD exposes window.lucide.icons[NameInPascal] as IconNode = [[tag, attrs], ...]
  const data = (window.lucide && window.lucide.icons && window.lucide.icons[name]) || null;
  // Lucide UMD icon shape is [tag, attrs, childrenArray] — children is what we want
  const children = Array.isArray(data) && Array.isArray(data[2]) ? data[2] : [];
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size}
      viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      className={className} style={style} aria-hidden="true">
      {children.map((child, i) => {
        const [tag, attrs] = child;
        return React.createElement(tag, { key: i, ...attrs });
      })}
    </svg>
  );
}

// ---- Status badge ----
const STATUS_STYLES = {
  PENDING: { bg: 'rgba(245,158,11,0.12)', text: '#F59E0B', dot: '#F59E0B' },
  APPROVED: { bg: 'rgba(59,130,246,0.12)', text: '#3B82F6', dot: '#3B82F6' },
  RECEIVED: { bg: 'rgba(139,92,246,0.12)', text: '#8B5CF6', dot: '#8B5CF6' },
  REFUNDED: { bg: 'rgba(34,197,94,0.12)', text: '#22C55E', dot: '#22C55E' },
  REJECTED: { bg: 'rgba(239,68,68,0.12)', text: '#EF4444', dot: '#EF4444' },
};
function StatusBadge({ status, size = 'sm' }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.PENDING;
  const cls = size === 'lg' ? 'text-xs px-2.5 py-1' : 'text-[10.5px] px-2 py-0.5';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded font-semibold tracking-wide ${cls}`}
      style={{ background: s.bg, color: s.text }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.dot }}></span>
      {status}
    </span>
  );
}

// ---- Toast ----
const ToastCtx = createContext(null);
function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((toast) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, ...toast }]);
    setTimeout(() => setToasts((t) => t.filter(x => x.id !== id)), toast.duration || 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => {
          const kindColor = t.kind === 'success' ? '#22C55E' : t.kind === 'error' ? '#EF4444' : t.kind === 'warn' ? '#F59E0B' : '#6C63FF';
          const kindIcon = t.kind === 'success' ? 'Check' : t.kind === 'error' ? 'X' : t.kind === 'warn' ? 'TriangleAlert' : 'Info';
          return (
            <div key={t.id} className="pointer-events-auto animate-slideUp flex items-start gap-3 bg-elevated border border-border rounded-lg shadow-pop px-4 py-3 min-w-[280px] max-w-sm">
              <div className="mt-0.5 w-5 h-5 rounded-full grid place-content-center" style={{ background: kindColor + '22', color: kindColor }}>
                <Icon name={kindIcon} size={12} strokeWidth={3} />
              </div>
              <div className="flex-1">
                <div className="text-[13px] font-semibold text-ink">{t.title}</div>
                {t.body && <div className="text-[12px] text-muted mt-0.5">{t.body}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
const useToast = () => useContext(ToastCtx);

// ---- Modal ----
function Modal({ open, onClose, title, children, footer, width = 'max-w-md' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center p-4 animate-fadeIn" style={{ background: 'rgba(8,10,15,0.7)' }} onClick={onClose}>
      <div className={`w-full ${width} bg-elevated border border-border rounded-xl shadow-pop animate-slideUp`} onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="text-[15px] font-semibold text-ink">{title}</div>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors p-1 -mr-1 rounded hover:bg-white/5">
            <Icon name="X" size={16} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="px-5 py-3.5 border-t border-border flex items-center justify-end gap-2 bg-black/10 rounded-b-xl">{footer}</div>}
      </div>
    </div>
  );
}

// ---- Buttons ----
function Btn({ variant = 'primary', size = 'md', children, className = '', icon, iconRight, ...rest }) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-all whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed';
  const sizes = { sm: 'h-8 px-3 text-[12.5px]', md: 'h-9 px-3.5 text-[13px]', lg: 'h-11 px-5 text-sm' };
  const variants = {
    primary: 'bg-accent hover:bg-accent2 text-white shadow-[0_1px_0_rgba(255,255,255,0.15)_inset,0_4px_12px_rgba(108,99,255,0.25)]',
    secondary: 'bg-elevated hover:bg-[#2a2e44] text-ink border border-border',
    ghost: 'text-ink hover:bg-white/5',
    ok: 'bg-ok hover:bg-[#1eb158] text-white shadow-[0_1px_0_rgba(255,255,255,0.15)_inset]',
    danger: 'bg-danger hover:bg-[#dc3a3a] text-white',
    'danger-outline': 'bg-transparent text-danger hover:bg-danger/10 border border-danger/40',
    subtle: 'bg-white/[0.04] hover:bg-white/[0.07] text-ink',
  };
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...rest}>
      {icon && <Icon name={icon} size={size === 'lg' ? 16 : 14} />}
      {children}
      {iconRight && <Icon name={iconRight} size={size === 'lg' ? 16 : 14} />}
    </button>
  );
}

// ---- Toggle ----
function Toggle({ checked, onChange, label, description }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer select-none">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className="relative shrink-0 mt-0.5 w-9 h-5 rounded-full transition-colors"
        style={{ background: checked ? '#6C63FF' : '#2E3148' }}
        aria-pressed={checked}>
        <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow"
          style={{ transform: checked ? 'translateX(16px)' : 'translateX(0)' }} />
      </button>
      {(label || description) && (
        <div className="flex-1 min-w-0">
          {label && <div className="text-[13.5px] text-ink leading-tight">{label}</div>}
          {description && <div className="text-[12px] text-muted mt-0.5">{description}</div>}
        </div>
      )}
    </label>
  );
}

// ---- Input / Textarea / Select ----
function Input(props) {
  const { className = '', ...rest } = props;
  return <input {...rest} className={`w-full h-9 px-3 text-[13px] rounded-md bg-bg border border-border text-ink placeholder:text-faint focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition ${className}`} />;
}
function Textarea(props) {
  const { className = '', rows = 4, ...rest } = props;
  return <textarea rows={rows} {...rest} className={`w-full px-3 py-2.5 text-[13px] rounded-md bg-bg border border-border text-ink placeholder:text-faint focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition resize-none ${className}`} />;
}
function Select({ value, onChange, options, className = '' }) {
  return (
    <div className={`relative ${className}`}>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="appearance-none w-full h-9 pl-3 pr-8 text-[13px] rounded-md bg-bg border border-border text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition cursor-pointer">
        {options.map(o => typeof o === 'string'
          ? <option key={o} value={o}>{o}</option>
          : <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted">
        <Icon name="ChevronDown" size={14} />
      </div>
    </div>
  );
}

// ---- Card ----
function Card({ title, subtitle, action, children, className = '', padding = 'p-5' }) {
  return (
    <div className={`bg-surface border border-border rounded-lg ${className}`}>
      {(title || action) && (
        <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-3">
          <div>
            {title && <div className="text-[14px] font-semibold text-ink">{title}</div>}
            {subtitle && <div className="text-[12px] text-muted mt-0.5">{subtitle}</div>}
          </div>
          {action}
        </div>
      )}
      <div className={title ? 'px-5 pb-5' : padding}>{children}</div>
    </div>
  );
}

// ---- Sidebar ----
const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
  { key: 'returns', label: 'Returns', icon: 'Package', badge: 'pending' },
  { key: 'analytics', label: 'Analytics', icon: 'ChartLine' },
  { key: 'settings', label: 'Settings', icon: 'Settings' },
  { key: 'billing', label: 'Billing', icon: 'CreditCard' },
];

function Sidebar({ active, onNavigate, pendingCount, onOpenPortal }) {
  return (
    <aside className="hidden md:flex flex-col w-[232px] shrink-0 h-screen sticky top-0 bg-surface border-r border-border">
      {/* Logo */}
      <div className="px-5 h-16 flex items-center gap-2.5 border-b border-divider">
        <div className="w-7 h-7 rounded-md grid place-content-center text-white"
          style={{ background: 'linear-gradient(135deg, #6C63FF 0%, #8B5CF6 100%)', boxShadow: '0 4px 14px rgba(108,99,255,0.35)' }}>
          <Icon name="RefreshCcw" size={15} strokeWidth={2.5} />
        </div>
        <div>
          <div className="text-[15px] font-semibold text-ink leading-tight tracking-tight">TrackBack</div>
          <div className="text-[10px] text-muted leading-tight">Shopify · v1.4</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        <div className="px-2 mb-1.5 text-[10px] uppercase tracking-[0.08em] text-faint font-semibold">Workspace</div>
        {NAV.map(item => {
          const isActive = active === item.key;
          return (
            <button key={item.key} onClick={() => onNavigate(item.key)}
              className={`w-full group flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] transition-colors relative ${isActive ? 'text-ink' : 'text-muted hover:text-ink hover:bg-white/[0.03]'
                }`}
              style={isActive ? { background: 'rgba(108,99,255,0.12)' } : undefined}>
              {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-accent" />}
              <Icon name={item.icon} size={15} className={isActive ? 'text-accent2' : ''} strokeWidth={isActive ? 2.25 : 2} />
              <span className="flex-1 text-left font-medium">{item.label}</span>
              {item.badge === 'pending' && pendingCount > 0 && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                  style={{ background: 'rgba(245,158,11,0.16)', color: '#F59E0B' }}>{pendingCount}</span>
              )}
            </button>
          );
        })}

        <div className="px-2 mt-6 mb-1.5 text-[10px] uppercase tracking-[0.08em] text-faint font-semibold">Tools</div>
        <button onClick={onOpenPortal}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] text-muted hover:text-ink hover:bg-white/[0.03] transition-colors">
          <Icon name="ExternalLink" size={15} />
          <span className="flex-1 text-left font-medium">Preview portal</span>
        </button>
        <a className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] text-muted hover:text-ink hover:bg-white/[0.03] transition-colors cursor-pointer">
          <Icon name="BookOpen" size={15} />
          <span className="flex-1 text-left font-medium">Docs</span>
        </a>
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-divider">
        <div className="flex items-center gap-2.5 p-2 rounded-md hover:bg-white/[0.03] transition-colors cursor-pointer">
          <div className="w-8 h-8 rounded-md grid place-content-center text-[12px] font-bold text-white"
            style={{ background: 'linear-gradient(135deg,#3B82F6,#6C63FF)' }}>AS</div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-ink truncate leading-tight">Acme Store</div>
            <div className="text-[11px] text-muted truncate">Free plan · 8/10 used</div>
          </div>
          <Icon name="Settings" size={14} className="text-muted" />
        </div>
      </div>
    </aside>
  );
}

// ---- Page header (used by most admin pages) ----
function PageHeader({ title, subtitle, right }) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
      <div>
        <h1 className="text-[22px] font-semibold text-ink leading-tight tracking-tight">{title}</h1>
        {subtitle && <div className="text-[13px] text-muted mt-1">{subtitle}</div>}
      </div>
      {right && <div className="flex items-center gap-2 flex-wrap">{right}</div>}
    </div>
  );
}

// Export to window
Object.assign(window, {
  Icon, StatusBadge, Modal, Btn, Toggle, Input, Textarea, Select, Card, Sidebar, PageHeader,
  ToastProvider, useToast, NAV, STATUS_STYLES,
});
