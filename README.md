# 🏙️ Trujillo Reportes — Backend API

Backend para la plataforma ciudadana de denuncias de Trujillo.  
Construido con **Hono.js** sobre **Cloudflare Workers** + **D1** + **R2**.

---

## 📁 Estructura del proyecto

```
backend/
├── src/
│   ├── index.js              ← Entrada principal, registra rutas y middlewares
│   ├── routes/
│   │   ├── auth.js           ← Registro, login, perfil
│   │   ├── reports.js        ← Feed, mapa, CRUD de reportes
│   │   ├── comments.js       ← Comentarios por reporte
│   │   ├── votes.js          ← Votos / apoyos
│   │   ├── categories.js     ← Categorías de reportes
│   │   └── admin.js          ← Panel autoridad y administrador
│   ├── middleware/
│   │   └── auth.js           ← requireAuth, requireAdmin, optionalAuth
│   └── utils/
│       ├── jwt.js            ← Firmar y verificar tokens JWT
│       ├── hash.js           ← Hashear y verificar contraseñas (PBKDF2)
│       └── helpers.js        ← generateId, ok(), err(), paginate()
├── schema.sql                ← Esquema de base de datos D1
├── seed.sql                  ← Datos iniciales (categorías, usuarios)
├── wrangler.toml             ← Configuración de Cloudflare Workers
└── package.json
```

---

## 🚀 Instalación y despliegue

### 1. Instalar dependencias
```bash
npm install
```

### 2. Autenticarse en Cloudflare
```bash
npx wrangler login
```

### 3. Crear la base de datos D1
```bash
npx wrangler d1 create trujillo-reportes
# Copia el database_id que aparece y pégalo en wrangler.toml
```

### 4. Crear el bucket R2 (para imágenes)
```bash
npx wrangler r2 bucket create trujillo-reportes-images
```

### 5. Configurar el secreto JWT
```bash
npx wrangler secret put JWT_SECRET
# Escribe una clave segura cuando te lo pida, ej: trujillo_reportes_2025_super_secreto
```

### 6. Ejecutar el schema y seed
```bash
npm run db:init
npm run db:seed
```

### 7. Desarrollo local
```bash
npm run dev
# API disponible en http://localhost:8787
```

### 8. Desplegar a producción
```bash
npm run deploy
# URL: https://trujillo-reportes-api.<tu-usuario>.workers.dev
```

---

## 📡 Endpoints de la API

### Auth
| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| POST | `/api/auth/register` | Registro de usuario | No |
| POST | `/api/auth/login` | Iniciar sesión | No |
| GET | `/api/auth/me` | Perfil del usuario actual | ✅ |
| POST | `/api/auth/change-password` | Cambiar contraseña | ✅ |

### Reportes
| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| GET | `/api/reports` | Feed/Blog de reportes (con filtros) | Opcional |
| POST | `/api/reports` | Crear reporte | Opcional |
| GET | `/api/reports/map` | Datos para Google Maps | No |
| GET | `/api/reports/:id` | Detalle de reporte | Opcional |
| PUT | `/api/reports/:id` | Editar reporte | ✅ Dueño |
| DELETE | `/api/reports/:id` | Eliminar reporte | ✅ Admin |
| POST | `/api/reports/:id/image` | Subir imagen | ✅ |

### Comentarios
| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| GET | `/api/comments/:reportId` | Listar comentarios | No |
| POST | `/api/comments/:reportId` | Agregar comentario | ✅ |
| DELETE | `/api/comments/:id` | Eliminar comentario | ✅ Dueño/Admin |

### Votos
| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| POST | `/api/votes/:reportId` | Votar reporte | ✅ |
| DELETE | `/api/votes/:reportId` | Quitar voto | ✅ |

### Categorías
| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| GET | `/api/categories` | Listar categorías | No |
| POST | `/api/categories` | Crear categoría | ✅ Admin |
| PUT | `/api/categories/:id` | Editar categoría | ✅ Admin |
| DELETE | `/api/categories/:id` | Eliminar categoría | ✅ Admin |

### Panel Admin
| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| GET | `/api/admin/stats` | Dashboard estadísticas | ✅ Authority |
| GET | `/api/admin/reports` | Todos los reportes | ✅ Authority |
| PUT | `/api/admin/reports/:id/status` | Cambiar estado | ✅ Authority |
| PUT | `/api/admin/reports/:id/assign` | Asignar área | ✅ Authority |
| GET | `/api/admin/reports/:id/history` | Historial de cambios | ✅ Authority |
| GET | `/api/admin/users` | Listar usuarios | ✅ Admin |
| PUT | `/api/admin/users/:id/role` | Cambiar rol | ✅ Admin |
| PUT | `/api/admin/users/:id/active` | Activar/desactivar | ✅ Admin |
| GET | `/api/admin/areas` | Áreas responsables | ✅ Authority |

---

## 🔐 Roles del sistema

| Rol | Puede hacer |
|-----|-------------|
| `citizen` | Crear reportes, comentar, votar |
| `authority` | Todo lo anterior + gestionar reportes, ver estadísticas |
| `admin` | Todo + gestionar usuarios y categorías |

---

## 📋 Parámetros de filtros - GET /api/reports

```
?page=1           Página (default: 1)
?limit=10         Resultados por página (max: 50)
?category=1       Filtrar por categoría
?status=pending   pending | in_progress | resolved | rejected
?district=Trujillo Filtrar por distrito
?sort=recent      recent | popular | unresolved
?search=bache     Búsqueda en título y descripción
```