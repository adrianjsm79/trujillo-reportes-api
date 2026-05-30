// ============================================================
// MIDDLEWARE DE AUTENTICACIÓN
// ============================================================
import { verifyToken } from '../utils/jwt.js';
import { err }         from '../utils/helpers.js';

// Middleware: requiere token válido
export async function requireAuth(c, next) {
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) return err(c, 'Token requerido', 401);

  const payload = await verifyToken(auth.slice(7), c.env.JWT_SECRET);
  if (!payload) return err(c, 'Token inválido o expirado', 401);

  c.set('user', payload);
  await next();
}

// Middleware: requiere rol de autoridad o admin
export async function requireAuthority(c, next) {
  await requireAuth(c, async () => {
    const user = c.get('user');
    if (!['authority', 'admin'].includes(user.role))
      return err(c, 'Acceso denegado', 403);
    await next();
  });
}

// Middleware: requiere rol de admin
export async function requireAdmin(c, next) {
  await requireAuth(c, async () => {
    const user = c.get('user');
    if (user.role !== 'admin') return err(c, 'Acceso denegado', 403);
    await next();
  });
}

// Middleware: inyecta usuario si hay token (no falla si no hay)
export async function optionalAuth(c, next) {
  const auth = c.req.header('Authorization');
  if (auth?.startsWith('Bearer ')) {
    const payload = await verifyToken(auth.slice(7), c.env.JWT_SECRET);
    if (payload) c.set('user', payload);
  }
  await next();
}