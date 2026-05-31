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
      r.image_url, r.media, r.vote_count, r.comment_count, r.view_count,
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

  // Parsear la columna JSON 'media' de cada reporte
  const reportsList = rows.results.map(r => ({
    ...r,
    media: r.media ? JSON.parse(r.media) : (r.image_url ? [r.image_url] : [])
  }));

  return ok(c, {
    reports:  reportsList,
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
      r.vote_count, r.image_url, r.media,
      c.name AS category_name, c.icon AS category_icon, c.color AS category_color
    FROM reports r
    LEFT JOIN categories c ON r.category_id = c.id
    ${where}
    ORDER BY r.created_at DESC
    LIMIT 500
  `).bind(...bindings).all();

  // Parsear la columna JSON 'media'
  const markers = rows.results.map(r => ({
    ...r,
    media: r.media ? JSON.parse(r.media) : (r.image_url ? [r.image_url] : [])
  }));

  return ok(c, { markers });
});

// ── Top reportes más votados (para sección Urgentes) ─────
reports.get('/top', async (c) => {
  const limit = parseInt(c.req.query('limit') || '5', 10);

  const rows = await c.env.DB.prepare(`
    SELECT
      r.id, r.title, r.status, r.vote_count, r.comment_count,
      r.district, r.address, r.image_url, r.media, r.created_at,
      r.is_anonymous, r.latitude, r.longitude,
      c.name AS category_name, c.icon AS category_icon,
      CASE WHEN r.is_anonymous = 1 THEN NULL ELSE u.username END AS author_username
    FROM reports r
    LEFT JOIN categories c ON r.category_id = c.id
    LEFT JOIN users u ON r.user_id = u.id
    WHERE r.status != 'resolved' AND r.status != 'rejected'
    ORDER BY r.vote_count DESC, r.created_at DESC
    LIMIT ?
  `).bind(limit).all();

  const top = rows.results.map(r => ({
    ...r,
    media: r.media ? JSON.parse(r.media) : (r.image_url ? [r.image_url] : [])
  }));

  return ok(c, { reports: top });
});

// ── Historial de actividad público de un reporte ──────────
reports.get('/:id/history', async (c) => {
  const { id } = c.req.param();

  const report = await c.env.DB.prepare('SELECT id, created_at, status, assigned_to, is_anonymous, user_id FROM reports WHERE id = ?').bind(id).first();
  if (!report) return err(c, 'Reporte no encontrado', 404);

  const history = await c.env.DB.prepare(`
    SELECT
      sh.id, sh.old_status, sh.new_status, sh.note, sh.created_at,
      u.username AS changed_by_username
    FROM status_history sh
    LEFT JOIN users u ON sh.changed_by = u.id
    WHERE sh.report_id = ?
    ORDER BY sh.created_at ASC
  `).bind(id).all();

  return ok(c, {
    created_at:  report.created_at,
    assigned_to: report.assigned_to,
    history:     history.results
  });
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

  report.media           = report.media           ? JSON.parse(report.media)           : (report.image_url ? [report.image_url] : []);
  report.resolution_media = report.resolution_media ? JSON.parse(report.resolution_media) : [];

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

// ── Subir multimedia a Cloudinary ─────────────────────────────
reports.post('/:id/media', optionalAuth, async (c) => {
  const { id } = c.req.param();
  const user   = c.get('user');

  // Verificar que el reporte existe
  const report = await c.env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(id).first();
  if (!report) return err(c, 'Reporte no encontrado', 404);

  // Lógica de permisos
  if (report.user_id) {
    if (!user) return err(c, 'Token requerido', 401);
    if (report.user_id !== user.id && user.role !== 'admin')
      return err(c, 'Sin permisos', 403);
  } else {
    if (report.media || report.image_url) {
      return err(c, 'Este reporte anónimo ya tiene contenido multimedia', 403);
    }
  }

  const formData = await c.req.formData();
  const files    = formData.getAll('media'); // Puede ser un array de archivos
  if (!files || files.length === 0) return err(c, 'Archivos requeridos');

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'];
  
  const uploadedUrls = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!allowedTypes.includes(file.type)) {
      return err(c, `Formato no permitido: ${file.type}. Solo JPG, PNG, WebP, MP4, WebM.`);
    }

    const maxSize = 20 * 1024 * 1024; // 20MB max por archivo
    if (file.size > maxSize) return err(c, `El archivo no puede superar 20MB`);

    const buffer = await file.arrayBuffer();
    const publicId = `reports/${id}_media_${i}`;

    try {
      const url = await uploadToCloudinary(buffer, file.type, publicId, c.env);
      uploadedUrls.push(url);
    } catch (e) {
      console.error('Cloudinary upload failed:', e.message);
      return err(c, 'Error al subir los archivos. Intenta de nuevo.', 502);
    }
  }

  const mediaJson = JSON.stringify(uploadedUrls);

  // Guardamos en la nueva columna media, y por retrocompatibilidad guardamos el primero en image_url
  await c.env.DB.prepare('UPDATE reports SET media = ?, image_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(mediaJson, uploadedUrls[0] || null, id).run();

  return ok(c, { media: uploadedUrls });
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

// ── Subir evidencia de resolución (autoridades) ──────────
reports.post('/:id/resolution-media', async (c) => {
  const { id }  = c.req.param();
  const authHeader = c.req.header('Authorization');
  if (!authHeader) return err(c, 'Token requerido', 401);

  const report = await c.env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(id).first();
  if (!report) return err(c, 'Reporte no encontrado', 404);

  const formData = await c.req.formData();
  const files    = formData.getAll('media');
  if (!files || files.length === 0) return err(c, 'Archivos requeridos');

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'];
  const existing = report.resolution_media ? JSON.parse(report.resolution_media) : [];
  const uploadedUrls = [...existing];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!allowedTypes.includes(file.type)) return err(c, `Formato no permitido: ${file.type}`);
    if (file.size > 20 * 1024 * 1024) return err(c, 'Archivo mayor a 20MB');

    const buffer   = await file.arrayBuffer();
    const publicId = `reports/${id}_resolution_${uploadedUrls.length}`;
    try {
      const url = await uploadToCloudinary(buffer, file.type, publicId, c.env);
      uploadedUrls.push(url);
    } catch (e) {
      return err(c, 'Error al subir el archivo a Cloudinary', 502);
    }
  }

  await c.env.DB.prepare('UPDATE reports SET resolution_media = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(JSON.stringify(uploadedUrls), id).run();

  return ok(c, { resolution_media: uploadedUrls });
});

export default reports;