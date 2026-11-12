// Verifies the Cloudflare Access JWT on /app and /api. Without a valid token
// signed by OUR team and issued for OUR Access app (aud), the request is refused,
// so the page is never public even if Access gets switched off by mistake.
// Needs vars ACCESS_TEAM_DOMAIN (e.g. "yourteam.cloudflareaccess.com") and ACCESS_AUD.

let jwksCache = { at: 0, keys: null, team: null };

function b64urlToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const b64json = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

async function keys(team) {
  if (jwksCache.keys && jwksCache.team === team && Date.now() - jwksCache.at < 3600_000) return jwksCache.keys;
  const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error("access_certs_unavailable");
  const j = await r.json();
  jwksCache = { at: Date.now(), keys: j.keys || [], team };
  return jwksCache.keys;
}

function cookie(request, name) {
  const c = request.headers.get("Cookie") || "";
  const m = c.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? m[1] : null;
}

/** Returns { email } when valid, or { error } otherwise. */
export async function verifyAccess(request, env) {
  const team = (env.ACCESS_TEAM_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const aud = env.ACCESS_AUD;
  if (!team || !aud) return { error: "access_not_configured" };
  const token = request.headers.get("Cf-Access-Jwt-Assertion") || cookie(request, "CF_Authorization");
  if (!token) return { error: "no_access_token" };
  const parts = token.split(".");
  if (parts.length !== 3) return { error: "bad_token" };
  let header, payload;
  try { header = b64json(parts[0]); payload = b64json(parts[1]); } catch { return { error: "bad_token" }; }
  if (header.alg !== "RS256") return { error: "bad_alg" };
  const jwk = (await keys(team)).find((k) => k.kid === header.kid);
  if (!jwk) return { error: "unknown_key" };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
  if (!ok) return { error: "bad_signature" };
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) return { error: "expired" };
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) return { error: "wrong_aud" };
  if (payload.iss !== `https://${team}`) return { error: "wrong_issuer" };
  return { email: payload.email || null };
}
