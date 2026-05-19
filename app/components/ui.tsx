import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react';
import { icons } from 'lucide-react';
import { Link, useLocation, useFetcher } from 'react-router';

// ---- Icon wrapper around lucide-react ----
export function Icon({ name, size = 16, className = '', strokeWidth = 2, style }: any) {
  const LucideIcon = (icons as any)[name];
  if (!LucideIcon) return null;
  return <LucideIcon size={size} className={className} strokeWidth={strokeWidth} style={style} />;
}

// ---- Status badge ----
export const STATUS_STYLES: Record<string, any> = {
  PENDING:  { bg: 'rgba(245,158,11,0.12)',  text: '#F59E0B', dot: '#F59E0B' },
  APPROVED: { bg: 'rgba(59,130,246,0.12)',  text: '#3B82F6', dot: '#3B82F6' },
  SHIPPED:  { bg: 'rgba(16,185,129,0.12)',  text: '#10B981', dot: '#10B981' },
  RECEIVED: { bg: 'rgba(139,92,246,0.12)',  text: '#8B5CF6', dot: '#8B5CF6' },
  REFUNDED: { bg: 'rgba(34,197,94,0.12)',   text: '#22C55E', dot: '#22C55E' },
  REJECTED: { bg: 'rgba(239,68,68,0.12)',   text: '#EF4444', dot: '#EF4444' },
  EXPIRED:  { bg: 'rgba(107,114,128,0.12)', text: '#6B7280', dot: '#6B7280' },
};

