/**
 * Comprehensive Automated Tests for CampusSwap Transaction Lifecycle & Reviews
 * File: backend/test-transactions.js
 * 
 * Tests:
 * 1. Transaction access control:
 *    - Unauthenticated request rejected (401 UNAUTHENTICATED)
 *    - Third-party non-participant forbidden from GET /transactions/:id (403 FORBIDDEN_OPERATION)
 *    - Participant successfully retrieves /transactions/:id (200 OK)
 *    - Participant views transaction history with counterparty details (200 OK)
 *    - Non-participant forbidden from completing transaction (403 FORBIDDEN_OPERATION)
 *    - Non-participant forbidden from cancelling transaction (403 FORBIDDEN_OPERATION)
 * 2. Review eligibility before completion:
 *    - Attempting review on PENDING_MEETUP transaction fails (409 INVALID_STATE_TRANSITION)
 * 3. Successful completion:
 *    - Seller completes transaction (200 OK, status = COMPLETED, completedAt populated)
 *    - Target listing atomically transitioned to COMPLETED
 *    - Preserves transaction final_price and transaction_type
 * 4. Rejection of invalid state transitions:
 *    - Attempting to complete already COMPLETED transaction fails (409 INVALID_STATE_TRANSITION)
 *    - Attempting to cancel already COMPLETED transaction fails (409 INVALID_STATE_TRANSITION)
 * 5. Review validation and submission:
 *    - Non-participant review rejected (403 FORBIDDEN_OPERATION)
 *    - Out of bounds rating rejected (400 RATING_OUT_OF_BOUNDS)
 *    - Non-integer rating rejected (400 RATING_OUT_OF_BOUNDS)
 *    - Buyer submits valid review (201 Created)
 *    - Duplicate review by same buyer rejected (409 DUPLICATE_ENTITY)
 *    - Seller submits valid review for buyer (201 Created)
 *    - Dynamic seller reputation calculation verified
 * 6. Cancellation and listing restoration:
 *    - Buyer/Seller cancels PENDING_MEETUP transaction (200 OK, status = CANCELLED)
 *    - Reserved listing successfully restored to ACTIVE
 *    - Competing offers verified as CANCELLED_BY_SYSTEM
 *    - New offer can be accepted on restored listing
 * 7. Transaction rollback:
 *    - Multi-step transaction rolls back on failure with zero partial changes
 */

const http = require('http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./config/database');
const app = require('./app');

let server;
const TEST_PORT = 5096;
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

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    throw new Error(message);
  }
  console.log(`  ✓ ${message}`);
}

