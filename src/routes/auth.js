// ============================================================
// RUTAS DE AUTENTICACIÓN
// POST /api/auth/register
// POST /api/auth/login
// GET  /api/auth/me
// POST /api/auth/change-password
// ============================================================
import { Hono }           from 'hono';
import { hashPassword, verifyPassword } from '../utils/hash.js';
import { signToken }      from '../utils/jwt.js';
import { generateId, ok, err } from '../utils/helpers.js';
import { requireAuth }    from '../middleware/auth.js';

const auth = new Hono();

// ── Registro ──────────────────────────────────────────────
auth.post('/register', async (c) => {
  const { username, email, password, district } = await c.req.json();

  if (!username || !email || !password)
    return err(c, 'username, email y password son requeridos');

  if (password.length < 6)
    return err(c, 'La contraseña debe tener al menos 6 caracteres');

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return err(c, 'Email inválido');

  // Verificar duplicados
  const existing = await c.env.DB.prepare(
    'SELECT id FROM users WHERE email = ? OR username = ?'
  ).bind(email, username).first();

  if (existing) return err(c, 'El email o username ya está en uso');

  const id   = generateId('usr');
  const hash = await hashPassword(password);

  await c.env.DB.prepare(`
    INSERT INTO users (id, username, email, password, district)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, username, email, hash, district || null).run();

  const token = await signToken({ id, username, email, role: 'citizen' }, c.env.JWT_SECRET);

  return ok(c, {
    token,
    user: { id, username, email, role: 'citizen', district }
  }, 201);
});

// ── Login ─────────────────────────────────────────────────
auth.post('/login', async (c) => {
  const { email, password } = await c.req.json();

  if (!email || !password) return err(c, 'Email y password requeridos');

  const user = await c.env.DB.prepare(
    'SELECT * FROM users WHERE email = ? AND is_active = 1'
  ).bind(email).first();

  if (!user) return err(c, 'Credenciales inválidas', 401);

  const valid = await verifyPassword(password, user.password);
  if (!valid) return err(c, 'Credenciales inválidas', 401);

  const token = await signToken(
    { id: user.id, username: user.username, email: user.email, role: user.role },
    c.env.JWT_SECRET
  );

  return ok(c, {
    token,
    user: {
      id:       user.id,
      username: user.username,
      email:    user.email,
      role:     user.role,
      district: user.district,
      avatar_url: user.avatar_url
    }
  });
});

// ── Perfil actual ─────────────────────────────────────────
auth.get('/me', requireAuth, async (c) => {
  const { id } = c.get('user');

  const user = await c.env.DB.prepare(
    'SELECT id, username, email, role, district, avatar_url, created_at FROM users WHERE id = ?'
  ).bind(id).first();

  if (!user) return err(c, 'Usuario no encontrado', 404);

  // Estadísticas del usuario
  const stats = await c.env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM reports WHERE user_id = ?) AS total_reports,
      (SELECT COUNT(*) FROM reports WHERE user_id = ? AND status = 'resolved') AS resolved_reports,
      (SELECT COUNT(*) FROM votes WHERE user_id = ?) AS total_votes
  `).bind(id, id, id).first();

  return ok(c, { ...user, stats });
});

// ── Cambiar contraseña ────────────────────────────────────
auth.post('/change-password', requireAuth, async (c) => {
  const { currentPassword, newPassword } = await c.req.json();
  const { id } = c.get('user');

  if (!currentPassword || !newPassword)
    return err(c, 'currentPassword y newPassword son requeridos');

  if (newPassword.length < 6)
    return err(c, 'La nueva contraseña debe tener al menos 6 caracteres');

  const user = await c.env.DB.prepare('SELECT password FROM users WHERE id = ?').bind(id).first();
  const valid = await verifyPassword(currentPassword, user.password);
  if (!valid) return err(c, 'Contraseña actual incorrecta', 401);

  const hash = await hashPassword(newPassword);
  await c.env.DB.prepare('UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(hash, id).run();

  return ok(c, { message: 'Contraseña actualizada correctamente' });
});

export default auth;