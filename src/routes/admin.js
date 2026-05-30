// ============================================================
// RUTAS DE ADMINISTRACIÓN
// GET  /api/admin/stats                   - Dashboard de estadísticas
// GET  /api/admin/reports                 - Todos los reportes con filtros
// PUT  /api/admin/reports/:id/status      - Cambiar estado de reporte
// PUT  /api/admin/reports/:id/assign      - Asignar área responsable
// GET  /api/admin/users                   - Listar usuarios
// PUT  /api/admin/users/:id/role          - Cambiar rol de usuario
// DELETE /api/admin/users/:id             - Desactivar usuario
// GET  /api/admin/districts               - Resumen por distrito
// ============================================================
import { Hono }              from 'hono';
import { requireAuthority, requireAdmin } from '../middleware/auth.js';
import { generateId, ok, err, paginate }  from '../utils/helpers.js';

const admin = new Hono();

// Estados válidos de un reporte
const VALID_STATUSES = ['pending', 'in_progress', 'resolved', 'rejected'];

// Áreas responsables de la Municipalidad de Trujillo
const AREAS = [
  'Gerencia de Obras Públicas',
  'Gerencia de Servicios Públicos',
  'Gerencia de Seguridad Ciudadana (Serenazgo)',
  'Gerencia de Medio Ambiente',
  'Gerencia de Transporte',
  'SEDALIB (Agua y Desagüe)',
  'Empresa de Energía (Hidrandina)',
  'Otro',
];

// ── Dashboard de estadísticas ─────────────────────────────
admin.get('/stats', requireAuthority, async (c) => {
  const [
    totals, byStatus, byCategory, byDistrict, recentActivity, avgResolutionTime
  ] = await Promise.all([
    // Totales globales
    c.env.DB.prepare(`
      SELECT
        COUNT(*)                                              AS total_reports,
        SUM(CASE WHEN status = 'pending'     THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
        SUM(CASE WHEN status = 'resolved'    THEN 1 ELSE 0 END) AS resolved,
        SUM(CASE WHEN status = 'rejected'    THEN 1 ELSE 0 END) AS rejected,
        (SELECT COUNT(*) FROM users WHERE role = 'citizen') AS total_users
      FROM reports
    `).first(),

    // Reportes por estado (últimos 30 días)
    c.env.DB.prepare(`
      SELECT status, COUNT(*) AS total
      FROM reports
      WHERE created_at >= datetime('now', '-30 days')
      GROUP BY status
    `).all(),

    // Reportes por categoría
    c.env.DB.prepare(`
      SELECT c.name, c.icon, c.color, COUNT(r.id) AS total
      FROM categories c
      LEFT JOIN reports r ON r.category_id = c.id
      GROUP BY c.id
      ORDER BY total DESC
    `).all(),

    // Reportes por distrito
    c.env.DB.prepare(`
      SELECT district, COUNT(*) AS total
      FROM reports
      WHERE district IS NOT NULL
      GROUP BY district
      ORDER BY total DESC
      LIMIT 10
    `).all(),

    // Actividad reciente (últimos 7 días por día)
    c.env.DB.prepare(`
      SELECT
        date(created_at) AS day,
        COUNT(*) AS total
      FROM reports
      WHERE created_at >= datetime('now', '-7 days')
      GROUP BY date(created_at)
      ORDER BY day ASC
    `).all(),

    // Tiempo promedio de resolución (en horas)
    c.env.DB.prepare(`
      SELECT
        ROUND(AVG((julianday(resolved_at) - julianday(created_at)) * 24), 1) AS avg_hours
      FROM reports
      WHERE status = 'resolved' AND resolved_at IS NOT NULL
    `).first(),
  ]);

  return ok(c, {
    totals,
    by_status:          byStatus.results,
    by_category:        byCategory.results,
    by_district:        byDistrict.results,
    recent_activity:    recentActivity.results,
    avg_resolution_hours: avgResolutionTime?.avg_hours || 0,
    areas,
  });
});

