import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { transactionsApi, listingsApi } from '../api/client';

export default function AdminPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('transactions'); // 'transactions' | 'listings'
  
  // Transactions state
  const [transactions, setTransactions] = useState([]);
  const [loadingTx, setLoadingTx] = useState(true);
  const [txError, setTxError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Listings moderation state
  const [listings, setListings] = useState([]);
  const [loadingListings, setLoadingListings] = useState(false);
  const [listingsError, setListingsError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [takedownId, setTakedownId] = useState(null);
  const [takedownLoading, setTakedownLoading] = useState(false);
  const [actionSuccess, setActionSuccess] = useState('');
  const [actionError, setActionError] = useState('');

  // Fetch all transactions (as ADMIN, returns all platform transactions)
  const fetchTransactions = useCallback(async () => {
    setLoadingTx(true);
    setTxError('');
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      const res = await transactionsApi.list(params);
      setTransactions(res.data?.data || []);
    } catch (err) {
      setTxError(err.response?.data?.error?.message || 'Failed to load system transactions.');
    } finally {
      setLoadingTx(false);
    }
  }, [statusFilter]);

  // Fetch listings for moderation
  const fetchListings = useCallback(async () => {
    setLoadingListings(true);
    setListingsError('');
    try {
      const params = { limit: 50 };
      if (searchQuery.trim()) params.q = searchQuery.trim();
      const res = await listingsApi.search(params);
      setListings(res.data?.data || []);
    } catch (err) {
      setListingsError(err.response?.data?.error?.message || 'Failed to load listings for moderation.');
    } finally {
      setLoadingListings(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    if (activeTab === 'transactions') {
      fetchTransactions();
    } else if (activeTab === 'listings') {
      fetchListings();
    }
  }, [activeTab, fetchTransactions, fetchListings]);

  // Handle listing takedown
  const handleTakedown = async (id) => {
    setTakedownLoading(true);
    setActionSuccess('');
    setActionError('');
    try {
      await listingsApi.remove(id);
      setActionSuccess(`Listing #${id} successfully taken down by administrator (DELETED_BY_ADMIN).`);
      setTakedownId(null);
      await fetchListings();
    } catch (err) {
      setActionError(err.response?.data?.error?.message || 'Failed to execute administrative takedown.');
    } finally {
      setTakedownLoading(false);
    }
  };

  const completedCount = transactions.filter((t) => t.status === 'COMPLETED').length;
  const pendingCount = transactions.filter((t) => t.status === 'PENDING_MEETUP').length;

  return (
    <div className="container py-4 fade-in-up">
      {/* Admin Header */}
      <div className="d-flex align-items-center justify-content-between mb-4 flex-wrap gap-2">
        <div>
          <div className="d-flex align-items-center gap-2">
            <h2 style={{ fontWeight: 800, color: 'var(--cs-text)', marginBottom: '0.2rem' }}>
              🛡️ Administration Portal
            </h2>
            <span className="badge bg-danger">ADMIN</span>
          </div>
          <p className="text-muted-cs mb-0" style={{ fontSize: '0.95rem' }}>
            System audit log and administrative controls for {user?.email}.
          </p>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="row g-3 mb-4">
        <div className="col-12 col-sm-4">
          <div className="card p-3">
            <div className="text-dim" style={{ fontSize: '0.8rem', fontWeight: 600 }}>
              TOTAL SYSTEM TRANSACTIONS
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--cs-primary-light)' }}>
              {transactions.length}
            </div>
            <div className="text-dim" style={{ fontSize: '0.75rem' }}>
              All-time platform handovers
            </div>
          </div>
        </div>
        <div className="col-12 col-sm-4">
          <div className="card p-3">
            <div className="text-dim" style={{ fontSize: '0.8rem', fontWeight: 600 }}>
              ACTIVE MEETUPS
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--cs-accent)' }}>
              {pendingCount}
            </div>
            <div className="text-dim" style={{ fontSize: '0.75rem' }}>
              Pending handover verification
            </div>
          </div>
        </div>
        <div className="col-12 col-sm-4">
          <div className="card p-3">
            <div className="text-dim" style={{ fontSize: '0.8rem', fontWeight: 600 }}>
              COMPLETED EXCHANGES
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--cs-success)' }}>
              {completedCount}
            </div>
            <div className="text-dim" style={{ fontSize: '0.75rem' }}>
              Successfully finalized
            </div>
          </div>
        </div>
      </div>

      {/* Action Alerts */}
      {actionSuccess && (
        <div className="alert alert-success d-flex align-items-center justify-content-between mb-4">
          <span>✅ {actionSuccess}</span>
          <button className="btn btn-sm btn-close" onClick={() => setActionSuccess('')} />
        </div>
      )}
      {actionError && (
        <div className="alert alert-danger d-flex align-items-center justify-content-between mb-4">
          <span>⚠️ {actionError}</span>
          <button className="btn btn-sm btn-close" onClick={() => setActionError('')} />
        </div>
      )}

      {/* Tabs */}
      <ul className="nav nav-tabs mb-4" style={{ borderColor: 'var(--cs-border)' }}>
        <li className="nav-item">
          <button
            className={`nav-link ${activeTab === 'transactions' ? 'active' : ''}`}
            onClick={() => setActiveTab('transactions')}
            style={{
              color: activeTab === 'transactions' ? 'var(--cs-primary-light)' : 'var(--cs-text-muted)',
              background: activeTab === 'transactions' ? 'var(--cs-surface)' : 'transparent',
              borderColor: activeTab === 'transactions' ? 'var(--cs-border) var(--cs-border) var(--cs-surface)' : 'transparent',
              fontWeight: 600,
            }}
          >
            📋 Platform Transactions Audit
          </button>
        </li>
        <li className="nav-item">
          <button
            className={`nav-link ${activeTab === 'listings' ? 'active' : ''}`}
            onClick={() => setActiveTab('listings')}
            style={{
              color: activeTab === 'listings' ? 'var(--cs-primary-light)' : 'var(--cs-text-muted)',
              background: activeTab === 'listings' ? 'var(--cs-surface)' : 'transparent',
              borderColor: activeTab === 'listings' ? 'var(--cs-border) var(--cs-border) var(--cs-surface)' : 'transparent',
              fontWeight: 600,
            }}
          >
            🔨 Listing Moderation & Takedowns
          </button>
        </li>
      </ul>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* TAB 1: Transactions Audit */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeTab === 'transactions' && (
        <div className="card p-4">
          <div className="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
            <h5 style={{ fontWeight: 700, color: 'var(--cs-text)', margin: 0 }}>
              System Handovers & Transactions
            </h5>
            <div className="d-flex align-items-center gap-2">
              <select
                className="form-select form-select-sm"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{ width: 'auto' }}
              >
                <option value="">All Statuses</option>
                <option value="PENDING_MEETUP">Pending Meetup</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
              <button
                className="btn btn-outline-secondary btn-sm"
                onClick={fetchTransactions}
              >
                🔄 Refresh
              </button>
            </div>
          </div>

          {loadingTx ? (
            <div className="text-center py-5">
              <div className="spinner-border text-primary mb-2" role="status" />
              <div className="text-dim">Loading system transaction log…</div>
            </div>
          ) : txError ? (
            <div className="alert alert-danger">{txError}</div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-5 text-muted-cs">
              No transactions recorded in the platform yet.
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0" style={{ color: 'var(--cs-text)' }}>
                <thead>
                  <tr style={{ color: 'var(--cs-text-dim)', fontSize: '0.8rem', borderBottom: '1px solid var(--cs-border)' }}>
                    <th>ID</th>
                    <th>ITEM</th>
                    <th>TYPE</th>
                    <th>SELLER</th>
                    <th>BUYER</th>
                    <th>AMOUNT</th>
                    <th>STATUS</th>
                    <th>DATE</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => (
                    <tr key={tx.id} style={{ borderBottom: '1px solid var(--cs-border)', fontSize: '0.88rem' }}>
                      <td style={{ fontWeight: 700, color: 'var(--cs-primary-light)' }}>
                        #{tx.id}
                      </td>
                      <td>
                        <span style={{ fontWeight: 600 }}>{tx.listingTitle}</span>
                        {tx.barterListingTitle && (
                          <div className="text-dim" style={{ fontSize: '0.75rem' }}>
                            ↔ Traded: {tx.barterListingTitle}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className="badge bg-secondary" style={{ fontSize: '0.72rem' }}>
                          {tx.transactionType}
                        </span>
                      </td>
                      <td>{tx.counterparty?.fullName || tx.sellerName || 'Seller'}</td>
                      <td>{tx.buyerName || 'Buyer'}</td>
                      <td style={{ fontWeight: 600 }}>
                        {parseFloat(tx.finalPrice || 0) > 0 ? `₹${parseFloat(tx.finalPrice).toFixed(2)}` : 'FREE'}
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            tx.status === 'COMPLETED'
                              ? 'bg-success'
                              : tx.status === 'PENDING_MEETUP'
                              ? 'bg-warning text-dark'
                              : 'bg-danger'
                          }`}
                          style={{ fontSize: '0.72rem' }}
                        >
                          {tx.status}
                        </span>
                      </td>
                      <td className="text-dim" style={{ fontSize: '0.78rem' }}>
                        {new Date(tx.createdAt).toLocaleDateString()}
                      </td>
                      <td>
                        <Link
                          to={`/transactions/${tx.id}`}
                          className="btn btn-outline-primary btn-sm py-1 px-2"
                          style={{ fontSize: '0.75rem' }}
                        >
                          Inspect ↗
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* TAB 2: Listing Moderation */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeTab === 'listings' && (
        <div className="card p-4">
          <div className="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
            <div>
              <h5 style={{ fontWeight: 700, color: 'var(--cs-text)', margin: 0 }}>
                Marketplace Content Moderation
              </h5>
              <div className="text-dim" style={{ fontSize: '0.82rem' }}>
                Inspect listings and execute administrative takedowns (sets status to DELETED_BY_ADMIN).
              </div>
            </div>
            <div className="d-flex align-items-center gap-2">
              <input
                type="text"
                className="form-control form-control-sm"
                placeholder="Search listing title…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchListings()}
                style={{ width: 220 }}
              />
              <button className="btn btn-primary btn-sm" onClick={fetchListings}>
                Search
              </button>
            </div>
          </div>

          {loadingListings ? (
            <div className="text-center py-5">
              <div className="spinner-border text-primary mb-2" role="status" />
              <div className="text-dim">Loading listings…</div>
            </div>
          ) : listingsError ? (
            <div className="alert alert-danger">{listingsError}</div>
          ) : listings.length === 0 ? (
            <div className="text-center py-5 text-muted-cs">
              No listings found matching search query.
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0" style={{ color: 'var(--cs-text)' }}>
                <thead>
                  <tr style={{ color: 'var(--cs-text-dim)', fontSize: '0.8rem', borderBottom: '1px solid var(--cs-border)' }}>
                    <th>ID</th>
                    <th>TITLE</th>
                    <th>MODE</th>
                    <th>PRICE</th>
                    <th>SELLER</th>
                    <th>LOCATION</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {listings.map((l) => (
                    <tr key={l.id} style={{ borderBottom: '1px solid var(--cs-border)', fontSize: '0.88rem' }}>
                      <td style={{ fontWeight: 700, color: 'var(--cs-primary-light)' }}>
                        #{l.id}
                      </td>
                      <td style={{ fontWeight: 600 }}>{l.title}</td>
                      <td>
                        <span className={`badge mode-${l.mode}`} style={{ fontSize: '0.72rem' }}>
                          {l.mode}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        {l.mode === 'FREE' ? 'FREE' : `₹${parseFloat(l.price || 0).toFixed(2)}`}
                      </td>
                      <td>{l.seller?.fullName || 'Student'}</td>
                      <td className="text-dim" style={{ fontSize: '0.8rem' }}>
                        {l.pickupLocation}
                      </td>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <Link
                            to={`/listings/${l.id}`}
                            className="btn btn-outline-secondary btn-sm py-1 px-2"
                            style={{ fontSize: '0.75rem' }}
                          >
                            View
                          </Link>
                          <button
                            className="btn btn-outline-danger btn-sm py-1 px-2"
                            style={{ fontSize: '0.75rem' }}
                            onClick={() => setTakedownId(l.id)}
                          >
                            Takedown
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Confirmation Modal for Listing Takedown */}
      {takedownId && (
        <div
          className="modal show d-block"
          style={{ background: 'rgba(0,0,0,0.7)', zIndex: 1050 }}
          tabIndex="-1"
        >
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content" style={{ background: 'var(--cs-surface)', border: '1px solid var(--cs-border)' }}>
              <div className="modal-header" style={{ borderBottom: '1px solid var(--cs-border)' }}>
                <h5 className="modal-title" style={{ color: 'var(--cs-danger)', fontWeight: 700 }}>
                  ⚠️ Confirm Administrative Takedown
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setTakedownId(null)}
                  disabled={takedownLoading}
                />
              </div>
              <div className="modal-body">
                <p style={{ color: 'var(--cs-text)' }}>
                  Are you sure you want to remove listing <strong>#{takedownId}</strong>?
                </p>
                <p className="text-dim mb-0" style={{ fontSize: '0.85rem' }}>
                  This will transition the listing status to <code>DELETED_BY_ADMIN</code> and prevent any further buyer offers.
                </p>
              </div>
              <div className="modal-footer" style={{ borderTop: '1px solid var(--cs-border)' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setTakedownId(null)}
                  disabled={takedownLoading}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => handleTakedown(takedownId)}
                  disabled={takedownLoading}
                >
                  {takedownLoading ? 'Processing…' : 'Confirm Takedown'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
