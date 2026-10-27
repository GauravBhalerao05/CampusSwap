const pool = require('./config/database');

async function testConnection() {
  try {
    const [rows] = await pool.query('SELECT 1 AS result');
    console.log('Database connection successful. Query result:', rows[0].result);
    process.exit(0);
  } catch (err) {
    console.error('Database connection failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

testConnection();
