import express from 'express';
import cors from 'cors';
import session from 'express-session';
import dotenv from 'dotenv';
import { initDatabase } from './db/postgres.js';
import { initControlPlaneDatabase } from './db/controlPlane.js';
import { initLogPlaneDatabase } from './db/logPlane.js';
import adminRoutes from './routes/admin.js';
import tenantRoutes from './routes/tenants.js';
import issueRoutes from './routes/issues.js';
import studentRoutes from './routes/student.js';
import { cache } from './cache.js';
import rateLimit from 'express-rate-limit';
import { authMiddleware, requireTenantDataAdmin } from './middleware/auth.js';
import { tenantIssueRequestLogger } from './middleware/issueLogger.js';

dotenv.config();

// Validate JWT_SECRET tại startup — không cho phép chạy nếu thiếu
if (!process.env.JWT_SECRET) {
  console.error('FATAL ERROR: JWT_SECRET is not set in environment variables.');
  console.error('Please add JWT_SECRET to your .env file and restart the server.');
  process.exit(1);
}

if (process.env.NODE_ENV === 'production' && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  console.error('FATAL ERROR: SESSION_SECRET must contain at least 32 characters in production.');
  process.exit(1);
}

console.log('Starting server...');

console.log('DB:', process.env.DATABASE_URL ? 'configured' : 'NOT configured');
console.log('USE_SQLITE:', process.env.USE_SQLITE || 'false (PostgreSQL)');

const app = express();

app.set('trust proxy', 1);

// [C-1] CORS: Chỉ cho phép các origin được cấu hình trong ALLOWED_ORIGINS
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Cho phép request không có origin (server-to-server, curl, v.v.)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: Origin "${origin}" is not allowed`));
      }
    },
    credentials: true,
  })
);
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
  if (process.env.NODE_ENV === 'production') {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(rateLimit({ windowMs: 60000, max: 200 }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'local-development-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  }
}));

app.use(tenantIssueRequestLogger);

// Global control-plane and tenant data-plane are deliberately separate route trees.
app.use('/api/tenants', tenantRoutes);
app.use('/api/admin/issues', issueRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/student', studentRoutes);

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    cache: 'active',
    queue: cache.getQueueStats()
  });
});

// [C-2] Internal diagnostic/operational endpoints — require admin JWT
// [C-3] POST /api/init-tables đã bị xóa (DB init tự động khi server start)

app.get('/api/test-db', authMiddleware, requireTenantDataAdmin, async (req, res) => {
  try {
    const { query } = await import('./db/postgres.js');
    const result = await query('SELECT NOW() as time, version() as pg_version');
    res.json({
      success: true,
      time: result.rows[0]?.time,
      pg_version: result.rows[0]?.pg_version,
      mode: process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite',
    });
  } catch (e: any) {
    // [M-1] Không lộ chi tiết lỗi DB ra ngoài
    console.error('[test-db] Error:', e.message);
    res.status(500).json({ error: 'Database connection test failed' });
  }
});

app.get('/api/queue/process', authMiddleware, requireTenantDataAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 5;
    const processed = await cache.processQueue(limit);
    res.json({ processed, timestamp: new Date().toISOString() });
  } catch (error: any) {
    console.error('[Queue] Process failed:', error);
    res.status(500).json({ error: 'Queue processing failed' });
  }
});

app.get('/api/queue/stats', authMiddleware, requireTenantDataAdmin, async (req, res) => {
  try {
    const stats = cache.getQueueStats();
    res.json(stats);
  } catch (error: any) {
    console.error('[Queue] Stats failed:', error);
    res.status(500).json({ error: 'Queue statistics failed' });
  }
});

app.post('/api/cache/flush', authMiddleware, requireTenantDataAdmin, async (req, res) => {
  try {
    await cache.flushAnswers();
    res.json({ success: true, timestamp: new Date().toISOString() });
  } catch (error: any) {
    console.error('[Cache] Flush failed:', error);
    res.status(500).json({ error: 'Cache flush failed' });
  }
});

app.get('/api/stats', authMiddleware, requireTenantDataAdmin, (req, res) => {
  res.json({
    queue: cache.getQueueStats(),
    timestamp: new Date().toISOString(),
  });
});

process.on('SIGINT', () => {
  console.log('Shutting down...');
  cache.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  cache.destroy();
  process.exit(0);
});

export const initialization = initDatabase()
  .then(() => console.log('Assessment data-plane initialized'))
  .then(() => initControlPlaneDatabase())
  .then(() => console.log('Tenant control-plane initialized'))
  .then(() => initLogPlaneDatabase())
  .then(() => console.log('Tenant issue log-plane initialized'))
  .then(() => cache.init())
  .then(() => cache.processQueue(5))
  .then(() => console.log('Initial queue processed'));

export default app;
