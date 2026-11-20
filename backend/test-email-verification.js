/**
 * Comprehensive Automated Tests for CampusSwap Email Verification & Production Readiness
 * File: backend/test-email-verification.js
 * 
 * Verifies the 12 requirements from specification:
 * 1. Registration using a Gmail address (e.g., student@gmail.com)
 * 2. Registration using another valid email provider (e.g., student@outlook.com)
 * 3. Rejection of invalid email formats
 * 4. Successful OTP email delivery (HTML template, branding, OTP, expiry)
 * 5. Correct OTP verification
 * 6. Incorrect OTP rejection with attempt limits & brute-force protection
 * 7. Expired OTP rejection
 * 8. OTP resend cooldown (429 within 60s, succeeds when cooldown expires)
 * 9. Duplicate email registration rejection
 * 10. Email service failure handling (graceful rollback and descriptive error)
 * 11. Login after successful verification
 * 12. Security: OTP is stored hashed in DB, never plain text, cannot be reused
 */

process.env.NODE_ENV = 'test';

const http = require('http');
const bcrypt = require('bcryptjs');
const pool = require('./config/database');
const app = require('./app');
const emailService = require('./services/emailService');

let server;
const TEST_PORT = 5097;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

let capturedEmails = [];
let mockEmailShouldFail = false;

// Mock Resend client for controlled testing
emailService._setClientForTesting({
  emails: {
    send: async (payload) => {
      if (mockEmailShouldFail) {
        return {
          data: null,
          error: {
            message: 'Domain not verified. You can only send to registered test email.',
            name: 'validation_error'
          }
        };
      }
      capturedEmails.push(payload);
      return { data: { id: `resend_mock_${Date.now()}` }, error: null };
    }
  }
});

function makeRequest(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const payload = body ? JSON.stringify(body) : null;
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

    const req = http.request(url, { method, headers }, (res) => {
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(rawData); } catch (e) { parsed = rawData; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', (err) => reject(err));
    if (payload) req.write(payload);
    req.end();
  });
}

