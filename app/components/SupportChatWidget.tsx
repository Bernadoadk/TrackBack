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

const POLL_MS = 6000;

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SupportChatWidget() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [unread, setUnread] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const lastTsRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => setMounted(true), []);

  // Allow any page to imperatively open the support chat by dispatching
  // `window.dispatchEvent(new Event('returnflow:open-support-chat'))`.
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('returnflow:open-support-chat', handler);
    return () => window.removeEventListener('returnflow:open-support-chat', handler);
  }, []);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/chat/support");
        if (!r.ok) return;
        const data = await r.json();
        if (cancelled) return;
        setConvId(data.conversationId);
        setMessages(data.messages || []);
        if (data.messages?.length) {
          lastTsRef.current =
            data.messages[data.messages.length - 1].createdAt;
        }
        setLoaded(true);
      } catch { /* ignore */ }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Polling
  useEffect(() => {
    if (!convId) return;
    const tick = async () => {
      try {
        const params = new URLSearchParams({ conversationId: convId });
        if (lastTsRef.current) params.set("since", lastTsRef.current);
        const r = await fetch(`/api/chat/messages?${params.toString()}`);
        if (!r.ok) return;
        const data = await r.json();
        const fresh: Msg[] = data.messages || [];
        if (fresh.length) {
          setMessages((prev) => {
            const seen = new Set(prev.map((m) => m.id));
            const add = fresh.filter((m) => !seen.has(m.id));
            if (!add.length) return prev;
            lastTsRef.current = add[add.length - 1].createdAt;
            const supportNew = add.filter(
              (m) => m.senderType === "SUPPORT",
            ).length;
            if (supportNew > 0 && !openRef.current) {
              setUnread((u) => u + supportNew);
            }
            return [...prev, ...add];
          });
        }
      } catch { /* ignore */ }
    };
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [convId]);

  useEffect(() => {
    if (!open) return;
    setUnread(0);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, messages]);

  const sendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || sending || !convId) return;
    setSending(true);
    const optimistic: Msg = {
      id: "tmp-" + Date.now(),
      senderType: "MERCHANT",
      senderName: null,
      body: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput("");
    try {
      const r = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: convId,
          intent: "support",
          body: text,
          senderType: "MERCHANT",
        }),
      });
      const data = await r.json();
      if (!r.ok || data.error) throw new Error(data.error || "Failed");
      setMessages((prev) => {
        const without = prev.filter((m) => m.id !== optimistic.id);
        const seen = new Set(without.map((m) => m.id));
        if (seen.has(data.message.id)) return without;
        return [...without, data.message];
      });
      lastTsRef.current = data.message.createdAt;
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  if (!mounted || !loaded) return null;

  const widget = (
    <div
      style={{
        position: "fixed",
        right: 20,
        bottom: 20,
        zIndex: 2147483600,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        fontFamily: "inherit",
        // The outer container is sized to fit the (always-laid-out) panel, so
        // without this it would intercept clicks across a ~380×600 area in the
        // bottom-right of the viewport — covering legitimate buttons like the
        // "Upgrade to Pro" CTA. Only the visible children should be clickable.
        pointerEvents: "none",
      }}
    >
      {/* Panel */}
      <div
        className={`mb-3 origin-bottom-right transition-all duration-300 ease-out ${
          open
            ? "opacity-100 scale-100 translate-y-0 pointer-events-auto"
            : "opacity-0 scale-95 translate-y-2 pointer-events-none"
        }`}
        style={{
          width: "min(380px, calc(100vw - 32px))",
          height: "min(540px, calc(100vh - 120px))",
        }}
      >
        <div
          className="flex flex-col h-full rounded-2xl overflow-hidden bg-surface shadow-2xl border border-divider"
          style={{
            boxShadow: "0 24px 60px -12px rgba(0,0,0,0.4), 0 8px 24px -8px rgba(0,0,0,0.3)",
          }}
        >
          {/* Header */}
          <div
            className="px-4 py-3.5 text-white flex items-center justify-between"
            style={{
              background:
                "linear-gradient(135deg, #6C63FF 0%, #4F46E5 100%)",
            }}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-full bg-white/20 grid place-content-center shrink-0">
                <Icon name="MessageCircleMore" size={18} strokeWidth={2.25} />
              </div>
              <div className="min-w-0">
                <div className="text-[14px] font-semibold leading-tight truncate">
                  ReturnFlow Support
                </div>
                <div className="text-[11px] opacity-80 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-300 inline-block animate-pulse" />
                  Usually replies within a few hours
                </div>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="w-8 h-8 grid place-content-center rounded-full hover:bg-white/15 transition-colors"
              aria-label="Close"
            >
              <Icon name="X" size={18} />
            </button>
          </div>

          {/* Body */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-4 py-4 bg-bg space-y-2.5"
          >
            {messages.length === 0 && (
              <div className="text-center py-8 text-muted text-[13px]">
                <div className="w-12 h-12 mx-auto mb-2 rounded-full bg-white/[0.04] grid place-content-center">
                  <Icon name="MessageCircleMore" size={20} className="text-accent" />
                </div>
                Need help with the app? Send us a message — we'll get back to
                you ASAP.
              </div>
            )}
            {messages.map((m) => {
              const fromMe = m.senderType === "MERCHANT";
              return (
                <div
                  key={m.id}
                  className={`flex ${fromMe ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-[13.5px] leading-relaxed ${
                      fromMe
                        ? "text-white rounded-br-md"
                        : "bg-white/[0.06] text-ink rounded-bl-md border border-divider"
                    }`}
                    style={
                      fromMe
                        ? {
                            background:
                              "linear-gradient(135deg,#6C63FF,#4F46E5)",
                          }
                        : undefined
                    }
                  >
                    <div className="whitespace-pre-wrap break-words">
                      {m.body}
                    </div>
                    <div
                      className={`mt-1 text-[10px] ${fromMe ? "text-white/70" : "text-faint"}`}
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
            className="border-t border-divider p-3 bg-surface flex items-end gap-2"
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
              placeholder="Describe your issue…"
              className="flex-1 resize-none px-3 py-2 rounded-lg bg-white/[0.04] border border-divider focus:outline-none focus:border-accent text-[13.5px] text-ink max-h-32"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="w-9 h-9 shrink-0 grid place-content-center rounded-full text-white disabled:opacity-40 transition-transform hover:scale-105 active:scale-95"
              style={{
                background:
                  "linear-gradient(135deg,#6C63FF,#4F46E5)",
              }}
              aria-label="Send"
            >
              {sending ? (
                <Icon name="Loader2" size={16} className="animate-spin" />
              ) : (
                <Icon name="Send" size={15} strokeWidth={2.25} />
              )}
            </button>
          </form>
        </div>
      </div>

      {/* Floating button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="pointer-events-auto relative w-14 h-14 rounded-full grid place-content-center text-white transition-transform hover:scale-105 active:scale-95"
        style={{
          background: "linear-gradient(135deg,#6C63FF,#4F46E5)",
          boxShadow:
            "0 12px 28px -8px rgba(108,99,255,0.55), 0 0 0 1px rgba(255,255,255,0.06) inset",
        }}
        aria-label={open ? "Close support" : "Open support"}
      >
        <div
          className="transition-transform duration-300"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          {open ? (
            <Icon name="X" size={22} />
          ) : (
            <Icon name="MessageCircleMore" size={22} strokeWidth={2.25} />
          )}
        </div>
        {!open && unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold grid place-content-center ring-2 ring-surface animate-pulse">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    </div>
  );

  return createPortal(widget, document.body);
}
