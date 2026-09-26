import crypto from "crypto";

const CLOUD = process.env.CLOUDINARY_CLOUD_NAME ?? "";
const KEY = process.env.CLOUDINARY_API_KEY ?? "";
const SEC = process.env.CLOUDINARY_API_SECRET ?? "";

export function cloudinaryConfigured(): boolean {
  return !!(CLOUD && KEY && SEC);
}

function sign(params: Record<string, string>): string {
  const str =
    Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join("&") + SEC;
  return crypto.createHash("sha256").update(str).digest("hex");
}

/** Per-shop folder, so assets of one merchant can never be touched by another. */
export function shopFolder(shop: string, sub: "logos" | "returns" = "logos"): string {
  const handle = shop.replace(/\.myshopify\.com$/i, "").replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  return `trackback/${handle}/${sub}`;
}

const DATA_URL_RE = /^data:image\/(png|jpe?g|webp|svg\+xml|gif|heic|heif);base64,/i;
/** ~7 MB of base64 ≈ 5 MB image. */
const MAX_DATA_URL_LENGTH = 7 * 1024 * 1024;

export function isAcceptableImageDataUrl(value: string | null | undefined): boolean {
  return !!value && value.length <= MAX_DATA_URL_LENGTH && DATA_URL_RE.test(value);
}

export async function uploadToCloudinary(
  base64Data: string,
  folder = "trackback",
): Promise<{ url: string; publicId: string }> {
  if (!cloudinaryConfigured()) throw new Error("Cloudinary is not configured");
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sig = sign({ folder, timestamp });

  const body = new URLSearchParams({
    file: base64Data,
    timestamp,
    folder,
    signature: sig,
    api_key: KEY,
  });

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`, {
    method: "POST",
    body,
  });

  if (!res.ok) throw new Error(`Cloudinary upload failed: ${await res.text()}`);

  const data = (await res.json()) as { secure_url: string; public_id: string };
  return { url: data.secure_url, publicId: data.public_id };
}

export async function deleteFromCloudinary(urlOrPublicId: string): Promise<void> {
  if (!cloudinaryConfigured()) return;
  const publicId = isCloudinaryUrl(urlOrPublicId) ? extractPublicId(urlOrPublicId) : urlOrPublicId;
  if (!publicId) return;

  const timestamp = String(Math.floor(Date.now() / 1000));
  const sig = sign({ public_id: publicId, timestamp });

  await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/destroy`, {
    method: "POST",
    body: new URLSearchParams({ public_id: publicId, timestamp, signature: sig, api_key: KEY }),
  });
}

/**
 * Deletes an asset only if it belongs to this shop's folder. Legacy logos
 * (uploaded before per-shop folders) are only deleted when they are the
 * URL currently stored for this shop — callers pass that stored value.
 */
export async function deleteShopAsset(shop: string, storedUrl: string | null | undefined) {
  if (!storedUrl || !isCloudinaryUrl(storedUrl)) return;
  await deleteFromCloudinary(storedUrl).catch(() => {});
}

export function isCloudinaryUrl(url: string): boolean {
  return Boolean(url) && url.includes("res.cloudinary.com");
}

export function extractPublicId(cloudinaryUrl: string): string {
  const match = cloudinaryUrl.match(/\/upload\/(?:v\d+\/)?(.+?)\.[a-z0-9]+$/i);
  return match?.[1] ?? "";
}

/** True for a return photo uploaded by TrackBack for this shop (our account, shop folder). */
export function belongsToShop(url: string, shop: string): boolean {
  if (!isCloudinaryUrl(url) || !/^https:\/\//i.test(url)) return false;
  if (CLOUD && !url.includes(`/${CLOUD}/`)) return false;
  return extractPublicId(url).startsWith(`${shopFolder(shop, "returns")}/`);
}
