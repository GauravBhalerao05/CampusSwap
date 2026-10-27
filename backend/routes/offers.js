const express = require('express');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/v1/offers/:id/counter
 * Submit counteroffer (Listing Owner only)
 */
router.post('/:id/counter', authenticate, async (req, res, next) => {
  try {
    const offerId = parseInt(req.params.id, 10);
    if (isNaN(offerId)) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'Offer does not exist.'
        }
      });
    }

    const { counterPrice, message } = req.body;
    const parsedCounterPrice = parseFloat(counterPrice);
    if (isNaN(parsedCounterPrice) || parsedCounterPrice <= 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'counterPrice must be a valid number greater than zero.'
        }
      });
    }

    // Retrieve offer and target listing to verify ownership
    const [rows] = await pool.query(
      `SELECT o.id, o.listing_id, o.buyer_id, o.status, o.offer_type, l.seller_id
       FROM offers o
       INNER JOIN listings l ON o.listing_id = l.id
       WHERE o.id = ?`,
      [offerId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'Offer does not exist.'
        }
      });
    }

    const offer = rows[0];

    // Only the target listing's seller can counter
    if (offer.seller_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN_OPERATION',
          message: 'Only the listing owner can submit a counteroffer.'
        }
      });
    }

    // Offer must be in PENDING status to counter
    if (offer.status !== 'PENDING') {
      return res.status(409).json({
        success: false,
        error: {
          code: 'INVALID_STATE_TRANSITION',
          message: `Cannot counteroffer an offer in ${offer.status} status.`
        }
      });
    }

    await pool.query(
      "UPDATE offers SET status = 'COUNTERED', counter_price = ?, message = COALESCE(?, message) WHERE id = ?",
      [parsedCounterPrice.toFixed(2), message ? String(message).trim() : null, offerId]
    );

    return res.status(200).json({
      success: true,
      data: {
        offerId,
        status: 'COUNTERED',
        counterPrice: parsedCounterPrice.toFixed(2),
        updatedAt: new Date().toISOString()
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/v1/offers/:id/accept
 * Accept offer or counteroffer with deterministic locking
 * Listing Owner accepts direct offer; Buyer accepts counteroffer
 */
router.patch('/:id/accept', authenticate, async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const offerId = parseInt(req.params.id, 10);
    if (isNaN(offerId)) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'Offer does not exist.'
        }
      });
    }

    await connection.beginTransaction();

    // 1. Initial lookup to get target & offered listing IDs
    const [offerRows] = await connection.query(
      `SELECT o.id, o.listing_id, o.buyer_id, o.offer_type, o.offered_price, 
              o.offered_listing_id, o.cash_difference, o.counter_price, o.status,
              l.seller_id AS target_seller_id
       FROM offers o
       INNER JOIN listings l ON o.listing_id = l.id
       WHERE o.id = ?`,
      [offerId]
    );

    if (offerRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'Offer does not exist.'
        }
      });
    }

    const offer = offerRows[0];
    const targetListingId = offer.listing_id;
    const offeredListingId = offer.offered_listing_id;

    // Check permissions:
    // If status === 'PENDING', listing owner accepts
    // If status === 'COUNTERED', buyer accepts
    const isSeller = req.user.id === offer.target_seller_id;
    const isBuyer = req.user.id === offer.buyer_id;

    if (offer.status === 'PENDING') {
      if (!isSeller) {
        await connection.rollback();
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN_OPERATION',
            message: 'Only the listing owner can accept a pending offer.'
          }
        });
      }
    } else if (offer.status === 'COUNTERED') {
      if (!isBuyer) {
        await connection.rollback();
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN_OPERATION',
            message: 'Only the buyer can accept a counteroffer.'
          }
        });
      }
    } else {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        error: {
          code: 'INVALID_STATE_TRANSITION',
          message: `Cannot accept offer in ${offer.status} status.`
        }
      });
    }

    // 2. Deterministic Row Locking Order: LEAST(id1, id2) then GREATEST(id1, id2)
    let firstLockId, secondLockId;
    if (offeredListingId) {
      firstLockId = Math.min(targetListingId, offeredListingId);
      secondLockId = Math.max(targetListingId, offeredListingId);
    } else {
      firstLockId = targetListingId;
      secondLockId = null;
    }

    // Acquire lock on first listing
    const [firstRows] = await connection.query(
      'SELECT id, seller_id, mode, status FROM listings WHERE id = ? FOR UPDATE',
      [firstLockId]
    );

    let secondRows = [];
    if (secondLockId) {
      const [sRows] = await connection.query(
        'SELECT id, seller_id, mode, status FROM listings WHERE id = ? FOR UPDATE',
        [secondLockId]
      );
      secondRows = sRows;
    }

    // Map locked rows
    const lockedListings = {};
    if (firstRows.length > 0) lockedListings[firstRows[0].id] = firstRows[0];
    if (secondRows.length > 0) lockedListings[secondRows[0].id] = secondRows[0];

    const lockedTarget = lockedListings[targetListingId];
    const lockedOffered = offeredListingId ? lockedListings[offeredListingId] : null;

    // Verify target listing is still ACTIVE
    if (!lockedTarget || lockedTarget.status !== 'ACTIVE') {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        error: {
          code: 'STATE_CONFLICT',
          message: 'Cannot accept offer. Listing is no longer ACTIVE or has already been reserved.'
        }
      });
    }

    // If barter, verify offered listing is still ACTIVE and owned by the buyer
    if (offeredListingId) {
      if (!lockedOffered || lockedOffered.status !== 'ACTIVE' || lockedOffered.seller_id !== offer.buyer_id) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          error: {
            code: 'STATE_CONFLICT',
            message: 'The offered barter listing is no longer active or ownership has changed.'
          }
        });
      }
    }

    // Recheck offer status under lock
    const [lockedOfferRows] = await connection.query(
      'SELECT id, status FROM offers WHERE id = ? FOR UPDATE',
      [offerId]
    );
    if (lockedOfferRows.length === 0 || !['PENDING', 'COUNTERED'].includes(lockedOfferRows[0].status)) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        error: {
          code: 'STATE_CONFLICT',
          message: 'Offer status has changed concurrently.'
        }
      });
    }

    // 3. Determine agreed settlement price and transaction type
    let agreedPrice = '0.00';
    let transactionType = 'SALE';

    if (offer.offer_type === 'PURCHASE') {
      transactionType = 'SALE';
      agreedPrice = offer.status === 'COUNTERED' && offer.counter_price
        ? parseFloat(offer.counter_price).toFixed(2)
        : parseFloat(offer.offered_price).toFixed(2);
    } else if (offer.offer_type === 'BARTER') {
      transactionType = 'BARTER';
      agreedPrice = parseFloat(offer.cash_difference || 0).toFixed(2);
    } else if (offer.offer_type === 'CLAIM') {
      transactionType = 'FREE_GIVEAWAY';
      agreedPrice = '0.00';
    }

    // 4. Update listing(s) to RESERVED
    if (offeredListingId) {
      await connection.query(
        "UPDATE listings SET status = 'RESERVED' WHERE id IN (?, ?)",
        [targetListingId, offeredListingId]
      );
    } else {
      await connection.query(
        "UPDATE listings SET status = 'RESERVED' WHERE id = ?",
        [targetListingId]
      );
    }

    // 5. Update this offer to ACCEPTED
    await connection.query(
      "UPDATE offers SET status = 'ACCEPTED' WHERE id = ?",
      [offerId]
    );

    // 6. Invalidate competing offers on target listing and offered barter listing
    if (offeredListingId) {
      await connection.query(
        `UPDATE offers 
         SET status = 'CANCELLED_BY_SYSTEM' 
         WHERE (listing_id IN (?, ?) OR offered_listing_id IN (?, ?))
           AND id != ? 
           AND status IN ('PENDING', 'COUNTERED')`,
        [targetListingId, offeredListingId, targetListingId, offeredListingId, offerId]
      );
    } else {
      await connection.query(
        `UPDATE offers 
         SET status = 'CANCELLED_BY_SYSTEM' 
         WHERE listing_id = ? 
           AND id != ? 
           AND status IN ('PENDING', 'COUNTERED')`,
        [targetListingId, offerId]
      );
    }

    // 7. Insert official transaction record
    const insertTxSql = `
      INSERT INTO transactions (
        offer_id, listing_id, seller_id, buyer_id,
        transaction_type, final_price, barter_listing_id, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING_MEETUP')
    `;

    const [txResult] = await connection.query(insertTxSql, [
      offerId,
      targetListingId,
      offer.target_seller_id,
      offer.buyer_id,
      transactionType,
      agreedPrice,
      offeredListingId || null
    ]);

    const transactionId = txResult.insertId;

    await connection.commit();

    return res.status(200).json({
      success: true,
      data: {
        transactionId,
        offerId,
        listingId: targetListingId,
        agreedPrice,
        transactionStatus: 'PENDING_MEETUP',
        message: 'Offer accepted! Item is now RESERVED. Coordinate meetup for handover.'
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
 * PATCH /api/v1/offers/:id/reject
 * Reject offer (Listing Owner only)
 */
router.patch('/:id/reject', authenticate, async (req, res, next) => {
  try {
    const offerId = parseInt(req.params.id, 10);
    if (isNaN(offerId)) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'Offer does not exist.'
        }
      });
    }

    const [rows] = await pool.query(
      `SELECT o.id, o.status, l.seller_id
       FROM offers o
       INNER JOIN listings l ON o.listing_id = l.id
       WHERE o.id = ?`,
      [offerId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'Offer does not exist.'
        }
      });
    }

    const offer = rows[0];

    if (offer.seller_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN_OPERATION',
          message: 'Only the listing owner can reject this offer.'
        }
      });
    }

    if (!['PENDING', 'COUNTERED'].includes(offer.status)) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'INVALID_STATE_TRANSITION',
          message: `Cannot reject an offer in ${offer.status} status.`
        }
      });
    }

    await pool.query("UPDATE offers SET status = 'REJECTED' WHERE id = ?", [offerId]);

    return res.status(200).json({
      success: true,
      data: {
        offerId,
        status: 'REJECTED'
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/v1/offers/:id/withdraw
 * Withdraw offer (Buyer / Proposer only)
 */
router.patch('/:id/withdraw', authenticate, async (req, res, next) => {
  try {
    const offerId = parseInt(req.params.id, 10);
    if (isNaN(offerId)) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'Offer does not exist.'
        }
      });
    }

    const [rows] = await pool.query(
      'SELECT id, buyer_id, status FROM offers WHERE id = ?',
      [offerId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'Offer does not exist.'
        }
      });
    }

    const offer = rows[0];

    if (offer.buyer_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN_OPERATION',
          message: 'Only the offer proposer can withdraw this offer.'
        }
      });
    }

    if (!['PENDING', 'COUNTERED'].includes(offer.status)) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'INVALID_STATE_TRANSITION',
          message: `Cannot withdraw an offer in ${offer.status} status.`
        }
      });
    }

    await pool.query("UPDATE offers SET status = 'WITHDRAWN' WHERE id = ?", [offerId]);

    return res.status(200).json({
      success: true,
      data: {
        offerId,
        status: 'WITHDRAWN'
      }
    });
  } catch (err) {
    next(err);
  }
});

const { sendMessage, getMessages } = require('./messages');

/**
 * POST /api/v1/offers/:id/messages
 * Send negotiation message for offer thread (API_CONTRACT Section 9.1)
 */
router.post('/:id/messages', authenticate, sendMessage);

/**
 * GET /api/v1/offers/:id/messages
 * Retrieve messages for offer thread (API_CONTRACT Section 9.2)
 */
router.get('/:id/messages', authenticate, getMessages);

module.exports = router;

