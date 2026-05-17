import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./ui";

type Msg = {
  id: string;
  senderType: "CLIENT" | "MERCHANT" | "SUPPORT";
  senderName: string | null;
  body: string;
  createdAt: string;
};

type Props = {
  shop: string;
  brandColor?: string;
  storeName?: string;
  // Pre-fill identity (when client is in middle of a return)
  prefillEmail?: string;
  prefillName?: string;
  // Source endpoint (defaults to portal)
  sendUrl?: string;
  pollUrl?: string;
  // Position
  position?: "bottom-right" | "bottom-left";
};

const STORAGE_KEY = "rf_chat_identity";
const POLL_INTERVAL_MS = 4000;

function readStoredIdentity() {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as { email: string; name: string };
  } catch {
    return null;
  }
}

function storeIdentity(email: string, name: string) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ email, name }));
  } catch { /* ignore */ }
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function ChatWidget({
  shop,
  brandColor = "#6C63FF",
  storeName = "Support",
  prefillEmail,
  prefillName,
  sendUrl = "/portal-api/chat/send",
  pollUrl = "/portal-api/chat/poll",
  position = "bottom-right",
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(prefillEmail || "");
  const [name, setName] = useState(prefillName || "");
  const [identified, setIdentified] = useState(Boolean(prefillEmail));
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const lastTsRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => setMounted(true), []);

  // Restore identity from localStorage on mount
  useEffect(() => {
    if (prefillEmail) {
      setIdentified(true);
      return;
    }
    const stored = readStoredIdentity();
    if (stored?.email) {
      setEmail(stored.email);
      setName(stored.name || "");
      setIdentified(true);
    }
  }, [prefillEmail]);

  // Polling loop
  useEffect(() => {
    if (!identified || !email) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const params = new URLSearchParams({ shop, email });
        if (lastTsRef.current) params.set("since", lastTsRef.current);
        const res = await fetch(`${pollUrl}?${params.toString()}`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (Array.isArray(data.messages) && data.messages.length > 0) {
          setMessages((prev) => {
            const seen = new Set(prev.map((m) => m.id));
            const fresh = (data.messages as Msg[]).filter((m) => !seen.has(m.id));
            if (fresh.length === 0) return prev;
            lastTsRef.current = fresh[fresh.length - 1].createdAt;
            const merged = [...prev, ...fresh];
            const merchantNew = fresh.filter(
              (m) => m.senderType !== "CLIENT",
            ).length;
            if (merchantNew > 0 && !openRef.current) {
              setUnread((u) => u + merchantNew);
            }
            return merged;
          });
        } else if (lastTsRef.current === null && Array.isArray(data.messages)) {
          lastTsRef.current = new Date().toISOString();
        }
      } catch {
        /* ignore network errors */
      }
    };

    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [identified, email, shop, pollUrl]);

  // Auto-scroll to bottom on new messages or open
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  // Clear unread when opened
  useEffect(() => {
    if (open) setUnread(0);
  }, [open]);

  const submitIdentity = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      setError("Please enter a valid email.");
      return;
    }
    if (!cleanName) {
      setError("Please enter your name.");
      return;
    }
    setError(null);
    setEmail(cleanEmail);
    setName(cleanName);
    storeIdentity(cleanEmail, cleanName);
    setIdentified(true);
  };

  const sendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);

    const optimistic: Msg = {
      id: "tmp-" + Date.now(),
      senderType: "CLIENT",
      senderName: name,
      body: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput("");

    try {
      const res = await fetch(sendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop, email, name, body: text }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to send");
      }
      setMessages((prev) => {
        // Replace optimistic with real
        const withoutTmp = prev.filter((m) => m.id !== optimistic.id);
        const seen = new Set(withoutTmp.map((m) => m.id));
        if (seen.has(data.message.id)) return withoutTmp;
        return [...withoutTmp, data.message];
      });
      lastTsRef.current = data.message.createdAt;
    } catch (err: any) {
      setError(err?.message || "Failed to send. Please try again.");
      // Remove optimistic on failure
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  if (!mounted) return null;

  const containerStyle: React.CSSProperties = {
    position: "fixed",
    bottom: 20,
    zIndex: 2147483600, // max safe
    fontFamily: "inherit",
    display: "flex",
    flexDirection: "column",
    alignItems: position === "bottom-right" ? "flex-end" : "flex-start",
    ...(position === "bottom-right" ? { right: 20 } : { left: 20 }),
  };

  const widget = (
    <div style={containerStyle}>
      {/* Panel */}
      <div
        className={`mb-3 origin-bottom-right transition-all duration-300 ease-out ${
          open
            ? "opacity-100 scale-100 translate-y-0 pointer-events-auto"
            : "opacity-0 scale-95 translate-y-2 pointer-events-none"
        }`}
        style={{
          width: "min(380px, calc(100vw - 32px))",
          height: "min(560px, calc(100vh - 120px))",
        }}
      >
        <div
          className="flex flex-col h-full rounded-2xl overflow-hidden bg-white shadow-2xl"
          style={{
            boxShadow:
              "0 24px 60px -12px rgba(0,0,0,0.25), 0 8px 24px -8px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.04)",
          }}
        >
          {/* Header */}
          <div
            className="px-4 py-3.5 text-white flex items-center justify-between"
            style={{
              background: `linear-gradient(135deg, ${brandColor} 0%, ${shadeColor(
                brandColor,
                -20,
              )} 100%)`,
            }}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-full bg-white/20 grid place-content-center backdrop-blur-sm shrink-0">
                <Icon name="MessageCircle" size={18} strokeWidth={2.25} />
              </div>
              <div className="min-w-0">
                <div className="text-[14px] font-semibold leading-tight truncate">
                  {storeName}
                </div>
                <div className="text-[11px] opacity-80 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-300 inline-block animate-pulse" />
                  We typically reply within an hour
                </div>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="w-8 h-8 grid place-content-center rounded-full hover:bg-white/15 transition-colors"
              aria-label="Close chat"
            >
              <Icon name="X" size={18} />
            </button>
          </div>

          {/* Body */}
          {!identified ? (
            <form
              onSubmit={submitIdentity}
              className="flex-1 flex flex-col p-5 gap-3 bg-gray-50"
            >
              <div className="text-[14px] font-semibold text-gray-800">
                👋 Hi there!
              </div>
              <div className="text-[13px] text-gray-600 leading-relaxed">
                Leave your email and name so we can reply even if you close this
                window.
              </div>
              <input
                type="text"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="px-3 py-2.5 rounded-lg border border-gray-200 text-[13.5px] focus:outline-none focus:ring-2 bg-white"
                style={{ borderColor: "#E5E7EB" }}
                onFocus={(e) => (e.currentTarget.style.borderColor = brandColor)}
                onBlur={(e) => (e.currentTarget.style.borderColor = "#E5E7EB")}
                autoFocus
              />
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="px-3 py-2.5 rounded-lg border border-gray-200 text-[13.5px] focus:outline-none bg-white"
                onFocus={(e) => (e.currentTarget.style.borderColor = brandColor)}
                onBlur={(e) => (e.currentTarget.style.borderColor = "#E5E7EB")}
              />
              {error && (
                <div className="text-[12px] text-red-600">{error}</div>
              )}
              <button
                type="submit"
                className="mt-1 px-4 py-2.5 rounded-lg text-white text-[13.5px] font-semibold transition-transform hover:scale-[1.01] active:scale-[0.99]"
                style={{ background: brandColor }}
              >
                Start chatting
              </button>
            </form>
          ) : (
            <>
              {/* Messages */}
              <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto px-4 py-4 bg-gray-50 space-y-2.5"
              >
                {messages.length === 0 && (
                  <div className="text-center py-8 text-gray-400 text-[13px]">
                    <div
                      className="w-12 h-12 mx-auto mb-2 rounded-full grid place-content-center"
                      style={{ background: shadeColor(brandColor, 80) }}
                    >
                      <Icon
                        name="MessageCircle"
                        size={20}
                        className="opacity-80"
                        style={{ color: brandColor }}
                      />
                    </div>
                    Send your first message — we'll get back to you ASAP.
                  </div>
                )}
                {messages.map((m) => {
                  const fromMe = m.senderType === "CLIENT";
                  return (
                    <div
                      key={m.id}
                      className={`flex ${fromMe ? "justify-end" : "justify-start"} animate-fadeIn`}
                    >
                      <div
                        className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-[13.5px] leading-relaxed shadow-sm ${
                          fromMe ? "text-white rounded-br-md" : "bg-white text-gray-800 rounded-bl-md border border-gray-100"
                        }`}
                        style={
                          fromMe
                            ? { background: brandColor }
                            : undefined
                        }
                      >
                        <div className="whitespace-pre-wrap break-words">
                          {m.body}
                        </div>
                        <div
                          className={`mt-1 text-[10px] ${fromMe ? "text-white/70" : "text-gray-400"}`}
                        >
                          {formatTime(m.createdAt)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Input */}
              <form
                onSubmit={sendMessage}
                className="border-t border-gray-100 p-3 bg-white flex items-end gap-2"
              >
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
                  placeholder="Type a message…"
                  className="flex-1 resize-none px-3 py-2 rounded-lg border border-gray-200 text-[13.5px] focus:outline-none bg-gray-50 max-h-32"
                  style={{ borderColor: "#E5E7EB" }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = brandColor)}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "#E5E7EB")}
                />
                <button
                  type="submit"
                  disabled={sending || !input.trim()}
                  className="w-9 h-9 shrink-0 grid place-content-center rounded-full text-white disabled:opacity-40 transition-transform hover:scale-105 active:scale-95"
                  style={{ background: brandColor }}
                  aria-label="Send"
                >
                  {sending ? (
                    <Icon name="Loader2" size={16} className="animate-spin" />
                  ) : (
                    <Icon name="Send" size={15} strokeWidth={2.25} />
                  )}
                </button>
              </form>
              {error && (
                <div className="px-4 pb-2 text-[12px] text-red-600 bg-white">
                  {error}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Floating button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative w-14 h-14 rounded-full grid place-content-center text-white shadow-xl transition-transform hover:scale-105 active:scale-95"
        style={{
          background: `linear-gradient(135deg, ${brandColor} 0%, ${shadeColor(brandColor, -20)} 100%)`,
          boxShadow: `0 12px 28px -8px ${hexAlpha(brandColor, 0.55)}, 0 0 0 1px rgba(255,255,255,0.06) inset`,
        }}
        aria-label={open ? "Close chat" : "Open chat"}
      >
        <div className="transition-transform duration-300" style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>
          {open ? <Icon name="X" size={22} /> : <Icon name="MessageCircle" size={22} strokeWidth={2.25} />}
        </div>
        {!open && unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold grid place-content-center ring-2 ring-white animate-pulse">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
        {!open && (
          <span
            className="absolute inset-0 rounded-full animate-ping"
            style={{ background: brandColor, opacity: 0.2 }}
          />
        )}
      </button>
    </div>
  );

  return createPortal(widget, document.body);
}

// ---------- helpers ----------
function shadeColor(hex: string, percent: number): string {
  const clean = hex.replace("#", "");
  const num = parseInt(
    clean.length === 3
      ? clean.split("").map((c) => c + c).join("")
      : clean,
    16,
  );
  let r = (num >> 16) + Math.round((255 * percent) / 100);
  let g = ((num >> 8) & 0xff) + Math.round((255 * percent) / 100);
  let b = (num & 0xff) + Math.round((255 * percent) / 100);
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
}

function hexAlpha(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const num = parseInt(
    clean.length === 3
      ? clean.split("").map((c) => c + c).join("")
      : clean,
    16,
  );
  const r = num >> 16;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}
