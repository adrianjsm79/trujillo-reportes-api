// ============================================================
// CLOUDINARY HELPER
// Sube imágenes usando la Upload API de Cloudinary vía fetch.
// Compatible con Cloudflare Workers (no usa Node.js SDK).
// ============================================================

/**
 * Sube un archivo (ArrayBuffer) a Cloudinary.
 *
 * @param {ArrayBuffer} buffer    - Contenido del archivo
 * @param {string}      mimeType  - e.g. "image/jpeg"
 * @param {string}      publicId  - ID público en Cloudinary (ej: "reports/rpt_abc123")
 * @param {object}      env       - Env de Cloudflare Workers con:
 *                                    CLOUDINARY_CLOUD_NAME
 *                                    CLOUDINARY_API_KEY
 *                                    CLOUDINARY_API_SECRET
 * @returns {Promise<string>}     - URL segura (https) de la imagen subida
 */
export async function uploadToCloudinary(buffer, mimeType, publicId, env) {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = env;

  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new Error('Faltan variables de entorno de Cloudinary (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET)');
  }

  // Los parámetros a firmar deben ir ordenados alfabéticamente
  // NO se incluyen: file, api_key, resource_type, signature
  const timestamp     = Math.floor(Date.now() / 1000).toString();
  const paramsToSign  = `public_id=${publicId}&timestamp=${timestamp}`;

  // Cloudinary acepta SHA-1 o SHA-256 según la config de la cuenta.
  // Intentamos SHA-256 primero (cuentas nuevas), con fallback a SHA-1.
  let signature;
  try {
    signature = await hmacSha256(paramsToSign, CLOUDINARY_API_SECRET);
  } catch {
    signature = await hmacSha1(paramsToSign, CLOUDINARY_API_SECRET);
  }

  // Construir el FormData para el upload
  const form = new FormData();
  // Nombre de archivo opcional pero ayuda a Cloudinary a detectar el tipo
  const ext  = mimeType.split('/')[1] || 'jpg';
  form.append('file',       new Blob([buffer], { type: mimeType }), `upload.${ext}`);
  form.append('public_id',  publicId);
  form.append('timestamp',  timestamp);
  form.append('api_key',    CLOUDINARY_API_KEY);
  form.append('signature',  signature);

  const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

  const res = await fetch(uploadUrl, { method: 'POST', body: form });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Cloudinary ${res.status}: ${errBody}`);
  }

  const data = await res.json();

  if (!data.secure_url) {
    throw new Error(`Cloudinary no devolvió secure_url: ${JSON.stringify(data)}`);
  }

  return data.secure_url;
}

// ── HMAC-SHA256 (cuentas nuevas de Cloudinary) ──────────────
async function hmacSha256(message, secret) {
  const enc     = new TextEncoder();
  const keyData = enc.encode(secret);
  const msgData = enc.encode(message);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );

  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  return toHex(sig);
}

// ── HMAC-SHA1 (cuentas antiguas de Cloudinary) ──────────────
async function hmacSha1(message, secret) {
  const enc     = new TextEncoder();
  const keyData = enc.encode(secret);
  const msgData = enc.encode(message);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData,
    { name: 'HMAC', hash: 'SHA-1' },
    false, ['sign']
  );

  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  return toHex(sig);
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
