import { useEffect, useRef, useState } from "react";

// TrackBack internal support console
// Public route — protected only by the SUPPORT_REPLY_TOKEN you store in localStorage.
// Designed to be opened from Discord notification links: /support-console?conv=xxx

type Msg = {
  id: string;
  senderType: "CLIENT" | "MERCHANT" | "SUPPORT";
  senderName: string | null;
  body: string;
  createdAt: string;
};

const STORAGE_KEY = "rf_support_token";

function formatTime(iso: string) {
  return new Date(iso).toLocaleString();
}

export default function SupportConsole() {
  const [token, setToken] = useState<string>("");
  const [tokenInput, setTokenInput] = useState<string>("");
  const [convInput, setConvInput] = useState<string>("");
  const [conv, setConv] = useState<string>("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Hydration: read token from localStorage + conv from URL
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setToken(saved);
    } catch { /* ignore */ }

    const url = new URL(window.location.href);
    const c = url.searchParams.get("conv");
    if (c) {
      setConv(c);
      setConvInput(c);
    }
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // When token + conv are present, load messages and poll
  useEffect(() => {
    if (!token || !conv) return;
    let cancelled = false;

    const load = async () => {
      try {
        const r = await fetch(
          `/api/support/messages?conversationId=${encodeURIComponent(conv)}`,
          { headers: { "X-Support-Token": token } },
        );
        if (r.status === 401) {
          setError("Invalid token. Re-enter it.");
          setToken("");
          try { localStorage.removeItem(STORAGE_KEY); } catch { }
          return;
        }
        if (!r.ok) {
          setError(`Failed to load (${r.status})`);
          return;
        }
        const data = await r.json();
        if (cancelled) return;
        setError(null);
        setMessages(data.messages || []);
      } catch (e: any) {
        setError(e?.message || "Network error");
      }
    };

    load();
    const id = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token, conv]);

  const saveToken = () => {
    const t = tokenInput.trim();
    if (!t) return;
    setToken(t);
    try { localStorage.setItem(STORAGE_KEY, t); } catch { }
    setTokenInput("");
  };

  const openConv = () => {
    const c = convInput.trim();
    if (!c) return;
    setConv(c);
    setMessages([]);
    setStatus(null);
    setError(null);
    const url = new URL(window.location.href);
    url.searchParams.set("conv", c);
    window.history.replaceState({}, "", url.toString());
  };

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy || !conv || !token) return;
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      const r = await fetch("/api/support/reply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Support-Token": token,
        },
        body: JSON.stringify({ conversationId: conv, body: text }),
      });
      const data = await r.json();
      if (!r.ok || data.error) throw new Error(data.error || `HTTP ${r.status}`);
      setInput("");
      setStatus("Sent ✓");
      setMessages((prev) => [...prev, data.message]);
      setTimeout(() => setStatus(null), 1500);
    } catch (e: any) {
      setError(e?.message || "Send failed");
    } finally {
      setBusy(false);
    }
  };

  // Token gate
  if (!token) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <h1 style={titleStyle}>TrackBack · Support Console</h1>
          <p style={subStyle}>
            Enter your <code>SUPPORT_REPLY_TOKEN</code> to access. It's stored
            in this browser only.
          </p>
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveToken()}
            placeholder="Paste your support token…"
            autoFocus
            style={inputStyle}
          />
          <button onClick={saveToken} style={btnStyle}>
            Unlock
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <div style={{ ...cardStyle, maxWidth: 720 }}>
        <div style={headerRow}>
          <h1 style={{ ...titleStyle, marginBottom: 0 }}>Support Console</h1>
          <button
            onClick={() => {
              setToken("");
              try { localStorage.removeItem(STORAGE_KEY); } catch { }
            }}
            style={linkBtn}
          >
            Sign out
          </button>
        </div>

        {/* Conversation picker */}
        <div style={pickerRow}>
          <input
            value={convInput}
            onChange={(e) => setConvInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && openConv()}
            placeholder="Conversation ID (e.g. cmp9ykngl0000kmw4ltrb4q5h)"
            style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
          />
          <button onClick={openConv} style={{ ...btnStyle, width: 100, marginBottom: 0 }}>
            Open
          </button>
        </div>

        {!conv && (
          <p style={hintStyle}>
            Open a conversation by ID, or click a "Reply" link from your Discord
            channel — the ID will pre-fill automatically.
          </p>
        )}

        {conv && (
          <>
            <div style={convLabelStyle}>
              Conversation <code>{conv}</code>
            </div>

            <div ref={scrollRef} style={messagesStyle}>
              {messages.length === 0 && (
                <div style={emptyStyle}>No messages yet.</div>
              )}
              {messages.map((m) => {
                const fromUs = m.senderType === "SUPPORT";
                const fromMerchant = m.senderType === "MERCHANT";
                return (
                  <div
                    key={m.id}
                    style={{
                      display: "flex",
                      justifyContent: fromUs ? "flex-end" : "flex-start",
                      marginBottom: 8,
                    }}
                  >
                    <div
                      style={{
                        maxWidth: "75%",
                        background: fromUs ? "#6C63FF" : fromMerchant ? "#fff" : "#f3f4f6",
                        color: fromUs ? "#fff" : "#0f1117",
                        border: fromUs ? "none" : "1px solid #e5e7eb",
                        borderRadius: 14,
                        padding: "8px 12px",
                        fontSize: 14,
                        lineHeight: 1.5,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 11,
                          opacity: 0.7,
                          marginBottom: 2,
                          fontWeight: 600,
                        }}
                      >
                        {fromUs
                          ? "You (Support)"
                          : fromMerchant
                            ? m.senderName || "Merchant"
                            : m.senderName || "Customer"}
                      </div>
                      {m.body}
                      <div
                        style={{
                          fontSize: 10,
                          opacity: 0.55,
                          marginTop: 4,
                          textAlign: "right",
                        }}
                      >
                        {formatTime(m.createdAt)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <form onSubmit={send} style={formStyle}>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={3}
                placeholder="Type your reply to the merchant…   (Ctrl+Enter to send)"
                style={textareaStyle}
              />
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button type="submit" disabled={busy || !input.trim()} style={btnStyle}>
                  {busy ? "Sending…" : "Send reply"}
                </button>
                {status && <span style={{ color: "#22c55e", fontSize: 13 }}>{status}</span>}
                {error && <span style={{ color: "#ef4444", fontSize: 13 }}>{error}</span>}
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- styles ----------
const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#0F1117",
  color: "#F0F0F5",
  fontFamily: "Inter, system-ui, sans-serif",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: "40px 20px",
};
const cardStyle: React.CSSProperties = {
  background: "#1A1D27",
  border: "1px solid #2E3148",
  borderRadius: 16,
  padding: 24,
  width: "100%",
  maxWidth: 480,
  boxShadow: "0 20px 60px -20px rgba(0,0,0,0.6)",
};
const titleStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  marginBottom: 8,
};
const subStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#8B8FA8",
  marginBottom: 14,
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #2E3148",
  background: "#0F1117",
  color: "#F0F0F5",
  fontSize: 14,
  marginBottom: 10,
  outline: "none",
};
const btnStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  background: "linear-gradient(135deg,#6C63FF,#4F46E5)",
  color: "#fff",
  fontWeight: 600,
  fontSize: 14,
  border: "none",
  cursor: "pointer",
};
const linkBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#8B8FA8",
  fontSize: 12,
  cursor: "pointer",
  textDecoration: "underline",
};
const pickerRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  marginTop: 12,
  marginBottom: 12,
};
const headerRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 8,
};
const hintStyle: React.CSSProperties = {
  fontSize: 12.5,
  color: "#5B5F75",
  marginTop: 8,
};
const convLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#8B8FA8",
  marginBottom: 8,
};
const messagesStyle: React.CSSProperties = {
  background: "#F8FAFC",
  borderRadius: 12,
  padding: 16,
  height: 360,
  overflowY: "auto",
  border: "1px solid #2E3148",
};
const emptyStyle: React.CSSProperties = {
  color: "#9ca3af",
  fontSize: 13,
  textAlign: "center",
  padding: "60px 0",
};
const formStyle: React.CSSProperties = {
  marginTop: 12,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};
const textareaStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #2E3148",
  background: "#0F1117",
  color: "#F0F0F5",
  fontSize: 14,
  resize: "vertical",
  outline: "none",
  fontFamily: "inherit",
};