async function runTests() {
  console.log('--- Starting CampusSwap Transactions & Reviews Tests ---');
  let passed = 0;
  let failed = 0;

  // Track created entities for thorough cleanup
  const createdUserIds = [];
  const createdListingIds = [];
  const createdOfferIds = [];
  const createdTxIds = [];
  const createdReviewIds = [];

  const timestamp = Date.now();
  const jwtSecret = process.env.JWT_SECRET || 'campusswap-jwt-secret-key-2026';

  try {
    // 1. Setup test users: Seller, Buyer, and Unrelated Third Party
    const passwordHash = await bcrypt.hash('SecurePass123!', 10);

    const [userARes] = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, phone_number, department, role, status)
       VALUES (?, ?, 'Alice Seller', '+1-555-0101', 'Computer Science', 'STUDENT', 'ACTIVE')`,
      [`alice.seller.${timestamp}@univ.edu`, passwordHash]
    );
    const userAId = userARes.insertId;
    createdUserIds.push(userAId);
    const tokenA = jwt.sign({ userId: userAId, email: `alice.seller.${timestamp}@univ.edu`, role: 'STUDENT' }, jwtSecret, { expiresIn: '1h' });

    const [userBRes] = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, phone_number, department, role, status)
       VALUES (?, ?, 'Bob Buyer', '+1-555-0102', 'Electrical Engineering', 'STUDENT', 'ACTIVE')`,
      [`bob.buyer.${timestamp}@univ.edu`, passwordHash]
    );
    const userBId = userBRes.insertId;
    createdUserIds.push(userBId);
    const tokenB = jwt.sign({ userId: userBId, email: `bob.buyer.${timestamp}@univ.edu`, role: 'STUDENT' }, jwtSecret, { expiresIn: '1h' });

    const [userCRes] = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, phone_number, department, role, status)
       VALUES (?, ?, 'Charlie Unrelated', '+1-555-0103', 'Physics', 'STUDENT', 'ACTIVE')`,
      [`charlie.unrelated.${timestamp}@univ.edu`, passwordHash]
    );
    const userCId = userCRes.insertId;
    createdUserIds.push(userCId);
    const tokenC = jwt.sign({ userId: userCId, email: `charlie.unrelated.${timestamp}@univ.edu`, role: 'STUDENT' }, jwtSecret, { expiresIn: '1h' });

    // Category
    const [catRows] = await pool.query('SELECT id FROM categories WHERE is_active = TRUE LIMIT 1');
    const categoryId = catRows[0].id;

    // 2. Setup listings
    // Listing 1: for Completion flow
    const [listing1Res] = await pool.query(
      `INSERT INTO listings (seller_id, category_id, title, description, mode, price, item_condition, pickup_location, status)
       VALUES (?, ?, 'Operating System Concepts 10th Ed', 'Textbook in great condition', 'SELL', 45.00, 'LIKE_NEW', 'Engineering Hall', 'ACTIVE')`,
      [userAId, categoryId]
    );
    const listing1Id = listing1Res.insertId;
    createdListingIds.push(listing1Id);

    // Listing 2: for Cancellation & Restoration flow
    const [listing2Res] = await pool.query(
      `INSERT INTO listings (seller_id, category_id, title, description, mode, price, item_condition, pickup_location, status)
       VALUES (?, ?, 'TI-84 Plus CE Calculator', 'Working graphing calculator', 'SELL', 60.00, 'GOOD', 'Library Foyer', 'ACTIVE')`,
      [userAId, categoryId]
    );
    const listing2Id = listing2Res.insertId;
    createdListingIds.push(listing2Id);

    // Offers and Transactions setup:
    // Create and accept offer on Listing 1 -> Transaction 1
    const offer1Res = await makeRequest('POST', `/api/v1/listings/${listing1Id}/offers`, { offeredPrice: 45.00 }, tokenB);
    const offer1Id = offer1Res.body.data.offerId;
    createdOfferIds.push(offer1Id);

    const accept1Res = await makeRequest('PATCH', `/api/v1/offers/${offer1Id}/accept`, {}, tokenA);
    assert(accept1Res.status === 200, 'Seller accepts purchase offer for Listing 1');
    const tx1Id = accept1Res.body.data.transactionId;
    createdTxIds.push(tx1Id);

    // Create and accept offer on Listing 2 -> Transaction 2
    const offer2Res = await makeRequest('POST', `/api/v1/listings/${listing2Id}/offers`, { offeredPrice: 60.00 }, tokenB);
    const offer2Id = offer2Res.body.data.offerId;
    createdOfferIds.push(offer2Id);

    // Also add a competing offer from User C on Listing 2 to verify cascade cancellation
    const compOfferRes = await makeRequest('POST', `/api/v1/listings/${listing2Id}/offers`, { offeredPrice: 55.00 }, tokenC);
    const compOfferId = compOfferRes.body.data.offerId;
    createdOfferIds.push(compOfferId);

    const accept2Res = await makeRequest('PATCH', `/api/v1/offers/${offer2Id}/accept`, {}, tokenA);
    assert(accept2Res.status === 200, 'Seller accepts purchase offer for Listing 2');
    const tx2Id = accept2Res.body.data.transactionId;
    createdTxIds.push(tx2Id);

    // --- TEST 1: Unauthenticated Transaction Access ---
    {
      const res = await makeRequest('GET', '/api/v1/transactions');
      assert(res.status === 401 && res.body.error.code === 'UNAUTHENTICATED', 'Blocks unauthenticated GET /transactions with 401 UNAUTHENTICATED');
      passed++;
    }

    // --- TEST 2: Non-Participant Viewing Transaction Details ---
    {
      const res = await makeRequest('GET', `/api/v1/transactions/${tx1Id}`, null, tokenC);
      assert(res.status === 403 && res.body.error.code === 'FORBIDDEN_OPERATION', 'Denies third-party non-participant viewing transaction with 403 FORBIDDEN_OPERATION');
      passed++;
    }

    // --- TEST 3: Participant Viewing Transaction Details ---
    {
      const res = await makeRequest('GET', `/api/v1/transactions/${tx1Id}`, null, tokenA);
      assert(
        res.status === 200 &&
        res.body.data.id === tx1Id &&
        res.body.data.status === 'PENDING_MEETUP' &&
        res.body.data.finalPrice === '45.00' &&
        res.body.data.seller.id === userAId &&
        res.body.data.buyer.id === userBId,
        'Authorized participant retrieves transaction details with 200 OK'
      );
      passed++;
    }

    // --- TEST 4: User Transaction History & Counterparty Mapping ---
    {
      const res = await makeRequest('GET', '/api/v1/transactions', null, tokenB);
      assert(
        res.status === 200 &&
        Array.isArray(res.body.data) &&
        res.body.data.length >= 2 &&
        res.body.data.some((tx) => tx.id === tx1Id && tx.counterparty.id === userAId),
        'Participant retrieves transaction history with accurate counterparty mapping'
      );
      passed++;
    }

    // --- TEST 5: Non-Participant Handover Completion Forbidden ---
    {
      const res = await makeRequest('POST', `/api/v1/transactions/${tx1Id}/complete`, {}, tokenC);
      assert(res.status === 403 && res.body.error.code === 'FORBIDDEN_OPERATION', 'Denies non-participant confirming handover completion with 403 FORBIDDEN_OPERATION');
      passed++;
    }

    // --- TEST 6: Review Submission Forbidden Before Completion ---
    {
      const res = await makeRequest(
        'POST',
        '/api/v1/reviews',
        { transactionId: tx1Id, rating: 5, comment: 'Premature review before completion' },
        tokenB
      );
      assert(
        res.status === 409 && res.body.error.code === 'INVALID_STATE_TRANSITION',
        'Blocks review submission for PENDING_MEETUP transaction with 409 INVALID_STATE_TRANSITION'
      );
      passed++;
    }

    // --- TEST 7: Successful Handover Completion ---
    {
      const res = await makeRequest('POST', `/api/v1/transactions/${tx1Id}/complete`, {}, tokenA);
      assert(
        res.status === 200 &&
        res.body.data.id === tx1Id &&
        res.body.data.status === 'COMPLETED' &&
        res.body.data.completedAt !== null,
        'Seller marks transaction as COMPLETED with 200 OK and records completedAt'
      );

      // Verify DB listing status changed to COMPLETED
      const [dbListing] = await pool.query('SELECT status FROM listings WHERE id = ?', [listing1Id]);
      assert(dbListing[0].status === 'COMPLETED', 'Associated listing is atomically transitioned to COMPLETED');

      // Verify DB transaction preserved final_price and status
      const [dbTx] = await pool.query('SELECT status, final_price, transaction_type FROM transactions WHERE id = ?', [tx1Id]);
      assert(
        dbTx[0].status === 'COMPLETED' &&
        parseFloat(dbTx[0].final_price) === 45.00 &&
        dbTx[0].transaction_type === 'SALE',
        'Transaction preserved final_price and transaction_type upon completion'
      );
      passed++;
    }

    // --- TEST 8: Rejection of Invalid State Transition on Completed Transaction ---
    {
      // Attempt complete again
      const completeAgainRes = await makeRequest('POST', `/api/v1/transactions/${tx1Id}/complete`, {}, tokenA);
      assert(
        completeAgainRes.status === 409 && completeAgainRes.body.error.code === 'INVALID_STATE_TRANSITION',
        'Rejects completing an already COMPLETED transaction with 409 INVALID_STATE_TRANSITION'
      );

      // Attempt cancel on completed transaction
      const cancelCompletedRes = await makeRequest('POST', `/api/v1/transactions/${tx1Id}/cancel`, {}, tokenA);
      assert(
        cancelCompletedRes.status === 409 && cancelCompletedRes.body.error.code === 'INVALID_STATE_TRANSITION',
        'Rejects cancelling an already COMPLETED transaction with 409 INVALID_STATE_TRANSITION'
      );
      passed++;
    }

    // --- TEST 9: Review Submission - Non-Participant Forbidden ---
    {
      const res = await makeRequest(
        'POST',
        '/api/v1/reviews',
        { transactionId: tx1Id, rating: 5, comment: 'Nice deal' },
        tokenC
      );
      assert(res.status === 403 && res.body.error.code === 'FORBIDDEN_OPERATION', 'Denies non-participant review submission with 403 FORBIDDEN_OPERATION');
      passed++;
    }

    // --- TEST 10: Review Rating Validation ---
    {
      // Rating > 5
      const highRatingRes = await makeRequest('POST', '/api/v1/reviews', { transactionId: tx1Id, rating: 6 }, tokenB);
      assert(
        highRatingRes.status === 400 && highRatingRes.body.error.code === 'RATING_OUT_OF_BOUNDS',
        'Rejects rating > 5 with 400 RATING_OUT_OF_BOUNDS'
      );

      // Rating < 1
      const lowRatingRes = await makeRequest('POST', '/api/v1/reviews', { transactionId: tx1Id, rating: 0 }, tokenB);
      assert(
        lowRatingRes.status === 400 && lowRatingRes.body.error.code === 'RATING_OUT_OF_BOUNDS',
        'Rejects rating < 1 with 400 RATING_OUT_OF_BOUNDS'
      );

      // Decimal rating
      const floatRatingRes = await makeRequest('POST', '/api/v1/reviews', { transactionId: tx1Id, rating: 4.5 }, tokenB);
      assert(
        floatRatingRes.status === 400 && floatRatingRes.body.error.code === 'RATING_OUT_OF_BOUNDS',
        'Rejects non-integer rating with 400 RATING_OUT_OF_BOUNDS'
      );
      passed++;
    }

    // --- TEST 11: Successful Review Submission by Buyer ---
    {
      const res = await makeRequest(
        'POST',
        '/api/v1/reviews',
        { transactionId: tx1Id, rating: 5, comment: 'Seamless transaction and book is like new!' },
        tokenB
      );
      assert(
        res.status === 201 &&
        res.body.data.transactionId === tx1Id &&
        res.body.data.revieweeId === userAId &&
        res.body.data.rating === 5,
        'Buyer successfully submits 5-star review for seller with 201 Created'
      );
      createdReviewIds.push(res.body.data.reviewId);
      passed++;
    }

    // --- TEST 12: Duplicate Review Rejection ---
    {
      const res = await makeRequest(
        'POST',
        '/api/v1/reviews',
        { transactionId: tx1Id, rating: 4, comment: 'Trying to review again' },
        tokenB
      );
      assert(
        res.status === 409 && res.body.error.code === 'DUPLICATE_ENTITY',
        'Rejects duplicate review for same transaction by same reviewer with 409 DUPLICATE_ENTITY'
      );
      passed++;
    }

    // --- TEST 13: Seller Reviews Buyer & Reputation Calculation ---
    {
      const res = await makeRequest(
        'POST',
        '/api/v1/reviews',
        { transactionId: tx1Id, rating: 5, comment: 'Punctual buyer, brought exact cash!' },
        tokenA
      );
      assert(
        res.status === 201 &&
        res.body.data.transactionId === tx1Id &&
        res.body.data.revieweeId === userBId &&
        res.body.data.rating === 5,
        'Seller successfully submits review for buyer with 201 Created'
      );
      createdReviewIds.push(res.body.data.reviewId);

      // Verify dynamic reputation metrics via GET /api/v1/reviews?userId=...
      const repRes = await makeRequest('GET', `/api/v1/reviews?userId=${userAId}`);
      assert(
        repRes.status === 200 &&
        repRes.body.data.reputation.totalReviews === 1 &&
        repRes.body.data.reputation.averageRating === 5.0,
        'Dynamic seller reputation correctly reflects 5.00 average from reviews table'
      );
      passed++;
    }

    // --- TEST 14: Non-Participant Cancellation Forbidden ---
    {
      const res = await makeRequest('POST', `/api/v1/transactions/${tx2Id}/cancel`, {}, tokenC);
      assert(
        res.status === 403 && res.body.error.code === 'FORBIDDEN_OPERATION',
        'Denies non-participant from cancelling transaction with 403 FORBIDDEN_OPERATION'
      );
      passed++;
    }

    // --- TEST 15: Successful Transaction Cancellation & Correct Listing Restoration ---
    {
      // Prior check: Listing 2 is RESERVED
      const [beforeListing] = await pool.query('SELECT status FROM listings WHERE id = ?', [listing2Id]);
      assert(beforeListing[0].status === 'RESERVED', 'Listing 2 is currently in RESERVED state');

      // Buyer cancels meetup
      const res = await makeRequest('POST', `/api/v1/transactions/${tx2Id}/cancel`, {}, tokenB);
      assert(
        res.status === 200 &&
        res.body.data.id === tx2Id &&
        res.body.data.status === 'CANCELLED',
        'Participant successfully cancels transaction with 200 OK'
      );

      // Verify DB transaction status is CANCELLED and final_price is preserved
      const [dbTx2] = await pool.query('SELECT status, final_price FROM transactions WHERE id = ?', [tx2Id]);
      assert(
        dbTx2[0].status === 'CANCELLED' && parseFloat(dbTx2[0].final_price) === 60.00,
        'Transaction status is CANCELLED with final_price (60.00) preserved'
      );

      // Verify Listing 2 is restored to ACTIVE
      const [afterListing] = await pool.query('SELECT status FROM listings WHERE id = ?', [listing2Id]);
      assert(afterListing[0].status === 'ACTIVE', 'Listing 2 is restored to ACTIVE upon cancellation');

      // Verify competing offers remain voided (CANCELLED_BY_SYSTEM)
      const [compOfferDb] = await pool.query('SELECT status FROM offers WHERE id = ?', [compOfferId]);
      assert(compOfferDb[0].status === 'CANCELLED_BY_SYSTEM', 'Competing offers remain CANCELLED_BY_SYSTEM');

      // Verify that the restored listing can accept new offers now that it is ACTIVE
      const newOfferRes = await makeRequest('POST', `/api/v1/listings/${listing2Id}/offers`, { offeredPrice: 58.00 }, tokenC);
      assert(
        newOfferRes.status === 201 && newOfferRes.body.data.status === 'PENDING',
        'New offer can now be submitted on the restored ACTIVE listing'
      );
      createdOfferIds.push(newOfferRes.body.data.offerId);
      passed++;
    }

    // --- TEST 16: Atomic Transaction Rollback on Failure ---
    {
      const conn = await pool.getConnection();
      let rollbackVerified = false;
      try {
        await conn.beginTransaction();

        // Perform test mutation
        await conn.query('UPDATE listings SET title = ? WHERE id = ?', ['CORRUPTED_TITLE_TEST', listing2Id]);

        // Deliberately trigger SQL error (violating foreign key constraint)
        await conn.query('INSERT INTO transactions (id, offer_id, listing_id, seller_id, buyer_id, transaction_type) VALUES (999999, 999999, 999999, 999999, 999999, "SALE")');
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        rollbackVerified = true;
      } finally {
        conn.release();
      }

      const [checkListing] = await pool.query('SELECT title FROM listings WHERE id = ?', [listing2Id]);
      assert(
        rollbackVerified && checkListing[0].title !== 'CORRUPTED_TITLE_TEST',
        'Multi-step database transaction rolls back completely on error, preserving relational integrity'
      );
      passed++;
    }

  } catch (error) {
    console.error('Test execution error:', error);
    failed++;
  } finally {
    // Clean up temporary test data in reverse foreign-key order
    try {
      if (createdReviewIds.length > 0) {
        await pool.query('DELETE FROM reviews WHERE id IN (?)', [createdReviewIds]);
      }
      if (createdTxIds.length > 0) {
        await pool.query('DELETE FROM transactions WHERE id IN (?)', [createdTxIds]);
      }
      if (createdOfferIds.length > 0) {
        await pool.query('DELETE FROM offers WHERE id IN (?)', [createdOfferIds]);
      }
      if (createdListingIds.length > 0) {
        await pool.query('DELETE FROM listings WHERE id IN (?)', [createdListingIds]);
      }
      if (createdUserIds.length > 0) {
        await pool.query('DELETE FROM users WHERE id IN (?)', [createdUserIds]);
      }
    } catch (cleanupErr) {
      console.warn('Cleanup error (ignored):', cleanupErr.message);
    }
  }

  console.log(`\n--- Test Results: ${passed} passed, ${failed} failed ---`);
  if (failed > 0) {
    process.exit(1);
  }
}

// Start temporary test server
server = app.listen(TEST_PORT, async () => {
  try {
    await runTests();
  } finally {
    server.close();
    process.exit(0);
  }
});
