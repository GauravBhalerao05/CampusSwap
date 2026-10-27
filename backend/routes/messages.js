const express = require('express');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

/**
 * Helper function to retrieve an offer by ID (or transaction ID) and verify participant access.
 * Returns { offer } if valid and authorized, or { error: { status, code, message } } if invalid/forbidden.
 */
async function getOfferAndAuthorize(user, rawId, action = 'read', idType = 'any') {
  // Validate identifier format
  const stringId = String(rawId || '').trim();
  if (!stringId || !/^\d+$/.test(stringId)) {
    return {
      error: {
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'A valid positive integer offer ID is required.'
      }
    };
  }

  const parsedId = parseInt(stringId, 10);
  if (parsedId <= 0) {
    return {
      error: {
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'A valid positive integer offer ID is required.'
      }
    };
  }

  let offer = null;

  if (idType === 'transaction') {
    // Explicit transaction identifier lookup
    const [txRows] = await pool.query(
      `SELECT o.id, o.listing_id, o.buyer_id, o.status, l.seller_id, l.title AS listing_title, t.id AS transaction_id
       FROM transactions t
       INNER JOIN offers o ON t.offer_id = o.id
       INNER JOIN listings l ON o.listing_id = l.id
       WHERE t.id = ?`,
      [parsedId]
    );
    if (txRows.length > 0) {
      offer = txRows[0];
    }
  } else if (idType === 'offer') {
    // Explicit offer identifier lookup
    const [offerRows] = await pool.query(
      `SELECT o.id, o.listing_id, o.buyer_id, o.status, l.seller_id, l.title AS listing_title, t.id AS transaction_id
       FROM offers o
       INNER JOIN listings l ON o.listing_id = l.id
       LEFT JOIN transactions t ON t.offer_id = o.id
       WHERE o.id = ?`,
      [parsedId]
    );
    if (offerRows.length > 0) {
      offer = offerRows[0];
    }
  } else {
    // Ambiguous lookup (e.g. from /messages/:id):
    // Prioritize checking if the ID matches an offer where current user is participant
    const [userOfferRows] = await pool.query(
      `SELECT o.id, o.listing_id, o.buyer_id, o.status, l.seller_id, l.title AS listing_title, t.id AS transaction_id
       FROM offers o
       INNER JOIN listings l ON o.listing_id = l.id
       LEFT JOIN transactions t ON t.offer_id = o.id
       WHERE o.id = ? AND (o.buyer_id = ? OR l.seller_id = ?)`,
      [parsedId, user.id, user.id]
    );
    if (userOfferRows.length > 0) {
      offer = userOfferRows[0];
    } else {
      // Check if ID matches a transaction where current user is participant
      const [userTxRows] = await pool.query(
        `SELECT o.id, o.listing_id, o.buyer_id, o.status, l.seller_id, l.title AS listing_title, t.id AS transaction_id
         FROM transactions t
         INNER JOIN offers o ON t.offer_id = o.id
         INNER JOIN listings l ON o.listing_id = l.id
         WHERE t.id = ? AND (t.buyer_id = ? OR t.seller_id = ?)`,
        [parsedId, user.id, user.id]
      );
      if (userTxRows.length > 0) {
        offer = userTxRows[0];
      } else {
        // Fall back to general lookup for admin access or proper 403/404 resolution
        const [anyOfferRows] = await pool.query(
          `SELECT o.id, o.listing_id, o.buyer_id, o.status, l.seller_id, l.title AS listing_title, t.id AS transaction_id
           FROM offers o
           INNER JOIN listings l ON o.listing_id = l.id
           LEFT JOIN transactions t ON t.offer_id = o.id
           WHERE o.id = ?`,
          [parsedId]
        );
        if (anyOfferRows.length > 0) {
          offer = anyOfferRows[0];
        } else {
          const [anyTxRows] = await pool.query(
            `SELECT o.id, o.listing_id, o.buyer_id, o.status, l.seller_id, l.title AS listing_title, t.id AS transaction_id
             FROM transactions t
             INNER JOIN offers o ON t.offer_id = o.id
             INNER JOIN listings l ON o.listing_id = l.id
             WHERE t.id = ?`,
            [parsedId]
          );
          if (anyTxRows.length > 0) {
            offer = anyTxRows[0];
          }
        }
      }
    }
  }

  if (!offer) {
    return {
      error: {
        status: 404,
        code: 'RESOURCE_NOT_FOUND',
        message: 'Offer does not exist.'
      }
    };
  }

  // Check authorization
  const isBuyer = user.id === offer.buyer_id;
  const isSeller = user.id === offer.seller_id;
  const isAdmin = user.role === 'ADMIN';

  if (action === 'send') {
    // Only offer participants can send messages
    if (!isBuyer && !isSeller) {
      return {
        error: {
          status: 403,
          code: 'FORBIDDEN_OPERATION',
          message: 'You are not authorized to send messages in this conversation.'
        }
      };
    }
  } else {
    // Both participants and admins can read messages
    if (!isBuyer && !isSeller && !isAdmin) {
      return {
        error: {
          status: 403,
          code: 'FORBIDDEN_OPERATION',
          message: 'You are not authorized to access messages for this offer.'
        }
      };
    }
  }

  return { offer };
}

