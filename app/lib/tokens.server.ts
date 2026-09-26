/**
 * Signed, stateless tokens for the public (unauthenticated) surfaces:
 *
 *  - "order"  : issued after a successful order lookup in the portal. Every
 *               portal write (submit return, upload photo, pick a
 *               replacement) must present it, so the server never trusts an
 *               order id / email coming from the browser again.
 *  - "chat"   : identifies a customer in the portal chat widget. Tokens
 *               obtained through an order lookup are `verified` and can read
 *               the whole conversation history; self-declared ones can only
 *               read messages created after they were issued.
 *  - "status" : long-lived link to a return's status page (sent in emails).
 *
 * Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256). The key is
 * derived from SHOPIFY_API_SECRET (or TOKEN_SECRET) per token purpose, so a
 * token of one kind can never be replayed as another.
 */

import crypto from "crypto";

type TokenKind = "order" | "chat" | "status";

export interface OrderTokenPayload {
  shop: string;
  orderId: string;
  email: string;
  mode: "return" | "withdrawal";
}

export interface ChatTokenPayload {
  shop: string;
  email: string;
  verified: boolean;
  /** Epoch ms — unverified tokens only see messages created after this. */
  since: number;
}

export interface StatusTokenPayload {
  shop: string;
  rma: string;
}

const TTL: Record<TokenKind, number> = {
  order: 2 * 60 * 60, // 2 hours: enough to finish a return request
  chat: 30 * 24 * 60 * 60, // 30 days
  status: 365 * 24 * 60 * 60, // 1 year: email links
};

function secret(): string {
  const s = process.env.TOKEN_SECRET || process.env.SHOPIFY_API_SECRET || "";
  if (!s && process.env.NODE_ENV === "production") {
    throw new Error("TOKEN_SECRET / SHOPIFY_API_SECRET is not configured");
  }
  return s || "trackback-dev-secret";
}

function keyFor(kind: TokenKind): Buffer {
  return crypto.createHmac("sha256", secret()).update(`trackback:${kind}:v1`).digest();
}

const b64url = (buf: Buffer) => buf.toString("base64url");

function sign<T extends object>(kind: TokenKind, payload: T, ttlSeconds = TTL[kind]): string {
  const body = b64url(
    Buffer.from(JSON.stringify({ ...payload, k: kind, exp: Math.floor(Date.now() / 1000) + ttlSeconds })),
  );
  const mac = b64url(crypto.createHmac("sha256", keyFor(kind)).update(body).digest());
  return `${body}.${mac}`;
}

function verify<T>(kind: TokenKind, token: string | null | undefined): (T & { exp: number }) | null {
  if (!token || typeof token !== "string" || token.length > 4096) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = crypto.createHmac("sha256", keyFor(kind)).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(mac, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload?.k !== kind) return null;
    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
    return payload as T & { exp: number };
  } catch {
    return null;
  }
}

export const signOrderToken = (p: OrderTokenPayload) => sign("order", p);
export const verifyOrderToken = (t: string | null | undefined) => verify<OrderTokenPayload>("order", t);

export const signChatToken = (p: ChatTokenPayload) => sign("chat", p);
export const verifyChatToken = (t: string | null | undefined) => verify<ChatTokenPayload>("chat", t);

export const signStatusToken = (p: StatusTokenPayload) => sign("status", p);
export const verifyStatusToken = (t: string | null | undefined) => verify<StatusTokenPayload>("status", t);

/** Constant-time comparison for shared secrets (support console, cron…). */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Random secret for webhooks / API keys. */
export function randomSecret(bytes = 24): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
