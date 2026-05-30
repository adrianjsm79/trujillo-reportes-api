// ============================================================
// RUTAS DE REPORTES
// GET    /api/reports          - Feed/Blog de reportes
// POST   /api/reports          - Crear reporte
// GET    /api/reports/map      - Datos para el mapa
// GET    /api/reports/:id      - Detalle de reporte
// PUT    /api/reports/:id      - Editar reporte (dueño)
// DELETE /api/reports/:id      - Eliminar (admin)
// POST   /api/reports/:id/image - Subir imagen a Cloudinary
// ============================================================
import { Hono }        from 'hono';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { generateId, ok, err, paginate } from '../utils/helpers.js';
import { uploadToCloudinary } from '../utils/cloudinary.js';

const reports = new Hono();

// ── Feed / Blog de reportes ───────────────────────────────
// Soporta filtros: category, status, district, sort, search
reports.get('/', optionalAuth, async (c) => {
  const { page, limit, offset } = paginate(
    c.req.query('page'),
    c.req.query('limit')
  );

  const category = c.req.query('category');
  const status   = c.req.query('status');
  const district = c.req.query('district');
  const sort     = c.req.query('sort') || 'recent'; // recent | popular | unresolved
  const search   = c.req.query('search');

  // Construir WHERE dinámico
  const conditions = [];
  const bindings   = [];

  if (category) { conditions.push('r.category_id = ?'); bindings.push(category); }
  if (status)   { conditions.push('r.status = ?');      bindings.push(status); }
  if (district) { conditions.push('r.district = ?');    bindings.push(district); }
  if (search)   { conditions.push('(r.title LIKE ? OR r.description LIKE ?)'); bindings.push(`%${search}%`, `%${search}%`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const orderMap = {
    recent:     'r.created_at DESC',
    popular:    'r.vote_count DESC, r.created_at DESC',
    unresolved: "CASE r.status WHEN 'pending' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, r.created_at DESC"
  };
  const orderBy = orderMap[sort] || orderMap.recent;

  const query = `
    SELECT
      r.id, r.title, r.description, r.status, r.is_anonymous,
      r.latitude, r.longitude, r.address, r.district,
      r.image_url, r.vote_count, r.comment_count, r.view_count,
      r.created_at, r.updated_at, r.official_response,
      c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
      CASE WHEN r.is_anonymous = 1 THEN NULL ELSE u.username END AS author_username,
      CASE WHEN r.is_anonymous = 1 THEN NULL ELSE u.avatar_url END AS author_avatar
    FROM reports r
    LEFT JOIN categories c ON r.category_id = c.id
    LEFT JOIN users u ON r.user_id = u.id
    ${where}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;
  bindings.push(limit, offset);

  const countQuery = `SELECT COUNT(*) AS total FROM reports r ${where}`;

  const [rows, countRow] = await Promise.all([
    c.env.DB.prepare(query).bind(...bindings).all(),
    c.env.DB.prepare(countQuery).bind(...bindings.slice(0, -2)).first()
  ]);

  // Incrementar vistas en background (sin bloquear)
  // No es crítico para el prototipo

  return ok(c, {
    reports:  rows.results,
    pagination: {
      page,
      limit,
      total:       countRow.total,
      total_pages: Math.ceil(countRow.total / limit)
    }
  });
});

// ── Datos para el mapa ────────────────────────────────────
reports.get('/map', async (c) => {
  const category = c.req.query('category');
  const status   = c.req.query('status');

  const conditions = ['r.latitude IS NOT NULL'];
  const bindings   = [];

  if (category) { conditions.push('r.category_id = ?'); bindings.push(category); }
  if (status)   { conditions.push('r.status = ?');      bindings.push(status); }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const rows = await c.env.DB.prepare(`
    SELECT
      r.id, r.title, r.status, r.latitude, r.longitude,
      r.vote_count, r.image_url,
      c.name AS category_name, c.icon AS category_icon, c.color AS category_color
    FROM reports r
    LEFT JOIN categories c ON r.category_id = c.id
    ${where}
    ORDER BY r.created_at DESC
    LIMIT 500
  `).bind(...bindings).all();

  return ok(c, { markers: rows.results });
});

// ── Detalle de un reporte ─────────────────────────────────
reports.get('/:id', optionalAuth, async (c) => {
  const { id } = c.req.param();

  const report = await c.env.DB.prepare(`
    SELECT
      r.*,
      c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
      CASE WHEN r.is_anonymous = 1 THEN NULL ELSE u.username END AS author_username,
      CASE WHEN r.is_anonymous = 1 THEN NULL ELSE u.avatar_url END AS author_avatar
    FROM reports r
    LEFT JOIN categories c ON r.category_id = c.id
    LEFT JOIN users u ON r.user_id = u.id
    WHERE r.id = ?
  `).bind(id).first();

  if (!report) return err(c, 'Reporte no encontrado', 404);

  // Ver si el usuario actual ya votó
  const user = c.get('user');
  let user_voted = false;
  if (user) {
    const vote = await c.env.DB.prepare(
      'SELECT id FROM votes WHERE report_id = ? AND user_id = ?'
    ).bind(id, user.id).first();
    user_voted = !!vote;
  }

  // Incrementar vistas
  await c.env.DB.prepare('UPDATE reports SET view_count = view_count + 1 WHERE id = ?')
    .bind(id).run();

  return ok(c, { ...report, user_voted });
});

// ── Crear reporte ─────────────────────────────────────────
reports.post('/', optionalAuth, async (c) => {
  const body = await c.req.json();
  const { title, description, category_id, latitude, longitude, address, district, is_anonymous } = body;

  if (!title || !description || !latitude || !longitude)
    return err(c, 'title, description, latitude y longitude son requeridos');

  if (title.length < 5)  return err(c, 'El título debe tener al menos 5 caracteres');
  if (title.length > 100) return err(c, 'El título no puede exceder 100 caracteres');

  const user      = c.get('user');
  const anonymous = is_anonymous ? 1 : 0;

  // Si no hay usuario autenticado, el reporte es automáticamente anónimo
  const user_id = (user && !anonymous) ? user.id : null;

  const id = generateId('rpt');

  await c.env.DB.prepare(`
    INSERT INTO reports
      (id, title, description, category_id, is_anonymous, user_id, latitude, longitude, address, district)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, title, description,
    category_id || null,
    anonymous, user_id,
    latitude, longitude,
    address || null, district || null
  ).run();

  const report = await c.env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(id).first();
  return ok(c, report, 201);
});

// ── Subir imagen a Cloudinary ─────────────────────────────
reports.post('/:id/image', optionalAuth, async (c) => {
  const { id } = c.req.param();
  const user   = c.get('user');

  // Verificar que el reporte existe
  const report = await c.env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(id).first();
  if (!report) return err(c, 'Reporte no encontrado', 404);

  // Lógica de permisos
  if (report.user_id) {
    // Si el reporte pertenece a un usuario, debe estar logueado y ser el dueño (o admin)
    if (!user) return err(c, 'Token requerido', 401);
    if (report.user_id !== user.id && user.role !== 'admin')
      return err(c, 'Sin permisos', 403);
  } else {
    // Si el reporte es anónimo, permitimos subir imagen solo si aún no tiene una
    // para evitar que cualquiera sobreescriba imágenes de reportes anónimos.
    if (report.image_url) {
      return err(c, 'Este reporte anónimo ya tiene una imagen asociada', 403);
    }
  }

  const formData = await c.req.formData();
  const file     = formData.get('image');
  if (!file) return err(c, 'Imagen requerida');

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(file.type)) return err(c, 'Solo se permiten imágenes JPEG, PNG o WebP');

  const maxSize = 5 * 1024 * 1024; // 5MB
  if (file.size > maxSize) return err(c, 'La imagen no puede superar 5MB');

  const buffer   = await file.arrayBuffer();
  // public_id sin extensión; Cloudinary la gestiona automáticamente.
  // Usar el ID del reporte garantiza que una re-subida sobreescribe la imagen anterior.
  const publicId = `reports/${id}`;

  let imageUrl;
  try {
    imageUrl = await uploadToCloudinary(buffer, file.type, publicId, c.env);
  } catch (e) {
    console.error('Cloudinary upload failed:', e.message);
    return err(c, 'Error al subir la imagen. Intenta de nuevo.', 502);
  }

  await c.env.DB.prepare('UPDATE reports SET image_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(imageUrl, id).run();

  return ok(c, { image_url: imageUrl });
});

// ── Editar reporte ────────────────────────────────────────
reports.put('/:id', requireAuth, async (c) => {
  const { id } = c.req.param();
  const user   = c.get('user');
  const body   = await c.req.json();

  const report = await c.env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(id).first();
  if (!report) return err(c, 'Reporte no encontrado', 404);

  if (report.user_id !== user.id && user.role !== 'admin')
    return err(c, 'Sin permisos para editar este reporte', 403);

  const { title, description, category_id, address, district } = body;

  await c.env.DB.prepare(`
    UPDATE reports SET
      title       = COALESCE(?, title),
      description = COALESCE(?, description),
      category_id = COALESCE(?, category_id),
      address     = COALESCE(?, address),
      district    = COALESCE(?, district),
      updated_at  = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(title, description, category_id, address, district, id).run();

  const updated = await c.env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(id).first();
  return ok(c, updated);
});

// ── Eliminar reporte (admin) ──────────────────────────────
reports.delete('/:id', requireAuth, async (c) => {
  const { id } = c.req.param();
  const user   = c.get('user');

  const report = await c.env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(id).first();
  if (!report) return err(c, 'Reporte no encontrado', 404);

  // Solo el dueño o un admin pueden eliminar
  if (report.user_id !== user.id && user.role !== 'admin')
    return err(c, 'Sin permisos', 403);

  await c.env.DB.prepare('DELETE FROM reports WHERE id = ?').bind(id).run();
  return ok(c, { message: 'Reporte eliminado' });
});

export default reports;