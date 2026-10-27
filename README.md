# 🎓 CampusSwap

> **Campus Resource Exchange & Lending System**  
> A trusted, student-exclusive marketplace for buying, selling, and bartering university essentials—such as course textbooks, lab equipment, electronics, furniture, and bicycles—with built-in campus verification, meetup coordination, reputation scoring, and direct negotiation messaging.

---

## 🛠️ Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend** | React 18, Vite 5, Bootstrap 5, Axios, React Router 6 |
| **Backend** | Node.js (v18+), Express 4, `mysql2/promise`, JWT, bcryptjs |
| **Database** | MySQL 8.0 (InnoDB engine, strict foreign key constraints, atomic transactions) |
| **Testing** | Node.js native test runners with end-to-end integration assertions |

---

## 🚀 Key Functional Modules

1. **Campus-Verified Authentication**:
   - Requires university domain emails (e.g. `@univ.edu`).
   - Secure two-step registration with a 6-digit OTP email verification flow.
   - Stateless JWT authentication with role authorization (`STUDENT`, `ADMIN`).

2. **Marketplace Catalog & Search**:
   - Filter by keyword, category, mode (`SELL`, `BARTER`, `FREE`), condition, and price range.
   - Dynamic seller reputation ratings and review badges on listing cards.

3. **Listing Management**:
   - Create, edit, and cancel listings.
   - Multi-photo gallery preview (up to 5 image URLs).
   - Validation rules (e.g., positive price for SELL, 0.00 for FREE, barter preferences for BARTER).

4. **Offers & Barter Negotiation**:
   - Direct purchase offers with optional buyer notes.
   - Item-for-item barter proposals linking existing active listings with optional cash differences.
   - Counteroffer negotiation flow and atomic acceptance with row-level locking (`LEAST/GREATEST`) to prevent race conditions.

5. **Transactions & Handover Coordination**:
   - Coordinated meetup details and counterparty contact info.
   - Completion confirmation with atomic listing status finalization.
   - Handover cancellation with automatic restoration of listings.

6. **Reviews & Seller Reputation**:
   - 1–5 star rating and comment submission on completed transactions.
   - Duplicate review prevention and dynamic reputation score calculations.

7. **Direct Messaging**:
   - Conversation threads organized by negotiation offers and transactions.
   - Chronological message bubbles with sent/read delivery status receipts.
   - Periodic polling refresh without external third-party socket dependencies.

8. **Administration & Moderation**:
   - System-wide transaction audit log.
   - Content moderation and administrative listing takedowns (`DELETED_BY_ADMIN`).

---

## 📋 Prerequisites

Before running the project locally, ensure you have:
- **Node.js**: `v18.x` or `v20.x`
- **npm**: `v9.x` or `v10.x`
- **MySQL Server**: `8.0+` running locally on port `3306`

---

## ⚙️ Installation & Local Setup

### 1. Database Setup (MySQL 8)

Open your MySQL terminal or database client:

```sql
-- Create the database
CREATE DATABASE campusswap CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Apply the database schema and initial category seed:

```bash
# From the project root:
mysql -u root -p campusswap < backend/database/schema.sql
mysql -u root -p campusswap < backend/database/seed.sql
```

---

### 2. Backend Configuration & Startup

1. Navigate to the `backend/` directory:
   ```bash
   cd backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   ```bash
   cp .env.example .env
   ```
   *Edit `.env` to match your local MySQL credentials:*
   ```env
   PORT=5001
   NODE_ENV=development
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_USER=root
   DB_PASSWORD=your_mysql_password
   DB_NAME=campusswap
   COLLEGE_EMAIL_DOMAIN=univ.edu
   JWT_SECRET=your_jwt_secret_change_in_production
   JWT_EXPIRES_IN=24h
   ```

4. Verify database connectivity:
   ```bash
   npm run db:test
   ```

5. Start the backend server:
   ```bash
   npm start
   ```
   *The backend will listen on `http://localhost:5001`.*

---

### 3. Frontend Configuration & Startup

1. In a new terminal window, navigate to the `frontend/` directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   ```bash
   cp .env.example .env
   ```
   *(Defaults to `VITE_API_BASE_URL=http://localhost:5001/api/v1`)*

4. Start the frontend development server:
   ```bash
   npm run dev
   ```
   *The application will open at `http://localhost:3000`.*

---

## 🧪 Verification & Testing

### Running the Backend Test Suite

The backend includes 73 automated end-to-end integration tests covering database connectivity, authentication, listings, offers, transactions, reviews, and messaging.

```bash
cd backend
npm run test
```

Expected output:
```
✓ db:test: Database connection successful
✓ test:auth: 13 passed, 0 failed
✓ test:listings: 13 passed, 0 failed
✓ test:offers: 16 passed, 0 failed
✓ test:transactions: 16 passed, 0 failed
✓ test:messages: 14 passed, 0 failed
==================================================
Total: 73 passed, 0 failed
```

### Running the Frontend Production Build

Verify frontend compilation:

```bash
cd frontend
npm run build
```

Expected output:
```
✓ built in ~550ms with 0 errors
```

---

## 📱 Walkthrough: Demo & End-to-End User Flow

### 1. Student Registration & OTP Verification
1. Navigate to `http://localhost:3000/register`.
2. Enter your details with a campus email (e.g. `alice@univ.edu`), password, and student ID.
3. Submit the registration form.
4. **OTP Verification**: In local development mode, the 6-digit verification code is printed directly to the backend server terminal (e.g. `[CampusSwap Local Dev] Verification OTP for alice@univ.edu: 123456`).
5. Enter the 6-digit OTP to activate your account and automatically log in.

### 2. Creating a Listing
1. Click **+ New Listing** in the top navigation.
2. Select exchange mode:
   - **SELL**: Set a positive price in ₹.
   - **BARTER**: Enter barter preferences (what you are willing to trade for).
   - **FREE**: Price is locked to ₹0.00.
3. Add title, description, category, condition, pickup location (e.g. *Central Campus Library*), and optional photo URLs.
4. Publish the listing to make it immediately visible in the marketplace catalog.

### 3. Making and Accepting Offers
1. Log in with a second student account (e.g. `bob@univ.edu`).
2. Browse the marketplace and view the listing created above.
3. Submit an offer:
   - For cash items: Enter an offer amount and optional message.
   - For barter items: Select one of your own active listings to propose in trade.
4. Log back into the seller account, visit **My Listings** → **View Offers**, and click **✓ Accept Offer**.
5. Both listings atomically transition to `RESERVED` and a transaction is created in `PENDING_MEETUP`.

### 4. Meetup Coordination & Messaging
1. In the top navigation, click **Messages**.
2. Select the negotiation thread for the accepted offer.
3. Send coordination messages regarding the meetup time and safe location.
4. Sent messages display delivery receipts (`✓ Sent` and `✓✓ Read`).

### 5. Completing the Handover & Submitting a Review
1. Visit **Transactions** from the navigation bar and select the pending handover.
2. After meeting on campus, click **Confirm Handover / Mark as Completed**.
3. Once completed, both participants can submit a **1–5 star rating** and feedback comment.
4. The seller's public reputation score automatically updates on their listings.

---

## 🔒 Security & Privacy Notice
- Never commit production passwords, private keys, or actual database secrets to source control.
- All password hashes use `bcryptjs` with salt rounds.
- JWT tokens are signed with secret keys stored strictly in `.env`.
