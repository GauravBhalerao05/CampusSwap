const express = require('express');
const pool = require('../config/database');

const router = express.Router();

/**
 * GET /api/v1/categories
 * List active categories
 */
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, description, is_active FROM categories WHERE is_active = TRUE ORDER BY id ASC'
    );

    const categories = rows.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      isActive: Boolean(c.is_active)
    }));

    return res.status(200).json({
      success: true,
      data: categories
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
