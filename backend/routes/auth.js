const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Helper: validate college email domain
const isValidCollegeEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  const domain = process.env.COLLEGE_EMAIL_DOMAIN || 'univ.edu';
  const escapedDomain = domain.replace(/\./g, '\\.');
  const regex = new RegExp(`^[a-zA-Z0-9._%+-]+@([a-zA-Z0-9-]+\\.)*${escapedDomain}$`, 'i');
  return regex.test(email.trim());
};

// Helper: validate password complexity
// Min 8 chars, 1 uppercase, 1 digit, 1 special character
const isValidPassword = (password) => {
  if (!password || typeof password !== 'string') return false;
  const regex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/;
  return regex.test(password);
};

// Helper: generate 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * POST /api/v1/auth/register
 * Register a new student account
 */
router.post('/register', async (req, res, next) => {
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

    if (!isValidCollegeEmail(trimmedEmail)) {
      const domain = process.env.COLLEGE_EMAIL_DOMAIN || 'univ.edu';
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_EMAIL_DOMAIN',
          message: `Registration requires an authorized college email address ending with ${domain}.`
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

    const userId = insertResult.insertId;

    // Generate 6-digit OTP code (15-minute TTL)
    const otpCode = generateOTP();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await pool.query(
      `INSERT INTO email_verifications (user_id, otp_code, expires_at, is_used)
       VALUES (?, ?, ?, FALSE)`,
      [userId, otpCode, expiresAt]
    );

    // Development workflow: log OTP to server console
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[CampusSwap Local Dev] Verification OTP for ${trimmedEmail}: ${otpCode}`);
    }

    const responseData = {
      userId,
      email: trimmedEmail,
      status: 'PENDING_VERIFICATION',
      message: 'Registration successful. A 6-digit verification code has been dispatched to your college email address.'
    };

    // Include devOtp only in local development to simplify manual/automated testing
    if (process.env.NODE_ENV !== 'production') {
      responseData.devOtp = otpCode;
    }

    return res.status(201).json({
      success: true,
      data: responseData
    });
  } catch (err) {
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
      `SELECT id, otp_code, expires_at, is_used
       FROM email_verifications
       WHERE user_id = ? AND is_used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [user.id]
    );

    if (tokens.length === 0 || tokens[0].otp_code !== otpCode.trim()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_OTP',
          message: 'The verification code provided is invalid or has expired.'
        }
      });
    }

    const verificationToken = tokens[0];

    // Mark token as used and activate user
    await pool.query(
      'UPDATE email_verifications SET is_used = TRUE WHERE id = ?',
      [verificationToken.id]
    );

    await pool.query(
      "UPDATE users SET status = 'ACTIVE' WHERE id = ?",
      [user.id]
    );

    return res.status(200).json({
      success: true,
      data: {
        verified: true,
        message: 'Institutional email verified successfully. You may now log in.'
      }
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
