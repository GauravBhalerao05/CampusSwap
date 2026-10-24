# CampusSwap — REST API Contract Specification

**API Version:** `v1`  
**Base URL:** `/api/v1`  
**Format:** JSON (`Content-Type: application/json`)  
**Target Backend:** Node.js + Express.js + MySQL 8 (InnoDB)  
**Reference Documents:** `docs/PROJECT_SPEC.md`, `docs/DATABASE_SCHEMA.md`  

---

## 1. Global Conventions & Standards

### 1.1 Standard Response Envelopes

All endpoints return uniform response payloads.

#### Success Envelope
```json
{
  "success": true,
  "data": {}
}
```

#### Error Envelope
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE_STRING",
    "message": "Human-readable explanation of error condition"
  }
}
```

### 1.2 Common HTTP Status & Error Codes

| HTTP Status | Error Code | Description |
| :--- | :--- | :--- |
| `400 Bad Request` | `VALIDATION_ERROR` | Request payload fails schema validation, regex checks, or required fields. |
| `400 Bad Request` | `INVALID_STATE_TRANSITION` | Attempted state modification is disallowed by the entity state machine. |
| `401 Unauthorized` | `UNAUTHENTICATED` | Missing, malformed, or expired JWT bearer token. |
| `403 Forbidden` | `FORBIDDEN_OPERATION` | Insufficient role permissions or user does not own the requested resource. |
| `403 Forbidden` | `ACCOUNT_SUSPENDED` | Action blocked because student profile is currently suspended. |
| `404 Not Found` | `RESOURCE_NOT_FOUND` | Target entity does not exist in the database. |
| `409 Conflict` | `STATE_CONFLICT` | Resource was modified concurrently (e.g., item already claimed or reserved). |
| `409 Conflict` | `DUPLICATE_ENTITY` | Unique constraint violated (e.g., email already registered, duplicate bookmark). |
| `500 Internal Error` | `INTERNAL_SERVER_ERROR` | Unhandled database error or unexpected server exception. |

### 1.3 Authentication & Authorization Mechanism
- **Token Delivery:** JWT transmitted in standard HTTP Authorization header: `Authorization: Bearer <jwt_token>`.
- **JWT Payload Structure:**
  ```json
  {
    "userId": 42,
    "email": "alex.smith@univ.edu",
    "role": "STUDENT"
  }
  ```
- **Permission Checking:**
  - `Public`: No authorization required.
  - `Authenticated (Student/Admin)`: Valid JWT required; `users.status == 'ACTIVE'`.
  - `Resource Owner`: Verified by comparing `JWT.userId` against resource owner ID (`seller_id`, `buyer_id`, or `reviewer_id`).
  - `Administrator`: Verified by inspecting `JWT.role === 'ADMIN'`.

### 1.4 Concurrency & Duplicate Prevention Protocol
All reservation endpoints (`/listings/:id/claim`, `/offers/:id/accept`) implement database row-level locking:
1. `START TRANSACTION;`
2. Acquire pessimistic lock (`SELECT ... FOR UPDATE`) on target listing:
   - For single-item workflows (`SELL` offer or `FREE` claim): lock `target_listing_id`.
   - For barter proposals: sort IDs and lock `LEAST(target_listing_id, offered_listing_id)` first, followed by `GREATEST(target_listing_id, offered_listing_id)` to eliminate deadlocks.
3. Verify that listing status is `'ACTIVE'` (and for barter, both listings are `'ACTIVE'` and owned by the respective parties). If either is not active, issue `ROLLBACK` and respond with `409 Conflict` (`STATE_CONFLICT`).
4. Update listing status to `'RESERVED'`, set offer status to `'ACCEPTED'`, invalidate competing pending offers on both listings to `'CANCELLED_BY_SYSTEM'`, insert the official transaction record into `transactions` with status `'PENDING_MEETUP'`, and `COMMIT`.

---

## 2. Authentication & Account Lifecycle Endpoints

### 2.1 Register New Account
- **Method & Path:** `POST /api/v1/auth/register`
- **Access Level:** Public
- **Business Rules:**
  - `email` must conform to approved college domain pattern (e.g., regex `^[a-zA-Z0-9._%+-]+@([a-zA-Z0-9-]+\.)*univ\.edu$`).
  - Password must be at least 8 characters and contain at least 1 uppercase letter, 1 number, and 1 special symbol.
  - Automatically creates a row in `users` with `status = 'PENDING_VERIFICATION'` and dispatches a 6-digit OTP code stored in `email_verifications` (15-minute expiration).

#### Request Example
```json
{
  "email": "alex.smith@univ.edu",
  "password": "Password123!",
  "fullName": "Alex Smith",
  "phoneNumber": "+1-555-0199",
  "department": "Computer Science"
}
```

#### Success Response (`201 Created`)
```json
{
  "success": true,
  "data": {
    "userId": 105,
    "email": "alex.smith@univ.edu",
    "status": "PENDING_VERIFICATION",
    "message": "Registration successful. A 6-digit verification code has been dispatched to your college email address."
  }
}
```

#### Error Responses
- `400 Bad Request`: `{"success": false, "error": {"code": "INVALID_EMAIL_DOMAIN", "message": "Registration requires an authorized college email address ending with univ.edu."}}`
- `409 Conflict`: `{"success": false, "error": {"code": "DUPLICATE_ENTITY", "message": "An account with this email address already exists."}}`

---

### 2.2 Verify Registration OTP
- **Method & Path:** `POST /api/v1/auth/verify-email`
- **Access Level:** Public
- **Business Rules:**
  - Validates 6-digit `otpCode` against `email_verifications`.
  - Checks `is_used = FALSE` and `expires_at > NOW()`.
  - Upon success, marks token `is_used = TRUE` and updates `users.status = 'ACTIVE'`.

#### Request Example
```json
{
  "email": "alex.smith@univ.edu",
  "otpCode": "849201"
}
```

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "verified": true,
    "message": "Institutional email verified successfully. You may now log in."
  }
}
```

