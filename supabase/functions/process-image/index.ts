/**
 * Prangon Lite — trusted image processing.
 *
 * WHY THIS EXISTS
 *   The browser can compress an image before uploading, but that is a
 *   convenience, not a security boundary. Anyone with the anon key can POST
 *   straight to the storage API and skip the client entirely. So the resize /
 *   re-encode / metadata-strip step has to run somewhere the client cannot
 *   bypass — here, with the service role.
 *
 * FLOW
 *   1. Client uploads the ORIGINAL to the private `uploads-pending` bucket.
 *   2. Client calls this function with the staging path.
 *   3. We verify the caller owns that path, download, validate by magic bytes,
 *      decode, guard against decompression bombs, resize to <= 2048x2048,
 *      re-encode, upload the result to the public bucket, record metadata,
 *      and delete the staging object.
 *
 * Running the original through a decoder and re-encoding it is also what
 * strips EXIF/GPS: the encoder writes a fresh file and never copies the
 * original metadata blocks.
 *
 * NOTE: this function has NOT been executed against a live runtime — see the
 * final report. It is written to fail closed (reject) on anything unexpected.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@v1.2.15/mod.ts";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const MAX_DIMENSION = 2048;          // longest edge of the stored image
const THUMB_DIMENSION = 512;         // feed/list preview
const MAX_PIXELS = 50_000_000;       // decompression-bomb guard (50 MP)
const MAX_INPUT_BYTES = 30 * 1024 * 1024; // belt-and-braces; bucket also caps this
const ENCODE_QUALITY = 82;

const TARGET_BUCKETS: Record<string, string> = {
  post: "post-media",
  avatar: "avatars",
  banner: "banners",
};

// Magic bytes. We never trust the filename or the client-supplied MIME type.
const SIGNATURES: { ext: string; mime: string; test: (b: Uint8Array) => boolean }[] = [
  {
    ext: "jpg",
    mime: "image/jpeg",
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    ext: "png",
    mime: "image/png",
    test: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    ext: "webp",
    mime: "image/webp",
    test: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
  {
    ext: "gif",
    mime: "image/gif",
    test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
  },
];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function fail(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function detectType(bytes: Uint8Array) {
  return SIGNATURES.find((s) => s.test(bytes)) ?? null;
}

/** Fit inside a square box, preserving aspect ratio, never upscaling. */
function fitWithin(w: number, h: number, box: number) {
  const scale = Math.min(1, box / Math.max(w, h));
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail(405, "Method not allowed");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Identify the caller from their OWN token — never trust a user id from the
  // request body, or anyone could process (and claim) someone else's upload.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return fail(401, "Missing authorization");

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return fail(401, "Invalid session");
  const userId = userData.user.id;

  const admin = createClient(supabaseUrl, serviceKey);

  let body: { bucket?: string; path?: string; target?: string };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid JSON body");
  }

  const { bucket, path, target = "post" } = body;
  if (!bucket || !path) return fail(400, "bucket and path are required");

  // Only the staging bucket may be processed, and only the caller's own prefix.
  if (bucket !== "uploads-pending") return fail(400, "Unsupported source bucket");
  if (!path.startsWith(`${userId}/`)) return fail(403, "Not your upload");

  const targetBucket = TARGET_BUCKETS[target];
  if (!targetBucket) return fail(400, "Unknown target");

  // ---- 1. Download the staging object ------------------------------------
  const { data: file, error: dlErr } = await admin.storage.from(bucket).download(path);
  if (dlErr || !file) {
    return fail(400, "Could not read the uploaded file");
  }

  const original = new Uint8Array(await file.arrayBuffer());
  if (original.byteLength === 0) return fail(400, "Empty file");
  if (original.byteLength > MAX_INPUT_BYTES) {
    await admin.storage.from(bucket).remove([path]);
    return fail(413, "Image is too large to process");
  }

  // ---- 2. Validate by magic bytes ----------------------------------------
  const detected = detectType(original);
  if (!detected) {
    await admin.storage.from(bucket).remove([path]);
    return fail(415, "Unsupported or corrupted image file");
  }

  // ---- 3. Decode ----------------------------------------------------------
  let img: Image;
  try {
    img = await Image.decode(original);
  } catch {
    await admin.storage.from(bucket).remove([path]);
    return fail(415, "This image could not be decoded");
  }

  // ---- 4. Decompression-bomb guard ---------------------------------------
  const srcW = img.width;
  const srcH = img.height;
  if (srcW * srcH > MAX_PIXELS) {
    await admin.storage.from(bucket).remove([path]);
    return fail(413, "Image has too many pixels to process safely");
  }

  // ---- 5. Resize ----------------------------------------------------------
  const main = fitWithin(srcW, srcH, MAX_DIMENSION);
  if (main.width !== srcW || main.height !== srcH) {
    img.resize(main.width, main.height);
  }

  // ---- 6. Encode ----------------------------------------------------------
  // Re-encoding drops all original metadata (EXIF, GPS, colour profiles).
  let encoded: Uint8Array;
  let outExt: string;
  let outMime: string;
  try {
    encoded = await img.encode(Image.WEBP, ENCODE_QUALITY);
    outExt = "webp";
    outMime = "image/webp";
  } catch {
    // Fallback if the runtime's WebP encoder is unavailable.
    encoded = await img.encode(Image.JPEG, ENCODE_QUALITY);
    outExt = "jpg";
    outMime = "image/jpeg";
  }

  // ---- 7. Thumbnail -------------------------------------------------------
  let thumbUrl: string | null = null;
  let thumbPath: string | null = null;
  try {
    const thumb = await Image.decode(encoded);
    const t = fitWithin(thumb.width, thumb.height, THUMB_DIMENSION);
    thumb.resize(t.width, t.height);
    const thumbBytes = outExt === "webp"
      ? await thumb.encode(Image.WEBP, 70)
      : await thumb.encode(Image.JPEG, 75);

    thumbPath = `${userId}/${crypto.randomUUID()}.${outExt}`;
    const { error: thumbErr } = await admin.storage
      .from(targetBucket)
      .upload(thumbPath, thumbBytes, {
        contentType: outMime,
        cacheControl: "31536000",
        upsert: false,
      });

    if (thumbErr) {
      thumbPath = null;
    } else {
      thumbUrl = admin.storage.from(targetBucket).getPublicUrl(thumbPath).data.publicUrl;
    }
  } catch {
    // A thumbnail is an optimisation, not a requirement.
    thumbPath = null;
  }

  // ---- 8. Upload the processed image -------------------------------------
  const outPath = `${userId}/${crypto.randomUUID()}.${outExt}`;
  const { error: upErr } = await admin.storage
    .from(targetBucket)
    .upload(outPath, encoded, {
      contentType: outMime,
      cacheControl: "31536000",
      upsert: false,
    });

  if (upErr) {
    return fail(500, "Could not store the processed image");
  }

  const publicUrl = admin.storage.from(targetBucket).getPublicUrl(outPath).data.publicUrl;

  // ---- 9. Record metadata -------------------------------------------------
  const { error: metaErr } = await admin.from("media_assets").insert({
    owner_id: userId,
    bucket: targetBucket,
    path: outPath,
    url: publicUrl,
    thumb_bucket: thumbPath ? targetBucket : null,
    thumb_path: thumbPath,
    thumb_url: thumbUrl,
    kind: "image",
    mime_type: outMime,
    width: main.width,
    height: main.height,
    bytes: encoded.byteLength,
    processed: true,
  });
  if (metaErr) {
    // Non-fatal: the image is stored and usable; only the audit row is missing.
    console.error("media_assets insert failed:", metaErr.message);
  }

  // ---- 10. Delete the staging original -----------------------------------
  await admin.storage.from(bucket).remove([path]);

  return new Response(
    JSON.stringify({
      ok: true,
      url: publicUrl,
      thumbUrl,
      width: main.width,
      height: main.height,
      bytes: encoded.byteLength,
      format: outExt,
      originalBytes: original.byteLength,
      originalSize: `${srcW}x${srcH}`,
      resized: srcW !== main.width || srcH !== main.height,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
