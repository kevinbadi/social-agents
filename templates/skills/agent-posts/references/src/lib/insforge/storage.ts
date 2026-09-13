import "server-only";

// Upload a file to the Insforge "media" bucket and return its public URL.
// Handles both S3-presigned (this instance) and local/direct backends.
// Done server-side so large files skip S3 CORS and Next's server-action limit.

const BASE = process.env.INSFORGE_API_BASE_URL ?? "";
const KEY = process.env.INSFORGE_API_KEY ?? "";
const BUCKET = "media";

export type UploadedMedia = { url: string; type: "image" | "video" };

function guessContentType(file: File): string {
  const t = (file.type || "").toLowerCase();
  if (t && t !== "application/octet-stream") return t;
  const n = file.name.toLowerCase();
  if (n.endsWith(".mp4") || n.endsWith(".m4v")) return "video/mp4";
  if (n.endsWith(".mov")) return "video/quicktime";
  if (n.endsWith(".webm")) return "video/webm";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".gif")) return "image/gif";
  return t || "application/octet-stream";
}

function uniqueName(original: string, contentType: string): string {
  const fromName = original.match(/\.[a-z0-9]{1,8}$/i)?.[0] ?? "";
  const fromType =
    contentType === "video/mp4"
      ? ".mp4"
      : contentType === "video/quicktime"
        ? ".mov"
        : contentType === "image/png"
          ? ".png"
          : contentType === "image/jpeg"
            ? ".jpg"
            : contentType === "image/webp"
              ? ".webp"
              : contentType === "image/gif"
                ? ".gif"
                : "";
  const ext = fromName || fromType || "";
  const stem =
    original
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "upload";
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}-${stem}${ext}`;
}

function storageFail(status: number, body: string): Error {
  const code = body.match(/<Code>([^<]+)<\/Code>/)?.[1];
  const msg = body.match(/<Message>([^<]+)<\/Message>/)?.[1];
  const detail = [code, msg].filter(Boolean).join(" - ");
  return new Error(
    `Storage upload failed (${status}${detail ? `: ${detail}` : ""}).`,
  );
}

export async function uploadBytesToInsforge(
  bytes: Buffer | Uint8Array,
  filename: string,
  contentType: string,
): Promise<UploadedMedia> {
  const file = new File([new Uint8Array(bytes)], filename, { type: contentType });
  return uploadToInsforge(file);
}

export async function uploadToInsforge(file: File): Promise<UploadedMedia> {
  if (!BASE || !KEY) throw new Error("Insforge storage is not configured.");

  const contentType = guessContentType(file);
  const filename = uniqueName(file.name, contentType);
  // Read through to a Buffer so S3 gets the same bytes we declared in the
  // presigned policy. Re-posting the Next FormData File can 400 (size / name).
  const bytes = Buffer.from(await file.arrayBuffer());
  const size = bytes.length;
  if (!size) throw new Error("No file provided.");
  const blob = new Blob([bytes], { type: contentType });
  const auth = { Authorization: `Bearer ${KEY}` };

  const stratRes = await fetch(
    `${BASE}/api/storage/buckets/${BUCKET}/upload-strategy`,
    {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ filename, contentType, size }),
    },
  );
  if (!stratRes.ok) {
    throw new Error(`Upload strategy failed (${stratRes.status}).`);
  }
  const s = await stratRes.json();

  let url: string;

  if (s.method === "presigned") {
    const fd = new FormData();
    for (const [k, v] of Object.entries(s.fields ?? {})) fd.append(k, v as string);
    fd.append("file", blob, filename);
    const up = await fetch(s.uploadUrl, { method: "POST", body: fd });
    if (up.status < 200 || up.status >= 300) {
      throw storageFail(up.status, await up.text());
    }
    const cf = await fetch(`${BASE}${s.confirmUrl}`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ size, contentType }),
    });
    if (!cf.ok) throw new Error(`Upload confirm failed (${cf.status}).`);
    url = (await cf.json()).url;
  } else {
    const fd = new FormData();
    fd.append("file", blob, filename);
    const up = await fetch(`${BASE}${s.uploadUrl}`, {
      method: "PUT",
      headers: auth,
      body: fd,
    });
    if (!up.ok) throw storageFail(up.status, await up.text());
    const j = await up.json().catch(() => ({}));
    url = j.url || `${BASE}/api/storage/buckets/${BUCKET}/objects/${s.key}`;
  }

  return { url, type: contentType.startsWith("video") ? "video" : "image" };
}
