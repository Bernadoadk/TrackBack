import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./ui";
import { hasIcon } from "./icon-registry";

type Msg = {
  id: string;
  senderType: "CLIENT" | "MERCHANT" | "SUPPORT";
  senderName: string | null;
  body: string;
  createdAt: string;
};

type Texts = {
  chatTitle: string;
  chatSubtitle: string;
  chatIntro: string;
  chatName: string;
  chatEmail: string;
  chatStart: string;
  chatPlaceholder: string;
  chatSend: string;
  chatEmpty: string;
  chatError: string;
  errInvalidEmail: string;
  close: string;
};

type Props = {
  shop: string;
  brandColor?: string;
  storeName?: string;
  texts: Texts;
  /** Verified token issued by the order lookup — gives access to the full history. */
  verifiedToken?: string | null;
  prefillEmail?: string;
  prefillName?: string;
  position?: "bottom-right" | "bottom-left";
  icon?: string;
  /** Render in the page flow instead of a fixed bubble (portal embedded in a storefront iframe). */
  inline?: boolean;
};

type Identity = { token: string; email: string; name: string };

const OPEN_POLL_MS = 5000;
const IDLE_POLL_MS = 20000;

const storageKey = (shop: string) => `tb_chat_${shop}`;

function readIdentity(shop: string): Identity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey(shop));
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v?.token && v?.email ? v : null;
  } catch {
    return null;
  }
}