/**
 * POST /api/v1/offers/:id/messages
 * POST /api/v1/messages/:id
 * POST /api/v1/messages (with { offerId, messageText })
 * Send a negotiation or coordination message in an offer thread.
 */
async function sendMessage(req, res, next) {
  try {
    const explicitTxId = req.query.transactionId || req.body?.transactionId;
    const explicitOfferId = req.query.offerId || req.body?.offerId;
    let rawOfferId;
    let idType = 'any';

    if (explicitTxId) {
      rawOfferId = explicitTxId;
      idType = 'transaction';
    } else if (explicitOfferId) {
      rawOfferId = explicitOfferId;
      idType = 'offer';
    } else {
      rawOfferId = req.params.id || req.params.offerId;
      idType = 'any';
    }

    if (!rawOfferId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'A valid positive integer offer ID is required.'
        }
      });
    }

    const rawMessage = req.body.messageText !== undefined ? req.body.messageText : req.body.message;
    if (rawMessage === undefined || rawMessage === null || typeof rawMessage !== 'string' || rawMessage.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'messageText is required and cannot be empty.'
        }
      });
    }

    const trimmedText = rawMessage.trim();
    if (trimmedText.length > 5000) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'messageText cannot exceed 5000 characters.'
        }
      });
    }

    // Verify access
    const { offer, error } = await getOfferAndAuthorize(req.user, rawOfferId, 'send', idType);
    if (error) {
      return res.status(error.status).json({
        success: false,
        error: {
          code: error.code,
          message: error.message
        }
      });
    }

    // Insert message into MySQL messages table
    const [insertResult] = await pool.query(
      `INSERT INTO messages (offer_id, sender_id, message_text, is_read, sent_at)
       VALUES (?, ?, ?, FALSE, CURRENT_TIMESTAMP)`,
      [offer.id, req.user.id, trimmedText]
    );

    const messageId = insertResult.insertId;

    // Fetch the inserted record for exact timestamp
    const [msgRows] = await pool.query(
      'SELECT id, offer_id, sender_id, message_text, is_read, sent_at FROM messages WHERE id = ?',
      [messageId]
    );

    const createdMsg = msgRows[0];
    const sentAtIso = createdMsg.sent_at instanceof Date
      ? createdMsg.sent_at.toISOString()
      : new Date(createdMsg.sent_at).toISOString();

    return res.status(201).json({
      success: true,
      data: {
        id: createdMsg.id,
        messageId: createdMsg.id,
        offerId: createdMsg.offer_id,
        senderId: createdMsg.sender_id,
        messageText: createdMsg.message_text,
        sentAt: sentAtIso
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/offers/:id/messages
 * GET /api/v1/messages/:id
 * GET /api/v1/messages?offerId=...
 * Retrieve sequential messages for an offer negotiation thread.
 * Query parameters:
 *   - page: positive integer (default: 1)
 *   - limit: integer between 1 and 100 (default: 50)
 */
async function getMessages(req, res, next) {
  try {
    const explicitTxId = req.query.transactionId || req.body?.transactionId;
    const explicitOfferId = req.query.offerId || req.body?.offerId;
    let rawOfferId;
    let idType = 'any';

    if (explicitTxId) {
      rawOfferId = explicitTxId;
      idType = 'transaction';
    } else if (explicitOfferId) {
      rawOfferId = explicitOfferId;
      idType = 'offer';
    } else {
      rawOfferId = req.params.id || req.params.offerId;
      idType = 'any';
    }

    if (!rawOfferId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'A valid positive integer offer ID is required.'
        }
      });
    }

    // Verify access
    const { offer, error } = await getOfferAndAuthorize(req.user, rawOfferId, 'read', idType);
    if (error) {
      return res.status(error.status).json({
        success: false,
        error: {
          code: error.code,
          message: error.message
        }
      });
    }

    // Validate pagination parameters
    const { page, limit } = req.query;
    let currentPage = 1;
    let currentLimit = 50;

    if (page !== undefined) {
      const pageStr = String(page).trim();
      if (!/^\d+$/.test(pageStr) || parseInt(pageStr, 10) < 1) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Page must be a positive integer.'
          }
        });
      }
      currentPage = parseInt(pageStr, 10);
    }

    if (limit !== undefined) {
      const limitStr = String(limit).trim();
      if (!/^\d+$/.test(limitStr)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Limit must be an integer between 1 and 100.'
          }
        });
      }
      const parsedLimit = parseInt(limitStr, 10);
      if (parsedLimit < 1 || parsedLimit > 100) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Limit must be an integer between 1 and 100.'
          }
        });
      }
      currentLimit = parsedLimit;
    }

    const offset = (currentPage - 1) * currentLimit;

    // Mark unread messages sent by the counterparty as read
    await pool.query(
      'UPDATE messages SET is_read = TRUE WHERE offer_id = ? AND sender_id != ? AND is_read = FALSE',
      [offer.id, req.user.id]
    );

    // Retrieve sequential messages using parameterized SQL
    const [rows] = await pool.query(
      `SELECT id, offer_id, sender_id, message_text, is_read, sent_at
       FROM messages
       WHERE offer_id = ?
       ORDER BY sent_at ASC, id ASC
       LIMIT ? OFFSET ?`,
      [offer.id, currentLimit, offset]
    );

    const formattedMessages = rows.map((row) => ({
      id: row.id,
      senderId: row.sender_id,
      messageText: row.message_text,
      isRead: Boolean(row.is_read),
      sentAt: row.sent_at instanceof Date
        ? row.sent_at.toISOString()
        : new Date(row.sent_at).toISOString()
    }));

    return res.status(200).json({
      success: true,
      data: formattedMessages
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/messages
 * Retrieve conversation threads for the authenticated user.
 */
async function getConversations(req, res, next) {
  try {
    const userId = req.user.id;

    const [offerRows] = await pool.query(
      `SELECT o.id AS offer_id, o.listing_id, o.buyer_id, o.status AS offer_status,
              l.title AS listing_title, l.seller_id,
              buyer.full_name AS buyer_name,
              seller.full_name AS seller_name,
              t.id AS transaction_id
       FROM offers o
       INNER JOIN listings l ON o.listing_id = l.id
       INNER JOIN users buyer ON o.buyer_id = buyer.id
       INNER JOIN users seller ON l.seller_id = seller.id
       LEFT JOIN transactions t ON t.offer_id = o.id
       WHERE o.buyer_id = ? OR l.seller_id = ?
       ORDER BY o.updated_at DESC, o.id DESC`,
      [userId, userId]
    );

    const conversations = [];

    for (const row of offerRows) {
      const isUserSeller = userId === row.seller_id;
      const counterpartyId = isUserSeller ? row.buyer_id : row.seller_id;
      const counterpartyName = isUserSeller ? row.buyer_name : row.seller_name;

      // Get last message in this thread if any
      const [msgRows] = await pool.query(
        `SELECT id, sender_id, message_text, is_read, sent_at
         FROM messages
         WHERE offer_id = ?
         ORDER BY sent_at DESC, id DESC
         LIMIT 1`,
        [row.offer_id]
      );

      // Get unread count sent by counterparty
      const [unreadRows] = await pool.query(
        `SELECT COUNT(*) AS unread_count
         FROM messages
         WHERE offer_id = ? AND sender_id != ? AND is_read = FALSE`,
        [row.offer_id, userId]
      );

      let lastMessage = null;
      if (msgRows.length > 0) {
        const last = msgRows[0];
        lastMessage = {
          id: last.id,
          senderId: last.sender_id,
          messageText: last.message_text,
          isRead: Boolean(last.is_read),
          sentAt: last.sent_at instanceof Date
            ? last.sent_at.toISOString()
            : new Date(last.sent_at).toISOString()
        };
      }

      conversations.push({
        offerId: row.offer_id,
        transactionId: row.transaction_id || null,
        offerStatus: row.offer_status,
        listing: {
          id: row.listing_id,
          title: row.listing_title
        },
        counterparty: {
          id: counterpartyId,
          fullName: counterpartyName
        },
        lastMessage,
        unreadCount: unreadRows[0].unread_count
      });
    }

    return res.status(200).json({
      success: true,
      data: conversations
    });
  } catch (err) {
    next(err);
  }
}

// Routes on /api/v1/messages
router.get('/', authenticate, (req, res, next) => {
  if (req.query.offerId || req.query.transactionId) {
    return getMessages(req, res, next);
  }
  return getConversations(req, res, next);
});

router.post('/', authenticate, sendMessage);
router.get('/:id', authenticate, getMessages);
router.post('/:id', authenticate, sendMessage);

module.exports = {
  router,
  sendMessage,
  getMessages,
  getConversations
};
