// ============================================================
// ENTRY POINT - Plataforma Ciudadana de Denuncias Trujillo
// Cloudflare Workers + Hono.js
// ============================================================
import { Hono }    from 'hono';
import { cors }    from 'hono/cors';
import { logger }  from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';

import authRoutes     from './routes/auth.js';
import reportsRoutes  from './routes/reports.js';
import commentsRoutes from './routes/comments.js';
import votesRoutes    from './routes/votes.js';
import categoriesRoutes from './routes/categories.js';
import adminRoutes    from './routes/admin.js';

const app = new Hono();

// ── Middlewares globales ──────────────────────────────────

// Logs en consola (solo desarrollo)
app.use('*', logger());

// Cabeceras de seguridad
app.use('*', secureHeaders());

// CORS: permite peticiones desde el frontend
app.use('*', cors({
  origin: (origin, c) => {
    const allowed = [
      c.env.FRONTEND_URL,           // tu dominio en Pages
      'http://localhost:5173',       // Vite local
      'http://localhost:3000',
    ];
    return allowed.includes(origin) ? origin : null;
  },
  allowMethods:  ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders:  ['Content-Type', 'Authorization'],
  exposeHeaders: ['X-Total-Count'],
  maxAge:        86400,
  credentials:   true,
}));

// ── Rutas ─────────────────────────────────────────────────
app.route('/api/auth',       authRoutes);
app.route('/api/reports',    reportsRoutes);
app.route('/api/comments',   commentsRoutes);
app.route('/api/votes',      votesRoutes);
app.route('/api/categories', categoriesRoutes);
app.route('/api/admin',      adminRoutes);

// ── Health check ──────────────────────────────────────────
app.get('/api/health', (c) => {
  return c.json({
    status:  'ok',
    project: 'Trujillo Reportes API',
    version: '1.0.0',
    time:    new Date().toISOString(),
  });
});

// ── 404 para rutas no encontradas ─────────────────────────
app.notFound((c) => {
  return c.json({ success: false, error: 'Ruta no encontrada' }, 404);
});

// ── Errores globales no manejados ─────────────────────────
app.onError((err, c) => {
  console.error('Error no manejado:', err);
  return c.json({ success: false, error: 'Error interno del servidor' }, 500);
});

export default app;