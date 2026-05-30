// ============================================================
// JWT - Usando Web Crypto API (compatible con Cloudflare Workers)
// ============================================================

function base64urlEncode(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return atob(str);
}

async function getKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

// Genera un token JWT
export async function signToken(payload, secret, expiresInHours = 24) {
  const header  = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const exp     = Math.floor(Date.now() / 1000) + expiresInHours * 3600;
  const body    = base64urlEncode(JSON.stringify({ ...payload, exp, iat: Math.floor(Date.now() / 1000) }));
  const key     = await getKey(secret);
  const sigBuf  = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${body}`));
  const sig     = base64urlEncode(String.fromCharCode(...new Uint8Array(sigBuf)));
  return `${header}.${body}.${sig}`;
}

// Verifica y decodifica un token JWT
export async function verifyToken(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, body, sig] = parts;
    const key       = await getKey(secret);
    const sigBytes  = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const valid     = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(`${header}.${body}`));
    if (!valid) return null;

    const payload = JSON.parse(base64urlDecode(body));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null; // expirado

    return payload;
  } catch {
    return null;
  }
}