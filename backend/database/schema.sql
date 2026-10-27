-- =============================================================================
-- CampusSwap Database Schema Definition (MySQL 8.0+ / InnoDB)
-- File: backend/database/schema.sql
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS reports;
DROP TABLE IF EXISTS wishlists;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS offers;
DROP TABLE IF EXISTS listing_images;
DROP TABLE IF EXISTS listings;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS email_verifications;
DROP TABLE IF EXISTS users;
SET FOREIGN_KEY_CHECKS = 1;

-- -----------------------------------------------------------------------------
-- 1. USERS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    phone_number VARCHAR(20) DEFAULT NULL,
    department VARCHAR(100) DEFAULT NULL,
    role ENUM('STUDENT', 'ADMIN') NOT NULL DEFAULT 'STUDENT',
    status ENUM('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'PENDING_VERIFICATION',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT uq_users_email UNIQUE (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 2. EMAIL_VERIFICATIONS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE email_verifications (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    otp_code VARCHAR(6) NOT NULL,
    expires_at DATETIME NOT NULL,
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_verifications_user 
        FOREIGN KEY (user_id) REFERENCES users(id) 
        ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_verifications_user_lookup (user_id, otp_code, is_used)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 3. CATEGORIES TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE categories (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    description VARCHAR(255) DEFAULT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_categories_name UNIQUE (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 4. LISTINGS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE listings (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    seller_id BIGINT UNSIGNED NOT NULL,
    category_id INT UNSIGNED NOT NULL,
    title VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    mode ENUM('SELL', 'BARTER', 'FREE') NOT NULL,
    price DECIMAL(10,2) DEFAULT NULL,
    is_negotiable BOOLEAN NOT NULL DEFAULT FALSE,
    barter_preferences VARCHAR(255) DEFAULT NULL,
    item_condition ENUM('NEW', 'LIKE_NEW', 'GOOD', 'FAIR') NOT NULL DEFAULT 'GOOD',
    pickup_location VARCHAR(150) NOT NULL,
    status ENUM('ACTIVE', 'RESERVED', 'COMPLETED', 'CANCELLED', 'DELETED_BY_ADMIN') NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_listings_seller 
        FOREIGN KEY (seller_id) REFERENCES users(id) 
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_listings_category 
        FOREIGN KEY (category_id) REFERENCES categories(id) 
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_listing_price 
        CHECK (
            (mode = 'SELL' AND price IS NOT NULL AND price > 0.00) OR 
            (mode = 'FREE' AND price = 0.00) OR 
            (mode = 'BARTER' AND (price IS NULL OR price >= 0.00))
        ),
    CONSTRAINT chk_barter_desc 
        CHECK (mode != 'BARTER' OR barter_preferences IS NOT NULL),
    INDEX idx_listings_catalog (status, category_id, created_at DESC),
    INDEX idx_listings_mode_price (status, mode, price),
    INDEX idx_listings_seller (seller_id, status),
    FULLTEXT INDEX ft_listings_search (title, description)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 5. LISTING_IMAGES TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE listing_images (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    listing_id BIGINT UNSIGNED NOT NULL,
    image_url VARCHAR(500) NOT NULL,
    display_order TINYINT UNSIGNED NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_images_listing 
        FOREIGN KEY (listing_id) REFERENCES listings(id) 
        ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_images_listing (listing_id, display_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 6. OFFERS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE offers (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    listing_id BIGINT UNSIGNED NOT NULL,
    buyer_id BIGINT UNSIGNED NOT NULL,
    offer_type ENUM('PURCHASE', 'BARTER', 'CLAIM') NOT NULL,
    offered_price DECIMAL(10,2) DEFAULT NULL,
    offered_listing_id BIGINT UNSIGNED DEFAULT NULL,
    cash_difference DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    counter_price DECIMAL(10,2) DEFAULT NULL,
    message VARCHAR(500) DEFAULT NULL,
    status ENUM('PENDING', 'COUNTERED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'CANCELLED_BY_SYSTEM') NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_offers_listing 
        FOREIGN KEY (listing_id) REFERENCES listings(id) 
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_offers_buyer 
        FOREIGN KEY (buyer_id) REFERENCES users(id) 
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_offers_barter_listing 
        FOREIGN KEY (offered_listing_id) REFERENCES listings(id) 
        ON DELETE RESTRICT ON UPDATE CASCADE,
    -- Note: chk_offer_self (offered_listing_id != listing_id) is enforced at application/API layer
    -- because MySQL 8 prohibits CHECK constraints on columns participating in FKs with ON UPDATE CASCADE (Error 3823).
    CONSTRAINT chk_offer_cash_diff 
        CHECK (cash_difference >= 0.00),
    CONSTRAINT chk_offer_purchase_price 
        CHECK (offer_type != 'PURCHASE' OR offered_price > 0.00),
    INDEX idx_offers_listing_status (listing_id, status),
    INDEX idx_offers_buyer_status (buyer_id, status),
    INDEX idx_offers_barter_item (offered_listing_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 7. TRANSACTIONS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE transactions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    offer_id BIGINT UNSIGNED NOT NULL,
    listing_id BIGINT UNSIGNED NOT NULL,
    seller_id BIGINT UNSIGNED NOT NULL,
    buyer_id BIGINT UNSIGNED NOT NULL,
    transaction_type ENUM('SALE', 'BARTER', 'FREE_GIVEAWAY') NOT NULL,
    final_price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    barter_listing_id BIGINT UNSIGNED DEFAULT NULL,
    status ENUM('PENDING_MEETUP', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING_MEETUP',
    completed_at DATETIME DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_transactions_offer UNIQUE (offer_id),
    CONSTRAINT fk_transactions_offer 
        FOREIGN KEY (offer_id) REFERENCES offers(id) 
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_transactions_listing 
        FOREIGN KEY (listing_id) REFERENCES listings(id) 
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_transactions_seller 
        FOREIGN KEY (seller_id) REFERENCES users(id) 
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_transactions_buyer 
        FOREIGN KEY (buyer_id) REFERENCES users(id) 
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_transactions_barter_listing 
        FOREIGN KEY (barter_listing_id) REFERENCES listings(id) 
        ON DELETE RESTRICT ON UPDATE CASCADE,
    -- Note: chk_tx_parties (seller_id != buyer_id) and chk_tx_barter_item (barter_listing_id required for BARTER)
    -- are enforced at API layer because MySQL 8 prohibits CHECK constraints on columns with ON UPDATE CASCADE/SET NULL (Error 3823).
    CONSTRAINT chk_tx_final_price 
        CHECK (final_price >= 0.00),
    INDEX idx_transactions_user (seller_id, buyer_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 8. REVIEWS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE reviews (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    transaction_id BIGINT UNSIGNED NOT NULL,
    reviewer_id BIGINT UNSIGNED NOT NULL,
    reviewee_id BIGINT UNSIGNED NOT NULL,
    rating TINYINT UNSIGNED NOT NULL,
    comment TEXT DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_reviews_tx_user UNIQUE (transaction_id, reviewer_id),
    CONSTRAINT fk_reviews_transaction 
        FOREIGN KEY (transaction_id) REFERENCES transactions(id) 
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_reviews_reviewer 
        FOREIGN KEY (reviewer_id) REFERENCES users(id) 
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_reviews_reviewee 
        FOREIGN KEY (reviewee_id) REFERENCES users(id) 
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_rating_range CHECK (rating BETWEEN 1 AND 5),
    -- Note: chk_review_self (reviewer_id != reviewee_id) is enforced at application/API layer (Error 3823).
    INDEX idx_reviews_reviewee (reviewee_id, rating)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 9. MESSAGES TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE messages (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    offer_id BIGINT UNSIGNED NOT NULL,
    sender_id BIGINT UNSIGNED NOT NULL,
    message_text TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_messages_offer 
        FOREIGN KEY (offer_id) REFERENCES offers(id) 
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_messages_sender 
        FOREIGN KEY (sender_id) REFERENCES users(id) 
        ON DELETE RESTRICT ON UPDATE CASCADE,
    INDEX idx_messages_thread (offer_id, sent_at ASC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 10. WISHLISTS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE wishlists (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    listing_id BIGINT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_wishlists_user_item UNIQUE (user_id, listing_id),
    CONSTRAINT fk_wishlists_user 
        FOREIGN KEY (user_id) REFERENCES users(id) 
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_wishlists_listing 
        FOREIGN KEY (listing_id) REFERENCES listings(id) 
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 11. REPORTS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE reports (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    reporter_id BIGINT UNSIGNED NOT NULL,
    reported_user_id BIGINT UNSIGNED DEFAULT NULL,
    listing_id BIGINT UNSIGNED DEFAULT NULL,
    reason ENUM('PROHIBITED_ITEM', 'INAPPROPRIATE_CONTENT', 'SUSPECTED_SCAM', 'HARASSMENT', 'DUPLICATE_SPAM') NOT NULL,
    details TEXT NOT NULL,
    status ENUM('PENDING', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED') NOT NULL DEFAULT 'PENDING',
    admin_notes TEXT DEFAULT NULL,
    resolved_by BIGINT UNSIGNED DEFAULT NULL,
    resolved_at DATETIME DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_reports_reporter 
        FOREIGN KEY (reporter_id) REFERENCES users(id) 
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_reports_target_user 
        FOREIGN KEY (reported_user_id) REFERENCES users(id) 
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_reports_listing 
        FOREIGN KEY (listing_id) REFERENCES listings(id) 
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_reports_admin 
        FOREIGN KEY (resolved_by) REFERENCES users(id) 
        ON DELETE SET NULL ON UPDATE CASCADE,
    -- Note: chk_report_target (reported_user_id IS NOT NULL OR listing_id IS NOT NULL) is enforced at API layer (Error 3823).
    INDEX idx_reports_status (status, created_at ASC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
