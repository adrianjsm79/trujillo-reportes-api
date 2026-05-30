// Genera IDs únicos usando crypto
export function generateId(prefix = '') {
  const arr = crypto.getRandomValues(new Uint8Array(12));
  const hex = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  return prefix ? `${prefix}-${hex}` : hex;
}

// Respuestas JSON estándar
export function ok(c, data, status = 200) {
  return c.json({ success: true, data }, status);
}

export function err(c, message, status = 400) {
  return c.json({ success: false, error: message }, status);
}

// Paginación
export function paginate(page = 1, limit = 10) {
  const p      = Math.max(1, parseInt(page));
  const l      = Math.min(50, Math.max(1, parseInt(limit)));
  const offset = (p - 1) * l;
  return { page: p, limit: l, offset };
}