import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { listingsApi } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';

const STATUS_BADGES = {
  ACTIVE: 'bg-success',
  RESERVED: 'bg-warning',
  COMPLETED: 'bg-info',
  CANCELLED: 'bg-danger',
  DELETED_BY_ADMIN: 'bg-danger',
};

const TAB_STATUSES = ['ALL', 'ACTIVE', 'RESERVED', 'COMPLETED', 'CANCELLED'];

export default function MyListingsPage() {
  const { user } = useAuth();

  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');
  const [activeTab, setActiveTab] = useState('ALL');
  const [cancellingId, setCancellingId] = useState(null);

  const fetchMyListings = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError('');

    try {
      // Query with sellerId and status='ALL' to retrieve all user listings
      const res = await listingsApi.search({ sellerId: user.id, status: 'ALL', limit: 50 });
      const items = res.data.data.items || [];
      // Defensively ensure only listings belonging to current authenticated user are stored
      const myItems = items.filter((item) => !item.seller || item.seller.id === user.id);
      setListings(myItems);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to load your listings.');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchMyListings();
  }, [fetchMyListings]);

  const handleCancel = async (listingId, title) => {
    if (
      !window.confirm(
        `Are you sure you want to cancel the listing "${title}"?\nAny pending offers will be cancelled automatically.`
      )
    ) {
      return;
    }

    setCancellingId(listingId);
    setError('');
    setActionSuccess('');

    try {
      await listingsApi.remove(listingId);
      setActionSuccess(`Listing "${title}" was cancelled successfully.`);
      // Optimistically update the status in local list
      setListings((prev) =>
        prev.map((l) => (l.id === listingId ? { ...l, status: 'CANCELLED' } : l))
      );
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to cancel listing.');
    } finally {
      setCancellingId(null);
    }
  };

  const filteredListings = listings.filter((l) => {
    if (activeTab === 'ALL') return true;
    return l.status === activeTab;
  });

  const getTabCount = (tab) => {
    if (tab === 'ALL') return listings.length;
    return listings.filter((l) => l.status === tab).length;
  };

  const formatPrice = (listing) => {
    if (listing.mode === 'FREE') {
      return <span style={{ color: 'var(--cs-success)', fontWeight: 700 }}>FREE</span>;
    }
    if (listing.mode === 'BARTER') {
      return (
        <span style={{ color: '#fcd34d', fontWeight: 700 }}>
          BARTER {listing.price && parseFloat(listing.price) > 0 ? `(+₹${parseFloat(listing.price).toFixed(0)})` : ''}
        </span>
      );
    }
    return <span className="price-tag">₹{parseFloat(listing.price || 0).toFixed(0)}</span>;
  };

  return (
    <div className="container py-4 fade-in-up">
      {/* Top Header */}
      <div className="d-flex align-items-center justify-content-between mb-4 flex-wrap gap-3">
        <div>
          <h1 style={{ fontWeight: 800, fontSize: '1.8rem', color: 'var(--cs-text)', marginBottom: '0.2rem' }}>
            My Listings
          </h1>
          <p className="text-muted-cs mb-0" style={{ fontSize: '0.9rem' }}>
            Manage your campus marketplace offerings, track item status, and respond to buyer offers.
          </p>
        </div>

        <Link to="/listings/new" className="btn btn-primary d-inline-flex align-items-center gap-2">
          <span>+</span>
          <span>New Listing</span>
        </Link>
      </div>

      {actionSuccess && (
        <div className="alert alert-success py-2 mb-4 d-flex align-items-center justify-content-between" role="alert">
          <span>{actionSuccess}</span>
          <button type="button" className="btn-close btn-close-white" onClick={() => setActionSuccess('')} />
        </div>
      )}

      {error && (
        <div className="alert alert-danger py-2 mb-4" role="alert">
          {error}
        </div>
      )}

      {/* Status Filter Tabs */}
      <div className="d-flex gap-2 mb-4 overflow-auto pb-2">
        {TAB_STATUSES.map((tab) => {
          const count = getTabCount(tab);
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              className={`btn btn-sm ${isActive ? 'btn-primary' : 'btn-outline-secondary'}`}
              style={{
                borderRadius: '20px',
                padding: '0.35rem 0.9rem',
                fontSize: '0.82rem',
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
              onClick={() => setActiveTab(tab)}
            >
              {tab.charAt(0) + tab.slice(1).toLowerCase()} ({count})
            </button>
          );
        })}
      </div>

      {/* Content Area */}
      {loading ? (
        <Spinner text="Loading your listings…" />
      ) : listings.length === 0 ? (
        <EmptyState
          icon="📦"
          title="No listings yet"
          message="You have not published any campus resources yet. List a textbook, electronic equipment, or giveaway."
        >
          <Link to="/listings/new" className="btn btn-primary mt-2">
            + Create Your First Listing
          </Link>
        </EmptyState>
      ) : filteredListings.length === 0 ? (
        <EmptyState
          icon="🔍"
          title={`No ${activeTab.toLowerCase()} listings`}
          message={`You currently do not have any listings in ${activeTab} status.`}
        />
      ) : (
        <div className="d-flex flex-column gap-3">
          {filteredListings.map((l) => (
            <div key={l.id} className="card p-3 p-md-4">
              <div className="row align-items-center g-3">
                {/* Thumbnail / Placeholder */}
                <div className="col-auto">
                  <div
                    style={{
                      width: 80,
                      height: 80,
                      borderRadius: 'var(--cs-radius-sm)',
                      background: 'var(--cs-surface2)',
                      overflow: 'hidden',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '2rem',
                      border: '1px solid var(--cs-border)',
                      flexShrink: 0,
                    }}
                  >
                    {l.primaryImageUrl ? (
                      <img
                        src={l.primaryImageUrl}
                        alt={l.title}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={(e) => {
                          e.target.style.display = 'none';
                        }}
                      />
                    ) : (
                      <span>{l.mode === 'FREE' ? '🎁' : l.mode === 'BARTER' ? '🔄' : '💰'}</span>
                    )}
                  </div>
                </div>

                {/* Details */}
                <div className="col">
                  <div className="d-flex align-items-center gap-2 mb-1 flex-wrap">
                    <span className={`badge mode-${l.mode}`}>{l.mode}</span>
                    <span className={`badge ${STATUS_BADGES[l.status] || 'bg-secondary'}`}>
                      {l.status}
                    </span>
                    {l.category && (
                      <span className="text-dim" style={{ fontSize: '0.8rem' }}>
                        • {l.category.name}
                      </span>
                    )}
                  </div>

                  <h3
                    className="mb-1"
                    style={{
                      fontSize: '1.05rem',
                      fontWeight: 700,
                      color: 'var(--cs-text)',
                      lineHeight: 1.3,
                    }}
                  >
                    <Link to={`/listings/${l.id}`} className="text-decoration-none" style={{ color: 'var(--cs-text)' }}>
                      {l.title}
                    </Link>
                  </h3>

                  <div className="d-flex align-items-center gap-3 flex-wrap">
                    <div>{formatPrice(l)}</div>
                    <div className="text-muted-cs" style={{ fontSize: '0.8rem' }}>
                      📍 {l.pickupLocation}
                    </div>
                    {l.createdAt && (
                      <div className="text-dim" style={{ fontSize: '0.78rem' }}>
                        Posted {new Date(l.createdAt).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="col-12 col-md-auto d-flex align-items-center gap-2 flex-wrap justify-content-md-end">
                  <Link
                    to={`/listings/${l.id}`}
                    className="btn btn-outline-secondary btn-sm"
                    title="View details"
                  >
                    View
                  </Link>

                  {l.status === 'ACTIVE' && (
                    <>
                      <Link
                        to={`/listings/${l.id}/edit`}
                        className="btn btn-outline-primary btn-sm"
                        title="Edit listing details"
                      >
                        ✏️ Edit
                      </Link>

                      <Link
                        to={`/listings/${l.id}/offers`}
                        className="btn btn-outline-info btn-sm"
                        title="View received offers"
                      >
                        📋 Offers
                      </Link>

                      <button
                        type="button"
                        className="btn btn-outline-danger btn-sm"
                        onClick={() => handleCancel(l.id, l.title)}
                        disabled={cancellingId === l.id}
                        title="Cancel this listing"
                      >
                        {cancellingId === l.id ? (
                          <span className="spinner-border spinner-border-sm" role="status" />
                        ) : (
                          '🗑 Cancel'
                        )}
                      </button>
                    </>
                  )}

                  {l.status === 'RESERVED' && (
                    <Link to="/transactions" className="btn btn-outline-warning btn-sm">
                      🤝 View Meetup
                    </Link>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