#### Error Responses
- `400 Bad Request`: `{"success": false, "error": {"code": "INVALID_OTP", "message": "The verification code provided is invalid or has expired."}}`

---

### 2.3 User Login
- **Method & Path:** `POST /api/v1/auth/login`
- **Access Level:** Public
- **Business Rules:**
  - Compares password against salted `password_hash` via bcrypt.
  - User status must be `'ACTIVE'`. Rejects `'PENDING_VERIFICATION'` (needs OTP) and `'SUSPENDED'` accounts.

#### Request Example
```json
{
  "email": "alex.smith@univ.edu",
  "password": "Password123!"
}
```

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": 105,
      "email": "alex.smith@univ.edu",
      "fullName": "Alex Smith",
      "role": "STUDENT",
      "status": "ACTIVE",
      "department": "Computer Science"
    }
  }
}
```

#### Error Responses
- `401 Unauthorized`: `{"success": false, "error": {"code": "INVALID_CREDENTIALS", "message": "Invalid email or password."}}`
- `403 Forbidden`: `{"success": false, "error": {"code": "ACCOUNT_SUSPENDED", "message": "This account has been suspended by campus moderators."}}`

---

### 2.4 Get Current User Profile
- **Method & Path:** `GET /api/v1/auth/me`
- **Access Level:** Authenticated (`STUDENT` or `ADMIN`)

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "id": 105,
    "email": "alex.smith@univ.edu",
    "fullName": "Alex Smith",
    "phoneNumber": "+1-555-0199",
    "department": "Computer Science",
    "role": "STUDENT",
    "status": "ACTIVE",
    "createdAt": "2026-10-24T10:00:00.000Z"
  }
}
```

---

### 2.5 User Logout
- **Method & Path:** `POST /api/v1/auth/logout`
- **Access Level:** Authenticated
- **Business Rules:** JWT authentication is stateless in this college DBMS architecture; this endpoint provides an acknowledgment for the client application to discard and clear the stored bearer token locally. No server-side blacklist table is maintained.

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "message": "Logged out successfully. Please clear your local bearer token."
  }
}
```

---

## 3. Categories Endpoints

### 3.1 List Active Categories
- **Method & Path:** `GET /api/v1/categories`
- **Access Level:** Public

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Textbooks",
      "description": "Course books, study materials, and reference guides",
      "isActive": true
    },
    {
      "id": 2,
      "name": "Electronics & Gadgets",
      "description": "Calculators, lab equipment, cables, and peripherals",
      "isActive": true
    }
  ]
}
```

---

## 4. Listings Endpoints

