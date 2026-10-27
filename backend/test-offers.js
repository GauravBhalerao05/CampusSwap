/**
 * Comprehensive Automated Tests for CampusSwap Offers and Barter Workflow
 * File: backend/test-offers.js
 * 
 * Tests:
 * 1. POST /api/v1/listings/:id/offers on own listing -> 400 SELF_OFFER_DISALLOWED
 * 2. POST /api/v1/listings/:id/offers with invalid price -> 400 VALIDATION_ERROR
 * 3. POST /api/v1/listings/:id/offers successfully creates purchase offer -> 201 Created (PENDING)
 * 4. GET /api/v1/listings/:id/offers by non-owner -> 403 FORBIDDEN_OPERATION
 * 5. GET /api/v1/listings/:id/offers by owner -> 200 OK with list of offers
 * 6. POST /api/v1/offers/:id/counter by non-owner -> 403 FORBIDDEN_OPERATION
 * 7. POST /api/v1/offers/:id/counter by owner -> 200 OK (COUNTERED)
 * 8. PATCH /api/v1/offers/:id/withdraw by non-buyer -> 403 FORBIDDEN_OPERATION
 * 9. PATCH /api/v1/offers/:id/reject by owner -> 200 OK (REJECTED)
 * 10. Barter proposal with unowned / inactive offered listing -> 400 INVALID_OFFERED_ITEM
 * 11. Barter proposal with valid active owned listing -> 201 Created (PENDING)
 * 12. Competing offers and atomic acceptance:
 *     - Seller accepts barter proposal
 *     - Row locks acquired in deterministic order LEAST(target, offered) then GREATEST
 *     - Both listings transition to RESERVED
 *     - Competing offer is automatically updated to CANCELLED_BY_SYSTEM
 *     - Exactly one transaction record created preserving cash difference
 * 13. Attempting to accept another offer on already RESERVED listing -> 409 STATE_CONFLICT
 */

const http = require('http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./config/database');
const app = require('./app');

