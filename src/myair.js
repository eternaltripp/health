// ResMed myAir (CPAP). Undocumented web API, North America region. Login flow
// carried over from the old connector, which mirrors the open-source Home
// Assistant integration prestomation/resmed_myair_sensors. Can break if ResMed
// changes their login.
import { round1 } from "./util.js";

const MYAIR = {
  okta: "https://resmed-ext-1.okta.com",
  authServer: "aus4ccsxvnidQgLmA297",
  clientId: "0oa4ccq1v413ypROi297",
  apiKey: "da2-cenztfjrezhwphdqtwtbpqvzui", // public app key embedded in ResMed's web client
  graphql: "https://graphql.myair-prd.dht.live/graphql",
  redirect: "https://myair.resmed.com",
  product: "myAir",
};

function setCookies(res) {
  if (typeof res.headers.getSetCookie === "function") return res.headers.getSetCookie();
  const one = res.headers.get("set-cookie");
  return one ? [one] : [];
}
function pickCookie(list, name) {
  for (const c of list) {
    const m = c.match(new RegExp("(?:^|[;,]\\s*)" + name + "=([^;]+)", "i"));
    if (m) return m[1];
  }
  return null;
}
function b64url(bytes) {
  let s = "";
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function jwtClaims(t) {
  try {
    const p = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(p + "===".slice((p.length + 3) % 4)));
  } catch (e) { return {}; }
}

async function login(env) {
  if (!env.MYAIR_EMAIL || !env.MYAIR_PASSWORD) throw new Error("myair_not_configured");
  const base = `${MYAIR.okta}/oauth2/${MYAIR.authServer}/v1`;
  const saved = JSON.parse((await env.OURA_KV.get("myair")) || "{}");
  let dt = saved.dt || null;
  const cookieHdr = () => (dt ? "DT=" + dt : "");

  const authn = await fetch(`${MYAIR.okta}/api/v1/authn`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Cookie: cookieHdr() },
    body: JSON.stringify({ username: env.MYAIR_EMAIL, password: env.MYAIR_PASSWORD }),
  });
  const a = await authn.json();
  dt = pickCookie(setCookies(authn), "DT") || dt;
  if (a.status === "MFA_REQUIRED") throw new Error("myair_mfa_required");
  if (a.status !== "SUCCESS" || !a.sessionToken) throw new Error("myair_login_failed: " + (a.errorSummary || a.status || authn.status));

  const verifier = b64url(crypto.getRandomValues(new Uint8Array(40)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const q = new URLSearchParams({
    client_id: MYAIR.clientId, code_challenge: challenge, code_challenge_method: "S256",
    prompt: "none", redirect_uri: MYAIR.redirect, response_mode: "fragment",
    response_type: "code", sessionToken: a.sessionToken, scope: "openid profile email", state: "abcdef",
  });
  const codeRes = await fetch(`${base}/authorize?${q}`, { redirect: "manual", headers: { Cookie: cookieHdr() } });
  const loc = codeRes.headers.get("location") || "";
  const code = new URLSearchParams(loc.split("#")[1] || "").get("code");
  if (!code) throw new Error("myair_no_auth_code");

  const tokRes = await fetch(`${base}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: MYAIR.clientId, redirect_uri: MYAIR.redirect,
      grant_type: "authorization_code", code_verifier: verifier, code,
    }),
  });
  const tok = await tokRes.json();
  if (!tok.access_token) throw new Error("myair_token_failed");
  const state = {
    dt, access: tok.access_token,
    country: jwtClaims(tok.id_token || "").myAirCountryId || "US",
    exp: Date.now() + Number(tok.expires_in || 3600) * 1000,
  };
  await env.OURA_KV.put("myair", JSON.stringify(state));
  return state;
}

async function session(env, force) {
  const saved = JSON.parse((await env.OURA_KV.get("myair")) || "{}");
  if (!force && saved.access && Date.now() < saved.exp - 60000) return saved;
  return login(env);
}

/** Nights with startDate in [start, end]. Returns rows shaped for the cpap table. */
export async function pullCpap(env, start, end) {
  // myAir queries by month; widen the window so month boundaries are covered.
  const startMonth = start.slice(0, 8) + "01";
  const query = `query GetPatientSleepRecords { getPatientWrapper { patient { firstName }
    sleepRecords(startMonth: "${startMonth}", endMonth: "${end}") { items {
      startDate totalUsage sleepScore usageScore ahiScore maskScore leakScore
      ahi maskPairCount leakPercentile sleepRecordPatientId __typename } __typename } __typename } }`;

  const run = async (s) => {
    const r = await fetch(MYAIR.graphql, {
      method: "POST",
      headers: {
        "Content-Type": "application/json", "x-api-key": MYAIR.apiKey,
        Authorization: "Bearer " + s.access,
        rmdhandsetid: "02c1c662-c289-41fd-a9ae-196ff15b5166", rmdlanguage: "en",
        rmdhandsetmodel: "Chrome", rmdhandsetosversion: "127.0.6533.119",
        rmdproduct: MYAIR.product, rmdappversion: "1.0.0", rmdhandsetplatform: "Web",
        rmdcountry: s.country, "accept-language": "en-US,en;q=0.9",
      },
      body: JSON.stringify({ operationName: "GetPatientSleepRecords", variables: {}, query }),
    });
    return r.json();
  };

  let j = await run(await session(env, false));
  if (j.errors) j = await run(await session(env, true)); // stale token: log in fresh once
  if (j.errors) throw new Error("myair_query_failed: " + JSON.stringify(j.errors).slice(0, 200));

  const items = (((j.data || {}).getPatientWrapper || {}).sleepRecords || {}).items || [];
  return items
    .filter((r) => r.startDate && r.startDate >= start && r.startDate <= end)
    .map((r) => ({
      date: r.startDate,
      hours: r.totalUsage != null ? round1(r.totalUsage / 60) : null,
      ahi: r.ahi != null ? round1(r.ahi) : null,
      leak: r.leakPercentile ?? null,
      mask_off: r.maskPairCount ?? null,
      myair_score: r.sleepScore ?? null,
    }))
    // myAir returns placeholder rows for nights with no use; keep them only if they carry data
    .filter((r) => r.hours != null || r.ahi != null)
    .sort((x, y) => (x.date < y.date ? -1 : 1));
}
