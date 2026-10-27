const jwt = require('jsonwebtoken');
const pool = require('../config/database');

/**
 * Authentication Middleware:
 * Verifies Bearer JWT from Authorization header and attaches user to req.user.
 */
const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication token required.'
      }
    });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'campusswap_local_dev_secret_key_2026');
    
    // Check if user exists and is active
    const [rows] = await pool.query(
      'SELECT id, email, full_name, phone_number, department, role, status FROM users WHERE id = ?',
      [decoded.userId]
    );

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHENTICATED',
          message: 'User belonging to this token no longer exists.'
        }
      });
    }

    const user = rows[0];
    if (user.status === 'SUSPENDED') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCOUNT_SUSPENDED',
          message: 'This account has been suspended by campus moderators.'
        }
      });
    }

    if (user.status !== 'ACTIVE') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCOUNT_INACTIVE',
          message: 'Account is not active. Please complete email verification.'
        }
      });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Invalid or expired token.'
      }
    });
  }
};

/**
 * Role Authorization Middleware:
 * Restricts access to specified roles (e.g. authorizeRoles('ADMIN')).
 */
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN_OPERATION',
          message: 'You do not have permission to access this resource.'
        }
      });
    }
    next();
  };
};

module.exports = {
  authenticate,
  authorizeRoles
};