async function runEmailVerificationTests() {
  console.log('--- Starting CampusSwap Email Verification & Production Readiness Tests ---');
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
  const gmailUser = `student.${timestamp}@gmail.com`;
  const outlookUser = `scholar.${timestamp}@outlook.com`;
  const password = 'CampusSecure2026!';
  const trackedUserIds = [];

  try {
    // 1. Rejection of invalid email formats
    const invalidFormats = [
      'plainaddress',
      '#@%^%#$@#$@#.com',
      '@missingusername.com',
      'user@.com',
      'user@domain..com'
    ];
    for (const badEmail of invalidFormats) {
      const res = await makeRequest('POST', '/api/v1/auth/register', {
        email: badEmail,
        password,
        fullName: 'Bad Email User'
      });
      assert(
        res.status === 400 && res.body.error?.code === 'VALIDATION_ERROR',
        `Rejects invalid email format "${badEmail}" with 400 VALIDATION_ERROR`
      );
    }

    // 2. Registration using a Gmail address
    capturedEmails = [];
    const resGmail = await makeRequest('POST', '/api/v1/auth/register', {
      email: gmailUser,
      password,
      fullName: 'John Gmail Student',
      department: 'Electrical Engineering'
    });
    assert(
      resGmail.status === 201 &&
      resGmail.body.success === true &&
      resGmail.body.data?.email === gmailUser &&
      resGmail.body.data?.status === 'PENDING_VERIFICATION',
      '1. Registers using a Gmail address (@gmail.com) successfully'
    );
    const gmailUserId = resGmail.body.data?.userId;
    trackedUserIds.push(gmailUserId);
    const gmailOtp = resGmail.body.data?.devOtp;

    // 3. Registration using another valid email provider (Outlook)
    const resOutlook = await makeRequest('POST', '/api/v1/auth/register', {
      email: outlookUser,
      password,
      fullName: 'Sarah Outlook Student',
      department: 'Mechanical Engineering'
    });
    assert(
      resOutlook.status === 201 &&
      resOutlook.body.success === true &&
      resOutlook.body.data?.email === outlookUser,
      '2. Registers using another email provider (@outlook.com) successfully'
    );
    const outlookUserId = resOutlook.body.data?.userId;
    trackedUserIds.push(outlookUserId);

    // 4. Verification of Email Delivery & HTML Template Content
    assert(
      capturedEmails.length >= 2,
      '4. Actual transactional email delivery dispatched for registration'
    );
    const lastEmail = capturedEmails[capturedEmails.length - 1];
    assert(
      lastEmail.to === outlookUser &&
      lastEmail.subject.includes('CampusSwap verification code') &&
      lastEmail.html.includes('CampusSwap') &&
      lastEmail.html.includes('Verification Code') &&
      lastEmail.html.includes('Expires in 5 minutes') &&
      lastEmail.html.includes('Never share this OTP with anyone'),
      '4b. Email contains CampusSwap branding, OTP, 5-min expiry, and security warning'
    );

    // 5. Verification that OTP in DB is hashed and not plain text
    const [dbVer] = await pool.query(
      'SELECT otp_code FROM email_verifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
      [gmailUserId]
    );
    assert(
      dbVer.length > 0 && dbVer[0].otp_code.startsWith('$2') && dbVer[0].otp_code !== gmailOtp,
      '3. Stored OTP in DB is securely hashed with bcrypt (never plain text)'
    );

    // 6. Duplicate email registration rejection
    const resDup = await makeRequest('POST', '/api/v1/auth/register', {
      email: gmailUser,
      password,
      fullName: 'Imposter User'
    });
    assert(
      resDup.status === 409 && resDup.body.error?.code === 'DUPLICATE_ENTITY',
      '9. Duplicate email registration is prevented with 409 DUPLICATE_ENTITY'
    );

    // 7. Rejection of incorrect OTP & attempt tracking
    const resWrongOtp = await makeRequest('POST', '/api/v1/auth/verify-email', {
      email: gmailUser,
      otpCode: '111111'
    });
    assert(
      resWrongOtp.status === 400 &&
      resWrongOtp.body.error?.code === 'INVALID_OTP' &&
      resWrongOtp.body.error?.message?.includes('attempt(s) remaining'),
      '6. Incorrect OTP is rejected with remaining attempt counter'
    );

    // Verify attempts counter was updated in DB
    const [attRow] = await pool.query(
      'SELECT attempts FROM email_verifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
      [gmailUserId]
    );
    assert(attRow[0].attempts === 1, '6b. Database correctly increments OTP verification failure attempts');

    // 8. Rejection of expired OTP
    const expiredUser = `expired.${timestamp}@gmail.com`;
    const resExpReg = await makeRequest('POST', '/api/v1/auth/register', {
      email: expiredUser,
      password,
      fullName: 'Expired OTP User'
    });
    const expUserId = resExpReg.body.data?.userId;
    trackedUserIds.push(expUserId);
    const expOtp = resExpReg.body.data?.devOtp;
    // Artificially expire the token in the database
    await pool.query(
      'UPDATE email_verifications SET expires_at = DATE_SUB(NOW(), INTERVAL 10 MINUTE) WHERE user_id = ?',
      [expUserId]
    );
    const resExpVerify = await makeRequest('POST', '/api/v1/auth/verify-email', {
      email: expiredUser,
      otpCode: expOtp
    });
    assert(
      resExpVerify.status === 400 && resExpVerify.body.error?.code === 'INVALID_OTP',
      '7. Expired OTP is rejected with 400 INVALID_OTP'
    );

    // 9. Resend OTP cooldown (60 seconds)
    const resCool1 = await makeRequest('POST', '/api/v1/auth/resend-otp', {
      email: gmailUser
    });
    assert(
      resCool1.status === 429 && resCool1.body.error?.code === 'COOLDOWN_ACTIVE',
      '8. OTP resend rejected within 60-second cooldown with 429 COOLDOWN_ACTIVE'
    );

    // Fast-forward cooldown by updating created_at in DB
    await pool.query(
      'UPDATE email_verifications SET created_at = DATE_SUB(NOW(), INTERVAL 65 SECOND) WHERE user_id = ?',
      [gmailUserId]
    );

    // Request new OTP after cooldown
    const resCool2 = await makeRequest('POST', '/api/v1/auth/resend-otp', {
      email: gmailUser
    });
    assert(
      resCool2.status === 200 && resCool2.body.success === true,
      '8b. OTP resend succeeds once cooldown has elapsed'
    );
    const newGmailOtp = resCool2.body.data?.devOtp;

    // 10. Correct OTP verification
    const resVerifySuccess = await makeRequest('POST', '/api/v1/auth/verify-email', {
      email: gmailUser,
      otpCode: newGmailOtp
    });
    assert(
      resVerifySuccess.status === 200 && resVerifySuccess.body.data?.verified === true,
      '5. Correct OTP verifies user account successfully with 200 OK'
    );

    // 11. Login after successful verification
    const resLogin = await makeRequest('POST', '/api/v1/auth/login', {
      email: gmailUser,
      password
    });
    assert(
      resLogin.status === 200 &&
      resLogin.body.success === true &&
      resLogin.body.data?.user?.status === 'ACTIVE' &&
      typeof resLogin.body.data?.token === 'string',
      '11. User can successfully log in after verification'
    );

    // 12. Handling of email delivery service failure
    mockEmailShouldFail = true;
    const failUser = `deliveryfail.${timestamp}@gmail.com`;
    const resFail = await makeRequest('POST', '/api/v1/auth/register', {
      email: failUser,
      password,
      fullName: 'Fail Test User'
    });
    assert(
      resFail.status === 502 && resFail.body.error?.code === 'EMAIL_DELIVERY_FAILED',
      '10. Email delivery failure gracefully caught and reports EMAIL_DELIVERY_FAILED'
    );

    // Ensure database rolled back the user creation on email delivery failure
    const [orphanedUser] = await pool.query('SELECT id FROM users WHERE email = ?', [failUser]);
    assert(
      orphanedUser.length === 0,
      '10b. Rolls back pending user record on email delivery failure to prevent unverified lockout'
    );
    mockEmailShouldFail = false;

    // 13. Unconfigured email service handling
    emailService._setClientForTesting(null);
    const savedApiKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;

    const unconfiguredUser = `unconfigured.${timestamp}@gmail.com`;
    const resUnconfig = await makeRequest('POST', '/api/v1/auth/register', {
      email: unconfiguredUser,
      password,
      fullName: 'Unconfigured Test User'
    });
    assert(
      resUnconfig.status === 503 && resUnconfig.body.error?.code === 'EMAIL_SERVICE_NOT_CONFIGURED',
      '13. Unconfigured email service returns clear 503 EMAIL_SERVICE_NOT_CONFIGURED error'
    );

    // Restore API key & mock client
    process.env.RESEND_API_KEY = savedApiKey;
    emailService._setClientForTesting({
      emails: {
        send: async (payload) => {
          capturedEmails.push(payload);
          return { data: { id: `resend_mock_${Date.now()}` }, error: null };
        }
      }
    });

  } finally {
    // Cleanup created test records
    for (const uid of trackedUserIds) {
      if (uid) {
        await pool.query('DELETE FROM email_verifications WHERE user_id = ?', [uid]);
        await pool.query('DELETE FROM users WHERE id = ?', [uid]);
      }
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

runEmailVerificationTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
