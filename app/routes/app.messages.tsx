import { useEffect, useRef, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { markMerchantActive } from "../lib/chat.server";
import { PageHeader, Icon, Btn } from "../components/ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  markMerchantActive(shop);

  const conversations = await prisma.conversation.findMany({
    where: { shop, type: "CLIENT" },
    orderBy: { lastMessageAt: "desc" },
    take: 200,
  });

  return {
    shop,
    conversations: conversations.map((c) => ({
      id: c.id,
      customerEmail: c.customerEmail,
      customerName: c.customerName,
      unreadByMerchant: c.unreadByMerchant,
      lastMessageAt: c.lastMessageAt.toISOString(),
      lastMessagePreview: c.lastMessagePreview ?? "",
      closed: c.closed,
    })),
  };
};

type Conv = ReturnType<typeof useLoaderData<typeof loader>>["conversations"][number];
type Msg = {
  id: string;
  senderType: "CLIENT" | "MERCHANT" | "SUPPORT";
  senderName: string | null;
  body: string;
  createdAt: string;
};

const POLL_MS = 4000;

function formatRelative(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return d.toLocaleDateString();
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MessagesPage() {
  const { conversations: initial } = useLoaderData<typeof loader>();
  const [conversations, setConversations] = useState<Conv[]>(initial);
  const [selectedId, setSelectedId] = useState<string | null>(
    initial[0]?.id || null,
  );
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const lastTsRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const selected = conversations.find((c) => c.id === selectedId) || null;

  // Refresh conversations list
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/chat/conversations");
        if (!r.ok) return;
        const data = await r.json();
        if (cancelled) return;
        setConversations(
          (data.conversations as Conv[]).filter(
            (c: any) => c.type === "CLIENT",
          ),
        );
      } catch { /* ignore */ }
    };
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Load messages when selection changes
  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      lastTsRef.current = null;
      return;
    }
    let cancelled = false;
    setMessages([]);
    lastTsRef.current = null;
    (async () => {
      try {
        const r = await fetch(
          `/api/chat/messages?conversationId=${selectedId}`,
        );
        if (!r.ok) return;
        const data = await r.json();
        if (cancelled || selectedIdRef.current !== selectedId) return;
        setMessages(data.messages || []);
        if (data.messages?.length) {
          lastTsRef.current = data.messages[data.messages.length - 1].createdAt;
        }
        // Mark as read
        fetch("/api/chat/read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: selectedId }),
        }).catch(() => {});
        setConversations((prev) =>
          prev.map((c) =>
            c.id === selectedId ? { ...c, unreadByMerchant: 0 } : c,
          ),
        );
      } catch { /* ignore */ }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // Poll messages of selected conversation
  useEffect(() => {
    if (!selectedId) return;
    const id = setInterval(async () => {
      try {
        const params = new URLSearchParams({ conversationId: selectedId });
        if (lastTsRef.current) params.set("since", lastTsRef.current);
        const r = await fetch(`/api/chat/messages?${params.toString()}`);
        if (!r.ok) return;
        const data = await r.json();
        if (selectedIdRef.current !== selectedId) return;
        const fresh: Msg[] = data.messages || [];
        if (fresh.length) {
          setMessages((prev) => {
            const seen = new Set(prev.map((m) => m.id));
            const add = fresh.filter((m) => !seen.has(m.id));
            if (!add.length) return prev;
            lastTsRef.current = add[add.length - 1].createdAt;
            const hasClient = add.some((m) => m.senderType === "CLIENT");
            if (hasClient) {
              fetch("/api/chat/read", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ conversationId: selectedId }),
              }).catch(() => {});
            }
            return [...prev, ...add];
          });
        }
      } catch { /* ignore */ }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [selectedId]);

  // Auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const sendReply = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || !selectedId || sending) return;
    setSending(true);
    const optimistic: Msg = {
      id: "tmp-" + Date.now(),
      senderType: "MERCHANT",
      senderName: "You",
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
          conversationId: selectedId,
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
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Messages"
        subtitle="Conversations with your customers — replies happen in real time."
      />

      <div
        className="bg-surface rounded-xl border border-divider overflow-hidden flex"
        style={{ height: "calc(100vh - 220px)", minHeight: 520 }}
      >
        {/* Left: conversations list */}
        <div className="w-[300px] shrink-0 border-r border-divider flex flex-col bg-surface">
          <div className="px-4 py-3 border-b border-divider flex items-center justify-between">
            <div className="text-[13px] font-semibold text-ink">
              Inbox
              <span className="ml-1.5 text-muted font-normal text-[12px]">
                ({conversations.length})
              </span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 && (
              <div className="p-6 text-center text-[12.5px] text-muted">
                <div className="w-12 h-12 mx-auto mb-2 rounded-full bg-white/[0.04] grid place-content-center">
                  <Icon name="Inbox" size={20} className="text-faint" />
                </div>
                No messages yet. Customers will show up here when they write
                from the portal.
              </div>
            )}
            {conversations.map((c) => {
              const active = c.id === selectedId;
              const hasUnread = c.unreadByMerchant > 0;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full text-left px-4 py-3 border-b border-divider/60 transition-colors ${active ? "bg-white/[0.05]" : "hover:bg-white/[0.03]"}`}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-9 h-9 rounded-full grid place-content-center text-[11px] font-bold text-white shrink-0"
                      style={{
                        background:
                          "linear-gradient(135deg,#6C63FF,#8B5CF6)",
                      }}
                    >
                      {(c.customerName || c.customerEmail || "?")
                        .slice(0, 2)
                        .toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div
                          className={`text-[13px] truncate ${hasUnread ? "font-bold text-ink" : "font-semibold text-ink"}`}
                        >
                          {c.customerName || c.customerEmail}
                        </div>
                        <div className="text-[10.5px] text-faint ml-auto shrink-0">
                          {formatRelative(c.lastMessageAt)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div
                          className={`text-[12px] truncate ${hasUnread ? "text-ink" : "text-muted"}`}
                        >
                          {c.lastMessagePreview || "—"}
                        </div>
                        {hasUnread && (
                          <span className="ml-auto shrink-0 min-w-[18px] h-[18px] px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold grid place-content-center">
                            {c.unreadByMerchant}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: chat panel */}
        <div className="flex-1 flex flex-col bg-bg min-w-0">
          {!selected && (
            <div className="flex-1 grid place-content-center text-center px-6">
              <div className="text-[14px] text-muted">
                <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-white/[0.04] grid place-content-center">
                  <Icon name="MessageCircle" size={22} className="text-faint" />
                </div>
                Select a conversation to start replying.
              </div>
            </div>
          )}

          {selected && (
            <>
              {/* Conversation header */}
              <div className="px-5 py-3 border-b border-divider flex items-center gap-3 bg-surface">
                <div
                  className="w-9 h-9 rounded-full grid place-content-center text-[11px] font-bold text-white"
                  style={{
                    background: "linear-gradient(135deg,#6C63FF,#8B5CF6)",
                  }}
                >
                  {(selected.customerName || selected.customerEmail || "?")
                    .slice(0, 2)
                    .toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold text-ink truncate">
                    {selected.customerName || selected.customerEmail}
                  </div>
                  <div className="text-[11.5px] text-muted truncate">
                    {selected.customerEmail}
                  </div>
                </div>
              </div>

              {/* Messages */}
              <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto px-5 py-5 space-y-2.5"
              >
                {messages.map((m) => {
                  const fromMerchant = m.senderType !== "CLIENT";
                  return (
                    <div
                      key={m.id}
                      className={`flex ${fromMerchant ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[70%] rounded-2xl px-3.5 py-2 text-[13.5px] leading-relaxed ${
                          fromMerchant
                            ? "text-white rounded-br-md"
                            : "bg-white/[0.06] text-ink rounded-bl-md border border-divider"
                        }`}
                        style={
                          fromMerchant
                            ? {
                                background:
                                  "linear-gradient(135deg,#6C63FF,#8B5CF6)",
                              }
                            : undefined
                        }
                      >
                        <div className="whitespace-pre-wrap break-words">
                          {m.body}
                        </div>
                        <div
                          className={`mt-1 text-[10px] ${fromMerchant ? "text-white/70" : "text-faint"}`}
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
                onSubmit={sendReply}
                className="border-t border-divider p-3 bg-surface flex items-end gap-2"
              >
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendReply();
                    }
                  }}
                  rows={1}
                  placeholder="Type your reply…"
                  className="flex-1 resize-none px-3 py-2 rounded-lg bg-white/[0.04] border border-divider focus:outline-none focus:border-accent text-[13.5px] text-ink max-h-32"
                />
                <Btn
                  variant="primary"
                  size="md"
                  onClick={() => sendReply()}
                  loading={sending}
                  icon="Send"
                >
                  Send
                </Btn>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