### 4.1 Search & Filter Listings (Catalog)
- **Method & Path:** `GET /api/v1/listings`
- **Access Level:** Public
- **Query Parameters:**
  - `q` (string): Keyword text search across `title` and `description`.
  - `categoryId` (integer): Filter by category.
  - `mode` (`SELL` | `BARTER` | `FREE`): Filter by exchange mode.
  - `condition` (`NEW` | `LIKE_NEW` | `GOOD` | `FAIR`): Filter by condition.
  - `minPrice` (decimal): Minimum price filter.
  - `maxPrice` (decimal): Maximum price filter.
  - `sortBy` (`newest` | `price_asc` | `price_desc` | `rating_desc`): Default `newest`.
  - `page` (integer): Page number (default `1`).
  - `limit` (integer): Items per page (default `20`, max `50`).

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": 501,
        "title": "Introduction to Algorithms (CLRS 3rd Ed)",
        "description": "Clean condition textbook with minimal pencil annotations.",
        "mode": "SELL",
        "price": "45.00",
        "isNegotiable": true,
        "barterPreferences": null,
        "itemCondition": "GOOD",
        "pickupLocation": "Library Foyer / Main Stairs",
        "status": "ACTIVE",
        "category": {
          "id": 1,
          "name": "Textbooks"
        },
        "seller": {
          "id": 88,
          "fullName": "Sarah Connor",
          "department": "Computer Science",
          "avgRating": 4.85,
          "totalReviews": 12
        },
        "primaryImageUrl": "https://campusswap.local/uploads/clrs-front.jpg",
        "createdAt": "2026-10-24T18:30:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 5,
      "totalItems": 98,
      "limit": 20
    }
  }
}
```

---

### 4.2 Create New Listing
- **Method & Path:** `POST /api/v1/listings`
- **Access Level:** Authenticated (`STUDENT`)
- **Validation & Business Rules:**
  - `title`: String 5–100 chars.
  - `description`: String 10–2000 chars.
  - `mode`: Must be `'SELL'`, `'BARTER'`, or `'FREE'`.
  - If `mode === 'SELL'`: `price` is required, must be $> 0.00$.
  - If `mode === 'FREE'`: `price` is forced to `0.00` or `null`.
  - If `mode === 'BARTER'`: `barterPreferences` is required.
  - `imageUrls`: Array of 1 to 5 valid URL strings.

#### Request Example (Mode: SELL)
```json
{
  "categoryId": 1,
  "title": "Introduction to Algorithms (CLRS 3rd Ed)",
  "description": "Clean condition textbook with minimal pencil annotations. Perfect for CS201.",
  "mode": "SELL",
  "price": 45.00,
  "isNegotiable": true,
  "barterPreferences": null,
  "itemCondition": "GOOD",
  "pickupLocation": "Library Foyer / Main Stairs",
  "imageUrls": [
    "https://campusswap.local/uploads/clrs-front.jpg",
    "https://campusswap.local/uploads/clrs-back.jpg"
  ]
}
```

#### Success Response (`201 Created`)
```json
{
  "success": true,
  "data": {
    "id": 501,
    "sellerId": 105,
    "title": "Introduction to Algorithms (CLRS 3rd Ed)",
    "mode": "SELL",
    "price": "45.00",
    "status": "ACTIVE",
    "createdAt": "2026-10-24T21:45:00.000Z"
  }
}
```

#### Error Responses
- `400 Bad Request`: `{"success": false, "error": {"code": "VALIDATION_ERROR", "message": "Listings in SELL mode require a valid price greater than zero."}}`

---

### 4.3 Get Listing Details by ID
- **Method & Path:** `GET /api/v1/listings/:id`
- **Access Level:** Public

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "id": 501,
    "title": "Introduction to Algorithms (CLRS 3rd Ed)",
    "description": "Clean condition textbook with minimal pencil annotations. Perfect for CS201.",
    "mode": "SELL",
    "price": "45.00",
    "isNegotiable": true,
    "barterPreferences": null,
    "itemCondition": "GOOD",
    "pickupLocation": "Library Foyer / Main Stairs",
    "status": "ACTIVE",
    "category": {
      "id": 1,
      "name": "Textbooks"
    },
    "seller": {
      "id": 105,
      "fullName": "Alex Smith",
      "department": "Computer Science",
      "avgRating": 4.90,
      "totalReviews": 7
    },
    "images": [
      {
        "id": 1001,
        "imageUrl": "https://campusswap.local/uploads/clrs-front.jpg",
        "displayOrder": 1
      },
      {
        "id": 1002,
        "imageUrl": "https://campusswap.local/uploads/clrs-back.jpg",
        "displayOrder": 2
      }
    ],
    "createdAt": "2026-10-24T21:45:00.000Z",
    "updatedAt": "2026-10-24T21:45:00.000Z"
  }
}
```

