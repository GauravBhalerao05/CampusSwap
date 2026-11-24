const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

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

/**
 * POST /api/v1/auth/register
 * Register a new student account (Direct registration, no OTP required)
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

    // Insert user with status ACTIVE immediately (no OTP verification step)
    const [insertResult] = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, phone_number, department, role, status)
       VALUES (?, ?, ?, ?, ?, 'STUDENT', 'ACTIVE')`,
      [
        trimmedEmail,
        passwordHash,
        fullName.trim(),
        phoneNumber ? phoneNumber.trim() : null,
        department ? department.trim() : null
      ]
    );

    const userId = insertResult.insertId;

    // Issue JWT token immediately upon successful registration
    const token = jwt.sign(
      {
        userId,
        email: trimmedEmail,
        role: 'STUDENT'
      },
      process.env.JWT_SECRET || 'campusswap_local_dev_secret_key_2026',
      {
        expiresIn: process.env.JWT_EXPIRES_IN || '24h'
      }
    );

    return res.status(201).json({
      success: true,
      data: {
        userId,
        email: trimmedEmail,
        status: 'ACTIVE',
        message: 'Account registered successfully.',
        token,
        user: {
          id: userId,
          email: trimmedEmail,
          fullName: fullName.trim(),
          role: 'STUDENT',
          status: 'ACTIVE',
          department: department ? department.trim() : null
        }
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

    // Auto-activate any legacy pending user so they can log in without barriers
    if (user.status === 'PENDING_VERIFICATION') {
      await pool.query("UPDATE users SET status = 'ACTIVE' WHERE id = ?", [user.id]);
      user.status = 'ACTIVE';
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        userId,
        email: trimmedEmail,
        role: 'STUDENT'
      },
      process.env.JWT_SECRET,
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
