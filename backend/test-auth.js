/**
 * Automated Tests for CampusSwap Authentication Module (No Email OTP)
 * File: backend/test-auth.js
 * 
 * Verifies:
 * 1. Invalid email format rejection -> 400 VALIDATION_ERROR
 * 2. Password complexity validation -> 400 VALIDATION_ERROR
 * 3. Successful direct registration -> 201 ACTIVE status, no OTP needed
 * 4. Duplicate email rejection -> 409 DUPLICATE_ENTITY
 * 5. Immediate login after registration -> 200 OK + JWT returned
 * 6. Login with wrong password -> 401 INVALID_CREDENTIALS
 * 7. Unauthenticated access to protected route -> 401 UNAUTHENTICATED
 * 8. Authenticated access to protected route -> 200 OK
 * 9. Stateless logout -> 200 OK
 * 10. Student access to ADMIN route -> 403 FORBIDDEN_OPERATION
 */

process.env.NODE_ENV = 'test';

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
        let rawData = '';
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          let parsedBody = null;
          try {
            parsedBody = JSON.parse(rawData);
          } catch (e) {
            parsedBody = rawData;
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: parsedBody
          });
        });
      }
    );

    req.on('error', (err) => reject(err));

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

  const gmailEmail = `student.${Date.now()}@gmail.com`;
  const malformedEmail = `invalid-email-format-without-at-domain`;
  const validPassword = 'SecurePassword123!';
  let authToken = null;
  let createdUserId = null;

  try {
    // 1. Invalid email format check
    const res1 = await makeRequest('POST', '/api/v1/auth/register', {
      email: malformedEmail,
      password: validPassword,
      fullName: 'Test Student'
    });
    assert(
      res1.status === 400 && res1.body.error?.code === 'VALIDATION_ERROR',
      'Rejects invalid email format with 400 VALIDATION_ERROR'
    );

    // 2. Password validation check
    const res2 = await makeRequest('POST', '/api/v1/auth/register', {
      email: gmailEmail,
      password: 'weak',
      fullName: 'Test Student'
    });
    assert(
      res2.status === 400 && res2.body.error?.code === 'VALIDATION_ERROR',
      'Rejects weak password with 400 VALIDATION_ERROR'
    );

    // 3. Successful direct registration (active immediately, no OTP)
    const res3 = await makeRequest('POST', '/api/v1/auth/register', {
      email: gmailEmail,
      password: validPassword,
      fullName: 'Test Student',
      phoneNumber: '+1-555-0199',
      department: 'Computer Science'
    });
    createdUserId = res3.body.data?.userId;
    assert(
      res3.status === 201 &&
      res3.body.success === true &&
      res3.body.data?.status === 'ACTIVE' &&
      res3.body.data?.user?.status === 'ACTIVE' &&
      !res3.body.data?.devOtp,
      'Registers student directly with status ACTIVE and no OTP required'
    );

    // 4. Duplicate registration
    const res4 = await makeRequest('POST', '/api/v1/auth/register', {
      email: gmailEmail,
      password: validPassword,
      fullName: 'Test Student Duplicate'
    });
    assert(
      res4.status === 409 && res4.body.error?.code === 'DUPLICATE_ENTITY',
      'Rejects duplicate email registration with 409 DUPLICATE_ENTITY'
    );

    // 5. Login immediately after registration
    const res5 = await makeRequest('POST', '/api/v1/auth/login', {
      email: gmailEmail,
      password: validPassword
    });
    authToken = res5.body.data?.token;
    assert(
      res5.status === 200 &&
      res5.body.success === true &&
      typeof authToken === 'string' &&
      res5.body.data?.user?.email === gmailEmail &&
      res5.body.data?.user?.status === 'ACTIVE' &&
      !res5.body.data?.user?.password_hash,
      'Logs in directly after registration with 200 OK, returns JWT token, and hides password hash'
    );

    // 6. Login with wrong password
    const res6 = await makeRequest('POST', '/api/v1/auth/login', {
      email: gmailEmail,
      password: 'WrongPassword999!'
    });
    assert(
      res6.status === 401 && res6.body.error?.code === 'INVALID_CREDENTIALS',
      'Rejects incorrect password with 401 INVALID_CREDENTIALS'
    );

    // 7. Access protected /me without token
    const res7 = await makeRequest('GET', '/api/v1/auth/me');
    assert(
      res7.status === 401 && res7.body.error?.code === 'UNAUTHENTICATED',
      'Blocks unauthenticated access to /me with 401 UNAUTHENTICATED'
    );

    // 8. Access protected /me with token
    const res8 = await makeRequest('GET', '/api/v1/auth/me', null, authToken);
    assert(
      res8.status === 200 &&
      res8.body.data?.email === gmailEmail &&
      res8.body.data?.role === 'STUDENT',
      'Permits authenticated access to /me with valid Bearer token'
    );

    // 9. Logout
    const res9 = await makeRequest('POST', '/api/v1/auth/logout', null, authToken);
    assert(
      res9.status === 200 && res9.body.data?.message?.includes('Logged out successfully'),
      'Acknowledges stateless logout with 200 OK'
    );

    // 10. Role-based authorization check (student attempting admin route)
    const res10 = await makeRequest('GET', '/api/v1/auth/test-admin-only', null, authToken);
    assert(
      res10.status === 403 && res10.body.error?.code === 'FORBIDDEN_OPERATION',
      'Denies STUDENT access to ADMIN protected route with 403 FORBIDDEN_OPERATION'
    );

  } finally {
    // Cleanup test user from DB
    if (createdUserId) {
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
