// ============================================================
// CLOUDINARY HELPER
// Sube imágenes usando la Upload API de Cloudinary vía fetch.
// Compatible con Cloudflare Workers (no usa Node.js SDK).
// ============================================================

/**
 * Sube un archivo (ArrayBuffer o Blob) a Cloudinary.
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

  // Cloudinary requiere firma HMAC-SHA1 para uploads autenticados
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const paramsToSign = `public_id=${publicId}&timestamp=${timestamp}`;
  const signature   = await hmacSha1(paramsToSign, CLOUDINARY_API_SECRET);

  // Construir el FormData para el upload
  const form = new FormData();
  form.append('file',       new Blob([buffer], { type: mimeType }));
  form.append('public_id',  publicId);
  form.append('timestamp',  timestamp);
  form.append('api_key',    CLOUDINARY_API_KEY);
  form.append('signature',  signature);

  const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

  const res = await fetch(uploadUrl, { method: 'POST', body: form });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Cloudinary error ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  return data.secure_url; // URL pública HTTPS
}

// ── HMAC-SHA1 usando Web Crypto API (disponible en Workers) ──
async function hmacSha1(message, secret) {
  const enc     = new TextEncoder();
  const keyData = enc.encode(secret);
  const msgData = enc.encode(message);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData,
    { name: 'HMAC', hash: 'SHA-1' },
    false, ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, msgData);

  // Convertir a hex string
  return Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