// ── Listar todos los reportes (panel admin) ───────────────
admin.get('/reports', requireAuthority, async (c) => {
  const { page, limit, offset } = paginate(c.req.query('page'), c.req.query('limit') || 20);

  const status   = c.req.query('status');
  const category = c.req.query('category');
  const district = c.req.query('district');
  const assigned = c.req.query('assigned');
  const search   = c.req.query('search');
  const sort     = c.req.query('sort') || 'recent';

  const conditions = [];
  const bindings   = [];

  if (status)   { conditions.push('r.status = ?');      bindings.push(status); }
  if (category) { conditions.push('r.category_id = ?'); bindings.push(category); }
  if (district) { conditions.push('r.district = ?');    bindings.push(district); }
  if (assigned) { conditions.push('r.assigned_to = ?'); bindings.push(assigned); }
  if (search)   {
    conditions.push('(r.title LIKE ? OR r.description LIKE ? OR r.address LIKE ?)');
    bindings.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const orderMap = {
    recent:  'r.created_at DESC',
    oldest:  'r.created_at ASC',
    popular: 'r.vote_count DESC',
  };
  const orderBy = orderMap[sort] || orderMap.recent;

  const [rows, countRow] = await Promise.all([
    c.env.DB.prepare(`
      SELECT
        r.id, r.title, r.status, r.is_anonymous, r.district,
        r.address, r.image_url, r.vote_count, r.comment_count,
        r.assigned_to, r.created_at, r.updated_at, r.resolved_at,
        c.name AS category_name, c.icon AS category_icon,
        CASE WHEN r.is_anonymous = 1 THEN 'Anónimo' ELSE u.username END AS author
      FROM reports r
      LEFT JOIN categories c ON r.category_id = c.id
      LEFT JOIN users u ON r.user_id = u.id
      ${where}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `).bind(...bindings, limit, offset).all(),

    c.env.DB.prepare(`SELECT COUNT(*) AS total FROM reports r ${where}`)
      .bind(...bindings).first(),
  ]);

  return ok(c, {
    reports: rows.results,
    pagination: {
      page, limit,
      total:       countRow.total,
      total_pages: Math.ceil(countRow.total / limit),
    },
  });
});

// ── Cambiar estado de un reporte ──────────────────────────
admin.put('/reports/:id/status', requireAuthority, async (c) => {
  const { id }             = c.req.param();
  const { status, note }   = await c.req.json();
  const user               = c.get('user');

  if (!VALID_STATUSES.includes(status))
    return err(c, `Estado inválido. Debe ser: ${VALID_STATUSES.join(', ')}`);

  const report = await c.env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(id).first();
  if (!report) return err(c, 'Reporte no encontrado', 404);

  const resolvedAt = status === 'resolved' ? new Date().toISOString() : null;

  await c.env.DB.prepare(`
    UPDATE reports SET
      status      = ?,
      resolved_at = COALESCE(?, resolved_at),
      updated_at  = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(status, resolvedAt, id).run();

  // Guardar en historial de cambios
  const histId = generateId('his');
  await c.env.DB.prepare(`
    INSERT INTO status_history (id, report_id, old_status, new_status, changed_by, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(histId, id, report.status, status, user.id, note || null).run();

  return ok(c, { id, old_status: report.status, new_status: status, note });
});

// ── Asignar área responsable ──────────────────────────────
admin.put('/reports/:id/assign', requireAuthority, async (c) => {
  const { id }          = c.req.param();
  const { assigned_to } = await c.req.json();

  if (!assigned_to) return err(c, 'assigned_to es requerido');

  const report = await c.env.DB.prepare('SELECT id FROM reports WHERE id = ?').bind(id).first();
  if (!report) return err(c, 'Reporte no encontrado', 404);

  await c.env.DB.prepare(`
    UPDATE reports SET assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(assigned_to, id).run();

  return ok(c, { id, assigned_to });
});

// ── Ver historial de un reporte ───────────────────────────
admin.get('/reports/:id/history', requireAuthority, async (c) => {
  const { id } = c.req.param();

  const rows = await c.env.DB.prepare(`
    SELECT sh.*, u.username AS changed_by_username
    FROM status_history sh
    LEFT JOIN users u ON sh.changed_by = u.id
    WHERE sh.report_id = ?
    ORDER BY sh.created_at DESC
  `).bind(id).all();

  return ok(c, { history: rows.results });
});

// ── Listar usuarios ───────────────────────────────────────
admin.get('/users', requireAdmin, async (c) => {
  const { page, limit, offset } = paginate(c.req.query('page'), c.req.query('limit') || 20);
  const role   = c.req.query('role');
  const search = c.req.query('search');

  const conditions = [];
  const bindings   = [];

  if (role)   { conditions.push('role = ?'); bindings.push(role); }
  if (search) {
    conditions.push('(username LIKE ? OR email LIKE ?)');
    bindings.push(`%${search}%`, `%${search}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows, countRow] = await Promise.all([
    c.env.DB.prepare(`
      SELECT
        u.id, u.username, u.email, u.role, u.district,
        u.is_active, u.created_at,
        COUNT(r.id) AS report_count
      FROM users u
      LEFT JOIN reports r ON r.user_id = u.id
      ${where}
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(...bindings, limit, offset).all(),

    c.env.DB.prepare(`SELECT COUNT(*) AS total FROM users ${where}`)
      .bind(...bindings).first(),
  ]);

  return ok(c, {
    users: rows.results,
    pagination: { page, limit, total: countRow.total, total_pages: Math.ceil(countRow.total / limit) },
  });
});

// ── Cambiar rol de usuario ────────────────────────────────
admin.put('/users/:id/role', requireAdmin, async (c) => {
  const { id }   = c.req.param();
  const { role } = await c.req.json();

  if (!['citizen', 'authority', 'admin'].includes(role))
    return err(c, 'Rol inválido. Debe ser: citizen, authority o admin');

  const user = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first();
  if (!user) return err(c, 'Usuario no encontrado', 404);

  await c.env.DB.prepare('UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(role, id).run();

  return ok(c, { id, role });
});

// ── Activar / desactivar usuario ──────────────────────────
admin.put('/users/:id/active', requireAdmin, async (c) => {
  const { id }        = c.req.param();
  const { is_active } = await c.req.json();

  const user = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first();
  if (!user) return err(c, 'Usuario no encontrado', 404);

  await c.env.DB.prepare('UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(is_active ? 1 : 0, id).run();

  return ok(c, { id, is_active: !!is_active });
});

// ── Resumen de áreas disponibles ──────────────────────────
admin.get('/areas', requireAuthority, (c) => {
  return ok(c, { areas: AREAS });
});

const areas = AREAS;
export default admin;