#### Error Responses
- `404 Not Found`: `{"success": false, "error": {"code": "RESOURCE_NOT_FOUND", "message": "Listing does not exist."}}`

---

### 4.4 Update Listing
- **Method & Path:** `PUT /api/v1/listings/:id`
- **Access Level:** Authenticated (Resource Owner only)
- **Business Rules:** Listings can only be modified while in `'ACTIVE'` status. Cannot change `mode` once published.

#### Request Example
```json
{
  "title": "Introduction to Algorithms (CLRS 3rd Ed) - Reduced Price",
  "description": "Clean condition textbook. Reduced price for quick sale before midterms.",
  "price": 38.00,
  "isNegotiable": false,
  "pickupLocation": "Student Center 2nd Floor"
}
```

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "id": 501,
    "title": "Introduction to Algorithms (CLRS 3rd Ed) - Reduced Price",
    "price": "38.00",
    "status": "ACTIVE",
    "updatedAt": "2026-10-24T22:00:00.000Z"
  }
}
```

#### Error Responses
- `403 Forbidden`: `{"success": false, "error": {"code": "FORBIDDEN_OPERATION", "message": "You are not authorized to edit this listing."}}`
- `409 Conflict`: `{"success": false, "error": {"code": "INVALID_STATE_TRANSITION", "message": "Only ACTIVE listings can be updated."}}`

---

### 4.5 Delete / Cancel Listing
- **Method & Path:** `DELETE /api/v1/listings/:id`
- **Access Level:** Authenticated (Resource Owner or Admin)
- **Business Rules:**
  - Soft-deletes the listing by updating `status = 'CANCELLED'` (or `'DELETED_BY_ADMIN'`).
  - Cannot be cancelled if currently in `'RESERVED'` or `'COMPLETED'` state.
  - Automatically invalidates any associated `'PENDING'` offers to `'CANCELLED_BY_SYSTEM'`.

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "id": 501,
    "status": "CANCELLED",
    "message": "Listing successfully cancelled."
  }
}
```

---

## 5. Free-Item Claims Endpoints

### 5.1 Claim a Free Item
- **Method & Path:** `POST /api/v1/listings/:id/claim`
- **Access Level:** Authenticated (`STUDENT`)
- **Business Rules & Concurrency Control:**
  - Listing must have `mode === 'FREE'` and `price === "0.00"`.
  - Proposer cannot be the seller (`buyer_id !== seller_id`).
  - Executed inside a pessimistic lock transaction:
    ```sql
    START TRANSACTION;
    SELECT id, seller_id, mode, price, status FROM listings WHERE id = :id FOR UPDATE;
    -- Verify status == 'ACTIVE' AND mode == 'FREE'
    -- Update listings SET status = 'RESERVED' WHERE id = :id;
    -- Insert into offers (listing_id, buyer_id, offer_type, status) VALUES (:id, :claimer_id, 'CLAIM', 'ACCEPTED');
    -- Invalidate any pending inquiries/offers on this listing:
    -- UPDATE offers SET status = 'CANCELLED_BY_SYSTEM' WHERE listing_id = :id AND id != LAST_INSERT_ID();
    -- Insert into transactions (offer_id, listing_id, seller_id, buyer_id, transaction_type, final_price, status) 
    -- VALUES (LAST_INSERT_ID(), :id, :seller_id, :claimer_id, 'FREE_GIVEAWAY', 0.00, 'PENDING_MEETUP');
    COMMIT;
    ```

#### Request Example
```json
{
  "message": "Hi, I am taking Chem 101 this semester and would love to pick up your lab goggles!"
}
```

#### Success Response (`201 Created`)
```json
{
  "success": true,
  "data": {
    "transactionId": 801,
    "listingId": 505,
    "status": "PENDING_MEETUP",
    "pickupLocation": "Science Building Room 302",
    "seller": {
      "id": 92,
      "fullName": "Maria Garcia",
      "phoneNumber": "+1-555-0812"
    },
    "message": "Item claimed successfully! Please coordinate pickup with the student."
  }
}
```

#### Error Responses
- `400 Bad Request`: `{"success": false, "error": {"code": "INVALID_LISTING_MODE", "message": "Only listings marked with mode FREE can be claimed."}}`
- `400 Bad Request`: `{"success": false, "error": {"code": "SELF_CLAIM_DISALLOWED", "message": "You cannot claim your own listing."}}`
- `409 Conflict`: `{"success": false, "error": {"code": "STATE_CONFLICT", "message": "This item has already been claimed or is no longer active."}}`

