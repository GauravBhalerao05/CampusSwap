/**
 * Comprehensive Automated Tests for CampusSwap Listings Module
 * File: backend/test-listings.js
 * 
 * Tests:
 * 1. GET /api/v1/categories -> returns list of active categories
 * 2. POST /api/v1/listings without token -> 401 UNAUTHENTICATED
 * 3. POST /api/v1/listings with invalid price in SELL mode (<= 0) -> 400 VALIDATION_ERROR
 * 4. POST /api/v1/listings in FREE mode -> succeeds with price = 0.00
 * 5. POST /api/v1/listings in BARTER mode without barterPreferences -> 400 VALIDATION_ERROR
 * 6. POST /api/v1/listings in SELL mode -> succeeds with 201 Created and image records
 * 7. GET /api/v1/listings/:id -> returns full listing details with images and seller info
 * 8. GET /api/v1/listings -> catalog search, filtering by mode/price/category, and pagination
 * 9. PUT /api/v1/listings/:id by non-owner -> 403 FORBIDDEN_OPERATION
 * 10. PUT /api/v1/listings/:id by owner -> updates listing details successfully
 * 11. DELETE /api/v1/listings/:id by non-owner -> 403 FORBIDDEN_OPERATION
 * 12. DELETE /api/v1/listings/:id by owner -> soft-deletes (status = 'CANCELLED')
 * 13. PUT /api/v1/listings/:id on non-ACTIVE listing -> 409 INVALID_STATE_TRANSITION
 */

const http = require('http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./config/database');
const app = require('./app');

