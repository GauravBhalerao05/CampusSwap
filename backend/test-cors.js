/**
 * CORS Security and Functionality Verification Suite
 * File: backend/test-cors.js
 */

const http = require('http');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function makeRequest(port, method, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `http://127.0.0.1:${port}${path}`,
      { method, headers },
      (res) => {
        let rawData = '';
        res.on('data', chunk => rawData += chunk);
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: rawData
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function runCorsTests() {
  console.log('\n--- Starting CampusSwap CORS Tests ---');

  // Test setup: configure sample CORS_ORIGIN with trailing slash and whitespace to test robustness
  process.env.CORS_ORIGIN = ' https://custom-campus.edu/ , https://staging.campusswap.io ';
  process.env.NODE_ENV = 'production';

  // Freshly require app with these env vars
  delete require.cache[require.resolve('./app')];
  const app = require('./app');

  const server = http.createServer(app);
  const TEST_PORT = 5087;

  await new Promise((resolve) => server.listen(TEST_PORT, resolve));

  try {
    // 1. Current observed Vercel preview deployment
    const currentVercelOrigin = 'https://campus-swap-n38sqbpid-gaurav-add.vercel.app';
    const res1 = await makeRequest(TEST_PORT, 'GET', '/api/v1/health', {
      'Origin': currentVercelOrigin
    });
    assert(
      res1.headers['access-control-allow-origin'] === currentVercelOrigin,
      'Allows current Vercel deployment origin (campus-swap-n38sqbpid-gaurav-add.vercel.app)'
    );
    assert(
      res1.headers['access-control-allow-credentials'] === 'true',
      'Attaches credentials header for current Vercel deployment'
    );

    // 2. OPTIONS Preflight for current Vercel deployment
    const resPreflight = await makeRequest(TEST_PORT, 'OPTIONS', '/api/v1/listings', {
      'Origin': currentVercelOrigin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'Content-Type,Authorization'
    });
    assert(
      resPreflight.status === 204,
      'Preflight OPTIONS request returns 204 No Content'
    );
    assert(
      resPreflight.headers['access-control-allow-origin'] === currentVercelOrigin,
      'Preflight returns access-control-allow-origin matching Vercel origin'
    );
    assert(
      resPreflight.headers['access-control-allow-methods'].includes('GET') &&
      resPreflight.headers['access-control-allow-methods'].includes('POST'),
      'Preflight returns supported HTTP methods'
    );

    // 3. Stable production Vercel domain
    const stableDomain = 'https://campus-swap.vercel.app';
    const resStable = await makeRequest(TEST_PORT, 'GET', '/api/v1/health', {
      'Origin': stableDomain
    });
    assert(
      resStable.headers['access-control-allow-origin'] === stableDomain,
      'Allows stable production domain (https://campus-swap.vercel.app)'
    );

    // 4. Stable alias domain
    const aliasDomain = 'https://campusswap.vercel.app';
    const resAlias = await makeRequest(TEST_PORT, 'GET', '/api/v1/health', {
      'Origin': aliasDomain
    });
    assert(
      resAlias.headers['access-control-allow-origin'] === aliasDomain,
      'Allows stable alias domain (https://campusswap.vercel.app)'
    );

    // 5. Configured origin with robust whitespace/trailing-slash handling
    const configuredOrigin = 'https://custom-campus.edu';
    const resConfigured = await makeRequest(TEST_PORT, 'GET', '/api/v1/health', {
      'Origin': configuredOrigin
    });
    assert(
      resConfigured.headers['access-control-allow-origin'] === configuredOrigin,
      'Allows origin configured in CORS_ORIGIN despite trailing slashes/whitespace'
    );

    // 6. Non-browser request (no Origin header)
    const resNoOrigin = await makeRequest(TEST_PORT, 'GET', '/api/v1/health');
    assert(
      resNoOrigin.status !== 403 && resNoOrigin.headers['access-control-allow-origin'] === undefined,
      'Allows non-browser requests without Origin header (curl, health probes)'
    );

    // 7. Disallowed origin (Malicious site)
    const maliciousOrigin = 'https://malicious-attacker.com';
    const resMalicious = await makeRequest(TEST_PORT, 'GET', '/api/v1/health', {
      'Origin': maliciousOrigin
    });
    assert(
      resMalicious.headers['access-control-allow-origin'] === undefined,
      'Rejects disallowed external origin (no access-control-allow-origin header)'
    );

    // 8. Disallowed origin OPTIONS preflight
    const resMaliciousPreflight = await makeRequest(TEST_PORT, 'OPTIONS', '/api/v1/listings', {
      'Origin': maliciousOrigin,
      'Access-Control-Request-Method': 'POST'
    });
    assert(
      resMaliciousPreflight.headers['access-control-allow-origin'] === undefined,
      'Rejects disallowed origin on OPTIONS preflight (no access-control-allow-origin header)'
    );

    // 9. Unrelated Vercel app domain
    const otherVercelApp = 'https://other-unrelated-project.vercel.app';
    const resOtherVercel = await makeRequest(TEST_PORT, 'GET', '/api/v1/health', {
      'Origin': otherVercelApp
    });
    assert(
      resOtherVercel.headers['access-control-allow-origin'] === undefined,
      'Rejects unrelated Vercel app domains'
    );

    // 10. Fake domain mimicking campus-swap
    const fakeVercel = 'https://campus-swap.vercel.app.attacker.com';
    const resFakeVercel = await makeRequest(TEST_PORT, 'GET', '/api/v1/health', {
      'Origin': fakeVercel
    });
    assert(
      resFakeVercel.headers['access-control-allow-origin'] === undefined,
      'Rejects spoofed domain with attacker suffix'
    );

  } finally {
    server.close();
  }

  console.log(`--- CORS Test Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
  else process.exit(0);
}

runCorsTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
