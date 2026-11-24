const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const useSsl = process.env.DB_SSL !== undefined
  ? process.env.DB_SSL === 'true'
  : process.env.NODE_ENV === 'production';

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'campusswap',

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',

  // Enable TLS for production TiDB Cloud connections
  ssl: useSsl
    ? { minVersion: 'TLSv1.2', rejectUnauthorized: true }
    : undefined
});

// Auto-check and migrate email_verifications table for schema compatibility
(async () => {
  try {
    const [tableCheck] = await pool.query("SHOW TABLES LIKE 'email_verifications'");
    if (tableCheck.length > 0) {
      const [otpCol] = await pool.query("SHOW COLUMNS FROM email_verifications LIKE 'otp_code'");
      if (otpCol.length > 0 && !otpCol[0].Type.includes('255')) {
        await pool.query('ALTER TABLE email_verifications MODIFY COLUMN otp_code VARCHAR(255) NOT NULL');
      }
      const [attemptsCol] = await pool.query("SHOW COLUMNS FROM email_verifications LIKE 'attempts'");
      if (attemptsCol.length === 0) {
        await pool.query('ALTER TABLE email_verifications ADD COLUMN attempts INT NOT NULL DEFAULT 0 AFTER is_used');
      }
    }
  } catch (err) {
    // Graceful startup; DB might not be seeded yet
  }
})();

module.exports = pool;