export function StatusBadge({ status, size = 'sm' }: any) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.PENDING;
  const cls = size === 'lg' ? 'text-xs px-2.5 py-1' : 'text-[10.5px] px-2 py-0.5';
  const isLive = status === 'PENDING' || status === 'SHIPPED';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-semibold tracking-wide ${cls} transition-colors`}
          style={{ background: s.bg, color: s.text, boxShadow: `inset 0 0 0 1px ${s.dot}22` }}>
      <span className="relative w-1.5 h-1.5 rounded-full" style={{ background: s.dot }}>
        {isLive && (
          <span className="absolute inset-0 rounded-full animate-ping" style={{ background: s.dot, opacity: 0.6 }} />
        )}
      </span>
      {status}
    </span>
  );
}

// ---- Toast ----
const ToastCtx = createContext<any>(null);
export function ToastProvider({ children }: any) {
  const [toasts, setToasts] = useState<any[]>([]);
  const push = useCallback((toast: any) => {
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
          const kindIcon  = t.kind === 'success' ? 'Check' : t.kind === 'error' ? 'X' : t.kind === 'warn' ? 'TriangleAlert' : 'Info';
          return (
            <div key={t.id}
                 className="pointer-events-auto animate-slideInR flex items-start gap-3 rf-glass rounded-xl shadow-pop px-4 py-3 min-w-[280px] max-w-sm relative overflow-hidden">
              {/* tinted left rail */}
              <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: kindColor }} />
              <div className="mt-0.5 w-6 h-6 rounded-full grid place-content-center shrink-0 ring-1"
                   style={{ background: kindColor + '22', color: kindColor, boxShadow: `0 0 0 1px ${kindColor}33` }}>
                <Icon name={kindIcon} size={12} strokeWidth={3} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-ink leading-snug">{t.title}</div>
                {t.body && <div className="text-[12px] text-muted mt-0.5 leading-relaxed">{t.body}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---- Modal ----
export function Modal({ open, onClose, title, children, footer, width = 'max-w-md' }: any) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: any) => e.key === 'Escape' && onClose && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center p-4 animate-fadeIn"
         style={{ background: 'rgba(8,10,15,0.62)', backdropFilter: 'blur(6px) saturate(140%)', WebkitBackdropFilter: 'blur(6px) saturate(140%)' }}
         onClick={onClose}>
      <div className={`w-full ${width} bg-elevated border border-border rounded-2xl shadow-pop animate-scaleIn relative overflow-hidden`}
           onClick={(e) => e.stopPropagation()}>
        {/* gradient hairline on top */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="text-[15px] font-semibold text-ink tracking-tight">{title}</div>
          <button onClick={onClose}
                  className="text-muted hover:text-ink transition-colors p-1.5 -mr-1 rounded-md hover:bg-white/5 rf-press"
                  aria-label="Close">
            <Icon name="X" size={16} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="px-5 py-3.5 border-t border-border flex items-center justify-end gap-2 bg-black/10 rounded-b-2xl">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Buttons ----
export function Btn({ variant = 'primary', size = 'md', children, className = '', icon, iconRight, loading, ...rest }: any) {
  const base = 'group relative inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed select-none rf-press';
  const transition = 'transition-[background-color,box-shadow,border-color,color,transform] duration-150 ease-smooth';
  const sizes: Record<string, string> = { sm: 'h-8 px-3 text-[12.5px]', md: 'h-9 px-3.5 text-[13px]', lg: 'h-11 px-5 text-sm' };
  const variants: Record<string, string> = {
    primary:
      'text-white bg-gradient-to-b from-[#7B73FF] to-[#6259EE] hover:from-[#8B85FF] hover:to-[#6C63FF] ' +
      'shadow-[0_1px_0_rgba(255,255,255,0.18)_inset,0_6px_18px_-4px_rgba(108,99,255,0.45)] ' +
      'hover:shadow-[0_1px_0_rgba(255,255,255,0.22)_inset,0_10px_26px_-6px_rgba(108,99,255,0.55)]',
    secondary:
      'bg-elevated hover:bg-[#2a2e44] text-ink border border-border hover:border-[#3a3e58] ' +
      'shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]',
    ghost: 'text-ink hover:bg-white/[0.06]',
    ok:    'bg-ok hover:bg-[#1eb158] text-white shadow-[0_1px_0_rgba(255,255,255,0.15)_inset,0_4px_14px_-4px_rgba(34,197,94,0.45)]',
    danger:'bg-danger hover:bg-[#dc3a3a] text-white shadow-[0_1px_0_rgba(255,255,255,0.12)_inset,0_4px_14px_-4px_rgba(239,68,68,0.45)]',
    'danger-outline': 'bg-transparent text-danger hover:bg-danger/10 border border-danger/40 hover:border-danger/60',
    subtle:'bg-white/[0.04] hover:bg-white/[0.08] text-ink border border-white/[0.04]',
  };
  const iconSize = size === 'lg' ? 16 : 14;
  return (
    <button className={`${base} ${transition} ${sizes[size]} ${variants[variant]} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading ? (
        <Icon name="Loader2" size={iconSize} className="animate-spin" />
      ) : icon ? (
        <Icon name={icon} size={iconSize} className="transition-transform group-hover:-translate-x-[1px]" />
      ) : null}
      {children}
      {iconRight && !loading && (
        <Icon name={iconRight} size={iconSize} className="transition-transform group-hover:translate-x-[1px]" />
      )}
    </button>
  );
}

// ---- Toggle ----
export function Toggle({ checked, onChange, label, description }: any) {
  return (
    <div className="flex items-start gap-3 select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="relative shrink-0 mt-0.5 w-9 h-5 rounded-full transition-colors duration-200 ease-smooth"
        style={{
          background: checked ? '#6C63FF' : '#2E3148',
          boxShadow: checked
            ? '0 0 0 4px rgba(108,99,255,0.18), inset 0 1px 1px rgba(0,0,0,0.25)'
            : 'inset 0 1px 1px rgba(0,0,0,0.35)',
        }}>
        <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.35),0_0_0_1px_rgba(0,0,0,0.05)]"
              style={{
                transform: checked ? 'translateX(16px)' : 'translateX(0)',
                transition: 'transform .25s cubic-bezier(0.34, 1.56, 0.64, 1)',
              }} />
      </button>
      {(label || description) && (
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onChange(!checked)}>
          {label && <div className="text-[13.5px] text-ink leading-tight">{label}</div>}
          {description && <div className="text-[12px] text-muted mt-0.5 leading-relaxed">{description}</div>}
        </div>
      )}
    </div>
  );
}

// ---- Input / Textarea / Select ----
const FIELD_BASE = 'w-full text-[13px] rounded-md bg-bg/80 border border-border text-ink placeholder:text-faint ' +
  'hover:border-[#3a3e58] focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/25 focus:bg-bg ' +
  'transition-[border-color,box-shadow,background-color] duration-150 ease-smooth';

