const express = require('express');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/v1/transactions
 * Retrieve transaction history for the authenticated user.
 * Optional query parameters:
 *   - role: 'seller' | 'buyer' | 'all'
 *   - status: 'PENDING_MEETUP' | 'COMPLETED' | 'CANCELLED'
 */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { role = 'all', status } = req.query;
    const userId = req.user.id;
    const isAdmin = req.user.role === 'ADMIN';

    // Validate status if provided
    const validStatuses = ['PENDING_MEETUP', 'COMPLETED', 'CANCELLED'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Invalid status filter. Allowed values: ${validStatuses.join(', ')}`
        }
      });
    }

    // Build WHERE clauses
    const whereConditions = [];
    const queryParams = [];

    if (!isAdmin) {
      if (role === 'seller') {
        whereConditions.push('t.seller_id = ?');
        queryParams.push(userId);
      } else if (role === 'buyer') {
        whereConditions.push('t.buyer_id = ?');
        queryParams.push(userId);
      } else {
        whereConditions.push('(t.seller_id = ? OR t.buyer_id = ?)');
        queryParams.push(userId, userId);
      }
    } else {
      // Admin user: optionally filter by role if passed
      if (role === 'seller') {
        whereConditions.push('t.seller_id = ?');
        queryParams.push(userId);
      } else if (role === 'buyer') {
        whereConditions.push('t.buyer_id = ?');
        queryParams.push(userId);
      }
    }

    if (status) {
      whereConditions.push('t.status = ?');
      queryParams.push(status);
    }

    const whereClause = whereConditions.length > 0
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';

    const sql = `
      SELECT 
        t.id,
        t.transaction_type,
        t.final_price,
        t.status,
        t.created_at,
        t.completed_at,
        t.listing_id,
        l.title AS listing_title,
        t.seller_id,
        u_s.full_name AS seller_name,
        u_s.phone_number AS seller_phone,
        t.buyer_id,
        u_b.full_name AS buyer_name,
        u_b.phone_number AS buyer_phone,
        t.barter_listing_id,
        bl.title AS barter_listing_title
      FROM transactions t
      INNER JOIN listings l ON t.listing_id = l.id
      INNER JOIN users u_s ON t.seller_id = u_s.id
      INNER JOIN users u_b ON t.buyer_id = u_b.id
      LEFT JOIN listings bl ON t.barter_listing_id = bl.id
      ${whereClause}
      ORDER BY t.created_at DESC
    `;

    const [rows] = await pool.query(sql, queryParams);

    const formattedData = rows.map((row) => {
      const isUserSeller = (row.seller_id === userId);
      const counterpartyId = isUserSeller ? row.buyer_id : row.seller_id;
      const counterpartyName = isUserSeller ? row.buyer_name : row.seller_name;
      const counterpartyPhone = isUserSeller ? row.buyer_phone : row.seller_phone;

      return {
        id: row.id,
        transactionType: row.transaction_type,
        finalPrice: parseFloat(row.final_price).toFixed(2),
        status: row.status,
        listing: {
          id: row.listing_id,
          title: row.listing_title
        },
        counterparty: {
          id: counterpartyId,
          fullName: counterpartyName,
          phoneNumber: counterpartyPhone || null
        },
        createdAt: row.created_at,
        completedAt: row.completed_at
      };
    });

    return res.status(200).json({
      success: true,
      data: formattedData
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/transactions/:id
 * Retrieve specific transaction details.
 * Access restricted to transaction participants (seller/buyer) and administrators.
 */
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const txId = parseInt(req.params.id, 10);
    if (isNaN(txId) || txId <= 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid transaction ID.'
        }
      });
    }

    const sql = `
      SELECT 
        t.id,
        t.offer_id,
        t.transaction_type,
        t.final_price,
        t.status,
        t.created_at,
        t.completed_at,
        t.listing_id,
        l.title AS listing_title,
        l.pickup_location AS listing_pickup_location,
        t.seller_id,
        u_s.full_name AS seller_name,
        t.buyer_id,
        u_b.full_name AS buyer_name,
        t.barter_listing_id,
        bl.title AS barter_listing_title
      FROM transactions t
      INNER JOIN listings l ON t.listing_id = l.id
      INNER JOIN users u_s ON t.seller_id = u_s.id
      INNER JOIN users u_b ON t.buyer_id = u_b.id
      LEFT JOIN listings bl ON t.barter_listing_id = bl.id
      WHERE t.id = ?
    `;

    const [rows] = await pool.query(sql, [txId]);
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TRANSACTION_NOT_FOUND',
          message: 'Transaction not found.'
        }
      });
    }

    const tx = rows[0];
    const isParticipant = (req.user.id === tx.seller_id || req.user.id === tx.buyer_id);
    const isAdmin = (req.user.role === 'ADMIN');

    if (!isParticipant && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN_OPERATION',
          message: 'You do not have permission to view this transaction.'
        }
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        id: tx.id,
        transactionType: tx.transaction_type,
        finalPrice: parseFloat(tx.final_price).toFixed(2),
        status: tx.status,
        listing: {
          id: tx.listing_id,
          title: tx.listing_title,
          pickupLocation: tx.listing_pickup_location
        },
        seller: {
          id: tx.seller_id,
          fullName: tx.seller_name
        },
        buyer: {
          id: tx.buyer_id,
          fullName: tx.buyer_name
        },
        barterListing: tx.barter_listing_id ? {
          id: tx.barter_listing_id,
          title: tx.barter_listing_title
        } : null,
        createdAt: tx.created_at,
        completedAt: tx.completed_at
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/transactions/:id/complete
 * Confirm handover completion.
 * Access restricted to Seller, Claimer, Barter item owner, or Admin.
 * Business rules:
 *   - Transaction must be in 'PENDING_MEETUP'
 *   - Locks affected listings in deterministic order: LEAST(id1, id2) then GREATEST(id1, id2)
 *   - Transitions transaction to 'COMPLETED' with completed_at = NOW()
 *   - Transitions associated listing(s) to 'COMPLETED'
 *   - Preserves final_price, transaction_type, and barter_listing_id
 *   - Rolls back completely on failure
 */
router.post('/:id/complete', authenticate, async (req, res, next) => {
  const txId = parseInt(req.params.id, 10);
  if (isNaN(txId) || txId <= 0) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid transaction ID.'
      }
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Lock transaction row
    const [txRows] = await connection.query(
      'SELECT * FROM transactions WHERE id = ? FOR UPDATE',
      [txId]
    );

    if (txRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        error: {
          code: 'TRANSACTION_NOT_FOUND',
          message: 'Transaction not found.'
        }
      });
    }

    const tx = txRows[0];

    // 2. Authorization check
    // Allowed: Seller, Claimer in FREE_GIVEAWAY, Barter participant, or Admin
    const isSeller = (req.user.id === tx.seller_id);
    const isClaimer = (tx.transaction_type === 'FREE_GIVEAWAY' && req.user.id === tx.buyer_id);
    const isBarterParticipant = (tx.transaction_type === 'BARTER' && req.user.id === tx.buyer_id);
    const isAdmin = (req.user.role === 'ADMIN');

    if (!isSeller && !isClaimer && !isBarterParticipant && !isAdmin) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN_OPERATION',
          message: 'Only the seller, claimer, or administrator can confirm completion.'
        }
      });
    }

    // 3. State validation
    if (tx.status !== 'PENDING_MEETUP') {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        error: {
          code: 'INVALID_STATE_TRANSITION',
          message: `Cannot complete transaction with current status '${tx.status}'. Expected 'PENDING_MEETUP'.`
        }
      });
    }

    // 4. Deterministic row locking for affected listings: LEAST then GREATEST
    const listingIds = [tx.listing_id];
    if (tx.barter_listing_id) {
      listingIds.push(tx.barter_listing_id);
    }
    listingIds.sort((a, b) => a - b);

    await connection.query(
      'SELECT id, status FROM listings WHERE id IN (?) ORDER BY id ASC FOR UPDATE',
      [listingIds]
    );

    // 5. Update listings to COMPLETED
    await connection.query(
      "UPDATE listings SET status = 'COMPLETED' WHERE id IN (?)",
      [listingIds]
    );

    // 6. Update transaction to COMPLETED
    await connection.query(
      "UPDATE transactions SET status = 'COMPLETED', completed_at = NOW() WHERE id = ?",
      [tx.id]
    );

    // Retrieve recorded completion timestamp
    const [updatedTxRows] = await connection.query(
      'SELECT completed_at FROM transactions WHERE id = ?',
      [tx.id]
    );

    await connection.commit();

    return res.status(200).json({
      success: true,
      data: {
        id: tx.id,
        status: 'COMPLETED',
        completedAt: updatedTxRows[0].completed_at,
        message: 'Transaction marked as completed! You can now rate your peer.'
      }
    });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

/**
 * POST /api/v1/transactions/:id/cancel
 * Abort / cancel meetup.
 * Access restricted to transaction participants (seller/buyer) and administrators.
 * Business rules:
 *   - Transaction must be in 'PENDING_MEETUP'
 *   - Locks affected listings in deterministic order: LEAST(id1, id2) then GREATEST(id1, id2)
 *   - Reverts transaction status to 'CANCELLED'
 *   - Restores affected listing(s) back to 'ACTIVE'
 *   - Ensures any competing pending offers remain/transition to 'CANCELLED_BY_SYSTEM'
 *   - Preserves final_price, transaction_type, and barter_listing_id
 *   - Rolls back completely on failure
 */
router.post('/:id/cancel', authenticate, async (req, res, next) => {
  const txId = parseInt(req.params.id, 10);
  if (isNaN(txId) || txId <= 0) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid transaction ID.'
      }
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Lock transaction row
    const [txRows] = await connection.query(
      'SELECT * FROM transactions WHERE id = ? FOR UPDATE',
      [txId]
    );

    if (txRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        error: {
          code: 'TRANSACTION_NOT_FOUND',
          message: 'Transaction not found.'
        }
      });
    }

    const tx = txRows[0];

    // 2. Authorization check
    // Allowed: Transaction Participants (seller or buyer) or Admin
    const isParticipant = (req.user.id === tx.seller_id || req.user.id === tx.buyer_id);
    const isAdmin = (req.user.role === 'ADMIN');

    if (!isParticipant && !isAdmin) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN_OPERATION',
          message: 'Only transaction participants or administrators can cancel this transaction.'
        }
      });
    }

    // 3. State validation
    if (tx.status !== 'PENDING_MEETUP') {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        error: {
          code: 'INVALID_STATE_TRANSITION',
          message: `Cannot cancel transaction with current status '${tx.status}'. Expected 'PENDING_MEETUP'.`
        }
      });
    }

    // 4. Deterministic row locking for affected listings: LEAST then GREATEST
    const listingIds = [tx.listing_id];
    if (tx.barter_listing_id) {
      listingIds.push(tx.barter_listing_id);
    }
    listingIds.sort((a, b) => a - b);

    await connection.query(
      'SELECT id, status FROM listings WHERE id IN (?) ORDER BY id ASC FOR UPDATE',
      [listingIds]
    );

    // 5. Restore affected reserved listings back to ACTIVE
    await connection.query(
      "UPDATE listings SET status = 'ACTIVE' WHERE id IN (?)",
      [listingIds]
    );

    // 6. Invalidate any lingering pending/countered offers to CANCELLED_BY_SYSTEM
    await connection.query(
      "UPDATE offers SET status = 'CANCELLED_BY_SYSTEM' WHERE (listing_id IN (?) OR offered_listing_id IN (?)) AND status IN ('PENDING', 'COUNTERED')",
      [listingIds, listingIds]
    );

    // 7. Update transaction to CANCELLED
    await connection.query(
      "UPDATE transactions SET status = 'CANCELLED' WHERE id = ?",
      [tx.id]
    );

    await connection.commit();

    return res.status(200).json({
      success: true,
      data: {
        id: tx.id,
        status: 'CANCELLED',
        message: 'Transaction cancelled. Listings have been restored to ACTIVE.'
      }
    });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

module.exports = router;