function writeIdentity(shop: string, id: Identity) {
  try {
    localStorage.setItem(storageKey(shop), JSON.stringify(id));
  } catch {
    /* private mode — identity lives in memory only */
  }
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function ChatWidget({
  shop,
  brandColor = "#6C63FF",
  storeName = "Support",
  texts,
  verifiedToken,
  prefillEmail,
  prefillName,
  position = "bottom-right",
  icon = "MessageCircle",
  inline = false,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [email, setEmail] = useState(prefillEmail || "");
  const [name, setName] = useState(prefillName || "");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const lastTsRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => setMounted(true), []);

  // Identity: a verified token from the order lookup wins over a stored one.
  useEffect(() => {
    if (verifiedToken && prefillEmail) {
      const id = { token: verifiedToken, email: prefillEmail.toLowerCase(), name: prefillName || "" };
      setIdentity(id);
      writeIdentity(shop, id);
      return;
    }
    const stored = readIdentity(shop);
    if (stored) {
      setIdentity(stored);
      setEmail(stored.email);
      setName(stored.name);
    }
  }, [shop, verifiedToken, prefillEmail, prefillName]);

  const poll = useCallback(async () => {
    if (!identity) return;
    try {
      const params = new URLSearchParams({ shop, token: identity.token });
      if (lastTsRef.current) params.set("since", lastTsRef.current);
      const res = await fetch(`/portal-api/chat/poll?${params.toString()}`, { headers: { Accept: "application/json" } });
      if (res.status === 401) {
        // Token expired: ask the customer to identify again.
        setIdentity(null);
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      const incoming: Msg[] = Array.isArray(data.messages) ? data.messages : [];
      if (incoming.length === 0) {
        if (lastTsRef.current === null) lastTsRef.current = new Date(0).toISOString();
        return;
      }
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const fresh = incoming.filter((m) => !seen.has(m.id));
        if (fresh.length === 0) return prev;
        lastTsRef.current = fresh[fresh.length - 1].createdAt;
        const fromStore = fresh.filter((m) => m.senderType !== "CLIENT").length;
        if (fromStore > 0 && !openRef.current) setUnread((u) => u + fromStore);
        return [...prev, ...fresh];
      });
    } catch {
      /* network blip — next tick retries */
    }
  }, [identity, shop]);

  // Visibility-aware polling: fast while the panel is open, slow otherwise,
  // paused while the tab is hidden.
  useEffect(() => {
    if (!identity) return;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      if (typeof document === "undefined" || document.visibilityState === "visible") await poll();
      timer = setTimeout(tick, openRef.current ? OPEN_POLL_MS : IDLE_POLL_MS);
    };
    tick();
    const onVisible = () => document.visibilityState === "visible" && poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [identity, poll]);

  useEffect(() => {
    if (!open) return;
    setUnread(0);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  const startChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || !cleanName) {
      setError(texts.errInvalidEmail);
      return;
    }
    setError(null);
    setStarting(true);
    try {
      const res = await fetch("/portal-api/chat/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop, email: cleanEmail }),
      });
      const data = await res.json();
      if (!data.chatToken) throw new Error();
      const id = { token: data.chatToken, email: cleanEmail, name: cleanName };
      writeIdentity(shop, id);
      setIdentity(id);
    } catch {
      setError(texts.chatError);
    } finally {
      setStarting(false);
    }
  };

  const sendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || sending || !identity) return;
    setSending(true);
    setError(null);
    const optimistic: Msg = {
      id: "tmp-" + Date.now(),
      senderType: "CLIENT",
      senderName: identity.name,
      body: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput("");
    try {
      const res = await fetch("/portal-api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop, token: identity.token, name: identity.name || undefined, body: text }),
      });
      const data = await res.json();
      if (!res.ok || data.error || !data.message) throw new Error();
      setMessages((prev) => {
        const withoutTmp = prev.filter((m) => m.id !== optimistic.id);
        return withoutTmp.some((m) => m.id === data.message.id) ? withoutTmp : [...withoutTmp, data.message];
      });
      lastTsRef.current = data.message.createdAt;
    } catch {
      setError(texts.chatError);
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  if (!mounted) return null;

  const containerStyle: React.CSSProperties = inline
    ? { position: "relative", display: "flex", flexDirection: "column", alignItems: "flex-end", margin: "8px auto 24px", maxWidth: 768, padding: "0 12px" }
    : {
        position: "fixed",
        bottom: 20,
        zIndex: 2147483600,
        fontFamily: "inherit",
        display: "flex",
        flexDirection: "column",
        alignItems: position === "bottom-right" ? "flex-end" : "flex-start",
        ...(position === "bottom-right" ? { right: 20 } : { left: 20 }),
      };

  const widget = (
    <div style={containerStyle}>
      <div
        className={`mb-3 origin-bottom-right transition-all duration-300 ease-out ${
          open ? "opacity-100 scale-100 translate-y-0 pointer-events-auto" : "opacity-0 scale-95 translate-y-2 pointer-events-none"
        } ${inline && !open ? "hidden" : ""}`}
        style={{ width: "min(380px, calc(100vw - 32px))", height: "min(560px, calc(100vh - 120px))" }}
        aria-hidden={!open}
      >
        <div
          className="flex flex-col h-full rounded-2xl overflow-hidden bg-white shadow-2xl"
          style={{ boxShadow: "0 24px 60px -12px rgba(0,0,0,0.25), 0 8px 24px -8px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.04)" }}
        >
          <div
            className="px-4 py-3.5 text-white flex items-center justify-between"
            style={{ background: `linear-gradient(135deg, ${brandColor} 0%, ${shadeColor(brandColor, -20)} 100%)` }}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-full bg-white/20 grid place-content-center backdrop-blur-sm shrink-0">
                <Icon name="MessageCircle" size={18} strokeWidth={2.25} />
              </div>
              <div className="min-w-0">
                <div className="text-[14px] font-semibold leading-tight truncate">
                  {texts.chatTitle.replace("{store}", storeName)}
                </div>
                <div className="text-[11px] opacity-80 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-300 inline-block animate-pulse" />
                  {texts.chatSubtitle}
                </div>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="w-8 h-8 grid place-content-center rounded-full hover:bg-white/15 transition-colors"
              aria-label={texts.close}
            >
              <Icon name="X" size={18} />
            </button>
          </div>

          {!identity ? (
            <form onSubmit={startChat} className="flex-1 flex flex-col p-5 gap-3 bg-gray-50">
              <div className="text-[14px] font-semibold text-gray-800">👋</div>
              <div className="text-[13px] text-gray-600 leading-relaxed">{texts.chatIntro}</div>
              <input
                type="text"
                placeholder={texts.chatName}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="px-3 py-2.5 rounded-lg border border-gray-200 text-[13.5px] focus:outline-none bg-white"
                maxLength={80}
              />
              <input
                type="email"
                placeholder={texts.chatEmail}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="px-3 py-2.5 rounded-lg border border-gray-200 text-[13.5px] focus:outline-none bg-white"
                maxLength={254}
              />
              {error && <div className="text-[12px] text-red-600">{error}</div>}
              <button
                type="submit"
                disabled={starting}
                className="mt-1 px-4 py-2.5 rounded-lg text-white text-[13.5px] font-semibold transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60"
                style={{ background: brandColor }}
              >
                {starting ? <Icon name="LoaderCircle" size={16} className="animate-spin mx-auto" /> : texts.chatStart}
              </button>
            </form>
          ) : (
            <>
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 bg-gray-50 space-y-2.5">
                {messages.length === 0 && (
                  <div className="text-center py-8 text-gray-400 text-[13px]">
                    <div className="w-12 h-12 mx-auto mb-2 rounded-full grid place-content-center" style={{ background: shadeColor(brandColor, 80) }}>
                      <Icon name="MessageCircle" size={20} className="opacity-80" style={{ color: brandColor }} />
                    </div>
                    {texts.chatEmpty}
                  </div>
                )}
                {messages.map((m) => {
                  const fromMe = m.senderType === "CLIENT";
                  return (
                    <div key={m.id} className={`flex ${fromMe ? "justify-end" : "justify-start"} animate-fadeIn`}>
                      <div
                        className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-[13.5px] leading-relaxed shadow-sm ${
                          fromMe ? "text-white rounded-br-md" : "bg-white text-gray-800 rounded-bl-md border border-gray-100"
                        }`}
                        style={fromMe ? { background: brandColor } : undefined}
                      >
                        <div className="whitespace-pre-wrap break-words">{m.body}</div>
                        <div className={`mt-1 text-[10px] ${fromMe ? "text-white/70" : "text-gray-400"}`}>{formatTime(m.createdAt)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <form onSubmit={sendMessage} className="border-t border-gray-100 p-3 bg-white flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  rows={1}
                  maxLength={4000}
                  placeholder={texts.chatPlaceholder}
                  className="flex-1 resize-none px-3 py-2 rounded-lg border border-gray-200 text-[13.5px] focus:outline-none bg-gray-50 max-h-32"
                />
                <button
                  type="submit"
                  disabled={sending || !input.trim()}
                  className="w-9 h-9 shrink-0 grid place-content-center rounded-full text-white disabled:opacity-40 transition-transform hover:scale-105 active:scale-95"
                  style={{ background: brandColor }}
                  aria-label={texts.chatSend}
                >
                  {sending ? <Icon name="LoaderCircle" size={16} className="animate-spin" /> : <Icon name="Send" size={15} strokeWidth={2.25} />}
                </button>
              </form>
              {error && <div className="px-4 pb-2 text-[12px] text-red-600 bg-white">{error}</div>}
            </>
          )}
        </div>
      </div>

      <button
        onClick={() => setOpen((v) => !v)}
        className="relative w-14 h-14 rounded-full grid place-content-center text-white shadow-xl transition-transform hover:scale-105 active:scale-95"
        style={{
          background: `linear-gradient(135deg, ${brandColor} 0%, ${shadeColor(brandColor, -20)} 100%)`,
          boxShadow: `0 12px 28px -8px ${hexAlpha(brandColor, 0.55)}, 0 0 0 1px rgba(255,255,255,0.06) inset`,
        }}
        aria-label={texts.chatTitle.replace("{store}", storeName)}
      >
        <div className="transition-transform duration-300" style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>
          {open ? <Icon name="X" size={22} /> : <Icon name={hasIcon(icon) ? icon : "MessageCircle"} size={22} strokeWidth={2.25} />}
        </div>
        {!open && unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold grid place-content-center ring-2 ring-white animate-pulse">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    </div>
  );

  return inline ? widget : createPortal(widget, document.body);
}

function shadeColor(hex: string, percent: number): string {
  const clean = hex.replace("#", "");
  const num = parseInt(clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean, 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const d = Math.round((255 * percent) / 100);
  const r = clamp((num >> 16) + d);
  const g = clamp(((num >> 8) & 0xff) + d);
  const b = clamp((num & 0xff) + d);
  return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
}

function hexAlpha(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const num = parseInt(clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean, 16);
  return `rgba(${num >> 16},${(num >> 8) & 0xff},${num & 0xff},${alpha})`;
}
