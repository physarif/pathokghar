// functions/api/r2-upload.js
// Cloudflare Pages Function — runs server-side only.
// Uploads a file to R2 using the native R2 bucket binding (no access/secret key needed at all).
// Requires a valid Firebase ID token from the logged-in admin.

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function verifyIdToken(idToken, apiKey) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.users?.[0]?.localId || null;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const idToken = (request.headers.get("Authorization") || "").replace("Bearer ", "");
    if (!idToken) return json({ error: "Unauthorized" }, 401);

    const uid = await verifyIdToken(idToken, env.FIREBASE_API_KEY);
    if (!uid) return json({ error: "Unauthorized" }, 401);
    if (env.ADMIN_UID && uid !== env.ADMIN_UID) return json({ error: "Forbidden" }, 403);

    const key = request.headers.get("X-File-Key");
    if (!key) return json({ error: "Missing X-File-Key header" }, 400);

    const contentType = request.headers.get("Content-Type") || "application/octet-stream";

    await env.R2_BUCKET.put(key, request.body, {
      httpMetadata: { contentType },
    });

    return json({ url: `${env.R2_PUBLIC_URL}/${key}`, key });
  } catch (err) {
    return json({ error: err.message || "Upload failed" }, 500);
  }
}
