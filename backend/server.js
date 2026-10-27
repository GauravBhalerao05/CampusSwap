const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const app = require('./app');

const PORT = process.env.PORT || 5001;

app.listen(PORT, () => {
  console.log(`CampusSwap backend server running on http://localhost:${PORT}`);
  console.log(`Health check available at http://localhost:${PORT}/api/v1/health`);
});
