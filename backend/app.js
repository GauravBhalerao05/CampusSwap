const express = require('express');
const cors = require('cors');
const pool = require('./config/database');

const app = express();

const authRoutes = require('./routes/auth');
const categoriesRoutes = require('./routes/categories');
const listingsRoutes = require('./routes/listings');
const offersRoutes = require('./routes/offers');
const transactionsRoutes = require('./routes/transactions');
const reviewsRoutes = require('./routes/reviews');
const { router: messagesRoutes } = require('./routes/messages');

// Dynamic CORS configuration supporting development and production environments
const isDev = process.env.NODE_ENV !== 'production';

const getAllowedOrigins = () => {
  const envOrigins = (process.env.CORS_ORIGIN || process.env.FRONTEND_URL || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return envOrigins;
};

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests (e.g. mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);

    // In development mode, allow localhost and 127.0.0.1 on any port (3000, 5173, etc.)
    if (isDev) {
      if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }
    }

    const allowed = getAllowedOrigins();
    if (allowed.length === 0 || allowed.includes('*') || allowed.includes(origin)) {
      return callback(null, true);
    }

    // Reject origin cleanly without throwing 500 error
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json());

// Basic health check endpoint (supports /api/v1/health and /health)
app.get(['/api/v1/health', '/health'], async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 AS status');
    return res.status(200).json({
      success: true,
      data: {
        status: 'UP',
        database: rows[0].status === 1 ? 'CONNECTED' : 'UNKNOWN',
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[Health Check DB Error]:', {
      code: error.code,
      errno: error.errno,
      sqlState: error.sqlState,
      message: error.message
    });
    return res.status(500).json({
      success: false,
      error: {
        code: 'DATABASE_DISCONNECTED',
        message: 'Database query failed during health check'
      }
    });
  }
});

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/categories', categoriesRoutes);
app.use('/api/v1/listings', listingsRoutes);
app.use('/api/v1/offers', offersRoutes);
app.use('/api/v1/transactions', transactionsRoutes);
app.use('/api/v1/reviews', reviewsRoutes);
app.use('/api/v1/messages', messagesRoutes);

// 404 Route Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `Cannot ${req.method} ${req.originalUrl}`
    }
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Global Error]:', err);
  res.status(err.status || 500).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_SERVER_ERROR',
      message: err.message || 'An unexpected internal error occurred'
    }
  });
});

module.exports = app;
