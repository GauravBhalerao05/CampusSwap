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
   FRONTEND_URL=http://localhost:3000
   CORS_ORIGIN=http://localhost:3000,http://localhost:5173
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

### 1. Direct Student Registration & Login
1. Navigate to `http://localhost:3000/register`.
2. Enter your details with any valid email (e.g. `student@gmail.com`), password, full name, and department.
3. Submit the registration form.
4. **Instant Activation**: The account is activated immediately upon creation. No OTP or email verification is required.
5. The application automatically logs you in and redirects you directly to the marketplace listings.

---

## 🚀 Cloud Deployment Guide (Free Tier)

CampusSwap is architected to deploy 100% on free cloud tiers:
- **Database:** TiDB Cloud Serverless (MySQL-compatible, persistent, TLS-encrypted)
- **Backend:** Render Free Web Service (Node.js runtime)
- **Frontend:** Vercel Free Plan (Vite + React SPA)

---

### Step 1: Database (TiDB Cloud Serverless)
1. Sign in to your [TiDB Cloud](https://tidbcloud.com) console.
2. Under your Serverless Cluster, navigate to **Overview** → **Connect**.
3. Choose **Connection Method**: `MySQL Client` or `General Connection String`.
4. Note your credentials:
   - **Host:** e.g. `gateway01.ap-southeast-1.prod.aws.tidbcloud.com`
   - **Port:** `4000`
   - **User:** e.g. `xxxxxx.root`
   - **Password:** `<your-tidb-password>`
   - **Database:** `campusswap`
5. *Note: TiDB Cloud enforces TLS 1.2+ encryption automatically. CampusSwap enables SSL automatically when `NODE_ENV=production` or `DB_SSL=true`.*

---

### Step 2: Backend Deployment (Render)
1. Go to your [Render Dashboard](https://dashboard.render.com) and click **New +** → **Web Service**.
2. Connect your GitHub repository (`CampusSwap`).
3. Configure the service:
   - **Name:** `campusswap-backend` (or your choice)
   - **Region:** `Singapore (Southeast Asia)` or closest to your database
   - **Branch:** `main`
   - **Root Directory:** `backend`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** `Free`
4. Add the following **Environment Variables** in Render's dashboard:
   | Variable | Value | Description |
   | :--- | :--- | :--- |
   | `NODE_ENV` | `production` | Enables production mode & TLS |
   | `DB_HOST` | `gateway01...tidbcloud.com` | TiDB Cloud host |
   | `DB_PORT` | `4000` | TiDB Cloud port |
   | `DB_NAME` | `campusswap` | Database name |
   | `DB_USER` | `xxxxxx.root` | TiDB username |
   | `DB_PASSWORD` | `<your-tidb-password>` | TiDB password |
   | `DB_SSL` | `true` | Enforces TLS connection |
   | `JWT_SECRET` | `<32+ char random string>` | Secure random key for signing tokens |
   | `JWT_EXPIRES_IN` | `24h` | Token validity duration |
   | `CORS_ORIGIN` | `https://<your-vercel-app>.vercel.app` | Allowed frontend origin (set after Step 3) |
   | `FRONTEND_URL` | `https://<your-vercel-app>.vercel.app` | Frontend application URL |
5. Click **Create Web Service**.
6. Once deployed, copy your Render URL (e.g. `https://campusswap-backend.onrender.com`).
7. Verify health: visit `https://campusswap-backend.onrender.com/api/v1/health` in your browser. It should return `{"status":"UP","database":"CONNECTED"}`.

---

### Step 3: Frontend Deployment (Vercel)
1. Go to your [Vercel Dashboard](https://vercel.com) and click **Add New...** → **Project**.
2. Import your GitHub repository (`CampusSwap`).
3. Configure the project:
   - **Framework Preset:** `Vite`
   - **Root Directory:** Click `Edit` and select `frontend`
   - **Build Command:** `npm run build` (default)
   - **Output Directory:** `dist` (default)
4. Add the **Environment Variable**:
   | Variable | Value | Description |
   | :--- | :--- | :--- |
   | `VITE_API_BASE_URL` | `https://campusswap-backend.onrender.com/api/v1` | Render backend URL + `/api/v1` |
5. Click **Deploy**.
6. Vercel will build the frontend and provide your production URL (e.g. `https://campusswap.vercel.app`).
7. *Note: `frontend/vercel.json` is included in the repository to automatically handle SPA client-side routing rewrites on page reloads.*

---

### Step 4: Finalize CORS on Render
1. Return to your **Render Web Service** → **Environment**.
2. Update `CORS_ORIGIN` and `FRONTEND_URL` with your actual Vercel domain:
   ```
   CORS_ORIGIN=https://campusswap.vercel.app
   FRONTEND_URL=https://campusswap.vercel.app
   ```
3. Save changes. Render will automatically redeploy with the updated CORS policy.

---

### Step 5: Post-Deployment Verification Checklist
- [ ] Visit `https://<your-vercel-app>.vercel.app` → Home and Marketplace catalog load without errors.
- [ ] Direct Registration: Click **Register**, enter valid details, submit -> Account created immediately and auto-redirected to `/listings`.
- [ ] Direct Login: Log out and sign in with the newly created account.
- [ ] Create Listing: Click **+ New Listing**, publish an item -> Displays instantly in the marketplace.
- [ ] Deep Linking: Refresh browser while on `/listings` or `/login` -> Page renders cleanly without 404 errors (SPA rewrite active).

---

### Step 6: Troubleshooting

| Issue | Cause | Solution |
| :--- | :--- | :--- |
| **"Failed to load listings"** | CORS rejection or invalid API URL | Verify `VITE_API_BASE_URL` in Vercel includes `/api/v1` without trailing slashes. Verify `CORS_ORIGIN` in Render matches your exact Vercel URL (`https://...`). |
| **Render 50-second initial delay** | Free tier spin-down | Render free tier spins down after 15 minutes of inactivity. First request takes ~30–50s to wake up; subsequent requests respond instantly. |
| **TiDB connection error** | Missing SSL or firewall | Ensure `DB_SSL=true` is set. Verify your TiDB Cloud cluster status is Active and credentials match. |
| **404 on page reload on Vercel** | Missing SPA rewrite rule | Ensure `frontend/vercel.json` exists with the rewrite rule to `/index.html`. |

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
