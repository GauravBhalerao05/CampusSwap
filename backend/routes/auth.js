const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const emailService = require('../services/emailService');

const router = express.Router();

// Helper: validate standard email address format (RFC 5322 compliant subset)
const isValidEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length > 254) return false;
  // Disallow consecutive dots or malformed dot placement
  if (trimmed.includes('..') || trimmed.includes('@.') || trimmed.includes('.@')) return false;
  // Standard email regex allowing any valid provider (gmail.com, yahoo.com, outlook.com, institutional, etc.)
  const regex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9]+([.-][a-zA-Z0-9]+)*\.[a-zA-Z]{2,}$/;
  return regex.test(trimmed);
};

// Helper: validate password complexity
// Min 8 chars, 1 uppercase, 1 digit, 1 special character
const isValidPassword = (password) => {
  if (!password || typeof password !== 'string') return false;
  const regex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/;
  return regex.test(password);
};

// Helper: generate cryptographically secure 6-digit OTP
const generateOTP = () => {
  return crypto.randomInt(100000, 1000000).toString();
};

/**
 * POST /api/v1/auth/register
 * Register a new student account
 */
router.post('/register', async (req, res, next) => {
  let createdUserId = null;
  try {
    const { email, password, fullName, phoneNumber, department } = req.body;

    if (!email || !password || !fullName) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Email, password, and fullName are required.'
        }
      });
    }

    const trimmedEmail = email.trim().toLowerCase();

    if (!isValidEmail(trimmedEmail)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Please provide a valid email address.'
        }
      });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Password must be at least 8 characters long and contain at least 1 uppercase letter, 1 number, and 1 special symbol.'
        }
      });
    }

    // Check for existing user
    const [existingUsers] = await pool.query(
      'SELECT id FROM users WHERE email = ?',
      [trimmedEmail]
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'DUPLICATE_ENTITY',
          message: 'An account with this email address already exists.'
        }
      });
    }

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Insert user with status PENDING_VERIFICATION
    const [insertResult] = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, phone_number, department, role, status)
       VALUES (?, ?, ?, ?, ?, 'STUDENT', 'PENDING_VERIFICATION')`,
      [
        trimmedEmail,
        passwordHash,
        fullName.trim(),
        phoneNumber ? phoneNumber.trim() : null,
        department ? department.trim() : null
      ]
    );

    createdUserId = insertResult.insertId;

    // Generate cryptographically secure 6-digit OTP code (5-minute TTL)
    const otpCode = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // Hash OTP before storing in database
    const hashedOtp = await bcrypt.hash(otpCode, 10);

    await pool.query(
      `INSERT INTO email_verifications (user_id, otp_code, expires_at, is_used, attempts)
       VALUES (?, ?, ?, FALSE, 0)`,
      [createdUserId, hashedOtp, expiresAt]
    );

    // Dispatch verification email via Resend
    try {
      await emailService.sendVerificationOtpEmail({
        toEmail: trimmedEmail,
        fullName: fullName.trim(),
        otpCode,
        expiryMinutes: 5
      });
    } catch (emailErr) {
      // Rollback newly created user & verification if email fails
      if (createdUserId) {
        await pool.query('DELETE FROM email_verifications WHERE user_id = ?', [createdUserId]);
        await pool.query('DELETE FROM users WHERE id = ?', [createdUserId]);
        createdUserId = null;
      }
      return res.status(emailErr.status || 502).json({
        success: false,
        error: {
          code: emailErr.code || 'EMAIL_DELIVERY_FAILED',
          message: emailErr.message || 'Failed to dispatch verification email.'
        }
      });
    }

    const responseData = {
      userId: createdUserId,
      email: trimmedEmail,
      status: 'PENDING_VERIFICATION',
      message: 'Registration successful. A 6-digit verification code has been dispatched to your email address.'
    };

    // Include devOtp only in test environment to simplify automated test suites
    if (process.env.NODE_ENV === 'test') {
      responseData.devOtp = otpCode;
    }

    return res.status(201).json({
      success: true,
      data: responseData
    });
  } catch (err) {
    if (createdUserId) {
      try {
        await pool.query('DELETE FROM email_verifications WHERE user_id = ?', [createdUserId]);
        await pool.query('DELETE FROM users WHERE id = ?', [createdUserId]);
      } catch (_) {}
    }
    next(err);
  }
});

/**
 * POST /api/v1/auth/verify-email
 * Verify registration OTP
 */
router.post('/verify-email', async (req, res, next) => {
  try {
    const { email, otpCode } = req.body;

    if (!email || !otpCode) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Email and otpCode are required.'
        }
      });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const cleanOtp = String(otpCode).trim();

    // Find user
    const [users] = await pool.query(
      'SELECT id, status FROM users WHERE email = ?',
      [trimmedEmail]
    );

    if (users.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_OTP',
          message: 'The verification code provided is invalid or has expired.'
        }
      });
    }

    const user = users[0];

    // Find latest active verification code
    const [tokens] = await pool.query(
      `SELECT id, otp_code, expires_at, is_used, attempts
       FROM email_verifications
       WHERE user_id = ? AND is_used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [user.id]
    );

    if (tokens.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_OTP',
          message: 'The verification code provided is invalid or has expired.'
        }
      });
    }

    const verificationToken = tokens[0];

    // Enforce max 5 attempts to prevent brute force
    if (verificationToken.attempts >= 5) {
      await pool.query(
        'UPDATE email_verifications SET is_used = TRUE WHERE id = ?',
        [verificationToken.id]
      );
      return res.status(400).json({
        success: false,
        error: {
          code: 'TOO_MANY_ATTEMPTS',
          message: 'Maximum OTP verification attempts exceeded. This code has been invalidated. Please request a new OTP.'
        }
      });
    }

    // Verify OTP against stored hash (supporting legacy plain OTPs if present)
    const isMatch = verificationToken.otp_code.startsWith('$2')
      ? await bcrypt.compare(cleanOtp, verificationToken.otp_code)
      : verificationToken.otp_code === cleanOtp;

    if (!isMatch) {
      const nextAttempts = verificationToken.attempts + 1;
      if (nextAttempts >= 5) {
        await pool.query(
          'UPDATE email_verifications SET attempts = ?, is_used = TRUE WHERE id = ?',
          [nextAttempts, verificationToken.id]
        );
        return res.status(400).json({
          success: false,
          error: {
            code: 'TOO_MANY_ATTEMPTS',
            message: 'Maximum OTP verification attempts exceeded. This code has been invalidated. Please request a new OTP.'
          }
        });
      } else {
        await pool.query(
          'UPDATE email_verifications SET attempts = ? WHERE id = ?',
          [nextAttempts, verificationToken.id]
        );
        const remainingAttempts = 5 - nextAttempts;
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_OTP',
            message: `Invalid verification code. You have ${remainingAttempts} attempt(s) remaining.`
          }
        });
      }
    }

    // Mark token as used, invalidate all other tokens for this user, and activate user
    await pool.query(
      'UPDATE email_verifications SET is_used = TRUE WHERE user_id = ?',
      [user.id]
    );

    await pool.query(
      "UPDATE users SET status = 'ACTIVE' WHERE id = ?",
      [user.id]
    );

    return res.status(200).json({
      success: true,
      data: {
        verified: true,
        message: 'Email verified successfully. You may now log in.'
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/auth/resend-otp
 * Resend verification OTP with 60s cooldown
 */
router.post('/resend-otp', async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Email is required.'
        }
      });
    }

    const trimmedEmail = email.trim().toLowerCase();

    if (!isValidEmail(trimmedEmail)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Please provide a valid email address.'
        }
      });
    }

    // Find user
    const [users] = await pool.query(
      'SELECT id, full_name, status FROM users WHERE email = ?',
      [trimmedEmail]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'No account found with this email address.'
        }
      });
    }

    const user = users[0];

    if (user.status === 'ACTIVE') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'ALREADY_VERIFIED',
          message: 'This account is already verified. Please sign in.'
        }
      });
    }

    if (user.status === 'SUSPENDED') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCOUNT_SUSPENDED',
          message: 'This account has been suspended by campus moderators.'
        }
      });
    }

    // Check resend cooldown: 60 seconds
    const [recentTokens] = await pool.query(
      `SELECT id, created_at
       FROM email_verifications
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [user.id]
    );

    if (recentTokens.length > 0) {
      const timeSinceLastOtp = Date.now() - new Date(recentTokens[0].created_at).getTime();
      const cooldownMs = 60 * 1000;
      if (timeSinceLastOtp < cooldownMs) {
        const remainingSeconds = Math.ceil((cooldownMs - timeSinceLastOtp) / 1000);
        return res.status(429).json({
          success: false,
          error: {
            code: 'COOLDOWN_ACTIVE',
            message: `Please wait ${remainingSeconds} second(s) before requesting a new verification code.`
          }
        });
      }
    }

    // Invalidate previous unused verification codes
    await pool.query(
      'UPDATE email_verifications SET is_used = TRUE WHERE user_id = ? AND is_used = FALSE',
      [user.id]
    );

    // Generate new cryptographically secure 6-digit OTP (5-minute TTL)
    const otpCode = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const hashedOtp = await bcrypt.hash(otpCode, 10);

    await pool.query(
      `INSERT INTO email_verifications (user_id, otp_code, expires_at, is_used, attempts)
       VALUES (?, ?, ?, FALSE, 0)`,
      [user.id, hashedOtp, expiresAt]
    );

    // Send email via Resend
    try {
      await emailService.sendVerificationOtpEmail({
        toEmail: trimmedEmail,
        fullName: user.full_name,
        otpCode,
        expiryMinutes: 5
      });
    } catch (emailErr) {
      return res.status(emailErr.status || 502).json({
        success: false,
        error: {
          code: emailErr.code || 'EMAIL_DELIVERY_FAILED',
          message: emailErr.message || 'Failed to dispatch verification email.'
        }
      });
    }

    const responseData = {
      message: 'A new verification code has been dispatched to your email address.'
    };

    if (process.env.NODE_ENV === 'test') {
      responseData.devOtp = otpCode;
    }

    return res.status(200).json({
      success: true,
      data: responseData
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/auth/login
 * User login
 */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Email and password are required.'
        }
      });
    }

    const trimmedEmail = email.trim().toLowerCase();

    const [rows] = await pool.query(
      `SELECT id, email, password_hash, full_name, phone_number, department, role, status
       FROM users WHERE email = ?`,
      [trimmedEmail]
    );

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password.'
        }
      });
    }

    const user = rows[0];

    // Verify password hash
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password.'
        }
      });
    }

    // Check user account status
    if (user.status === 'SUSPENDED') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCOUNT_SUSPENDED',
          message: 'This account has been suspended by campus moderators.'
        }
      });
    }

    if (user.status === 'PENDING_VERIFICATION') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCOUNT_INACTIVE',
          message: 'Account is pending email verification. Please verify using the OTP sent to your email.'
        }
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role
      },
      process.env.JWT_SECRET || 'campusswap_local_dev_secret_key_2026',
      {
        expiresIn: process.env.JWT_EXPIRES_IN || '24h'
      }
    );

    return res.status(200).json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          role: user.role,
          status: user.status,
          department: user.department
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/auth/me
 * Get current authenticated user profile
 */
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = req.user;
    return res.status(200).json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        phoneNumber: user.phone_number,
        department: user.department,
        role: user.role,
        status: user.status,
        createdAt: user.created_at
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/auth/logout
 * Stateless client logout acknowledgment
 */
router.post('/logout', authenticate, (req, res) => {
  return res.status(200).json({
    success: true,
    data: {
      message: 'Logged out successfully. Please clear your local bearer token.'
    }
  });
});

/**
 * GET /api/v1/auth/test-admin-only
 * Test endpoint to verify role authorization middleware (ADMIN only)
 */
router.get('/test-admin-only', authenticate, require('../middleware/auth').authorizeRoles('ADMIN'), (req, res) => {
  return res.status(200).json({
    success: true,
    data: {
      message: 'Admin access granted'
    }
  });
});

module.exports = router;