---

## 6. Offers & Negotiations Endpoints

### 6.1 Create Purchase Offer (Mode: SELL)
- **Method & Path:** `POST /api/v1/listings/:id/offers`
- **Access Level:** Authenticated (`STUDENT`)
- **Business Rules:**
  - Target listing must be `status === 'ACTIVE'` and `mode === 'SELL'`.
  - Proposer cannot be the seller.
  - `offeredPrice` must be $> 0.00$.

#### Request Example
```json
{
  "offerType": "PURCHASE",
  "offeredPrice": 40.00,
  "message": "Would you consider $40? I can meet today at the library."
}
```

#### Success Response (`201 Created`)
```json
{
  "success": true,
  "data": {
    "offerId": 301,
    "listingId": 501,
    "offerType": "PURCHASE",
    "offeredPrice": "40.00",
    "status": "PENDING",
    "createdAt": "2026-10-24T22:15:00.000Z"
  }
}
```

#### Error Responses
- `400 Bad Request`: `{"success": false, "error": {"code": "SELF_OFFER_DISALLOWED", "message": "You cannot make an offer on your own listing."}}`
- `409 Conflict`: `{"success": false, "error": {"code": "LISTING_NOT_ACTIVE", "message": "Offers can only be placed on ACTIVE listings."}}`

---

### 6.2 Propose Barter Exchange (Mode: BARTER or SELL)
- **Method & Path:** `POST /api/v1/listings/:id/barter-proposals`
- **Access Level:** Authenticated (`STUDENT`)
- **Business Rules:**
  - For the MVP, only listing-to-listing barter is supported; custom-description barter without an active listing is deferred.
  - `offeredListingId` is mandatory, must belong to the requesting user (`seller_id === JWT.userId`), and must currently hold `status === 'ACTIVE'`.
  - Proposer cannot barter for their own listing (`target.seller_id !== JWT.userId`).
  - `cashDifference` must be $\ge 0.00$ (default `0.00`).

#### Request Example
```json
{
  "offeredListingId": 512,
  "cashDifference": 5.00,
  "message": "I'd like to trade my TI-84 Plus Graphing Calculator plus $5 cash for your drawing kit."
}
```

#### Success Response (`201 Created`)
```json
{
  "success": true,
  "data": {
    "offerId": 302,
    "targetListingId": 501,
    "offeredListingId": 512,
    "offerType": "BARTER",
    "cashDifference": "5.00",
    "status": "PENDING",
    "createdAt": "2026-10-24T22:20:00.000Z"
  }
}
```

#### Error Responses
- `400 Bad Request`: `{"success": false, "error": {"code": "INVALID_OFFERED_ITEM", "message": "The item offered for barter must be an ACTIVE listing owned by you."}}`

---

### 6.3 List Offers on a Listing
- **Method & Path:** `GET /api/v1/listings/:id/offers`
- **Access Level:** Authenticated (Listing Owner only)

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": [
    {
      "id": 301,
      "offerType": "PURCHASE",
      "offeredPrice": "40.00",
      "counterPrice": null,
      "cashDifference": "0.00",
      "status": "PENDING",
      "message": "Would you consider $40?",
      "buyer": {
        "id": 105,
        "fullName": "Alex Smith",
        "avgRating": 4.90
      },
      "createdAt": "2026-10-24T22:15:00.000Z"
    }
  ]
}
```

---

### 6.4 Submit Counteroffer
- **Method & Path:** `POST /api/v1/offers/:id/counter`
- **Access Level:** Authenticated (Listing Owner only)
- **Business Rules:**
  - Offer must be in `'PENDING'` status.
  - `counterPrice` must be $> 0.00$.
  - Updates offer status to `'COUNTERED'`.

#### Request Example
```json
{
  "counterPrice": 42.50,
  "message": "I can meet you in the middle at $42.50."
}
```

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "offerId": 301,
    "status": "COUNTERED",
    "counterPrice": "42.50",
    "updatedAt": "2026-10-24T22:25:00.000Z"
  }
}
```

---

