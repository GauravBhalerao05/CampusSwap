const express = require('express');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/v1/reviews
 * Submit peer review for a completed transaction.
 * Access restricted to transaction participants (seller / buyer).
 * Business rules:
 *   - Transaction must have status === 'COMPLETED'
 *   - Reviewer must be seller_id or buyer_id
 *   - Reviewee is automatically the counterparty
 *   - Reviewer cannot review themselves
 *   - Rating must be an integer between 1 and 5
 *   - Exactly one review allowed per participant per transaction (enforces composite unique constraint)
 */
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { transactionId, rating, comment } = req.body;
    const reviewerId = req.user.id;

    // 1. Validate transactionId
    const parsedTxId = parseInt(transactionId, 10);
    if (!transactionId || isNaN(parsedTxId) || parsedTxId <= 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'A valid transactionId is required.'
        }
      });
    }

    // 2. Validate rating: must be an integer between 1 and 5
    if (
      rating === undefined ||
      rating === null ||
      typeof rating !== 'number' ||
      !Number.isInteger(rating) ||
      rating < 1 ||
      rating > 5
    ) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'RATING_OUT_OF_BOUNDS',
          message: 'Rating must be an integer between 1 and 5.'
        }
      });
    }

    // 3. Fetch transaction details
    const [txRows] = await pool.query(
      'SELECT id, seller_id, buyer_id, status FROM transactions WHERE id = ?',
      [parsedTxId]
    );

    if (txRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TRANSACTION_NOT_FOUND',
          message: 'Transaction not found.'
        }
      });
    }

    const tx = txRows[0];

    // 4. Validate transaction status: must be COMPLETED
    if (tx.status !== 'COMPLETED') {
      return res.status(409).json({
        success: false,
        error: {
          code: 'INVALID_STATE_TRANSITION',
          message: 'Reviews can only be submitted for completed transactions.'
        }
      });
    }

    // 5. Validate participant eligibility
    const isParticipant = (reviewerId === tx.seller_id || reviewerId === tx.buyer_id);
    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN_OPERATION',
          message: 'Only transaction participants can submit reviews.'
        }
      });
    }

    // 6. Determine reviewee
    const revieweeId = (reviewerId === tx.seller_id) ? tx.buyer_id : tx.seller_id;

    // 7. Prevent self-review
    if (reviewerId === revieweeId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'SELF_REVIEW_DISALLOWED',
          message: 'You cannot review yourself.'
        }
      });
    }

    // 8. Prevent duplicate reviews (one per participant per transaction)
    const [existingReviewRows] = await pool.query(
      'SELECT id FROM reviews WHERE transaction_id = ? AND reviewer_id = ?',
      [parsedTxId, reviewerId]
    );

    if (existingReviewRows.length > 0) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'DUPLICATE_ENTITY',
          message: 'You have already submitted a review for this transaction.'
        }
      });
    }

    // 9. Insert review record
    const [insertResult] = await pool.query(
      'INSERT INTO reviews (transaction_id, reviewer_id, reviewee_id, rating, comment) VALUES (?, ?, ?, ?, ?)',
      [parsedTxId, reviewerId, revieweeId, rating, comment ? comment.trim() : null]
    );

    // Retrieve created review details
    const [newReviewRows] = await pool.query(
      'SELECT id, transaction_id, reviewee_id, rating, comment, created_at FROM reviews WHERE id = ?',
      [insertResult.insertId]
    );
    const newReview = newReviewRows[0];

    return res.status(201).json({
      success: true,
      data: {
        reviewId: newReview.id,
        transactionId: newReview.transaction_id,
        revieweeId: newReview.reviewee_id,
        rating: newReview.rating,
        comment: newReview.comment,
        createdAt: newReview.created_at
      }
    });
  } catch (error) {
    // Catch MySQL duplicate key race condition if any
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        error: {
          code: 'DUPLICATE_ENTITY',
          message: 'You have already submitted a review for this transaction.'
        }
      });
    }
    next(error);
  }
});

/**
 * GET /api/v1/reviews
 * Query reviews and dynamic reputation metrics.
 * Optional query parameters:
 *   - userId (reviewee)
 *   - transactionId
 */
router.get('/', async (req, res, next) => {
  try {
    const { userId, transactionId } = req.query;
    const whereConditions = [];
    const queryParams = [];

    if (userId) {
      const parsedUserId = parseInt(userId, 10);
      if (!isNaN(parsedUserId)) {
        whereConditions.push('r.reviewee_id = ?');
        queryParams.push(parsedUserId);
      }
    }

    if (transactionId) {
      const parsedTxId = parseInt(transactionId, 10);
      if (!isNaN(parsedTxId)) {
        whereConditions.push('r.transaction_id = ?');
        queryParams.push(parsedTxId);
      }
    }

    const whereClause = whereConditions.length > 0
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';

    const sql = `
      SELECT 
        r.id,
        r.transaction_id,
        r.reviewer_id,
        u_rev.full_name AS reviewer_name,
        r.reviewee_id,
        u_ree.full_name AS reviewee_name,
        r.rating,
        r.comment,
        r.created_at
      FROM reviews r
      INNER JOIN users u_rev ON r.reviewer_id = u_rev.id
      INNER JOIN users u_ree ON r.reviewee_id = u_ree.id
      ${whereClause}
      ORDER BY r.created_at DESC
    `;

    const [rows] = await pool.query(sql, queryParams);

    // If querying for a specific user, compute aggregated reputation
    let userReputation = null;
    if (userId) {
      const [repRows] = await pool.query(
        `SELECT 
           COUNT(id) AS total_reviews, 
           COALESCE(ROUND(AVG(rating), 2), 0.00) AS avg_rating 
         FROM reviews 
         WHERE reviewee_id = ?`,
        [parseInt(userId, 10)]
      );
      if (repRows.length > 0) {
        userReputation = {
          totalReviews: parseInt(repRows[0].total_reviews, 10),
          averageRating: parseFloat(repRows[0].avg_rating)
        };
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        reviews: rows.map((r) => ({
          id: r.id,
          transactionId: r.transaction_id,
          reviewer: {
            id: r.reviewer_id,
            fullName: r.reviewer_name
          },
          reviewee: {
            id: r.reviewee_id,
            fullName: r.reviewee_name
          },
          rating: r.rating,
          comment: r.comment,
          createdAt: r.created_at
        })),
        ...(userReputation ? { reputation: userReputation } : {})
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
