// Verifies Cloudflare Access JWTs so the Worker can trust *who* is hitting
// /api/admin/* routes instead of a shared passphrase. Access sits in front
// of /admin/* at the edge (configured in the Cloudflare Zero Trust
// dashboard, not in this repo) and attaches a signed JWT either as the
// Cf-Access-Jwt-Assertion header (fetch/XHR calls from the admin page) or
// the CF_Authorization cookie (the initial page load). This only checks the
// JWT is validly signed by *your* Access team and not expired — the actual
// "which emails are allowed in" policy lives in the Access dashboard, so
// if a request reaches here at all it already passed that check. We still
// read the email out of the token for auditing/notifications.
//
// Needs two vars set once the Access application exists:
//   CF_ACCESS_TEAM_DOMAIN  e.g. "boxedindulgence.cloudflareaccess.com"
//   CF_ACCESS_AUD          the Application Audience (AUD) tag from the
//                           Access application's Overview tab

let cachedCerts = null;
let cachedAt = 0;
const CACHE_MS = 10 * 60_000;

function base64UrlToUint8Array(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    b64url.length + ((4 - (b64url.length % 4)) % 4),
    "="
  );
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function decodeJwtPart(part) {
  return JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(part)));
}

async function getAccessCerts(env) {
  const now = Date.now();
  if (cachedCerts && now - cachedAt < CACHE_MS) return cachedCerts;
  const res = await fetch(`https://${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error("Failed to fetch Access certs");
  cachedCerts = await res.json();
  cachedAt = now;
  return cachedCerts;
}

export function getAccessJwt(request) {
  const header = request.headers.get("Cf-Access-Jwt-Assertion");
  if (header) return header;
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/CF_Authorization=([^;]+)/);
  return match ? match[1] : null;
}

// Returns { email } on success, or null if the request isn't authenticated.
export async function verifyAccessJwt(request, env) {
  if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) {
    console.error("[access] CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD not configured");
    return null;
  }

  const token = getAccessJwt(request);
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  let header, payload;
  try {
    header = decodeJwtPart(headerB64);
    payload = decodeJwtPart(payloadB64);
  } catch {
    return null;
  }

  if (!payload.aud || !payload.aud.includes(env.CF_ACCESS_AUD)) return null;
  if (payload.exp && Date.now() / 1000 > payload.exp) return null;

  const certs = await getAccessCerts(env);
  const jwk = (certs.keys || certs.public_certs || []).find((k) => k.kid === header.kid);
  if (!jwk || !jwk.kty) return null;

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlToUint8Array(sigB64);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signedData);
  if (!valid) return null;

  return { email: payload.email || null };
}