### 6.5 Accept Offer / Counteroffer
- **Method & Path:** `PATCH /api/v1/offers/:id/accept`
- **Access Level:** Authenticated (Listing Owner for direct offers; Buyer for counteroffers)
- **Business Rules & Concurrency Control:**
  - Executes within a pessimistic transaction lock (`SELECT ... FOR UPDATE`).
  - To prevent deadlocks in dual-item barter agreements, row locks on `listings` are acquired in ascending primary key order: `LEAST(listing_id, offered_listing_id)` followed by `GREATEST(listing_id, offered_listing_id)`.
  - Verifies that all involved listings currently hold `status === 'ACTIVE'`.
  - Target listing status transitions to `'RESERVED'`.
  - If a barter offer, `offered_listing_id` status also transitions to `'RESERVED'`.
  - Offer status transitions to `'ACCEPTED'`.
  - All other pending offers on the target (and barter) listing are transitioned to `'CANCELLED_BY_SYSTEM'`.
  - Creates corresponding row in `transactions` with status `'PENDING_MEETUP'`. For `PURCHASE` offers, `final_price` records the agreed sale amount; for `BARTER` offers, `final_price` preserves the agreed `cash_difference` (or `0.00`).

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "transactionId": 802,
    "offerId": 301,
    "listingId": 501,
    "agreedPrice": "42.50",
    "transactionStatus": "PENDING_MEETUP",
    "message": "Offer accepted! Item is now RESERVED. Coordinate meetup for handover."
  }
}
```

#### Error Responses
- `409 Conflict`: `{"success": false, "error": {"code": "STATE_CONFLICT", "message": "Cannot accept offer. Listing is no longer ACTIVE or has already been reserved."}}`

---

### 6.6 Reject Offer
- **Method & Path:** `PATCH /api/v1/offers/:id/reject`
- **Access Level:** Authenticated (Listing Owner)
- **Business Rules:** Offer must be `'PENDING'` or `'COUNTERED'`. Transitions offer to `'REJECTED'`.

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "offerId": 301,
    "status": "REJECTED"
  }
}
```

---

### 6.7 Withdraw Offer
- **Method & Path:** `PATCH /api/v1/offers/:id/withdraw`
- **Access Level:** Authenticated (Offer Proposer / Buyer)
- **Business Rules:** Proposer can withdraw an offer while still `'PENDING'` or `'COUNTERED'`. Transitions to `'WITHDRAWN'`.

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "offerId": 301,
    "status": "WITHDRAWN"
  }
}
```

---

## 7. Transactions Endpoints

### 7.1 Get User Transaction History
- **Method & Path:** `GET /api/v1/transactions`
- **Access Level:** Authenticated (`STUDENT`)
- **Query Parameters:** `role` (`seller` | `buyer` | `all`), `status` (`PENDING_MEETUP` | `COMPLETED` | `CANCELLED`).

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": [
    {
      "id": 802,
      "transactionType": "SALE",
      "finalPrice": "42.50",
      "status": "PENDING_MEETUP",
      "listing": {
        "id": 501,
        "title": "Introduction to Algorithms (CLRS 3rd Ed)"
      },
      "counterparty": {
        "id": 105,
        "fullName": "Alex Smith",
        "phoneNumber": "+1-555-0199"
      },
      "createdAt": "2026-10-24T22:30:00.000Z",
      "completedAt": null
    }
  ]
}
```

---

### 7.2 Get Transaction Details
- **Method & Path:** `GET /api/v1/transactions/:id`
- **Access Level:** Authenticated (Transaction Participants or Admin)

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "id": 802,
    "transactionType": "SALE",
    "finalPrice": "42.50",
    "status": "PENDING_MEETUP",
    "listing": {
      "id": 501,
      "title": "Introduction to Algorithms (CLRS 3rd Ed)",
      "pickupLocation": "Library Foyer / Main Stairs"
    },
    "seller": {
      "id": 88,
      "fullName": "Sarah Connor"
    },
    "buyer": {
      "id": 105,
      "fullName": "Alex Smith"
    },
    "barterListing": null,
    "createdAt": "2026-10-24T22:30:00.000Z",
    "completedAt": null
  }
}
```

---

### 7.3 Confirm Handover Completion
- **Method & Path:** `POST /api/v1/transactions/:id/complete`
- **Access Level:** Authenticated (Seller or Claimer)
- **Business Rules:**
  - Transaction must be `'PENDING_MEETUP'`.
  - Updates `transactions.status = 'COMPLETED'` and records `completed_at = CURRENT_TIMESTAMP`.
  - Updates associated listing(s) to `'COMPLETED'`. Unlocks review submission.

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "id": 802,
    "status": "COMPLETED",
    "completedAt": "2026-10-24T23:00:00.000Z",
    "message": "Transaction marked as completed! You can now rate your peer."
  }
}
```

---

