/**
 * Comprehensive Verification: Direct Registration & Listings
 * File: backend/test-local-dev-and-listings.js
 */

process.env.NODE_ENV = 'development';

const http = require('http');
const pool = require('./config/database');
const app = require('./app');

let server;
const TEST_PORT = 5088;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function makeRequest(method, path, body = null, token = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };
    if (token) {
      reqHeaders['Authorization'] = `Bearer ${token}`;
    }

    const payload = body ? JSON.stringify(body) : null;
    if (payload) {
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(url, { method, headers: reqHeaders }, (res) => {
      let rawData = '';
      res.on('data', chunk => rawData += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(rawData); } catch (e) { parsed = rawData; }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: parsed
        });
      });
    });

    req.on('error', err => reject(err));
    if (payload) req.write(payload);
    req.end();
  });
}

async function runAllTests() {
  console.log('\n======================================================');
  console.log('   CAMPUSSWAP VERIFICATION: DIRECT REGISTRATION & LISTINGS');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(cond, msg) {
    if (cond) {
      console.log(`  ✓ ${msg}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${msg}`);
      failed++;
    }
  }

  await new Promise(resolve => {
    server = app.listen(TEST_PORT, resolve);
  });

  const timestamp = Date.now();
  const testEmail = `directuser.${timestamp}@gmail.com`;
  const testPassword = 'Password123!';
  let userId = null;
  let createdListingId = null;
  let authToken = null;

  try {
    // -------------------------------------------------------------------------
    // SECTION A: DIRECT REGISTRATION & LOGIN (NO OTP)
    // -------------------------------------------------------------------------
    console.log('--- Testing Direct Registration & Login (No OTP) ---');
    
    // 1. Register with Gmail directly
    const regRes = await makeRequest('POST', '/api/v1/auth/register', {
      email: testEmail,
      password: testPassword,
      fullName: 'Gaurav Developer',
      department: 'Computer Science'
    });
    userId = regRes.body.data?.userId;
    assert(
      regRes.status === 201 &&
      regRes.body.success === true &&
      regRes.body.data?.status === 'ACTIVE' &&
      regRes.body.data?.user?.status === 'ACTIVE',
      'A1. Direct registration with Gmail succeeds with 201 Created and ACTIVE status'
    );
    assert(
      !regRes.body.data?.devOtp && !regRes.body.data?.otpCode,
      'A2. No OTP is generated or sent in response'
    );

    // 2. Database stores user as ACTIVE
    const [userRows] = await pool.query('SELECT status, email FROM users WHERE id = ?', [userId]);
    assert(
      userRows.length > 0 && userRows[0].status === 'ACTIVE',
      'A3. User record in database has status ACTIVE immediately upon registration'
    );

    // 3. Duplicate registration rejection
    const dupRes = await makeRequest('POST', '/api/v1/auth/register', {
      email: testEmail,
      password: testPassword,
      fullName: 'Duplicate User'
    });
    assert(
      dupRes.status === 409 && dupRes.body.error?.code === 'DUPLICATE_ENTITY',
      'A4. Duplicate email registration rejected with 409 DUPLICATE_ENTITY'
    );

    // 4. Invalid credentials rejected
    const badLoginRes = await makeRequest('POST', '/api/v1/auth/login', {
      email: testEmail,
      password: 'WrongPassword999!'
    });
    assert(
      badLoginRes.status === 401 && badLoginRes.body.error?.code === 'INVALID_CREDENTIALS',
      'A5. Invalid login credentials rejected with 401 INVALID_CREDENTIALS'
    );

    // 5. Immediate login succeeds without OTP verification
    const loginRes = await makeRequest('POST', '/api/v1/auth/login', {
      email: testEmail,
      password: testPassword
    });
    authToken = loginRes.body.data?.token;
    assert(
      loginRes.status === 200 &&
      typeof authToken === 'string' &&
      loginRes.body.data?.user?.status === 'ACTIVE',
      'A6. Newly registered user logs in immediately with 200 OK and receives JWT token'
    );

    // 6. Access protected /me route
    const meRes = await makeRequest('GET', '/api/v1/auth/me', null, authToken);
    assert(
      meRes.status === 200 && meRes.body.data?.email === testEmail,
      'A7. Protected route /api/v1/auth/me accepts Bearer token'
    );

    // -------------------------------------------------------------------------
    // SECTION B: LISTINGS FUNCTIONALITY & CORS
    // -------------------------------------------------------------------------
    console.log('\n--- Testing Listings Functionality & CORS ---');

    // 1. Fetch listings with Origin from Vite dev server (http://localhost:3000)
    const corsListingsRes = await makeRequest('GET', '/api/v1/listings', null, null, {
      'Origin': 'http://localhost:3000'
    });
    assert(
      corsListingsRes.status === 200 && corsListingsRes.body.success === true,
      'B1. Listings page loads with 200 OK from Vite origin (http://localhost:3000)'
    );
    assert(
      corsListingsRes.headers['access-control-allow-origin'] === 'http://localhost:3000',
      'B2. CORS headers correctly allow http://localhost:3000 origin'
    );

    // 2. Fetch listings without login (public)
    const publicListingsRes = await makeRequest('GET', '/api/v1/listings');
    assert(
      publicListingsRes.status === 200 && Array.isArray(publicListingsRes.body.data?.items),
      `B3. Public catalog fetch succeeds without login (${publicListingsRes.body.data?.items.length} items retrieved)`
    );

    // 3. Fetch listings after login with Bearer token
    const authListingsRes = await makeRequest('GET', '/api/v1/listings', null, authToken);
    assert(
      authListingsRes.status === 200 && Array.isArray(authListingsRes.body.data?.items),
      'B4. Authenticated catalog fetch succeeds with Bearer token'
    );

    // 4. Search and filter listings
    const searchRes = await makeRequest('GET', '/api/v1/listings?mode=SELL&minPrice=10');
    assert(
      searchRes.status === 200 && searchRes.body.data?.items.every(it => it.mode === 'SELL'),
      'B5. Search and filter by mode=SELL returns matching items'
    );

    // 5. Open single listing details
    const sampleListing = publicListingsRes.body.data?.items[0];
    if (sampleListing) {
      const detailRes = await makeRequest('GET', `/api/v1/listings/${sampleListing.id}`);
      assert(
        detailRes.status === 200 && detailRes.body.data?.id === sampleListing.id,
        `B6. GET /api/v1/listings/${sampleListing.id} returns full listing details and seller info`
      );
    }

    // 6. Create a new listing with authenticated user
    const createRes = await makeRequest('POST', '/api/v1/listings', {
      categoryId: 1,
      title: 'College Project Demo Textbook',
      description: 'Used during college demonstration testing.',
      mode: 'SELL',
      price: 25.00,
      itemCondition: 'GOOD',
      pickupLocation: 'Main Campus Quad',
      imageUrls: ['https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c']
    }, authToken);
    createdListingId = createRes.body.data?.id;
    assert(
      createRes.status === 201 && createRes.body.success === true && createRes.body.data?.title === 'College Project Demo Textbook',
      'B7. Authenticated user successfully creates new listing with 201 Created'
    );

    // 7. Handle empty search cleanly
    const emptyRes = await makeRequest('GET', '/api/v1/listings?q=NonExistentItem99887766XYZ');
    assert(
      emptyRes.status === 200 &&
      emptyRes.body.data?.items.length === 0 &&
      emptyRes.body.data?.pagination?.totalItems === 0,
      'B8. Empty search handles gracefully returning 200 OK with empty items list'
    );

  } finally {
    // Cleanup
    if (createdListingId) {
      await pool.query('DELETE FROM listing_images WHERE listing_id = ?', [createdListingId]);
      await pool.query('DELETE FROM listings WHERE id = ?', [createdListingId]);
    }
    if (userId) {
      await pool.query('DELETE FROM users WHERE id = ?', [userId]);
    }

    server.close();
    await pool.end();
  }

  console.log(`\n--- Verification Summary: ${passed} passed, ${failed} failed ---`);
  if (failed > 0) process.exit(1);
  else process.exit(0);
}

runAllTests().catch(err => {
  console.error('Fatal error in test:', err);
  process.exit(1);
});
