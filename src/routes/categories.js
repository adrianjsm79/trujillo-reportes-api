// ============================================================
// RUTAS DE CATEGORÍAS
// GET  /api/categories        - Listar todas las categorías
// POST /api/categories        - Crear categoría (admin)
// PUT  /api/categories/:id    - Editar categoría (admin)
// DELETE /api/categories/:id  - Eliminar categoría (admin)
// ============================================================
import { Hono }        from 'hono';
import { requireAdmin } from '../middleware/auth.js';
import { ok, err }      from '../utils/helpers.js';

const categories = new Hono();

// ── Listar categorías con conteo de reportes ──────────────
categories.get('/', async (c) => {
  const rows = await c.env.DB.prepare(`
    SELECT
      c.id, c.name, c.icon, c.color,
      COUNT(r.id) AS report_count
    FROM categories c
    LEFT JOIN reports r ON r.category_id = c.id
    GROUP BY c.id
    ORDER BY c.id ASC
  `).all();

  return ok(c, { categories: rows.results });
});

// ── Crear categoría ───────────────────────────────────────
categories.post('/', requireAdmin, async (c) => {
  const { name, icon, color } = await c.req.json();

  if (!name || !icon || !color) return err(c, 'name, icon y color son requeridos');

  const existing = await c.env.DB.prepare(
    'SELECT id FROM categories WHERE name = ?'
  ).bind(name).first();
  if (existing) return err(c, 'Ya existe una categoría con ese nombre');

  const result = await c.env.DB.prepare(
    'INSERT INTO categories (name, icon, color) VALUES (?, ?, ?)'
  ).bind(name, icon, color).run();

  return ok(c, { id: result.meta.last_row_id, name, icon, color }, 201);
});

// ── Editar categoría ──────────────────────────────────────
categories.put('/:id', requireAdmin, async (c) => {
  const { id }            = c.req.param();
  const { name, icon, color } = await c.req.json();

  const existing = await c.env.DB.prepare('SELECT id FROM categories WHERE id = ?').bind(id).first();
  if (!existing) return err(c, 'Categoría no encontrada', 404);

  await c.env.DB.prepare(`
    UPDATE categories SET
      name  = COALESCE(?, name),
      icon  = COALESCE(?, icon),
      color = COALESCE(?, color)
    WHERE id = ?
  `).bind(name, icon, color, id).run();

  const updated = await c.env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first();
  return ok(c, updated);
});

// ── Eliminar categoría ────────────────────────────────────
categories.delete('/:id', requireAdmin, async (c) => {
  const { id } = c.req.param();

  const inUse = await c.env.DB.prepare(
    'SELECT COUNT(*) AS total FROM reports WHERE category_id = ?'
  ).bind(id).first();

  if (inUse.total > 0)
    return err(c, `No puedes eliminar esta categoría, tiene ${inUse.total} reportes asociados`);

  await c.env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
  return ok(c, { message: 'Categoría eliminada' });
});

export default categories;