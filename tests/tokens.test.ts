import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.TOKEN_SECRET = "test-secret-for-unit-tests";
});

describe("signed tokens", () => {
  it("round-trips an order token", async () => {
    const { signOrderToken, verifyOrderToken } = await import("../app/lib/tokens.server");
    const t = signOrderToken({ shop: "a.myshopify.com", orderId: "gid://shopify/Order/1", email: "x@y.com", mode: "return" });
    const p = verifyOrderToken(t);
    expect(p?.shop).toBe("a.myshopify.com");
    expect(p?.email).toBe("x@y.com");
  });

  it("rejects tampered payloads", async () => {
    const { signOrderToken, verifyOrderToken } = await import("../app/lib/tokens.server");
    const t = signOrderToken({ shop: "a.myshopify.com", orderId: "gid://shopify/Order/1", email: "x@y.com", mode: "return" });
    const [body, mac] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), shop: "victim.myshopify.com" })).toString("base64url");
    expect(verifyOrderToken(`${forged}.${mac}`)).toBeNull();
    expect(verifyOrderToken("garbage")).toBeNull();
  });

  it("does not accept a token of another kind", async () => {
    const { signOrderToken, verifyChatToken, signStatusToken, verifyOrderToken } = await import("../app/lib/tokens.server");
    const order = signOrderToken({ shop: "a.myshopify.com", orderId: "1", email: "x@y.com", mode: "return" });
    expect(verifyChatToken(order)).toBeNull();
    expect(verifyOrderToken(signStatusToken({ shop: "a.myshopify.com", rma: "RMA-2026-000001" }))).toBeNull();
  });

  it("compares secrets in constant time", async () => {
    const { safeEqual } = await import("../app/lib/tokens.server");
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual(null, "abc")).toBe(false);
  });
});
