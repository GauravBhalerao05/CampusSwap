/**
 * Comprehensive Automated Tests for CampusSwap Authentication Module
 * File: backend/test-auth.js
 * 
 * Tests:
 * 1. Registration with invalid college email domain -> 400 INVALID_EMAIL_DOMAIN
 * 2. Registration with weak password -> 400 VALIDATION_ERROR
 * 3. Successful registration -> 201 PENDING_VERIFICATION + OTP created
 * 4. Duplicate registration with same email -> 409 DUPLICATE_ENTITY
 * 5. Login prior to email verification -> 403 ACCOUNT_INACTIVE
 * 6. Email verification with invalid OTP -> 400 INVALID_OTP
 * 7. Email verification with valid OTP -> 200 OK + user ACTIVE
 * 8. Login with wrong password -> 401 INVALID_CREDENTIALS
 * 9. Login with correct credentials -> 200 OK + JWT issued
 * 10. Access protected route /me without token -> 401 UNAUTHENTICATED
 * 11. Access protected route /me with token -> 200 OK + user profile
 * 12. Stateless logout -> 200 OK acknowledgment
 * 13. Role-based authorization check (STUDENT vs ADMIN)
 */

const http = require('http');
const pool = require('./config/database');
const app = require('./app');

let server;
const TEST_PORT = 5099;
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
  console.log('--- Starting CampusSwap Auth Tests ---');
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

  // Start test HTTP server
  await new Promise((resolve) => {
    server = app.listen(TEST_PORT, resolve);
  });

  const collegeDomain = process.env.COLLEGE_EMAIL_DOMAIN || 'univ.edu';
  const testEmail = `test.student.${Date.now()}@${collegeDomain}`;
  const invalidEmail = `test.student.${Date.now()}@gmail.com`;
  const validPassword = 'SecurePassword123!';
  let generatedOtp = null;
  let authToken = null;
  let createdUserId = null;

  try {
    // 1. Invalid domain check
    const res1 = await makeRequest('POST', '/api/v1/auth/register', {
      email: invalidEmail,
      password: validPassword,
      fullName: 'Test Student'
    });
    assert(
      res1.status === 400 && res1.body.error?.code === 'INVALID_EMAIL_DOMAIN',
      'Rejects non-college email domain with 400 INVALID_EMAIL_DOMAIN'
    );

    // 2. Password validation check
    const res2 = await makeRequest('POST', '/api/v1/auth/register', {
      email: testEmail,
      password: 'weak',
      fullName: 'Test Student'
    });
    assert(
      res2.status === 400 && res2.body.error?.code === 'VALIDATION_ERROR',
      'Rejects weak password with 400 VALIDATION_ERROR'
    );

    // 3. Successful registration
    const res3 = await makeRequest('POST', '/api/v1/auth/register', {
      email: testEmail,
      password: validPassword,
      fullName: 'Test Student',
      phoneNumber: '+1-555-0199',
      department: 'Computer Science'
    });
    createdUserId = res3.body.data?.userId;
    generatedOtp = res3.body.data?.devOtp;
    assert(
      res3.status === 201 &&
      res3.body.success === true &&
      res3.body.data?.status === 'PENDING_VERIFICATION' &&
      !!generatedOtp,
      'Registers student successfully with 201 Created and PENDING_VERIFICATION status'
    );

    // 4. Duplicate registration
    const res4 = await makeRequest('POST', '/api/v1/auth/register', {
      email: testEmail,
      password: validPassword,
      fullName: 'Test Student Duplicate'
    });
    assert(
      res4.status === 409 && res4.body.error?.code === 'DUPLICATE_ENTITY',
      'Rejects duplicate email registration with 409 DUPLICATE_ENTITY'
    );

    // 5. Login before verification
    const res5 = await makeRequest('POST', '/api/v1/auth/login', {
      email: testEmail,
      password: validPassword
    });
    assert(
      res5.status === 403 && res5.body.error?.code === 'ACCOUNT_INACTIVE',
      'Blocks login for unverified accounts with 403 ACCOUNT_INACTIVE'
    );

    // 6. Verification with invalid OTP
    const res6 = await makeRequest('POST', '/api/v1/auth/verify-email', {
      email: testEmail,
      otpCode: '000000'
    });
    assert(
      res6.status === 400 && res6.body.error?.code === 'INVALID_OTP',
      'Rejects invalid OTP with 400 INVALID_OTP'
    );

    // 7. Verification with correct OTP
    const res7 = await makeRequest('POST', '/api/v1/auth/verify-email', {
      email: testEmail,
      otpCode: generatedOtp
    });
    assert(
      res7.status === 200 && res7.body.data?.verified === true,
      'Verifies email successfully with 200 OK'
    );

    // 8. Login with wrong password
    const res8 = await makeRequest('POST', '/api/v1/auth/login', {
      email: testEmail,
      password: 'WrongPassword999!'
    });
    assert(
      res8.status === 401 && res8.body.error?.code === 'INVALID_CREDENTIALS',
      'Rejects incorrect password with 401 INVALID_CREDENTIALS'
    );

    // 9. Login with correct password
    const res9 = await makeRequest('POST', '/api/v1/auth/login', {
      email: testEmail,
      password: validPassword
    });
    authToken = res9.body.data?.token;
    assert(
      res9.status === 200 &&
      res9.body.success === true &&
      typeof authToken === 'string' &&
      res9.body.data?.user?.email === testEmail &&
      res9.body.data?.user?.status === 'ACTIVE' &&
      !res9.body.data?.user?.password_hash,
      'Logs in verified user with 200 OK, returns JWT token, and hides password hash'
    );

    // 10. Access protected /me without token
    const res10 = await makeRequest('GET', '/api/v1/auth/me');
    assert(
      res10.status === 401 && res10.body.error?.code === 'UNAUTHENTICATED',
      'Blocks unauthenticated access to /me with 401 UNAUTHENTICATED'
    );

    // 11. Access protected /me with token
    const res11 = await makeRequest('GET', '/api/v1/auth/me', null, authToken);
    assert(
      res11.status === 200 &&
      res11.body.data?.email === testEmail &&
      res11.body.data?.role === 'STUDENT',
      'Permits authenticated access to /me with valid Bearer token'
    );

    // 12. Logout
    const res12 = await makeRequest('POST', '/api/v1/auth/logout', null, authToken);
    assert(
      res12.status === 200 && res12.body.data?.message?.includes('Logged out successfully'),
      'Acknowledges stateless logout with 200 OK'
    );

    // 13. Role-based authorization check (student attempting admin route)
    const res13 = await makeRequest('GET', '/api/v1/auth/test-admin-only', null, authToken);
    assert(
      res13.status === 403 && res13.body.error?.code === 'FORBIDDEN_OPERATION',
      'Denies STUDENT access to ADMIN protected route with 403 FORBIDDEN_OPERATION'
    );

  } finally {
    // Cleanup test user and verifications from DB
    if (createdUserId) {
      await pool.query('DELETE FROM email_verifications WHERE user_id = ?', [createdUserId]);
      await pool.query('DELETE FROM users WHERE id = ?', [createdUserId]);
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
  console.error('Fatal test error:', err);
  process.exit(1);
});