### 7.4 Abort / Cancel Meetup
- **Method & Path:** `POST /api/v1/transactions/:id/cancel`
- **Access Level:** Authenticated (Transaction Participants or Admin)
- **Business Rules:**
  - Transaction must be in `'PENDING_MEETUP'`.
  - Reverts `transactions.status = 'CANCELLED'`.
  - Reverts associated `listings.status` back to `'ACTIVE'` so they can be re-listed.

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "id": 802,
    "status": "CANCELLED",
    "message": "Transaction cancelled. Listings have been restored to ACTIVE."
  }
}
```

---

## 8. Reviews Endpoints

### 8.1 Submit Review for Completed Transaction
- **Method & Path:** `POST /api/v1/reviews`
- **Access Level:** Authenticated (Transaction Participants only)
- **Business Rules:**
  - Transaction must have `status === 'COMPLETED'`.
  - Requesting user must be either `seller_id` or `buyer_id`.
  - Cannot review yourself.
  - Enforces single review per transaction via composite unique check (`transaction_id, reviewer_id`).
  - `rating`: Integer between 1 and 5.

#### Request Example
```json
{
  "transactionId": 802,
  "rating": 5,
  "comment": "Punctual meetup at the library, book was exactly in the described condition!"
}
```

#### Success Response (`201 Created`)
```json
{
  "success": true,
  "data": {
    "reviewId": 401,
    "transactionId": 802,
    "revieweeId": 88,
    "rating": 5,
    "comment": "Punctual meetup at the library, book was exactly in the described condition!",
    "createdAt": "2026-10-24T23:15:00.000Z"
  }
}
```

#### Error Responses
- `400 Bad Request`: `{"success": false, "error": {"code": "RATING_OUT_OF_BOUNDS", "message": "Rating must be an integer between 1 and 5."}}`
- `409 Conflict`: `{"success": false, "error": {"code": "DUPLICATE_ENTITY", "message": "You have already submitted a review for this transaction."}}`

---

## 9. Messages Endpoints *(Optional Scope)*

### 9.1 Send Negotiation Message
- **Method & Path:** `POST /api/v1/offers/:id/messages`
- **Access Level:** Authenticated (Offer Proposer or Target Listing Seller)

#### Request Example
```json
{
  "messageText": "Are you available to meet near the library entrance at 4 PM?"
}
```

#### Success Response (`201 Created`)
```json
{
  "success": true,
  "data": {
    "messageId": 701,
    "offerId": 301,
    "senderId": 105,
    "messageText": "Are you available to meet near the library entrance at 4 PM?",
    "sentAt": "2026-10-24T22:40:00.000Z"
  }
}
```

---

### 9.2 Get Messages for Offer Thread
- **Method & Path:** `GET /api/v1/offers/:id/messages`
- **Access Level:** Authenticated (Offer Participants only)

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": [
    {
      "id": 701,
      "senderId": 105,
      "messageText": "Are you available to meet near the library entrance at 4 PM?",
      "isRead": true,
      "sentAt": "2026-10-24T22:40:00.000Z"
    }
  ]
}
```

---

## 10. Wishlist Endpoints *(Optional Scope)*

### 10.1 Add Item to Wishlist
- **Method & Path:** `POST /api/v1/wishlists`
- **Access Level:** Authenticated (`STUDENT`)

#### Request Example
```json
{
  "listingId": 501
}
```

#### Success Response (`201 Created`)
```json
{
  "success": true,
  "data": {
    "wishlistId": 601,
    "listingId": 501,
    "createdAt": "2026-10-24T22:45:00.000Z"
  }
}
```

---

### 10.2 View User Wishlist
- **Method & Path:** `GET /api/v1/wishlists`
- **Access Level:** Authenticated (`STUDENT`)

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": [
    {
      "wishlistId": 601,
      "listing": {
        "id": 501,
        "title": "Introduction to Algorithms (CLRS 3rd Ed)",
        "price": "45.00",
        "mode": "SELL",
        "status": "ACTIVE",
        "primaryImageUrl": "https://campusswap.local/uploads/clrs-front.jpg"
      }
    }
  ]
}
```

---

### 10.3 Remove Item from Wishlist
- **Method & Path:** `DELETE /api/v1/wishlists/:listingId`
- **Access Level:** Authenticated (`STUDENT`)

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "removed": true,
    "listingId": 501
  }
}
```

---

## 11. Reports & Abuse Flagging Endpoints

