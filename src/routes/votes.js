// ============================================================
// RUTAS DE VOTOS / APOYOS
// POST   /api/votes/:reportId  - Votar un reporte
// DELETE /api/votes/:reportId  - Quitar voto
// GET    /api/votes/:reportId  - Ver quién votó (solo admin)
// ============================================================
import { Hono }         from 'hono';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { generateId, ok, err }       from '../utils/helpers.js';

const votes = new Hono();

// ── Votar un reporte ──────────────────────────────────────
votes.post('/:reportId', requireAuth, async (c) => {
  const { reportId } = c.req.param();
  const user         = c.get('user');

  const report = await c.env.DB.prepare('SELECT id FROM reports WHERE id = ?').bind(reportId).first();
  if (!report) return err(c, 'Reporte no encontrado', 404);

  // Verificar si ya votó
  const existing = await c.env.DB.prepare(
    'SELECT id FROM votes WHERE report_id = ? AND user_id = ?'
  ).bind(reportId, user.id).first();

  if (existing) return err(c, 'Ya apoyaste este reporte', 409);

  const id = generateId('vot');
  await c.env.DB.prepare(
    'INSERT INTO votes (id, report_id, user_id) VALUES (?, ?, ?)'
  ).bind(id, reportId, user.id).run();

  // Actualizar contador
  await c.env.DB.prepare(
    'UPDATE reports SET vote_count = vote_count + 1 WHERE id = ?'
  ).bind(reportId).run();

  const updated = await c.env.DB.prepare('SELECT vote_count FROM reports WHERE id = ?').bind(reportId).first();

  return ok(c, { voted: true, vote_count: updated.vote_count }, 201);
});

// ── Quitar voto ───────────────────────────────────────────
votes.delete('/:reportId', requireAuth, async (c) => {
  const { reportId } = c.req.param();
  const user         = c.get('user');

  const vote = await c.env.DB.prepare(
    'SELECT id FROM votes WHERE report_id = ? AND user_id = ?'
  ).bind(reportId, user.id).first();

  if (!vote) return err(c, 'No has apoyado este reporte', 404);

  await c.env.DB.prepare('DELETE FROM votes WHERE id = ?').bind(vote.id).run();

  await c.env.DB.prepare(
    'UPDATE reports SET vote_count = MAX(0, vote_count - 1) WHERE id = ?'
  ).bind(reportId).run();

  const updated = await c.env.DB.prepare('SELECT vote_count FROM reports WHERE id = ?').bind(reportId).first();

  return ok(c, { voted: false, vote_count: updated.vote_count });
});

// ── Ver votantes (solo admin) ─────────────────────────────
votes.get('/:reportId', requireAdmin, async (c) => {
  const { reportId } = c.req.param();

  const rows = await c.env.DB.prepare(`
    SELECT v.created_at, u.username, u.district
    FROM votes v
    JOIN users u ON v.user_id = u.id
    WHERE v.report_id = ?
    ORDER BY v.created_at DESC
  `).bind(reportId).all();

  return ok(c, { voters: rows.results, total: rows.results.length });
});

export default votes;