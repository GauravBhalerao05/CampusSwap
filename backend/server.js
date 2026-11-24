const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

// Verify required environment variables in production
if (process.env.NODE_ENV === 'production') {
  const required = ['DB_HOST', 'DB_USER', 'DB_NAME', 'JWT_SECRET'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`[FATAL] Missing required production environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
  if (!process.env.DB_PASSWORD) {
    console.warn('[WARN] DB_PASSWORD is not set in environment variables');
  }
}

const pool = require('./config/database');
const app = require('./app');

const PORT = process.env.PORT || 5001;

// Startup database connectivity check for diagnostics (non-blocking)
pool.getConnection()
  .then((conn) => {
    console.log(`[DB] Database connection verified successfully`);
    conn.release();
  })
  .catch((err) => {
    console.error('[DB Error] Startup database connection failed:', {
      code: err.code,
      errno: err.errno,
      sqlState: err.sqlState,
      message: err.message
    });
  });

app.listen(PORT, () => {
  console.log(`CampusSwap backend server running on port ${PORT}`);
  console.log(`Health check available at /api/v1/health`);
});