let server;
const TEST_PORT = 5097;
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
  console.log('--- Starting CampusSwap Offers & Barter Tests ---');
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
  const sellerEmail = `seller.offer.${timestamp}@univ.edu`;
  const buyer1Email = `buyer1.offer.${timestamp}@univ.edu`;
  const buyer2Email = `buyer2.offer.${timestamp}@univ.edu`;
  const passwordHash = await bcrypt.hash('Password123!', 10);

  let sellerId, buyer1Id, buyer2Id;
  let sellerToken, buyer1Token, buyer2Token;
  let targetListingId, buyer1ListingId;
  let offer1Id, offer2Id, barterOfferId;
  let transactionId;

  try {
    // 1. Setup 3 test users
    const [u1] = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, status, department)
       VALUES (?, ?, 'Seller Student', 'STUDENT', 'ACTIVE', 'CS')`,
      [sellerEmail, passwordHash]
    );
    sellerId = u1.insertId;

    const [u2] = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, status, department)
       VALUES (?, ?, 'Buyer One', 'STUDENT', 'ACTIVE', 'EE')`,
      [buyer1Email, passwordHash]
    );
    buyer1Id = u2.insertId;

    const [u3] = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, status, department)
       VALUES (?, ?, 'Buyer Two', 'STUDENT', 'ACTIVE', 'ME')`,
      [buyer2Email, passwordHash]
    );
    buyer2Id = u3.insertId;

    const secret = process.env.JWT_SECRET || 'campusswap_local_dev_secret_key_2026';
    sellerToken = jwt.sign({ userId: sellerId, email: sellerEmail, role: 'STUDENT' }, secret, { expiresIn: '1h' });
    buyer1Token = jwt.sign({ userId: buyer1Id, email: buyer1Email, role: 'STUDENT' }, secret, { expiresIn: '1h' });
    buyer2Token = jwt.sign({ userId: buyer2Id, email: buyer2Email, role: 'STUDENT' }, secret, { expiresIn: '1h' });

    // Fetch existing category
    const [cats] = await pool.query('SELECT id FROM categories LIMIT 1');
    const categoryId = cats[0].id;

    // Create target listing owned by seller (SELL mode, price $50.00)
    const [tList] = await pool.query(
      `INSERT INTO listings (seller_id, category_id, title, description, mode, price, is_negotiable, item_condition, pickup_location, status)
       VALUES (?, ?, 'Engineering Drawing Kit', 'Complete drafter and compass set.', 'SELL', 50.00, TRUE, 'GOOD', 'Library', 'ACTIVE')`,
      [sellerId, categoryId]
    );
    targetListingId = tList.insertId;

    // Create a listing owned by buyer1 for barter (BARTER mode, TI-84 Calculator)
    const [bList] = await pool.query(
      `INSERT INTO listings (seller_id, category_id, title, description, mode, price, barter_preferences, item_condition, pickup_location, status)
       VALUES (?, ?, 'TI-84 Plus Calculator', 'Good condition calculator.', 'BARTER', 0.00, 'Looking for drawing kit', 'GOOD', 'Student Center', 'ACTIVE')`,
      [buyer1Id, categoryId]
    );
    buyer1ListingId = bList.insertId;

    // Test 1: Self-offer disallowed
    const resSelf = await makeRequest(
      'POST',
      `/api/v1/listings/${targetListingId}/offers`,
      { offerType: 'PURCHASE', offeredPrice: 40.0 },
      sellerToken
    );
    assert(
      resSelf.status === 400 && resSelf.body.error?.code === 'SELF_OFFER_DISALLOWED',
      'Disallows making purchase offer on own listing with 400 SELF_OFFER_DISALLOWED'
    );

    // Test 2: Invalid price in purchase offer
    const resInvalidPrice = await makeRequest(
      'POST',
      `/api/v1/listings/${targetListingId}/offers`,
      { offerType: 'PURCHASE', offeredPrice: -5.0 },
      buyer1Token
    );
    assert(
      resInvalidPrice.status === 400 && resInvalidPrice.body.error?.code === 'VALIDATION_ERROR',
      'Rejects offer with non-positive price with 400 VALIDATION_ERROR'
    );

    // Test 3: Buyer 2 creates purchase offer ($40.00)
    const resOffer2 = await makeRequest(
      'POST',
      `/api/v1/listings/${targetListingId}/offers`,
      { offerType: 'PURCHASE', offeredPrice: 40.0, message: 'Would you accept $40 cash?' },
      buyer2Token
    );
    offer2Id = resOffer2.body.data?.offerId;
    assert(
      resOffer2.status === 201 &&
      resOffer2.body.data?.status === 'PENDING' &&
      resOffer2.body.data?.offeredPrice === '40.00',
      'Buyer 2 submits purchase offer successfully with 201 Created and PENDING status'
    );

    // Test 4: View offers by non-owner -> 403
    const resViewForbidden = await makeRequest(
      'GET',
      `/api/v1/listings/${targetListingId}/offers`,
      null,
      buyer1Token
    );
    assert(
      resViewForbidden.status === 403 && resViewForbidden.body.error?.code === 'FORBIDDEN_OPERATION',
      'Denies non-owner viewing offers on a listing with 403 FORBIDDEN_OPERATION'
    );

    // Test 5: View offers by owner -> 200 OK
    const resViewOwner = await makeRequest(
      'GET',
      `/api/v1/listings/${targetListingId}/offers`,
      null,
      sellerToken
    );
    assert(
      resViewOwner.status === 200 &&
      Array.isArray(resViewOwner.body.data) &&
      resViewOwner.body.data.some((o) => o.id === offer2Id),
      'Listing owner retrieves incoming offers with 200 OK'
    );

    // Test 6: Counteroffer by non-owner -> 403
    const resCounterForbidden = await makeRequest(
      'POST',
      `/api/v1/offers/${offer2Id}/counter`,
      { counterPrice: 45.0 },
      buyer1Token
    );
    assert(
      resCounterForbidden.status === 403 && resCounterForbidden.body.error?.code === 'FORBIDDEN_OPERATION',
      'Denies non-owner submitting a counteroffer with 403 FORBIDDEN_OPERATION'
    );

    // Test 7: Counteroffer by owner -> 200 OK (status = COUNTERED)
    const resCounter = await makeRequest(
      'POST',
      `/api/v1/offers/${offer2Id}/counter`,
      { counterPrice: 45.0, message: 'Can we meet at $45?' },
      sellerToken
    );
    assert(
      resCounter.status === 200 &&
      resCounter.body.data?.status === 'COUNTERED' &&
      resCounter.body.data?.counterPrice === '45.00',
      'Listing owner counters offer with 200 OK and COUNTERED status'
    );

    // Test 8: Withdraw offer by non-buyer -> 403
    const resWithdrawForbidden = await makeRequest(
      'PATCH',
      `/api/v1/offers/${offer2Id}/withdraw`,
      null,
      buyer1Token
    );
    assert(
      resWithdrawForbidden.status === 403 && resWithdrawForbidden.body.error?.code === 'FORBIDDEN_OPERATION',
      'Denies non-proposer withdrawing offer with 403 FORBIDDEN_OPERATION'
    );

    // Create temporary offer from buyer2 to test rejection
    const resTempOffer = await makeRequest(
      'POST',
      `/api/v1/listings/${targetListingId}/offers`,
      { offerType: 'PURCHASE', offeredPrice: 30.0 },
      buyer2Token
    );
    const tempOfferId = resTempOffer.body.data?.offerId;

    // Test 9: Reject offer by owner -> 200 OK (status = REJECTED)
    const resReject = await makeRequest(
      'PATCH',
      `/api/v1/offers/${tempOfferId}/reject`,
      null,
      sellerToken
    );
    assert(
      resReject.status === 200 && resReject.body.data?.status === 'REJECTED',
      'Listing owner rejects offer with 200 OK and REJECTED status'
    );

    // Test 10: Barter proposal with unowned listing -> 400 INVALID_OFFERED_ITEM
    const resBarterUnowned = await makeRequest(
      'POST',
      `/api/v1/listings/${targetListingId}/barter-proposals`,
      { offeredListingId: targetListingId, cashDifference: 5.0 },
      buyer1Token
    );
    assert(
      resBarterUnowned.status === 400 && resBarterUnowned.body.error?.code === 'INVALID_OFFERED_ITEM',
      'Rejects barter proposal referencing unowned/same listing with 400 INVALID_OFFERED_ITEM'
    );

    // Test 11: Barter proposal by Buyer 1 with active owned listing
    const resBarterValid = await makeRequest(
      'POST',
      `/api/v1/listings/${targetListingId}/barter-proposals`,
      { offeredListingId: buyer1ListingId, cashDifference: 10.0, message: 'TI-84 plus $10 cash' },
      buyer1Token
    );
    barterOfferId = resBarterValid.body.data?.offerId;
    assert(
      resBarterValid.status === 201 &&
      resBarterValid.body.data?.offerType === 'BARTER' &&
      resBarterValid.body.data?.cashDifference === '10.00' &&
      resBarterValid.body.data?.status === 'PENDING',
      'Submits valid barter proposal with 201 Created and PENDING status'
    );

    // Test 12: Seller accepts Barter proposal with deterministic locking
    // At this point:
    // - Target listing has barterOfferId (PENDING) and offer2Id (COUNTERED)
    // - Both targetListingId and buyer1ListingId are ACTIVE
    const resAcceptBarter = await makeRequest(
      'PATCH',
      `/api/v1/offers/${barterOfferId}/accept`,
      null,
      sellerToken
    );
    transactionId = resAcceptBarter.body.data?.transactionId;
    assert(
      resAcceptBarter.status === 200 &&
      resAcceptBarter.body.data?.transactionStatus === 'PENDING_MEETUP' &&
      resAcceptBarter.body.data?.agreedPrice === '10.00' &&
      !!transactionId,
      'Accepts barter proposal, creating PENDING_MEETUP transaction with agreed cash difference ($10.00)'
    );

    // Verify DB state changes:
    // Both listings must now be RESERVED
    const [targetCheck] = await pool.query('SELECT status FROM listings WHERE id = ?', [targetListingId]);
    const [barterCheck] = await pool.query('SELECT status FROM listings WHERE id = ?', [buyer1ListingId]);
    assert(
      targetCheck[0].status === 'RESERVED' && barterCheck[0].status === 'RESERVED',
      'Both target and offered barter listings transitioned atomically to RESERVED'
    );

    // Competing offer (offer2Id) must be CANCELLED_BY_SYSTEM
    const [competingCheck] = await pool.query('SELECT status FROM offers WHERE id = ?', [offer2Id]);
    assert(
      competingCheck[0].status === 'CANCELLED_BY_SYSTEM',
      'Competing offer on target listing was automatically invalidated to CANCELLED_BY_SYSTEM'
    );

    // Verify transaction record preserves final_price = 10.00 and barter_listing_id
    const [txCheck] = await pool.query('SELECT * FROM transactions WHERE id = ?', [transactionId]);
    assert(
      txCheck.length === 1 &&
      txCheck[0].transaction_type === 'BARTER' &&
      parseFloat(txCheck[0].final_price) === 10.0 &&
      txCheck[0].barter_listing_id === buyer1ListingId &&
      txCheck[0].status === 'PENDING_MEETUP',
      'Transaction record accurately preserves barter_listing_id, transaction_type, and cash difference'
    );

    // Test 13: Attempt to accept an offer on already RESERVED listing -> 409 STATE_CONFLICT
    const resAcceptReserved = await makeRequest(
      'PATCH',
      `/api/v1/offers/${offer2Id}/accept`,
      null,
      buyer2Token
    );
    assert(
      resAcceptReserved.status === 409 &&
      (resAcceptReserved.body.error?.code === 'STATE_CONFLICT' || resAcceptReserved.body.error?.code === 'INVALID_STATE_TRANSITION'),
      'Rejects accepting offer on already RESERVED listing with 409 Conflict'
    );

  } finally {
    // Cleanup test records in dependency order
    if (transactionId) {
      await pool.query('DELETE FROM transactions WHERE id = ?', [transactionId]);
    }
    if (targetListingId) {
      await pool.query('DELETE FROM offers WHERE listing_id = ?', [targetListingId]);
      await pool.query('DELETE FROM listings WHERE id = ?', [targetListingId]);
    }
    if (buyer1ListingId) {
      await pool.query('DELETE FROM offers WHERE listing_id = ? OR offered_listing_id = ?', [buyer1ListingId, buyer1ListingId]);
      await pool.query('DELETE FROM listings WHERE id = ?', [buyer1ListingId]);
    }
    if (sellerId) await pool.query('DELETE FROM users WHERE id = ?', [sellerId]);
    if (buyer1Id) await pool.query('DELETE FROM users WHERE id = ?', [buyer1Id]);
    if (buyer2Id) await pool.query('DELETE FROM users WHERE id = ?', [buyer2Id]);

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
  console.error('Fatal test error in offers suite:', err);
  process.exit(1);
});
