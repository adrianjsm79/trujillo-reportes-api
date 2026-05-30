// ============================================================
// HASH DE CONTRASEÑAS - Web Crypto API (Workers compatible)
// Usamos PBKDF2 ya que bcrypt no está disponible en Workers
// ============================================================

const ITERATIONS = 100_000;
const KEY_LENGTH  = 256;
const ALGORITHM   = 'SHA-256';

function bufToHex(buf) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuf(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2)
    bytes[i / 2] = parseInt(hex.substring(i, 2 + i), 16);
  return bytes;
}

// Hashea una contraseña con PBKDF2 + salt aleatorio
export async function hashPassword(password) {
  const salt    = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = bufToHex(salt);
  const key     = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits    = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: ALGORITHM },
    key, KEY_LENGTH
  );
  return `${saltHex}:${bufToHex(bits)}`;
}

// Verifica una contraseña contra su hash
export async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const salt  = hexToBuf(saltHex);
  const key   = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits  = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: ALGORITHM },
    key, KEY_LENGTH
  );
  return bufToHex(bits) === hashHex;
}