export function Input(props: any) {
  const { className = '', ...rest } = props;
  return <input {...rest} className={`${FIELD_BASE} h-9 px-3 ${className}`} />;
}
export function Textarea(props: any) {
  const { className = '', rows = 4, ...rest } = props;
  return <textarea rows={rows} {...rest} className={`${FIELD_BASE} px-3 py-2.5 resize-none ${className}`} />;
}
export function Select({ value, onChange, options, className = '' }: any) {
  return (
    <div className={`relative ${className}`}>
      <select value={value} onChange={(e) => onChange(e.target.value)}
              className={`${FIELD_BASE} appearance-none h-9 pl-3 pr-8 cursor-pointer`}>
        {options.map((o: any) => typeof o === 'string'
          ? <option key={o} value={o}>{o}</option>
          : <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted transition-transform duration-150 ease-smooth">
        <Icon name="ChevronDown" size={14} />
      </div>
    </div>
  );
}

// ---- Card ----
export function Card({ title, subtitle, action, children, className = '', padding = 'p-5', hoverable = false }: any) {
  return (
    <div className={`bg-surface border border-border rounded-xl rf-hairline ${hoverable ? 'rf-lift hover:border-[#3a3e58]' : ''} ${className}`}>
      {(title || action) && (
        <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-3">
          <div>
            {title && <div className="text-[14px] font-semibold text-ink tracking-tight">{title}</div>}
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
const PLAN_LEVEL: Record<string, number> = { free: 0, starter: 1, pro: 2 };

export const NAV = [
  { key: 'dashboard',        path: '/app',                  label: 'Dashboard',        icon: 'LayoutDashboard' },
  { key: 'returns',          path: '/app/returns',          label: 'Returns',          icon: 'Package', badge: 'pending' },
  { key: 'messages',         path: '/app/messages',         label: 'Messages',         icon: 'MessageCircle', badge: 'unread' },
  { key: 'analytics',        path: '/app/analytics',        label: 'Analytics',        icon: 'ChartLine' },
  { key: 'portal-editor',    path: '/app/portal-editor',    label: 'Portal Editor',    icon: 'Paintbrush',   requiredPlan: 'starter' },
  { key: 'email-templates',  path: '/app/email-templates',  label: 'Email Templates',  icon: 'Mail',         requiredPlan: 'starter' },
  { key: 'settings',         path: '/app/settings',         label: 'Settings',         icon: 'Settings' },
  { key: 'billing',          path: '/app/billing',          label: 'Billing',          icon: 'CreditCard' },
];

export function Sidebar({ pendingCount, unreadCount = 0, shop, shopName, planName, usedThisMonth, planLimit, onboardingStatus }: any) {
  const location = useLocation();
  const currentPath = location.pathname;

  return (
    <aside className="hidden md:flex flex-col w-[232px] shrink-0 h-screen sticky top-0 bg-surface border-r border-border relative">
      {/* Subtle gradient sheen on top edge */}
      <div className="pointer-events-none absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent/30 to-transparent" />

      {/* Logo */}
      <div className="px-4 h-20 flex items-center justify-center border-b border-divider">
        <img
          src="/returnflow_logo.png"
          alt="ReturnFlow"
          className="h-12 w-auto object-contain select-none"
          draggable={false}
        />
      </div>

      {/* Onboarding incomplete banner */}
      {onboardingStatus === 'skipped' && (
        <Link to={`/app/onboarding${location.search}`}
              className="mx-3 mt-3 group flex items-start gap-2.5 px-3 py-2.5 rounded-lg border transition hover:bg-warn/15"
              style={{ background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.25)' }}>
          <div className="w-6 h-6 rounded-md grid place-content-center shrink-0"
               style={{ background: 'rgba(245,158,11,0.18)', color: '#F59E0B' }}>
            <Icon name="TriangleAlert" size={12} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11.5px] font-semibold" style={{ color: '#F59E0B' }}>Setup incomplete</div>
            <div className="text-[11px] text-muted mt-0.5 leading-snug">Finish setup so refunds work properly.</div>
          </div>
          <Icon name="ChevronRight" size={12} className="text-faint mt-1 group-hover:translate-x-0.5 transition-transform" />
        </Link>
      )}

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        <div className="px-2 mb-1.5 text-[10px] uppercase tracking-[0.1em] text-faint font-semibold">Workspace</div>
        {NAV.map(item => {
          const isActive = item.path === '/app' ? currentPath === '/app' : currentPath.startsWith(item.path);
          const isLocked = !!(item.requiredPlan && (PLAN_LEVEL[planName] ?? 0) < (PLAN_LEVEL[item.requiredPlan] ?? 0));
          return (
            <Link key={item.key} to={`${item.path}${location.search}`}
                    className={`w-full group flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] relative
                      transition-[background-color,color,transform] duration-200 ease-smooth
                      ${isActive ? 'text-ink' : 'text-muted hover:text-ink hover:bg-white/[0.04] hover:translate-x-[1px]'}`}
                    style={isActive ? {
                      background: 'linear-gradient(90deg, rgba(108,99,255,0.18), rgba(108,99,255,0.06))',
                    } : undefined}>
              {isActive && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-r-full bg-gradient-to-b from-accent2 to-accent shadow-[0_0_10px_rgba(108,99,255,0.6)]" />
              )}
              <Icon name={item.icon} size={15}
                    className={`${isActive ? 'text-accent2' : 'group-hover:text-ink'} transition-colors`}
                    strokeWidth={isActive ? 2.25 : 2} />
              <span className="flex-1 text-left font-medium">{item.label}</span>
              {item.badge === 'pending' && pendingCount > 0 && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md ring-1 ring-inset ring-warn/20"
                      style={{ background: 'rgba(245,158,11,0.16)', color: '#F59E0B' }}>{pendingCount}</span>
              )}
              {item.badge === 'unread' && unreadCount > 0 && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md ring-1 ring-inset"
                      style={{ background: 'rgba(239,68,68,0.18)', color: '#EF4444', boxShadow: '0 0 0 1px rgba(239,68,68,0.2) inset' }}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
              {isLocked && (
                <Icon name="Lock" size={11} className="text-faint shrink-0" />
              )}
            </Link>
          );
        })}

        <div className="px-2 mt-6 mb-1.5 text-[10px] uppercase tracking-[0.1em] text-faint font-semibold">Tools</div>
        <a href={`/portal?shop=${shop}`} target="_blank" rel="noreferrer"
                className="group w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] text-muted hover:text-ink hover:bg-white/[0.04] hover:translate-x-[1px] transition-all duration-200 ease-smooth">
          <Icon name="ExternalLink" size={15} className="group-hover:text-accent2 transition-colors" />
          <span className="flex-1 text-left font-medium">Preview portal</span>
        </a>
        <Link to={`/app/docs${location.search}`}
                className={`group w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] relative
                  transition-[background-color,color,transform] duration-200 ease-smooth
                  ${currentPath.startsWith('/app/docs') ? 'text-ink' : 'text-muted hover:text-ink hover:bg-white/[0.04] hover:translate-x-[1px]'}`}
                style={currentPath.startsWith('/app/docs') ? {
                  background: 'linear-gradient(90deg, rgba(108,99,255,0.18), rgba(108,99,255,0.06))',
                } : undefined}>
          {currentPath.startsWith('/app/docs') && (
            <span className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-r-full bg-gradient-to-b from-accent2 to-accent shadow-[0_0_10px_rgba(108,99,255,0.6)]" />
          )}
          <Icon name="BookOpen" size={15}
                className={`${currentPath.startsWith('/app/docs') ? 'text-accent2' : 'group-hover:text-ink'} transition-colors`}
                strokeWidth={currentPath.startsWith('/app/docs') ? 2.25 : 2} />
          <span className="flex-1 text-left font-medium">Docs</span>
        </Link>
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-divider">
        <div className="flex items-center gap-2.5 p-2 rounded-md hover:bg-white/[0.04] transition-colors cursor-pointer group">
          <div className="w-8 h-8 rounded-md grid place-content-center text-[12px] font-bold text-white shrink-0
                          shadow-[0_4px_12px_-4px_rgba(59,130,246,0.5),inset_0_1px_0_rgba(255,255,255,0.2)]"
               style={{ background: 'linear-gradient(135deg,#3B82F6,#6C63FF)' }}>
            {shopName ? shopName.slice(0, 2).toUpperCase() : '??'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-ink truncate leading-tight">{shopName}</div>
            <div className="text-[11px] text-muted truncate capitalize">
              {planName} plan · {planLimit >= 999999 ? `${usedThisMonth} used` : `${usedThisMonth}/${planLimit} used`}
            </div>
          </div>
          <Icon name="Settings" size={14} className="text-muted group-hover:text-ink group-hover:rotate-45 transition-all duration-300 ease-smooth" />
        </div>
      </div>
    </aside>
  );
}

// ---- Page header (used by most admin pages) ----
export function PageHeader({ title, subtitle, right }: any) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap mb-6 animate-slideDown">
      <div>
        <h1 className="text-[22px] font-semibold text-ink leading-tight tracking-tight">
          {title}
        </h1>
        {subtitle && <div className="text-[13px] text-muted mt-1.5">{subtitle}</div>}
      </div>
      {right && <div className="flex items-center gap-2 flex-wrap">{right}</div>}
    </div>
  );
}

// ---- ColorPicker ----
const COLOR_PRESETS = [
  '#6C63FF', '#3B82F6', '#8B5CF6', '#EC4899',
  '#10B981', '#F59E0B', '#EF4444', '#0F172A',
  '#14B8A6', '#F97316', '#06B6D4', '#64748B',
];

export function ColorPicker({ label, hint, value, onChange, presets }: {
  label?: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  presets?: string[];
}) {
  const swatches = presets ?? COLOR_PRESETS;
  const isValid  = /^#[0-9A-Fa-f]{6}$/.test(value);

  return (
    <div>
      {label && <div className="text-[12px] font-semibold text-ink mb-0.5">{label}</div>}
      {hint  && <div className="text-[11px] text-muted mb-2">{hint}</div>}

      <div className="flex items-center gap-2 mb-3">
        {/* Swatch → opens native color picker */}
        <label className="relative cursor-pointer shrink-0 group">
          <div
            className="w-9 h-9 rounded-lg border-2 border-border shadow-sm group-hover:ring-2 group-hover:ring-accent/40 transition"
            style={{ background: isValid ? value : '#888' }}
          />
          <input
            type="color"
            value={isValid ? value : '#000000'}
            onChange={e => onChange(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
          />
        </label>

        {/* Hex input */}
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] font-mono text-faint select-none">#</span>
          <input
            type="text"
            value={value.replace(/^#/, '')}
            maxLength={6}
            placeholder="6C63FF"
            spellCheck={false}
            onChange={e => {
              const raw = e.target.value.replace(/[^0-9A-Fa-f]/g, '');
              onChange('#' + raw);
            }}
            className="w-[88px] h-9 pl-6 pr-2 rounded-lg border border-border bg-bg text-[13px] font-mono text-ink placeholder:text-faint focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition"
          />
        </div>

        {isValid && (
          <span className="text-[10.5px] font-mono text-muted hidden sm:inline">{value.toUpperCase()}</span>
        )}
      </div>

      {/* Preset swatches */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {swatches.map(c => {
          const active = value.toLowerCase() === c.toLowerCase();
          return (
            <button
              key={c}
              type="button"
              title={c}
              onClick={() => onChange(c)}
              className={`w-6 h-6 rounded-md transition-all ${
                active
                  ? 'scale-110 ring-2 ring-offset-1 ring-offset-surface ring-accent'
                  : 'hover:scale-105 hover:ring-1 hover:ring-muted/60'
              }`}
              style={{ background: c }}
            />
          );
        })}
      </div>
    </div>
  );
}

// ---- CloudinaryLogoUploader ----
const LOGO_ACCEPTED = ['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp'];
const LOGO_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

export function CloudinaryLogoUploader({ value, onUpload, onRemove }: {
  value: string;
  onUpload: (url: string) => void;
  onRemove: () => void;
}) {
  const fetcher    = useFetcher<any>();
  const inputRef   = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError]           = useState('');

  const isUploading = fetcher.state !== 'idle';

  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data) {
      if (fetcher.data.logoUrl) onUpload(fetcher.data.logoUrl);
      if (fetcher.data.removed)  onRemove();
    }
  }, [fetcher.state, fetcher.data]);

  const processFile = useCallback((file: File) => {
    setError('');
    if (!LOGO_ACCEPTED.includes(file.type)) {
      setError('Unsupported format. Use PNG, SVG, JPG or WebP.');
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setError('File too large (max 2 MB). Try a smaller image or SVG.');
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      const fd = new FormData();
      fd.append('intent', 'upload_logo');
      fd.append('base64', e.target?.result as string);
      fd.append('previousUrl', value);
      fetcher.submit(fd, { method: 'POST' });
    };
    reader.readAsDataURL(file);
  }, [value, fetcher]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleRemove = () => {
    const fd = new FormData();
    fd.append('intent', 'remove_logo');
    fd.append('logoUrl', value);
    fetcher.submit(fd, { method: 'POST' });
  };

  return (
    <div>
      <div className="text-[12px] font-semibold text-ink mb-1">Logo</div>
      <div className="text-[11px] text-muted mb-2">PNG, SVG, JPG, WebP — max 2 MB. Stored on Cloudinary.</div>

      {/* Existing logo preview */}
      {value && (
        <div className="flex items-center gap-3 mb-3 p-3 rounded-lg border border-border bg-white">
          <img src={value} alt="Logo" className="h-10 w-auto max-w-[140px] object-contain"
               onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          <div className="flex-1" />
          <button type="button" onClick={() => inputRef.current?.click()} disabled={isUploading}
                  className="h-7 px-2.5 rounded text-[11.5px] font-medium border border-border bg-bg hover:bg-surface transition flex items-center gap-1 disabled:opacity-50">
            <Icon name="RefreshCw" size={11} /> Change
          </button>
          <button type="button" onClick={handleRemove} disabled={isUploading}
                  className="h-7 w-7 rounded border border-border bg-bg hover:bg-red-50 hover:border-red-200 hover:text-red-500 transition flex items-center justify-center disabled:opacity-50">
            <Icon name="X" size={12} />
          </button>
        </div>
      )}

      {/* Drop zone — shown when no logo or uploading */}
      {!value && (
        <div
          role="button" tabIndex={0}
          onClick={() => !isUploading && inputRef.current?.click()}
          onKeyDown={e => e.key === 'Enter' && !isUploading && inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
          onDragEnter={e => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center justify-center gap-2 h-24 rounded-xl border-2 border-dashed transition-all select-none ${
            isUploading ? 'border-accent/50 bg-accent/5' :
            isDragging  ? 'border-accent bg-accent/8 scale-[1.01]' :
                          'border-divider hover:border-accent/50 hover:bg-bg/60 cursor-pointer'
          }`}
        >
          {isUploading ? (
            <>
              <Icon name="Loader2" size={20} className="text-accent animate-spin" />
              <span className="text-[12px] text-muted">Uploading to Cloudinary…</span>
            </>
          ) : (
            <>
              <div className={`w-8 h-8 rounded-lg grid place-content-center transition ${isDragging ? 'text-accent' : 'text-muted'}`}
                   style={isDragging ? { background: 'rgba(108,99,255,0.12)' } : { background: 'rgba(0,0,0,0.04)' }}>
                <Icon name={isDragging ? 'DownloadCloud' : 'Upload'} size={16} />
              </div>
              <div className="text-center">
                <p className="text-[12px] font-medium text-ink">{isDragging ? 'Drop here' : 'Drag logo here'}</p>
                <p className="text-[11px] text-muted">or <span className="text-accent font-semibold">browse</span></p>
              </div>
            </>
          )}
        </div>
      )}

      {/* Upload loading overlay when logo exists */}
      {value && isUploading && (
        <div className="mt-2 flex items-center gap-2 text-[11.5px] text-muted">
          <Icon name="Loader2" size={12} className="animate-spin text-accent" />
          Uploading to Cloudinary…
        </div>
      )}

      <input ref={inputRef} type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp"
             className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = ''; }} />

      {error && (
        <p className="mt-1.5 text-[11px] text-red-500 flex items-center gap-1">
          <Icon name="TriangleAlert" size={11} /> {error}
        </p>
      )}
    </div>
  );
}
