/**
 * Comprehensive Integration Tests for CampusSwap Messaging API (Phase 6)
 * File: backend/test-messages.js
 *
 * Tests:
 * 1. Unauthenticated requests to POST and GET return 401 UNAUTHENTICATED
 * 2. Input validation:
 *    - Missing offerId returns 400 VALIDATION_ERROR
 *    - Malformed offerId returns 400 VALIDATION_ERROR
 *    - Missing or empty messageText returns 400 VALIDATION_ERROR
 *    - Non-string messageText returns 400 VALIDATION_ERROR
 *    - Overly long messageText (> 5000 chars) returns 400 VALIDATION_ERROR
 *    - Non-existent offerId returns 404 RESOURCE_NOT_FOUND
 * 3. Access control & conversation isolation:
 *    - Third-party student cannot send message in Offer 1 (403 FORBIDDEN_OPERATION)
 *    - Third-party student cannot read messages in Offer 1 (403 FORBIDDEN_OPERATION)
 *    - Competing buyer on same listing cannot access Offer 1 messages (403 FORBIDDEN_OPERATION)
 *    - Suspended student blocked by auth middleware (403 ACCOUNT_SUSPENDED)
 * 4. Sending messages:
 *    - Buyer sends message via POST /api/v1/messages (201 Created)
 *    - Seller replies via POST /api/v1/messages/:offerId (201 Created)
 *    - Buyer sends message via POST /api/v1/offers/:id/messages (201 Created)
 * 5. Retrieving messages & read receipts:
 *    - Retrieve thread via GET /api/v1/messages/:offerId (200 OK)
 *    - Retrieve thread via GET /api/v1/offers/:id/messages (200 OK)
 *    - Messages are in chronological order (sent_at ASC)
 *    - Unread messages from counterparty are marked as read (isRead = true)
 * 6. Pagination validation & slicing:
 *    - Invalid page (0, negative, string) returns 400 VALIDATION_ERROR
 *    - Invalid limit (0, negative, > 100, string) returns 400 VALIDATION_ERROR
 *    - Valid page & limit slices messages correctly
 * 7. Conversation thread list:
 *    - GET /api/v1/messages returns user's active conversations with unreadCount & lastMessage
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
          try {
            const parsed = JSON.parse(data);
            resolve({ status: res.statusCode, body: parsed });
          } catch (e) {
            resolve({ status: res.statusCode, body: data });
          }
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
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log('--- Starting CampusSwap Messaging API Tests ---');
  let passed = 0;
  let failed = 0;

  try {
    server = app.listen(TEST_PORT);
    await new Promise((r) => setTimeout(r, 200));

    // 1. Prepare test users
    const timestamp = Date.now();
    const passwordHash = await bcrypt.hash('TestPass123!', 10);
    const jwtSecret = process.env.JWT_SECRET || 'campusswap_local_dev_secret_key_2026';

    // Seller
    const [sellerRes] = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, status)
       VALUES (?, ?, ?, 'STUDENT', 'ACTIVE')`,
      [`msg.seller.${timestamp}@univ.edu`, passwordHash, 'Alice Seller']
    );
    const sellerId = sellerRes.insertId;
    const sellerToken = jwt.sign({ userId: sellerId, email: `msg.seller.${timestamp}@univ.edu`, role: 'STUDENT' }, jwtSecret);

    // Buyer 1 (Participant in Offer 1)
    const [buyer1Res] = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, status)
       VALUES (?, ?, ?, 'STUDENT', 'ACTIVE')`,
      [`msg.buyer1.${timestamp}@univ.edu`, passwordHash, 'Bob Buyer']
    );
    const buyer1Id = buyer1Res.insertId;
    const buyer1Token = jwt.sign({ userId: buyer1Id, email: `msg.buyer1.${timestamp}@univ.edu`, role: 'STUDENT' }, jwtSecret);

    // Buyer 2 (Competitor on same listing with Offer 2)
    const [buyer2Res] = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, status)
       VALUES (?, ?, ?, 'STUDENT', 'ACTIVE')`,
      [`msg.buyer2.${timestamp}@univ.edu`, passwordHash, 'Charlie Competitor']
    );
    const buyer2Id = buyer2Res.insertId;
    const buyer2Token = jwt.sign({ userId: buyer2Id, email: `msg.buyer2.${timestamp}@univ.edu`, role: 'STUDENT' }, jwtSecret);

    // Unrelated Student (Neither buyer nor seller)
    const [unrelatedRes] = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, status)
       VALUES (?, ?, ?, 'STUDENT', 'ACTIVE')`,
      [`msg.unrelated.${timestamp}@univ.edu`, passwordHash, 'Dave Outsider']
    );
    const unrelatedId = unrelatedRes.insertId;
    const unrelatedToken = jwt.sign({ userId: unrelatedId, email: `msg.unrelated.${timestamp}@univ.edu`, role: 'STUDENT' }, jwtSecret);

    // Suspended Student
    const [suspendedRes] = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, status)
       VALUES (?, ?, ?, 'STUDENT', 'SUSPENDED')`,
      [`msg.suspended.${timestamp}@univ.edu`, passwordHash, 'Eve Suspended']
    );
    const suspendedId = suspendedRes.insertId;
    const suspendedToken = jwt.sign({ userId: suspendedId, email: `msg.suspended.${timestamp}@univ.edu`, role: 'STUDENT' }, jwtSecret);

    // Get active category
    const [categories] = await pool.query('SELECT id FROM categories WHERE is_active = TRUE LIMIT 1');
    const categoryId = categories[0].id;

    // Create listing owned by Seller
    const [listingRes] = await pool.query(
      `INSERT INTO listings (seller_id, category_id, title, description, mode, price, is_negotiable, pickup_location, status)
       VALUES (?, ?, ?, ?, 'SELL', 50.00, TRUE, 'Student Center', 'ACTIVE')`,
      [sellerId, categoryId, 'Algorithms Textbook 4th Ed', 'Clean condition CS textbook.']
    );
    const listingId = listingRes.insertId;

    // Create Offer 1 (Buyer 1 -> Seller)
    const [offer1Res] = await pool.query(
      `INSERT INTO offers (listing_id, buyer_id, offer_type, offered_price, status)
       VALUES (?, ?, 'PURCHASE', 45.00, 'PENDING')`,
      [listingId, buyer1Id]
    );
    const offer1Id = offer1Res.insertId;

    // Create Offer 2 (Buyer 2 -> Seller, on same listing)
    const [offer2Res] = await pool.query(
      `INSERT INTO offers (listing_id, buyer_id, offer_type, offered_price, status)
       VALUES (?, ?, 'PURCHASE', 40.00, 'PENDING')`,
      [listingId, buyer2Id]
    );
    const offer2Id = offer2Res.insertId;

    // -------------------------------------------------------------
    // Test 1: Reject unauthenticated requests
    // -------------------------------------------------------------
    try {
      const resPost = await makeRequest('POST', '/api/v1/messages', { offerId: offer1Id, messageText: 'Hello' });
      assert(resPost.status === 401, 'Expected 401 on unauthenticated POST /messages');
      assert(resPost.body.error.code === 'UNAUTHENTICATED', 'Expected UNAUTHENTICATED error code');

      const resGet = await makeRequest('GET', `/api/v1/messages/${offer1Id}`);
      assert(resGet.status === 401, 'Expected 401 on unauthenticated GET /messages/:id');

      const resOffersPost = await makeRequest('POST', `/api/v1/offers/${offer1Id}/messages`, { messageText: 'Hello' });
      assert(resOffersPost.status === 401, 'Expected 401 on unauthenticated POST /offers/:id/messages');

      const resOffersGet = await makeRequest('GET', `/api/v1/offers/${offer1Id}/messages`);
      assert(resOffersGet.status === 401, 'Expected 401 on unauthenticated GET /offers/:id/messages');

      console.log('  ✓ Blocks unauthenticated requests with 401 UNAUTHENTICATED');
      passed++;
    } catch (err) {
      console.error('  ✗ Blocks unauthenticated requests failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 2: Validation of message content & identifiers
    // -------------------------------------------------------------
    try {
      // Missing offer ID
      const resNoOffer = await makeRequest('POST', '/api/v1/messages', { messageText: 'Test' }, buyer1Token);
      assert(resNoOffer.status === 400 && resNoOffer.body.error.code === 'VALIDATION_ERROR', 'Expected 400 on missing offerId');

      // Malformed offer ID
      const resBadOffer = await makeRequest('POST', '/api/v1/messages/abc', { messageText: 'Test' }, buyer1Token);
      assert(resBadOffer.status === 400 && resBadOffer.body.error.code === 'VALIDATION_ERROR', 'Expected 400 on malformed offerId');

      // Missing message text
      const resNoText = await makeRequest('POST', `/api/v1/messages/${offer1Id}`, {}, buyer1Token);
      assert(resNoText.status === 400 && resNoText.body.error.code === 'VALIDATION_ERROR', 'Expected 400 on missing messageText');

      // Empty string message text
      const resEmptyText = await makeRequest('POST', `/api/v1/messages/${offer1Id}`, { messageText: '   ' }, buyer1Token);
      assert(resEmptyText.status === 400 && resEmptyText.body.error.code === 'VALIDATION_ERROR', 'Expected 400 on empty messageText');

      // Non-string message text
      const resNonString = await makeRequest('POST', `/api/v1/messages/${offer1Id}`, { messageText: 12345 }, buyer1Token);
      assert(resNonString.status === 400 && resNonString.body.error.code === 'VALIDATION_ERROR', 'Expected 400 on non-string messageText');

      // Overly long message (> 5000 chars)
      const longMessage = 'A'.repeat(5001);
      const resLong = await makeRequest('POST', `/api/v1/messages/${offer1Id}`, { messageText: longMessage }, buyer1Token);
      assert(resLong.status === 400 && resLong.body.error.code === 'VALIDATION_ERROR', 'Expected 400 on messageText > 5000 chars');

      console.log('  ✓ Rejects invalid message content and identifiers with 400 VALIDATION_ERROR');
      passed++;
    } catch (err) {
      console.error('  ✗ Validation tests failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 3: Non-existent offer returns 404 RESOURCE_NOT_FOUND
    // -------------------------------------------------------------
    try {
      const resPost404 = await makeRequest('POST', '/api/v1/messages/999999', { messageText: 'Hello?' }, buyer1Token);
      assert(resPost404.status === 404, 'Expected 404 on non-existent offer');
      assert(resPost404.body.error.code === 'RESOURCE_NOT_FOUND', 'Expected RESOURCE_NOT_FOUND code');

      const resGet404 = await makeRequest('GET', '/api/v1/messages/999999', null, buyer1Token);
      assert(resGet404.status === 404, 'Expected 404 on non-existent offer GET');

      console.log('  ✓ Rejects non-existent conversation with 404 RESOURCE_NOT_FOUND');
      passed++;
    } catch (err) {
      console.error('  ✗ Non-existent conversation test failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 4: Deny unauthorized third-party user from sending or reading
    // -------------------------------------------------------------
    try {
      const resSend = await makeRequest(
        'POST',
        `/api/v1/messages/${offer1Id}`,
        { messageText: 'Can I crash this chat?' },
        unrelatedToken
      );
      assert(resSend.status === 403, 'Expected 403 for unauthorized sender');
      assert(resSend.body.error.code === 'FORBIDDEN_OPERATION', 'Expected FORBIDDEN_OPERATION code');

      const resRead = await makeRequest('GET', `/api/v1/messages/${offer1Id}`, null, unrelatedToken);
      assert(resRead.status === 403, 'Expected 403 for unauthorized reader');
      assert(resRead.body.error.code === 'FORBIDDEN_OPERATION', 'Expected FORBIDDEN_OPERATION code');

      console.log('  ✓ Denies unauthorized third-party student with 403 FORBIDDEN_OPERATION');
      passed++;
    } catch (err) {
      console.error('  ✗ Unauthorized third-party test failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 5: Conversation isolation between competing buyers on same listing
    // -------------------------------------------------------------
    try {
      // Buyer 2 has Offer 2 on the same listing, but should NOT be able to view or send in Offer 1
      const resCompSend = await makeRequest(
        'POST',
        `/api/v1/messages/${offer1Id}`,
        { messageText: 'Spying on Offer 1' },
        buyer2Token
      );
      assert(resCompSend.status === 403, 'Expected 403 when competitor sends to Offer 1');
      assert(resCompSend.body.error.code === 'FORBIDDEN_OPERATION', 'Expected FORBIDDEN_OPERATION');

      const resCompRead = await makeRequest('GET', `/api/v1/messages/${offer1Id}`, null, buyer2Token);
      assert(resCompRead.status === 403, 'Expected 403 when competitor reads Offer 1');
      assert(resCompRead.body.error.code === 'FORBIDDEN_OPERATION', 'Expected FORBIDDEN_OPERATION');

      console.log('  ✓ Enforces conversation isolation between competing buyers on same listing');
      passed++;
    } catch (err) {
      console.error('  ✗ Conversation isolation test failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 6: Suspended user is blocked from messaging
    // -------------------------------------------------------------
    try {
      const resSuspended = await makeRequest(
        'POST',
        `/api/v1/messages/${offer1Id}`,
        { messageText: 'Suspended attempt' },
        suspendedToken
      );
      assert(resSuspended.status === 403, 'Expected 403 for suspended user');
      assert(resSuspended.body.error.code === 'ACCOUNT_SUSPENDED', 'Expected ACCOUNT_SUSPENDED code');

      console.log('  ✓ Blocks suspended student with 403 ACCOUNT_SUSPENDED');
      passed++;
    } catch (err) {
      console.error('  ✗ Suspended user test failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 7: Buyer sends message via POST /api/v1/messages
    // -------------------------------------------------------------
    let msg1Id;
    try {
      const res = await makeRequest(
        'POST',
        '/api/v1/messages',
        {
          offerId: offer1Id,
          messageText: 'Hello Seller! Is the Algorithms book still in good shape?'
        },
        buyer1Token
      );

      assert(res.status === 201, `Expected 201 Created, got ${res.status}`);
      assert(res.body.success === true, 'Expected success: true');
      assert(res.body.data.offerId === offer1Id, 'Expected correct offerId');
      assert(res.body.data.senderId === buyer1Id, 'Expected correct senderId');
      assert(res.body.data.messageText === 'Hello Seller! Is the Algorithms book still in good shape?', 'Expected matching text');
      assert(typeof res.body.data.messageId === 'number', 'Expected numeric messageId');
      assert(typeof res.body.data.sentAt === 'string', 'Expected ISO sentAt string');
      msg1Id = res.body.data.messageId;

      console.log('  ✓ Buyer successfully sends message via POST /api/v1/messages with 201 Created');
      passed++;
    } catch (err) {
      console.error('  ✗ Buyer send message test failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 8: Seller replies via POST /api/v1/messages/:offerId
    // -------------------------------------------------------------
    let msg2Id;
    try {
      const res = await makeRequest(
        'POST',
        `/api/v1/messages/${offer1Id}`,
        {
          messageText: 'Yes, it is like new! Only light pencil marks in Chapter 2.'
        },
        sellerToken
      );

      assert(res.status === 201, `Expected 201 Created, got ${res.status}`);
      assert(res.body.data.senderId === sellerId, 'Expected sellerId as sender');
      assert(res.body.data.offerId === offer1Id, 'Expected offer1Id');
      msg2Id = res.body.data.messageId;

      console.log('  ✓ Seller successfully replies via POST /api/v1/messages/:id with 201 Created');
      passed++;
    } catch (err) {
      console.error('  ✗ Seller reply test failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 9: Buyer sends follow-up via POST /api/v1/offers/:id/messages
    // -------------------------------------------------------------
    let msg3Id;
    try {
      const res = await makeRequest(
        'POST',
        `/api/v1/offers/${offer1Id}/messages`,
        {
          messageText: 'Sounds great! Can we meet at 3 PM tomorrow?'
        },
        buyer1Token
      );

      assert(res.status === 201, `Expected 201 Created, got ${res.status}`);
      assert(res.body.data.senderId === buyer1Id, 'Expected buyer1Id as sender');
      msg3Id = res.body.data.messageId;

      console.log('  ✓ Buyer sends message via POST /api/v1/offers/:id/messages (API Contract 9.1)');
      passed++;
    } catch (err) {
      console.error('  ✗ Buyer contract endpoint test failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 10: Retrieve messages via GET /api/v1/offers/:id/messages & verify chronological order
    // -------------------------------------------------------------
    try {
      const res = await makeRequest('GET', `/api/v1/offers/${offer1Id}/messages`, null, buyer1Token);
      assert(res.status === 200, `Expected 200 OK, got ${res.status}`);
      assert(res.body.success === true, 'Expected success: true');
      assert(Array.isArray(res.body.data), 'Expected data to be an array');
      assert(res.body.data.length >= 3, 'Expected at least 3 messages');

      // Verify chronological order: sentAt ascending
      for (let i = 1; i < res.body.data.length; i++) {
        const prevTime = new Date(res.body.data[i - 1].sentAt).getTime();
        const currTime = new Date(res.body.data[i].sentAt).getTime();
        assert(currTime >= prevTime, 'Messages must be sorted chronologically ASC');
      }

      console.log('  ✓ Retrieves messages via GET /api/v1/offers/:id/messages sorted chronologically');
      passed++;
    } catch (err) {
      console.error('  ✗ Retrieve messages via offers endpoint failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 11: Read receipt verification: Seller retrieves messages, marking incoming as read
    // -------------------------------------------------------------
    try {
      // Prior to seller read: check in DB that msg3 (sent by buyer) has is_read = FALSE
      const [beforeRows] = await pool.query('SELECT is_read FROM messages WHERE id = ?', [msg3Id]);
      assert(beforeRows[0].is_read === 0, 'Message 3 should initially be unread');

      // Seller reads the thread
      const res = await makeRequest('GET', `/api/v1/messages/${offer1Id}`, null, sellerToken);
      assert(res.status === 200, 'Expected 200 OK on seller read');

      // Post seller read: verify msg3 is now marked as read
      const [afterRows] = await pool.query('SELECT is_read FROM messages WHERE id = ?', [msg3Id]);
      assert(afterRows[0].is_read === 1, 'Message 3 should now be marked is_read = 1');

      console.log('  ✓ Automatically updates read receipts (is_read = true) upon counterparty retrieval');
      passed++;
    } catch (err) {
      console.error('  ✗ Read receipt test failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 12: Pagination validation & slicing
    // -------------------------------------------------------------
    try {
      // Invalid page
      const resBadPage = await makeRequest('GET', `/api/v1/messages/${offer1Id}?page=0`, null, buyer1Token);
      assert(resBadPage.status === 400 && resBadPage.body.error.code === 'VALIDATION_ERROR', 'Expected 400 for page=0');

      const resStringPage = await makeRequest('GET', `/api/v1/messages/${offer1Id}?page=invalid`, null, buyer1Token);
      assert(resStringPage.status === 400 && resStringPage.body.error.code === 'VALIDATION_ERROR', 'Expected 400 for page=invalid');

      // Invalid limit
      const resBadLimit = await makeRequest('GET', `/api/v1/messages/${offer1Id}?limit=0`, null, buyer1Token);
      assert(resBadLimit.status === 400 && resBadLimit.body.error.code === 'VALIDATION_ERROR', 'Expected 400 for limit=0');

      const resExcessLimit = await makeRequest('GET', `/api/v1/messages/${offer1Id}?limit=150`, null, buyer1Token);
      assert(resExcessLimit.status === 400 && resExcessLimit.body.error.code === 'VALIDATION_ERROR', 'Expected 400 for limit > 100');

      // Valid pagination: page=1, limit=2
      const resP1 = await makeRequest('GET', `/api/v1/messages/${offer1Id}?page=1&limit=2`, null, buyer1Token);
      assert(resP1.status === 200, 'Expected 200 OK on page 1');
      assert(resP1.body.data.length === 2, `Expected 2 messages on page 1, got ${resP1.body.data.length}`);

      // Valid pagination: page=2, limit=2
      const resP2 = await makeRequest('GET', `/api/v1/messages/${offer1Id}?page=2&limit=2`, null, buyer1Token);
      assert(resP2.status === 200, 'Expected 200 OK on page 2');
      assert(resP2.body.data.length >= 1, 'Expected at least 1 message on page 2');
      assert(resP1.body.data[0].id !== resP2.body.data[0].id, 'Page 1 and Page 2 must not contain same starting message');

      console.log('  ✓ Validates pagination inputs and slices message records accurately');
      passed++;
    } catch (err) {
      console.error('  ✗ Pagination tests failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 13: List conversation threads for authenticated user
    // -------------------------------------------------------------
    try {
      const res = await makeRequest('GET', '/api/v1/messages', null, buyer1Token);
      assert(res.status === 200, 'Expected 200 OK on GET /api/v1/messages');
      assert(Array.isArray(res.body.data), 'Expected array of conversations');

      const offer1Conv = res.body.data.find((c) => c.offerId === offer1Id);
      assert(offer1Conv !== undefined, 'Expected conversation for offer1Id in list');
      assert(offer1Conv.listing.title === 'Algorithms Textbook 4th Ed', 'Expected correct listing title');
      assert(offer1Conv.counterparty.fullName === 'Alice Seller', 'Expected counterparty to be Alice Seller');
      assert(offer1Conv.lastMessage !== null, 'Expected lastMessage to be populated');
      assert(typeof offer1Conv.unreadCount === 'number', 'Expected unreadCount number');

      console.log('  ✓ GET /api/v1/messages lists active conversation threads with counterparty mapping');
      passed++;
    } catch (err) {
      console.error('  ✗ List conversation threads failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 14: Messaging after offer acceptance / transaction reservation
    // -------------------------------------------------------------
    try {
      // Seller accepts Offer 1
      const acceptRes = await makeRequest('PATCH', `/api/v1/offers/${offer1Id}/accept`, null, sellerToken);
      assert(acceptRes.status === 200, 'Expected 200 OK on offer accept');
      const transactionId = acceptRes.body.data.transactionId;

      // Both parties can still coordinate meetup messages
      const postTxMsg = await makeRequest(
        'POST',
        `/api/v1/messages/${offer1Id}`,
        { messageText: 'Meetup confirmed! See you at the Student Center.' },
        sellerToken
      );
      assert(postTxMsg.status === 201, 'Expected 201 Created for post-acceptance message');

      // Also accessible using transaction ID
      const getTxMsg = await makeRequest('GET', `/api/v1/messages/${transactionId}`, null, buyer1Token);
      assert(getTxMsg.status === 200, 'Expected 200 OK when querying messages by transactionId');
      assert(getTxMsg.body.data.some((m) => m.messageText.includes('Meetup confirmed')), 'Expected meetup message in thread');

      console.log('  ✓ Preserves messaging capability during post-acceptance handover coordination');
      passed++;
    } catch (err) {
      console.error('  ✗ Post-acceptance messaging test failed:', err.message);
      failed++;
    }

  } catch (err) {
    console.error('Unexpected test error:', err);
    failed++;
  } finally {
    if (server) {
      server.close();
    }
    await pool.end();
  }

  console.log(`\n--- Test Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