### 11.1 File Report Ticket
- **Method & Path:** `POST /api/v1/reports`
- **Access Level:** Authenticated (`STUDENT`)
- **Validation:** Must provide at least one of `reportedUserId` or `listingId`. `reason` must match permitted enumeration.

#### Request Example
```json
{
  "listingId": 501,
  "reportedUserId": 88,
  "reason": "PROHIBITED_ITEM",
  "details": "User is listing lab answer keys which violates academic honor code."
}
```

#### Success Response (`201 Created`)
```json
{
  "success": true,
  "data": {
    "reportId": 201,
    "status": "PENDING",
    "message": "Report submitted. Campus moderators will review this ticket."
  }
}
```

---

## 12. Administrator Moderation Endpoints

### 12.1 View Moderation Queue
- **Method & Path:** `GET /api/v1/admin/reports`
- **Access Level:** Authenticated (`ADMIN` only)
- **Query Parameters:** `status` (`PENDING` | `UNDER_REVIEW` | `RESOLVED` | `DISMISSED`).

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": [
    {
      "id": 201,
      "reporter": {
        "id": 105,
        "fullName": "Alex Smith"
      },
      "reportedUser": {
        "id": 88,
        "fullName": "Sarah Connor"
      },
      "listingId": 501,
      "reason": "PROHIBITED_ITEM",
      "details": "User is listing lab answer keys which violates academic honor code.",
      "status": "PENDING",
      "createdAt": "2026-10-24T22:50:00.000Z"
    }
  ]
}
```

---

### 12.2 Resolve Report Ticket
- **Method & Path:** `PATCH /api/v1/admin/reports/:id`
- **Access Level:** Authenticated (`ADMIN` only)

#### Request Example
```json
{
  "status": "RESOLVED",
  "adminNotes": "Confirmed violation of campus item policy. Listing taken down."
}
```

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "id": 201,
    "status": "RESOLVED",
    "resolvedBy": 1,
    "resolvedAt": "2026-10-24T23:05:00.000Z"
  }
}
```

---

### 12.3 Administrative Listing Takedown
- **Method & Path:** `PATCH /api/v1/admin/listings/:id/takedown`
- **Access Level:** Authenticated (`ADMIN` only)
- **Business Rules:** Updates `listings.status = 'DELETED_BY_ADMIN'`. Automatically cancels any pending offers.

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "listingId": 501,
    "status": "DELETED_BY_ADMIN",
    "message": "Listing has been removed from public catalog."
  }
}
```

---

### 12.4 Suspend Student Account
- **Method & Path:** `PATCH /api/v1/admin/users/:id/suspend`
- **Access Level:** Authenticated (`ADMIN` only)
- **Business Rules:**
  - Updates `users.status = 'SUSPENDED'`.
  - Batch cancels all active listings belonging to this user (`status = 'CANCELLED'`).

#### Request Example
```json
{
  "reason": "Repeated attempts to distribute prohibited academic materials."
}
```

#### Success Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "userId": 88,
    "status": "SUSPENDED",
    "message": "Student account has been suspended and their active listings delisted."
  }
}
```

---

## 13. Summary Matrix of Optional vs. Essential Endpoints

| Category | Endpoint | Scope Status |
| :--- | :--- | :---: |
| Auth | `POST /auth/register`, `/verify-email`, `/login`, `GET /auth/me`, `POST /logout` | **Essential** |
| Categories | `GET /categories` | **Essential** |
| Listings | `GET /listings`, `POST /listings`, `GET /listings/:id`, `PUT /listings/:id`, `DELETE /listings/:id` | **Essential** |
| Claims | `POST /listings/:id/claim` | **Essential** |
| Offers | `POST /listings/:id/offers`, `GET /listings/:id/offers`, `/counter`, `/accept`, `/reject`, `/withdraw` | **Essential** |
| Barter | `POST /listings/:id/barter-proposals` | **Essential** |
| Transactions | `GET /transactions`, `GET /transactions/:id`, `POST /complete`, `POST /cancel` | **Essential** |
| Reviews | `POST /reviews` | **Essential** |
| Reports | `POST /reports` | **Essential** |
| Admin | `GET /admin/reports`, `PATCH /admin/reports/:id`, `/listings/:id/takedown`, `/users/:id/suspend` | **Essential** |
| Messages | `POST /offers/:id/messages`, `GET /offers/:id/messages` | *Optional Scope* |
| Wishlist | `POST /wishlists`, `GET /wishlists`, `DELETE /wishlists/:listingId` | *Optional Scope* |
