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

// Middleware
app.use(cors());
app.use(express.json());

// Basic health check endpoint
app.get('/api/v1/health', async (req, res) => {
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
