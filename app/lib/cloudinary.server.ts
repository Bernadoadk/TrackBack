import crypto from "crypto";

const CLOUD = process.env.CLOUDINARY_CLOUD_NAME!;
const KEY = process.env.CLOUDINARY_API_KEY!;
const SEC = process.env.CLOUDINARY_API_SECRET!;

function sign(params: Record<string, string>): string {
  const str = Object.keys(params).sort()
    .map(k => `${k}=${params[k]}`)
    .join("&") + SEC;
  return crypto.createHash("sha256").update(str).digest("hex");
}

export async function uploadToCloudinary(
  base64Data: string,
  folder = "trackback"
): Promise<{ url: string; publicId: string }> {
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

  const data = await res.json() as { secure_url: string; public_id: string };
  return { url: data.secure_url, publicId: data.public_id };
}

export async function deleteFromCloudinary(urlOrPublicId: string): Promise<void> {
  const publicId = isCloudinaryUrl(urlOrPublicId)
    ? extractPublicId(urlOrPublicId)
    : urlOrPublicId;
  if (!publicId) return;

  const timestamp = String(Math.floor(Date.now() / 1000));
  const sig = sign({ public_id: publicId, timestamp });

  await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/destroy`, {
    method: "POST",
    body: new URLSearchParams({ public_id: publicId, timestamp, signature: sig, api_key: KEY }),
  });
}

export function isCloudinaryUrl(url: string): boolean {
  return Boolean(url) && url.includes("res.cloudinary.com");
}

export function extractPublicId(cloudinaryUrl: string): string {
  const match = cloudinaryUrl.match(/\/upload\/(?:v\d+\/)?(.+?)\.[a-z0-9]+$/i);
  return match?.[1] ?? "";
}
