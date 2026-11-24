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
}

const app = require('./app');

const PORT = process.env.PORT || 5001;

app.listen(PORT, () => {
  console.log(`CampusSwap backend server running on port ${PORT}`);
  console.log(`Health check available at /api/v1/health`);
});