let server;
const TEST_PORT = 5098;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function makeRequest(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const headers = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const payload = body ? JSON.stringify(body) : null;
    if (payload) {
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(
      url,
      {
        method,
        headers
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch (e) {
            parsed = data;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- Starting CampusSwap Listings Tests ---');
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

  await new Promise((resolve) => {
    server = app.listen(TEST_PORT, resolve);
  });

  const timestamp = Date.now();
  const sellerEmail = `seller.${timestamp}@univ.edu`;
  const otherUserEmail = `other.${timestamp}@univ.edu`;
  const passwordHash = await bcrypt.hash('Password123!', 10);

  let sellerId = null;
  let otherUserId = null;
  let sellerToken = null;
  let otherToken = null;
  let createdListingId = null;
  let freeListingId = null;

  try {
    // Setup 2 test users (seller & other user)
    const [u1] = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, status, department)
       VALUES (?, ?, 'Seller Student', 'STUDENT', 'ACTIVE', 'Computer Science')`,
      [sellerEmail, passwordHash]
    );
    sellerId = u1.insertId;

    const [u2] = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, status, department)
       VALUES (?, ?, 'Other Student', 'STUDENT', 'ACTIVE', 'Physics')`,
      [otherUserEmail, passwordHash]
    );
    otherUserId = u2.insertId;

    const secret = process.env.JWT_SECRET || 'campusswap_local_dev_secret_key_2026';
    sellerToken = jwt.sign({ userId: sellerId, email: sellerEmail, role: 'STUDENT' }, secret, { expiresIn: '1h' });
    otherToken = jwt.sign({ userId: otherUserId, email: otherUserEmail, role: 'STUDENT' }, secret, { expiresIn: '1h' });

    // 1. GET /api/v1/categories
    const resCat = await makeRequest('GET', '/api/v1/categories');
    assert(
      resCat.status === 200 && resCat.body.success === true && Array.isArray(resCat.body.data) && resCat.body.data.length > 0,
      'GET /api/v1/categories returns list of active categories'
    );
    const categoryId = resCat.body.data[0].id;

    // 2. POST /api/v1/listings without token -> 401
    const resNoAuth = await makeRequest('POST', '/api/v1/listings', {
      categoryId,
      title: 'Algorithms Textbook',
      description: 'Course textbook in good shape.',
      mode: 'SELL',
      price: 45.0,
      pickupLocation: 'Library'
    });
    assert(
      resNoAuth.status === 401 && resNoAuth.body.error?.code === 'UNAUTHENTICATED',
      'Rejects unauthenticated listing creation with 401 UNAUTHENTICATED'
    );

    // 3. POST /api/v1/listings in SELL mode with price <= 0 -> 400
    const resInvalidPrice = await makeRequest(
      'POST',
      '/api/v1/listings',
      {
        categoryId,
        title: 'Algorithms Textbook',
        description: 'Course textbook in good shape.',
        mode: 'SELL',
        price: 0.0,
        pickupLocation: 'Library'
      },
      sellerToken
    );
    assert(
      resInvalidPrice.status === 400 && resInvalidPrice.body.error?.code === 'VALIDATION_ERROR',
      'Rejects SELL listing with price <= 0 with 400 VALIDATION_ERROR'
    );

    // 4. POST /api/v1/listings in FREE mode -> succeeds with price = 0.00
    const resFree = await makeRequest(
      'POST',
      '/api/v1/listings',
      {
        categoryId,
        title: 'Chemistry Safety Goggles',
        description: 'Free lab goggles for incoming freshmen.',
        mode: 'FREE',
        pickupLocation: 'Science Building Hallway'
      },
      sellerToken
    );
    freeListingId = resFree.body.data?.id;
    assert(
      resFree.status === 201 &&
      resFree.body.data?.mode === 'FREE' &&
      resFree.body.data?.price === '0.00' &&
      resFree.body.data?.status === 'ACTIVE',
      'Creates FREE listing with price = 0.00 and status = ACTIVE'
    );

    // 5. POST /api/v1/listings in BARTER mode without barterPreferences -> 400
    const resBarterNoPref = await makeRequest(
      'POST',
      '/api/v1/listings',
      {
        categoryId,
        title: 'Graphing Calculator TI-84',
        description: 'TI-84 Plus in working condition.',
        mode: 'BARTER',
        pickupLocation: 'Engineering Center'
      },
      sellerToken
    );
    assert(
      resBarterNoPref.status === 400 && resBarterNoPref.body.error?.code === 'VALIDATION_ERROR',
      'Rejects BARTER listing without barterPreferences description'
    );

    // 6. POST /api/v1/listings in SELL mode with images -> 201 Created
    const resSell = await makeRequest(
      'POST',
      '/api/v1/listings',
      {
        categoryId,
        title: 'Introduction to Algorithms (CLRS 3rd Ed)',
        description: 'Clean condition textbook with minimal pencil annotations. Perfect for CS201.',
        mode: 'SELL',
        price: 45.0,
        isNegotiable: true,
        itemCondition: 'GOOD',
        pickupLocation: 'Library Foyer',
        imageUrls: [
          'https://campusswap.local/uploads/clrs-front.jpg',
          'https://campusswap.local/uploads/clrs-back.jpg'
        ]
      },
      sellerToken
    );
    createdListingId = resSell.body.data?.id;
    assert(
      resSell.status === 201 &&
      resSell.body.data?.sellerId === sellerId &&
      resSell.body.data?.price === '45.00' &&
      resSell.body.data?.status === 'ACTIVE',
      'Creates SELL listing successfully with 201 Created'
    );

    // 7. GET /api/v1/listings/:id
    const resGetDetails = await makeRequest('GET', `/api/v1/listings/${createdListingId}`);
    assert(
      resGetDetails.status === 200 &&
      resGetDetails.body.data?.id === createdListingId &&
      resGetDetails.body.data?.seller?.fullName === 'Seller Student' &&
      resGetDetails.body.data?.images?.length === 2 &&
      resGetDetails.body.data?.category?.name === 'Textbooks',
      'GET /api/v1/listings/:id returns full listing details with images and category'
    );

    // 8. GET /api/v1/listings catalog filtering
    const resCatalog = await makeRequest('GET', `/api/v1/listings?mode=SELL&minPrice=40&maxPrice=50&q=Algorithms`);
    assert(
      resCatalog.status === 200 &&
      resCatalog.body.data?.items?.some((item) => item.id === createdListingId) &&
      resCatalog.body.data?.pagination?.currentPage === 1,
      'GET /api/v1/listings filters by keyword, mode, price range, and returns pagination'
    );

    // 9. PUT /api/v1/listings/:id by non-owner -> 403
    const resForbiddenEdit = await makeRequest(
      'PUT',
      `/api/v1/listings/${createdListingId}`,
      { price: 35.0 },
      otherToken
    );
    assert(
      resForbiddenEdit.status === 403 && resForbiddenEdit.body.error?.code === 'FORBIDDEN_OPERATION',
      'Rejects modification by non-owner with 403 FORBIDDEN_OPERATION'
    );

    // 10. PUT /api/v1/listings/:id by owner -> 200 OK
    const resOwnerEdit = await makeRequest(
      'PUT',
      `/api/v1/listings/${createdListingId}`,
      {
        price: 38.0,
        pickupLocation: 'Student Center 2nd Floor'
      },
      sellerToken
    );
    assert(
      resOwnerEdit.status === 200 &&
      resOwnerEdit.body.data?.price === '38.00' &&
      resOwnerEdit.body.data?.status === 'ACTIVE',
      'Allows owner to update listing details with 200 OK'
    );

    // 11. DELETE /api/v1/listings/:id by non-owner -> 403
    const resForbiddenDelete = await makeRequest(
      'DELETE',
      `/api/v1/listings/${createdListingId}`,
      null,
      otherToken
    );
    assert(
      resForbiddenDelete.status === 403 && resForbiddenDelete.body.error?.code === 'FORBIDDEN_OPERATION',
      'Rejects cancellation by non-owner with 403 FORBIDDEN_OPERATION'
    );

    // 12. DELETE /api/v1/listings/:id by owner -> soft-delete (status = 'CANCELLED')
    const resOwnerDelete = await makeRequest(
      'DELETE',
      `/api/v1/listings/${createdListingId}`,
      null,
      sellerToken
    );
    assert(
      resOwnerDelete.status === 200 &&
      resOwnerDelete.body.data?.status === 'CANCELLED',
      'Allows owner to cancel listing (soft-delete to CANCELLED)'
    );

    // 13. PUT on cancelled listing -> 409 INVALID_STATE_TRANSITION
    const resEditCancelled = await makeRequest(
      'PUT',
      `/api/v1/listings/${createdListingId}`,
      { price: 30.0 },
      sellerToken
    );
    assert(
      resEditCancelled.status === 409 && resEditCancelled.body.error?.code === 'INVALID_STATE_TRANSITION',
      'Rejects modification of non-ACTIVE listing with 409 INVALID_STATE_TRANSITION'
    );

  } finally {
    // Cleanup test records
    if (createdListingId) {
      await pool.query('DELETE FROM listing_images WHERE listing_id = ?', [createdListingId]);
      await pool.query('DELETE FROM listings WHERE id = ?', [createdListingId]);
    }
    if (freeListingId) {
      await pool.query('DELETE FROM listing_images WHERE listing_id = ?', [freeListingId]);
      await pool.query('DELETE FROM listings WHERE id = ?', [freeListingId]);
    }
    if (sellerId) {
      await pool.query('DELETE FROM users WHERE id = ?', [sellerId]);
    }
    if (otherUserId) {
      await pool.query('DELETE FROM users WHERE id = ?', [otherUserId]);
    }

    server.close();
    await pool.end();
  }

  console.log(`\n--- Test Results: ${passed} passed, ${failed} failed ---`);
  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error in listings suite:', err);
  process.exit(1);
});
