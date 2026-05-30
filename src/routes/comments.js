// ============================================================
// RUTAS DE COMENTARIOS
// GET  /api/comments/:reportId   - Listar comentarios de un reporte
// POST /api/comments/:reportId   - Agregar comentario
// DELETE /api/comments/:id       - Eliminar comentario
// ============================================================
import { Hono }       from 'hono';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { generateId, ok, err, paginate } from '../utils/helpers.js';

const comments = new Hono();

// ── Listar comentarios de un reporte ──────────────────────
comments.get('/:reportId', optionalAuth, async (c) => {
  const { reportId }           = c.req.param();
  const { page, limit, offset } = paginate(c.req.query('page'), c.req.query('limit') || 20);

  const report = await c.env.DB.prepare('SELECT id FROM reports WHERE id = ?').bind(reportId).first();
  if (!report) return err(c, 'Reporte no encontrado', 404);

  const rows = await c.env.DB.prepare(`
    SELECT
      cm.id, cm.content, cm.is_official, cm.created_at,
      u.username AS author_username,
      u.avatar_url AS author_avatar,
      u.role AS author_role
    FROM comments cm
    LEFT JOIN users u ON cm.user_id = u.id
    WHERE cm.report_id = ?
    ORDER BY cm.created_at ASC
    LIMIT ? OFFSET ?
  `).bind(reportId, limit, offset).all();

  const total = await c.env.DB.prepare(
    'SELECT COUNT(*) AS total FROM comments WHERE report_id = ?'
  ).bind(reportId).first();

  return ok(c, {
    comments: rows.results,
    pagination: { page, limit, total: total.total, total_pages: Math.ceil(total.total / limit) }
  });
});

// ── Agregar comentario ────────────────────────────────────
comments.post('/:reportId', requireAuth, async (c) => {
  const { reportId } = c.req.param();
  const user         = c.get('user');
  const { content }  = await c.req.json();

  if (!content?.trim())        return err(c, 'El contenido del comentario es requerido');
  if (content.length < 3)      return err(c, 'El comentario es muy corto');
  if (content.length > 1000)   return err(c, 'El comentario no puede exceder 1000 caracteres');

  const report = await c.env.DB.prepare('SELECT id FROM reports WHERE id = ?').bind(reportId).first();
  if (!report) return err(c, 'Reporte no encontrado', 404);

  const isOfficial = ['authority', 'admin'].includes(user.role) ? 1 : 0;
  const id         = generateId('cmt');

  await c.env.DB.prepare(`
    INSERT INTO comments (id, report_id, user_id, content, is_official)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, reportId, user.id, content.trim(), isOfficial).run();

  // Actualizar contador de comentarios en el reporte
  await c.env.DB.prepare(`
    UPDATE reports SET comment_count = comment_count + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(reportId).run();

  // Si es respuesta oficial, guardarla también en official_response
  if (isOfficial) {
    await c.env.DB.prepare(`
      UPDATE reports SET official_response = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(content.trim(), reportId).run();
  }

  return ok(c, {
    id,
    report_id:       reportId,
    content:         content.trim(),
    is_official:     isOfficial,
    author_username: user.username,
    author_role:     user.role,
    created_at:      new Date().toISOString()
  }, 201);
});

// ── Eliminar comentario ───────────────────────────────────
comments.delete('/:id', requireAuth, async (c) => {
  const { id } = c.req.param();
  const user   = c.get('user');

  const comment = await c.env.DB.prepare(
    'SELECT * FROM comments WHERE id = ?'
  ).bind(id).first();

  if (!comment) return err(c, 'Comentario no encontrado', 404);

  if (comment.user_id !== user.id && user.role !== 'admin')
    return err(c, 'Sin permisos para eliminar este comentario', 403);

  await c.env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(id).run();

  await c.env.DB.prepare(`
    UPDATE reports SET comment_count = MAX(0, comment_count - 1) WHERE id = ?
  `).bind(comment.report_id).run();

  return ok(c, { message: 'Comentario eliminado' });
});

export default comments;