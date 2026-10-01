/**
 * Prism → Jev proxy (Cloudflare Worker).
 *
 * Why this exists: TypeSafe's API rejects browser origins (CORS) and must see
 * your API key. This Worker holds the key as a secret, forwards the request to
 * Jev server-side, and returns the answer with CORS headers so the static
 * GitHub Pages frontend can read it. The key never touches the browser or the
 * repository.
 *
 * Deploy:
 *   npm i -g wrangler
 *   wrangler login
 *   wrangler secret put JEV_KEY      # paste your TypeSafe key when prompted
 *   wrangler deploy
 * Then paste the printed *.workers.dev URL into Prism's "Go live" dialog.
 *
 * Lock it to your own page by setting ALLOW_ORIGIN below (recommended), or
 * leave it as "*" for an open demo proxy.
 */

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const ALLOW_ORIGIN = "*"; // e.g. "https://abdulsalam-create.github.io"

function cors(origin) {
  const allow = ALLOW_ORIGIN === "*" ? (origin || "*") : ALLOW_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = cors(origin);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST")
      return json({ error: "POST only" }, 405, headers);
    if (!env.JEV_KEY)
      return json({ error: "Worker missing JEV_KEY secret" }, 500, headers);

    let body;
    try { body = await request.json(); }
    catch { return json({ error: "Body must be JSON" }, 400, headers); }

    // Only forward the three fields Jev expects - nothing else from the client.
    const payload = {
      state: body.state,
      model: body.model || "jev-latest",
      questions: body.questions,
    };

    const upstream = await fetch(JEV_URL, {
      method: "POST",
      headers: { "Authorization": "Bearer " + env.JEV_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  },
};

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
