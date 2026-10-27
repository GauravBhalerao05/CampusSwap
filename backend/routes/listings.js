const express = require('express');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Allowed Enums
const ALLOWED_MODES = ['SELL', 'BARTER', 'FREE'];
const ALLOWED_CONDITIONS = ['NEW', 'LIKE_NEW', 'GOOD', 'FAIR'];
const ALLOWED_SORT = ['newest', 'price_asc', 'price_desc', 'rating_desc'];

/**
 * GET /api/v1/listings
 * Catalog search and faceted filtering
 */
router.get('/', async (req, res, next) => {
  try {
    const {
      q,
      categoryId,
      mode,
      condition,
      minPrice,
      maxPrice,
      sortBy = 'newest',
      page = 1,
      limit = 20,
      sellerId,
      status
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    // Build dynamic WHERE clause
    const whereConditions = ["u.status = 'ACTIVE'"];
    const queryParams = [];

    if (status && status.toUpperCase() === 'ALL') {
      // Allow any status (e.g. for owner inspecting their listings)
    } else if (status) {
      whereConditions.push('l.status = ?');
      queryParams.push(status.toUpperCase());
    } else {
      whereConditions.push("l.status = 'ACTIVE'");
    }

    if (sellerId) {
      const parsedSellerId = parseInt(sellerId, 10);
      if (!isNaN(parsedSellerId)) {
        whereConditions.push('l.seller_id = ?');
        queryParams.push(parsedSellerId);
      }
    }

    if (q && typeof q === 'string' && q.trim()) {
      whereConditions.push('(l.title LIKE ? OR l.description LIKE ?)');
      const searchTerm = `%${q.trim()}%`;
      queryParams.push(searchTerm, searchTerm);
    }

    if (categoryId) {
      const parsedCatId = parseInt(categoryId, 10);
      if (!isNaN(parsedCatId)) {
        whereConditions.push('l.category_id = ?');
        queryParams.push(parsedCatId);
      }
    }

    if (mode && ALLOWED_MODES.includes(mode.toUpperCase())) {
      whereConditions.push('l.mode = ?');
      queryParams.push(mode.toUpperCase());
    }

    if (condition && ALLOWED_CONDITIONS.includes(condition.toUpperCase())) {
      whereConditions.push('l.item_condition = ?');
      queryParams.push(condition.toUpperCase());
    }

    if (minPrice !== undefined && minPrice !== '') {
      const minP = parseFloat(minPrice);
      if (!isNaN(minP)) {
        whereConditions.push('l.price >= ?');
        queryParams.push(minP);
      }
    }

    if (maxPrice !== undefined && maxPrice !== '') {
      const maxP = parseFloat(maxPrice);
      if (!isNaN(maxP)) {
        whereConditions.push('l.price <= ?');
        queryParams.push(maxP);
      }
    }

    const whereClause = whereConditions.join(' AND ');

    // Count total items
    const countSql = `
      SELECT COUNT(l.id) AS total
      FROM listings l
      INNER JOIN users u ON l.seller_id = u.id
      WHERE ${whereClause}
    `;
    const [countRows] = await pool.query(countSql, queryParams);
    const totalItems = countRows[0].total;
    const totalPages = Math.ceil(totalItems / limitNum) || 1;

    // Sorting definition
    let orderByClause = 'l.created_at DESC';
    if (sortBy === 'price_asc') {
      orderByClause = 'l.price ASC, l.created_at DESC';
    } else if (sortBy === 'price_desc') {
      orderByClause = 'l.price DESC, l.created_at DESC';
    } else if (sortBy === 'rating_desc') {
      orderByClause = 'seller_avg_rating DESC, l.created_at DESC';
    }

    // Main catalog query
    const selectSql = `
      SELECT 
        l.id,
        l.title,
        l.description,
        l.mode,
        l.price,
        l.is_negotiable,
        l.barter_preferences,
        l.item_condition,
        l.pickup_location,
        l.status,
        l.created_at,
        c.id AS category_id,
        c.name AS category_name,
        u.id AS seller_id,
        u.full_name AS seller_name,
        u.department AS seller_department,
        COALESCE(rep.avg_rating, 0.00) AS seller_avg_rating,
        COALESCE(rep.total_reviews, 0) AS seller_review_count,
        (
          SELECT img.image_url 
          FROM listing_images img 
          WHERE img.listing_id = l.id 
          ORDER BY img.display_order ASC, img.id ASC 
          LIMIT 1
        ) AS primary_image_url
      FROM listings l
      INNER JOIN categories c ON l.category_id = c.id
      INNER JOIN users u ON l.seller_id = u.id
      LEFT JOIN (
        SELECT 
          reviewee_id,
          ROUND(AVG(rating), 2) AS avg_rating,
          COUNT(id) AS total_reviews
        FROM reviews
        GROUP BY reviewee_id
      ) rep ON u.id = rep.reviewee_id
      WHERE ${whereClause}
      ORDER BY ${orderByClause}
      LIMIT ? OFFSET ?
    `;

    const [rows] = await pool.query(selectSql, [...queryParams, limitNum, offset]);

    const formattedItems = rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      mode: r.mode,
      price: r.price !== null ? String(r.price) : null,
      isNegotiable: Boolean(r.is_negotiable),
      barterPreferences: r.barter_preferences,
      itemCondition: r.item_condition,
      pickupLocation: r.pickup_location,
      status: r.status,
      category: {
        id: r.category_id,
        name: r.category_name
      },
      seller: {
        id: r.seller_id,
        fullName: r.seller_name,
        department: r.seller_department,
        avgRating: parseFloat(r.seller_avg_rating),
        totalReviews: parseInt(r.seller_review_count, 10)
      },
      primaryImageUrl: r.primary_image_url,
      createdAt: r.created_at
    }));

    return res.status(200).json({
      success: true,
      data: {
        items: formattedItems,
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalItems,
          limit: limitNum
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/listings
 * Create new listing (Authenticated)
 */
router.post('/', authenticate, async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const {
      categoryId,
      title,
      description,
      mode,
      price,
      isNegotiable = false,
      barterPreferences,
      itemCondition = 'GOOD',
      pickupLocation,
      imageUrls = []
    } = req.body;

    // Basic validation
    if (!categoryId || !title || !description || !mode || !pickupLocation) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'categoryId, title, description, mode, and pickupLocation are required.'
        }
      });
    }

    if (typeof title !== 'string' || title.trim().length < 5 || title.trim().length > 100) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Title must be between 5 and 100 characters.'
        }
      });
    }

    if (typeof description !== 'string' || description.trim().length < 10 || description.trim().length > 2000) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Description must be between 10 and 2000 characters.'
        }
      });
    }

    const upperMode = String(mode).toUpperCase();
    if (!ALLOWED_MODES.includes(upperMode)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Mode must be one of: ${ALLOWED_MODES.join(', ')}`
        }
      });
    }

    const upperCondition = String(itemCondition).toUpperCase();
    if (!ALLOWED_CONDITIONS.includes(upperCondition)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `itemCondition must be one of: ${ALLOWED_CONDITIONS.join(', ')}`
        }
      });
    }

    // Mode-specific price & barter rules
    let finalPrice = null;
    let finalBarterPref = null;

    if (upperMode === 'SELL') {
      const parsedPrice = parseFloat(price);
      if (isNaN(parsedPrice) || parsedPrice <= 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Listings in SELL mode require a valid price greater than zero.'
          }
        });
      }
      finalPrice = parsedPrice.toFixed(2);
    } else if (upperMode === 'FREE') {
      // Per finalized spec, FREE listings must strictly have price = 0.00
      finalPrice = '0.00';
    } else if (upperMode === 'BARTER') {
      if (!barterPreferences || typeof barterPreferences !== 'string' || !barterPreferences.trim()) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Listings in BARTER mode require barterPreferences description.'
          }
        });
      }
      finalBarterPref = barterPreferences.trim();
      if (price !== undefined && price !== null) {
        const parsedPrice = parseFloat(price);
        if (isNaN(parsedPrice) || parsedPrice < 0) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'If price is provided for BARTER, it must be greater than or equal to 0.00.'
            }
          });
        }
        finalPrice = parsedPrice.toFixed(2);
      }
    }

    // Verify category exists and is active
    const [catRows] = await connection.query(
      'SELECT id FROM categories WHERE id = ? AND is_active = TRUE',
      [categoryId]
    );
    if (catRows.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid or inactive categoryId.'
        }
      });
    }

    // Validate images
    if (!Array.isArray(imageUrls)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'imageUrls must be an array of URL strings.'
        }
      });
    }

    if (imageUrls.length > 5) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'A maximum of 5 images can be attached to a listing.'
        }
      });
    }

    await connection.beginTransaction();

    const insertListingSql = `
      INSERT INTO listings (
        seller_id, category_id, title, description, mode, price,
        is_negotiable, barter_preferences, item_condition, pickup_location, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
    `;

    const [listingResult] = await connection.query(insertListingSql, [
      req.user.id,
      categoryId,
      title.trim(),
      description.trim(),
      upperMode,
      finalPrice,
      Boolean(isNegotiable),
      finalBarterPref,
      upperCondition,
      pickupLocation.trim()
    ]);

    const listingId = listingResult.insertId;

    // Insert images if present
    if (imageUrls.length > 0) {
      for (let i = 0; i < imageUrls.length; i++) {
        const url = String(imageUrls[i]).trim();
        if (url) {
          await connection.query(
            'INSERT INTO listing_images (listing_id, image_url, display_order) VALUES (?, ?, ?)',
            [listingId, url, i + 1]
          );
        }
      }
    }

    await connection.commit();

    return res.status(201).json({
      success: true,
      data: {
        id: listingId,
        sellerId: req.user.id,
        title: title.trim(),
        mode: upperMode,
        price: finalPrice !== null ? String(finalPrice) : null,
        status: 'ACTIVE',
        createdAt: new Date().toISOString()
      }
    });
  } catch (err) {
    await connection.rollback();
    next(err);
  } finally {
    connection.release();
  }
});

/**
 * GET /api/v1/listings/:id
 * Retrieve single listing details
 */
router.get('/:id', async (req, res, next) => {
  try {
    const listingId = parseInt(req.params.id, 10);
    if (isNaN(listingId)) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'Listing does not exist.'
        }
      });
    }

    const selectSql = `
      SELECT 
        l.id,
        l.title,
        l.description,
        l.mode,
        l.price,
        l.is_negotiable,
        l.barter_preferences,
        l.item_condition,
        l.pickup_location,
        l.status,
        l.created_at,
        l.updated_at,
        c.id AS category_id,
        c.name AS category_name,
        u.id AS seller_id,
        u.full_name AS seller_name,
        u.department AS seller_department,
        COALESCE(rep.avg_rating, 0.00) AS seller_avg_rating,
        COALESCE(rep.total_reviews, 0) AS seller_review_count
      FROM listings l
      INNER JOIN categories c ON l.category_id = c.id
      INNER JOIN users u ON l.seller_id = u.id
      LEFT JOIN (
        SELECT 
          reviewee_id,
          ROUND(AVG(rating), 2) AS avg_rating,
          COUNT(id) AS total_reviews
        FROM reviews
        GROUP BY reviewee_id
      ) rep ON u.id = rep.reviewee_id
      WHERE l.id = ?
    `;

    const [rows] = await pool.query(selectSql, [listingId]);
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'Listing does not exist.'
        }
      });
    }

    const r = rows[0];

    // Fetch images
    const [imageRows] = await pool.query(
      'SELECT id, image_url, display_order FROM listing_images WHERE listing_id = ? ORDER BY display_order ASC, id ASC',
      [listingId]
    );

    const images = imageRows.map((img) => ({
      id: img.id,
      imageUrl: img.image_url,
      displayOrder: img.display_order
    }));

    return res.status(200).json({
      success: true,
      data: {
        id: r.id,
        title: r.title,
        description: r.description,
        mode: r.mode,
        price: r.price !== null ? String(r.price) : null,
        isNegotiable: Boolean(r.is_negotiable),
        barterPreferences: r.barter_preferences,
        itemCondition: r.item_condition,
        pickupLocation: r.pickup_location,
        status: r.status,
        category: {
          id: r.category_id,
          name: r.category_name
        },
        seller: {
          id: r.seller_id,
          fullName: r.seller_name,
          department: r.seller_department,
          avgRating: parseFloat(r.seller_avg_rating),
          totalReviews: parseInt(r.seller_review_count, 10)
        },
        images,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/v1/listings/:id
 * Update listing details (Authenticated, Resource Owner only)
 */
router.put('/:id', authenticate, async (req, res, next) => {
  try {
    const listingId = parseInt(req.params.id, 10);
    if (isNaN(listingId)) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'Listing does not exist.'
        }
      });
    }

    // Check existing listing
    const [existing] = await pool.query('SELECT * FROM listings WHERE id = ?', [listingId]);
    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'Listing does not exist.'
        }
      });
    }

    const listing = existing[0];

    // Ownership check (only seller can update)
    if (listing.seller_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN_OPERATION',
          message: 'You are not authorized to edit this listing.'
        }
      });
    }

    // State machine check: only ACTIVE listings can be modified
    if (listing.status !== 'ACTIVE') {
      return res.status(409).json({
        success: false,
        error: {
          code: 'INVALID_STATE_TRANSITION',
          message: 'Only ACTIVE listings can be updated.'
        }
      });
    }

    const {
      title,
      description,
      price,
      isNegotiable,
      barterPreferences,
      itemCondition,
      pickupLocation
    } = req.body;

    // Construct update fields (mode, seller_id, status are protected from direct change)
    const updates = [];
    const values = [];

    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim().length < 5 || title.trim().length > 100) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Title must be between 5 and 100 characters.'
          }
        });
      }
      updates.push('title = ?');
      values.push(title.trim());
    }

    if (description !== undefined) {
      if (typeof description !== 'string' || description.trim().length < 10 || description.trim().length > 2000) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Description must be between 10 and 2000 characters.'
          }
        });
      }
      updates.push('description = ?');
      values.push(description.trim());
    }

    if (price !== undefined) {
      if (listing.mode === 'SELL') {
        const parsedPrice = parseFloat(price);
        if (isNaN(parsedPrice) || parsedPrice <= 0) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Price must be greater than zero for SELL listings.'
            }
          });
        }
        updates.push('price = ?');
        values.push(parsedPrice.toFixed(2));
      } else if (listing.mode === 'FREE') {
        // Enforce 0.00
        updates.push('price = ?');
        values.push('0.00');
      } else if (listing.mode === 'BARTER') {
        if (price !== null) {
          const parsedPrice = parseFloat(price);
          if (isNaN(parsedPrice) || parsedPrice < 0) {
            return res.status(400).json({
              success: false,
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Price must be greater than or equal to 0.00 for BARTER.'
              }
            });
          }
          updates.push('price = ?');
          values.push(parsedPrice.toFixed(2));
        } else {
          updates.push('price = NULL');
        }
      }
    }

    if (isNegotiable !== undefined) {
      updates.push('is_negotiable = ?');
      values.push(Boolean(isNegotiable));
    }

    if (barterPreferences !== undefined) {
      if (listing.mode === 'BARTER' && (!barterPreferences || !barterPreferences.trim())) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'barterPreferences cannot be empty for BARTER mode.'
          }
        });
      }
      updates.push('barter_preferences = ?');
      values.push(barterPreferences ? barterPreferences.trim() : null);
    }

    if (itemCondition !== undefined) {
      const cond = String(itemCondition).toUpperCase();
      if (!ALLOWED_CONDITIONS.includes(cond)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `itemCondition must be one of: ${ALLOWED_CONDITIONS.join(', ')}`
          }
        });
      }
      updates.push('item_condition = ?');
      values.push(cond);
    }

    if (pickupLocation !== undefined) {
      if (typeof pickupLocation !== 'string' || !pickupLocation.trim()) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'pickupLocation cannot be empty.'
          }
        });
      }
      updates.push('pickup_location = ?');
      values.push(pickupLocation.trim());
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'No updatable fields provided.'
        }
      });
    }

    values.push(listingId);
    const updateSql = `UPDATE listings SET ${updates.join(', ')} WHERE id = ?`;
    await pool.query(updateSql, values);

    // Fetch updated row
    const [updatedRows] = await pool.query('SELECT * FROM listings WHERE id = ?', [listingId]);
    const u = updatedRows[0];

    return res.status(200).json({
      success: true,
      data: {
        id: u.id,
        title: u.title,
        price: u.price !== null ? String(u.price) : null,
        status: u.status,
        updatedAt: u.updated_at
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/v1/listings/:id
 * Soft-delete / cancel listing (Authenticated: Owner or Admin)
 */
router.delete('/:id', authenticate, async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const listingId = parseInt(req.params.id, 10);
    if (isNaN(listingId)) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'Listing does not exist.'
        }
      });
    }

    const [existing] = await connection.query('SELECT * FROM listings WHERE id = ?', [listingId]);
    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'Listing does not exist.'
        }
      });
    }

    const listing = existing[0];
    const isOwner = listing.seller_id === req.user.id;
    const isAdmin = req.user.role === 'ADMIN';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN_OPERATION',
          message: 'You are not authorized to cancel this listing.'
        }
      });
    }

    // State machine check: cannot cancel if RESERVED or COMPLETED
    if (listing.status === 'RESERVED' || listing.status === 'COMPLETED') {
      return res.status(409).json({
        success: false,
        error: {
          code: 'INVALID_STATE_TRANSITION',
          message: `Cannot cancel listing in ${listing.status} status.`
        }
      });
    }

    await connection.beginTransaction();

    const newStatus = isAdmin && !isOwner ? 'DELETED_BY_ADMIN' : 'CANCELLED';

    await connection.query('UPDATE listings SET status = ? WHERE id = ?', [newStatus, listingId]);

    // Invalidate pending offers to CANCELLED_BY_SYSTEM
    await connection.query(
      "UPDATE offers SET status = 'CANCELLED_BY_SYSTEM' WHERE listing_id = ? AND status IN ('PENDING', 'COUNTERED')",
      [listingId]
    );

    await connection.commit();

    return res.status(200).json({
      success: true,
      data: {
        id: listingId,
        status: newStatus,
        message: 'Listing successfully cancelled.'
      }
    });
  } catch (err) {
    await connection.rollback();
    next(err);
  } finally {
    connection.release();
  }
});

/**
 * POST /api/v1/listings/:id/claim
 * Claim a free item (Mode: FREE) - API Contract Section 5.1
 */
router.post('/:id/claim', authenticate, async (req, res, next) => {
  const listingId = parseInt(req.params.id, 10);
  if (isNaN(listingId)) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'RESOURCE_NOT_FOUND',
        message: 'Listing does not exist.'
      }
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Pessimistic lock on target listing
    const [listingRows] = await connection.query(
      'SELECT id, seller_id, mode, price, pickup_location, status FROM listings WHERE id = ? FOR UPDATE',
      [listingId]
    );

    if (listingRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'Listing does not exist.'
        }
      });
    }

    const listing = listingRows[0];

    // Anti-wash trading: cannot claim own listing
    if (listing.seller_id === req.user.id) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: {
          code: 'SELF_CLAIM_DISALLOWED',
          message: 'You cannot claim your own listing.'
        }
      });
    }

    // Must be in FREE mode
    if (listing.mode !== 'FREE') {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_LISTING_MODE',
          message: 'Only listings marked with mode FREE can be claimed.'
        }
      });
    }

    // Must be in ACTIVE status
    if (listing.status !== 'ACTIVE') {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        error: {
          code: 'STATE_CONFLICT',
          message: 'This item has already been claimed or is no longer active.'
        }
      });
    }

    const claimMsg = req.body.message ? String(req.body.message).trim() : null;

    // 1. Update listing status to RESERVED
    await connection.query(
      "UPDATE listings SET status = 'RESERVED' WHERE id = ?",
      [listingId]
    );

    // 2. Insert into offers (CLAIM, ACCEPTED)
    const [offerResult] = await connection.query(
      `INSERT INTO offers (listing_id, buyer_id, offer_type, message, status)
       VALUES (?, ?, 'CLAIM', ?, 'ACCEPTED')`,
      [listingId, req.user.id, claimMsg]
    );
    const offerId = offerResult.insertId;

    // 3. Invalidate competing pending/countered offers on this listing
    await connection.query(
      `UPDATE offers 
       SET status = 'CANCELLED_BY_SYSTEM' 
       WHERE listing_id = ? 
         AND id != ? 
         AND status IN ('PENDING', 'COUNTERED')`,
      [listingId, offerId]
    );

    // 4. Insert into transactions (FREE_GIVEAWAY, 0.00, PENDING_MEETUP)
    const [txResult] = await connection.query(
      `INSERT INTO transactions (
        offer_id, listing_id, seller_id, buyer_id,
        transaction_type, final_price, status
      ) VALUES (?, ?, ?, ?, 'FREE_GIVEAWAY', 0.00, 'PENDING_MEETUP')`,
      [offerId, listingId, listing.seller_id, req.user.id]
    );
    const transactionId = txResult.insertId;

    // 5. If intro message was supplied, store in messages thread
    if (claimMsg) {
      await connection.query(
        `INSERT INTO messages (offer_id, sender_id, message_text, is_read, sent_at)
         VALUES (?, ?, ?, FALSE, CURRENT_TIMESTAMP)`,
        [offerId, req.user.id, claimMsg]
      );
    }

    // 6. Fetch seller details for response
    const [sellerRows] = await connection.query(
      'SELECT id, full_name, phone_number FROM users WHERE id = ?',
      [listing.seller_id]
    );
    const seller = sellerRows[0] || {};

    await connection.commit();

    return res.status(201).json({
      success: true,
      data: {
        transactionId,
        listingId,
        status: 'PENDING_MEETUP',
        pickupLocation: listing.pickup_location,
        seller: {
          id: seller.id,
          fullName: seller.full_name,
          phoneNumber: seller.phone_number || null
        },
        message: 'Item claimed successfully! Please coordinate pickup with the student.'
      }
    });
  } catch (err) {
    await connection.rollback();
    next(err);
  } finally {
    connection.release();
  }
});

/**
 * POST /api/v1/listings/:id/offers
 * Create purchase offer (Mode: SELL)
 */
router.post('/:id/offers', authenticate, async (req, res, next) => {
  try {
    const listingId = parseInt(req.params.id, 10);
    if (isNaN(listingId)) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'Listing does not exist.'
        }
      });
    }

    const { offerType = 'PURCHASE', offeredPrice, message } = req.body;

    if (offerType !== 'PURCHASE') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'This endpoint only accepts offerType PURCHASE.'
        }
      });
    }

    const parsedPrice = parseFloat(offeredPrice);
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'offeredPrice must be a valid number greater than zero.'
        }
      });
    }

    const [listingRows] = await pool.query(
      'SELECT id, seller_id, mode, status FROM listings WHERE id = ?',
      [listingId]
    );

    if (listingRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'Listing does not exist.'
        }
      });
    }

    const listing = listingRows[0];

    // Anti-wash trading: cannot make offer on own listing
    if (listing.seller_id === req.user.id) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'SELF_OFFER_DISALLOWED',
          message: 'You cannot make an offer on your own listing.'
        }
      });
    }

    // Mode check (API Contract 6.1: SELL mode only)
    if (listing.mode !== 'SELL') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_LISTING_MODE',
          message: 'Purchase offers can only be made on listings in SELL mode.'
        }
      });
    }

    // Must be in ACTIVE status
    if (listing.status !== 'ACTIVE') {
      return res.status(409).json({
        success: false,
        error: {
          code: 'LISTING_NOT_ACTIVE',
          message: 'Offers can only be placed on ACTIVE listings.'
        }
      });
    }

    const [insertResult] = await pool.query(
      `INSERT INTO offers (listing_id, buyer_id, offer_type, offered_price, message, status)
       VALUES (?, ?, 'PURCHASE', ?, ?, 'PENDING')`,
      [listingId, req.user.id, parsedPrice.toFixed(2), message ? String(message).trim() : null]
    );

    return res.status(201).json({
      success: true,
      data: {
        offerId: insertResult.insertId,
        listingId,
        offerType: 'PURCHASE',
        offeredPrice: parsedPrice.toFixed(2),
        status: 'PENDING',
        createdAt: new Date().toISOString()
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/listings/:id/barter-proposals
 * Propose barter exchange (Mode: BARTER or SELL)
 */
router.post('/:id/barter-proposals', authenticate, async (req, res, next) => {
  try {
    const targetListingId = parseInt(req.params.id, 10);
    if (isNaN(targetListingId)) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'Listing does not exist.'
        }
      });
    }

    const { offeredListingId, cashDifference = 0.0, message } = req.body;

    const parsedOfferedId = parseInt(offeredListingId, 10);
    if (isNaN(parsedOfferedId) || parsedOfferedId === targetListingId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_OFFERED_ITEM',
          message: 'The item offered for barter must be an ACTIVE listing owned by you, different from target.'
        }
      });
    }

    const parsedCashDiff = parseFloat(cashDifference);
    if (isNaN(parsedCashDiff) || parsedCashDiff < 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'cashDifference must be a valid number greater than or equal to 0.00.'
        }
      });
    }

    // Check target listing
    const [targetRows] = await pool.query(
      'SELECT id, seller_id, mode, status FROM listings WHERE id = ?',
      [targetListingId]
    );

    if (targetRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'Target listing does not exist.'
        }
      });
    }

    const targetListing = targetRows[0];

    // Cannot propose barter on own listing
    if (targetListing.seller_id === req.user.id) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'SELF_OFFER_DISALLOWED',
          message: 'You cannot make an offer on your own listing.'
        }
      });
    }

    if (targetListing.status !== 'ACTIVE') {
      return res.status(409).json({
        success: false,
        error: {
          code: 'LISTING_NOT_ACTIVE',
          message: 'Offers can only be placed on ACTIVE listings.'
        }
      });
    }

    // Verify offered listing: must be owned by req.user.id and currently ACTIVE
    const [offeredRows] = await pool.query(
      'SELECT id, seller_id, status FROM listings WHERE id = ?',
      [parsedOfferedId]
    );

    if (
      offeredRows.length === 0 ||
      offeredRows[0].seller_id !== req.user.id ||
      offeredRows[0].status !== 'ACTIVE'
    ) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_OFFERED_ITEM',
          message: 'The item offered for barter must be an ACTIVE listing owned by you.'
        }
      });
    }

    const [insertResult] = await pool.query(
      `INSERT INTO offers (
        listing_id, buyer_id, offer_type, offered_listing_id,
        cash_difference, message, status
      ) VALUES (?, ?, 'BARTER', ?, ?, ?, 'PENDING')`,
      [
        targetListingId,
        req.user.id,
        parsedOfferedId,
        parsedCashDiff.toFixed(2),
        message ? String(message).trim() : null
      ]
    );

    return res.status(201).json({
      success: true,
      data: {
        offerId: insertResult.insertId,
        targetListingId,
        offeredListingId: parsedOfferedId,
        offerType: 'BARTER',
        cashDifference: parsedCashDiff.toFixed(2),
        status: 'PENDING',
        createdAt: new Date().toISOString()
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/listings/:id/offers
 * List offers on a listing (Listing Owner only)
 */
router.get('/:id/offers', authenticate, async (req, res, next) => {
  try {
    const listingId = parseInt(req.params.id, 10);
    if (isNaN(listingId)) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'Listing does not exist.'
        }
      });
    }

    const [listingRows] = await pool.query('SELECT seller_id FROM listings WHERE id = ?', [listingId]);
    if (listingRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'Listing does not exist.'
        }
      });
    }

    if (listingRows[0].seller_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN_OPERATION',
          message: 'Only the listing owner can view offers on this listing.'
        }
      });
    }

    const selectSql = `
      SELECT 
        o.id,
        o.offer_type,
        o.offered_price,
        o.counter_price,
        o.cash_difference,
        o.offered_listing_id,
        o.status,
        o.message,
        o.created_at,
        u.id AS buyer_id,
        u.full_name AS buyer_name,
        COALESCE(rep.avg_rating, 0.00) AS buyer_avg_rating
      FROM offers o
      INNER JOIN users u ON o.buyer_id = u.id
      LEFT JOIN (
        SELECT 
          reviewee_id,
          ROUND(AVG(rating), 2) AS avg_rating
        FROM reviews
        GROUP BY reviewee_id
      ) rep ON u.id = rep.reviewee_id
      WHERE o.listing_id = ?
      ORDER BY o.created_at DESC
    `;

    const [rows] = await pool.query(selectSql, [listingId]);

    const formatted = rows.map((r) => ({
      id: r.id,
      offerType: r.offer_type,
      offeredPrice: r.offered_price !== null ? String(r.offered_price) : null,
      counterPrice: r.counter_price !== null ? String(r.counter_price) : null,
      cashDifference: String(r.cash_difference),
      offeredListingId: r.offered_listing_id,
      status: r.status,
      message: r.message,
      buyer: {
        id: r.buyer_id,
        fullName: r.buyer_name,
        avgRating: parseFloat(r.buyer_avg_rating)
      },
      createdAt: r.created_at
    }));

    return res.status(200).json({
      success: true,
      data: formatted
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
