import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { listingsApi, offersApi } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';

const STATUS_BADGES = {
  PENDING: 'bg-warning text-dark',
  COUNTERED: 'bg-info text-dark',
  ACCEPTED: 'bg-success',
  REJECTED: 'bg-danger',
  WITHDRAWN: 'bg-secondary',
  CANCELLED_BY_SYSTEM: 'bg-secondary',
};

function StarRow({ rating }) {
  const r = Math.round(rating || 0);
  return (
    <span className="d-inline-flex align-items-center gap-1" style={{ fontSize: '0.8rem' }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= r ? 'star' : 'star-empty'}>
          ★
        </span>
      ))}
      <span className="text-dim">({(rating || 0).toFixed(1)})</span>
    </span>
  );
}

export default function ListingOffersPage() {
  const { id } = useParams();
  const { user } = useAuth();

  const [listing, setListing] = useState(null);
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [activeTab, setActiveTab] = useState('ALL');

  // Accept confirmation modal/dialog state
  const [acceptingOffer, setAcceptingOffer] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Counteroffer form state
  const [counteringOfferId, setCounteringOfferId] = useState(null);
  const [counterPrice, setCounterPrice] = useState('');
  const [counterMsg, setCounterMsg] = useState('');
  const [counterError, setCounterError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const [listingRes, offersRes] = await Promise.all([
        listingsApi.get(id),
        listingsApi.getOffers(id),
      ]);

      const l = listingRes.data.data;
      setListing(l);
      setOffers(offersRes.data.data || []);
    } catch (err) {
      setError(
        err.response?.data?.error?.message ||
          'Failed to load offers. Only the listing owner can view offers.'
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Accept handler
  const handleAccept = async () => {
    if (!acceptingOffer) return;
    setActionLoading(true);
    setError('');
    setSuccessMsg('');

    try {
      const res = await offersApi.accept(acceptingOffer.id);
      const msg =
        res.data.data?.message ||
        'Offer accepted! The listing is now RESERVED for meetup.';
      setSuccessMsg(`✅ ${msg}`);
      setAcceptingOffer(null);
      // Reload offers and listing status
      await loadData();
    } catch (err) {
      const msg =
        err.response?.data?.error?.message ||
        'Failed to accept offer. The item may no longer be active.';
      setError(msg);
      setAcceptingOffer(null);
    } finally {
      setActionLoading(false);
    }
  };

  // Reject handler
  const handleReject = async (offerId) => {
    if (!window.confirm('Are you sure you want to reject this offer?')) return;
    setActionLoading(true);
    setError('');
    setSuccessMsg('');

    try {
      await offersApi.reject(offerId);
      setSuccessMsg('Offer rejected successfully.');
      await loadData();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to reject offer.');
    } finally {
      setActionLoading(false);
    }
  };

  // Counter handler
  const handleCounter = async (e) => {
    e.preventDefault();
    const price = parseFloat(counterPrice);
    if (!counterPrice || isNaN(price) || price <= 0) {
      setCounterError('Please enter a valid counteroffer amount greater than ₹0.00.');
      return;
    }

    setActionLoading(true);
    setCounterError('');
    setError('');
    setSuccessMsg('');

    try {
      await offersApi.counter(counteringOfferId, {
        counterPrice: price,
        message: counterMsg.trim() || undefined,
      });
      setSuccessMsg(`✅ Counteroffer of ₹${price.toFixed(2)} sent to the buyer.`);
      setCounteringOfferId(null);
      setCounterPrice('');
      setCounterMsg('');
      await loadData();
    } catch (err) {
      setCounterError(err.response?.data?.error?.message || 'Failed to submit counteroffer.');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="container py-5">
        <Spinner text="Loading incoming offers…" />
      </div>
    );
  }

  // Ownership verification check
  const isOwner = user && listing?.seller && user.id === listing.seller.id;
  if (!isOwner && !loading && listing) {
    return (
      <div className="container py-5 text-center fade-in-up" style={{ maxWidth: 520 }}>
        <div className="card p-4">
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔒</div>
          <h4 style={{ color: 'var(--cs-text)', fontWeight: 700 }}>Access Restricted</h4>
          <p className="text-muted-cs mb-4">
            Only the owner of this listing is authorized to view and manage incoming offers.
          </p>
          <Link to={`/listings/${id}`} className="btn btn-primary">
            View Listing
          </Link>
        </div>
      </div>
    );
  }

  const filteredOffers = offers.filter((o) => {
    if (activeTab === 'ALL') return true;
    if (activeTab === 'ACTIONABLE') return ['PENDING', 'COUNTERED'].includes(o.status);
    if (activeTab === 'ACCEPTED') return o.status === 'ACCEPTED';
    if (activeTab === 'CLOSED') return ['REJECTED', 'WITHDRAWN', 'CANCELLED_BY_SYSTEM'].includes(o.status);
    return true;
  });

  return (
    <div className="container py-4 fade-in-up" style={{ maxWidth: 960 }}>
      {/* Breadcrumb Navigation */}
      <div className="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
        <Link to={`/listings/${id}`} className="text-muted-cs text-decoration-none" style={{ fontSize: '0.9rem' }}>
          ← Back to Listing
        </Link>
        <Link to="/my-listings" className="text-muted-cs text-decoration-none" style={{ fontSize: '0.9rem' }}>
          My Listings
        </Link>
      </div>

      {/* Target Listing Header Card */}
      <div className="card p-3 p-md-4 mb-4">
        <div className="d-flex align-items-center justify-content-between flex-wrap gap-3">
          <div>
            <div className="d-flex align-items-center gap-2 mb-1 flex-wrap">
              <span className={`badge mode-${listing?.mode}`}>{listing?.mode}</span>
              <span className={`badge bg-${listing?.status === 'ACTIVE' ? 'success' : 'warning'}`}>
                {listing?.status}
              </span>
              {listing?.category && (
                <span className="text-dim" style={{ fontSize: '0.8rem' }}>
                  • {listing.category.name}
                </span>
              )}
            </div>
            <h1 style={{ fontWeight: 800, fontSize: '1.4rem', color: 'var(--cs-text)', marginBottom: '0.2rem' }}>
              {listing?.title}
            </h1>
            <div className="d-flex align-items-center gap-3 text-muted-cs" style={{ fontSize: '0.88rem' }}>
              {listing?.mode === 'SELL' && (
                <span className="price-tag" style={{ fontSize: '1.2rem' }}>
                  Asking: ₹{parseFloat(listing?.price || 0).toFixed(0)}
                </span>
              )}
              {listing?.mode === 'FREE' && <span className="text-success font-weight-bold">Free Giveaway</span>}
              {listing?.mode === 'BARTER' && <span className="text-warning">Barter Exchange</span>}
              <span>📍 {listing?.pickupLocation}</span>
            </div>
          </div>

          <div className="text-end">
            <span
              style={{
                fontSize: '1.8rem',
                fontWeight: 800,
                color: 'var(--cs-primary-light)',
                display: 'block',
              }}
            >
              {offers.length}
            </span>
            <span className="text-muted-cs" style={{ fontSize: '0.8rem' }}>
              Total Offer{offers.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </div>

      {/* Global Alerts */}
      {successMsg && (
        <div className="alert alert-success py-2 mb-4 d-flex align-items-center justify-content-between" role="alert">
          <span>{successMsg}</span>
          <button type="button" className="btn-close btn-close-white" onClick={() => setSuccessMsg('')} />
        </div>
      )}

      {error && (
        <div className="alert alert-danger py-2 mb-4" role="alert">
          {error}
        </div>
      )}

      {/* Filter Tabs */}
      <div className="d-flex gap-2 mb-4 overflow-auto pb-1">
        {[
          { key: 'ALL', label: `All (${offers.length})` },
          { key: 'ACTIONABLE', label: `Pending / Countered (${offers.filter((o) => ['PENDING', 'COUNTERED'].includes(o.status)).length})` },
          { key: 'ACCEPTED', label: `Accepted (${offers.filter((o) => o.status === 'ACCEPTED').length})` },
          { key: 'CLOSED', label: `Closed (${offers.filter((o) => ['REJECTED', 'WITHDRAWN', 'CANCELLED_BY_SYSTEM'].includes(o.status)).length})` },
        ].map((tab) => (
          <button
            key={tab.key}
            className={`btn btn-sm ${activeTab === tab.key ? 'btn-primary' : 'btn-outline-secondary'}`}
            style={{ borderRadius: '20px', padding: '0.35rem 0.9rem', fontSize: '0.82rem', fontWeight: 600 }}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Offers List */}
      {filteredOffers.length === 0 ? (
        <EmptyState
          icon="📬"
          title="No offers found"
          message={
            activeTab === 'ALL'
              ? 'No student has submitted an offer or proposal on this listing yet.'
              : `No offers currently in the selected ${activeTab.toLowerCase()} category.`
          }
        />
      ) : (
        <div className="d-flex flex-column gap-3">
          {filteredOffers.map((offer) => {
            const isPending = offer.status === 'PENDING';
            const isCountered = offer.status === 'COUNTERED';
            const isBarter = offer.offerType === 'BARTER';
            const isTargetActive = listing?.status === 'ACTIVE';

            return (
              <div
                key={offer.id}
                className="card p-3 p-md-4"
                style={{
                  borderLeft: isPending
                    ? '4px solid var(--cs-warning)'
                    : offer.status === 'ACCEPTED'
                    ? '4px solid var(--cs-success)'
                    : undefined,
                }}
              >
                <div className="row g-3 align-items-center">
                  {/* Buyer Avatar & Name */}
                  <div className="col-auto">
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: '50%',
                        background: 'linear-gradient(135deg,var(--cs-primary),var(--cs-primary-dark))',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '1.1rem',
                        fontWeight: 700,
                        color: 'white',
                      }}
                    >
                      {offer.buyer?.fullName?.[0]?.toUpperCase() || '?'}
                    </div>
                  </div>

                  {/* Offer Info */}
                  <div className="col">
                    <div className="d-flex align-items-center gap-2 mb-1 flex-wrap">
                      <span style={{ fontWeight: 700, color: 'var(--cs-text)' }}>
                        {offer.buyer?.fullName}
                      </span>
                      <StarRow rating={offer.buyer?.avgRating} />
                      <span className={`badge ${STATUS_BADGES[offer.status] || 'bg-secondary'}`}>
                        {offer.status}
                      </span>
                      <span className={`badge mode-${isBarter ? 'BARTER' : 'SELL'}`}>
                        {offer.offerType}
                      </span>
                    </div>

                    {/* Monetary Offer Details */}
                    {!isBarter && (
                      <div className="d-flex align-items-center gap-3 mt-1 flex-wrap">
                        <div>
                          <span className="text-dim" style={{ fontSize: '0.8rem' }}>
                            Offered:
                          </span>{' '}
                          <span className="price-tag" style={{ fontSize: '1.15rem' }}>
                            ₹{parseFloat(offer.offeredPrice || 0).toFixed(0)}
                          </span>
                        </div>

                        {offer.counterPrice && (
                          <div style={{ color: 'var(--cs-info)', fontSize: '0.88rem' }}>
                            Counteroffer: <strong>₹{parseFloat(offer.counterPrice).toFixed(0)}</strong>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Barter Proposal Details */}
                    {isBarter && (
                      <div className="mt-1">
                        <div className="d-flex align-items-center gap-2 flex-wrap" style={{ fontSize: '0.88rem' }}>
                          <span style={{ color: '#fcd34d', fontWeight: 700 }}>Item Trade:</span>
                          {offer.offeredListingId ? (
                            <Link
                              to={`/listings/${offer.offeredListingId}`}
                              className="text-primary-light"
                              target="_blank"
                              rel="noreferrer"
                            >
                              Offered Listing #{offer.offeredListingId} ↗
                            </Link>
                          ) : (
                            <span className="text-muted-cs">Exchange item specified</span>
                          )}

                          {parseFloat(offer.cashDifference || 0) > 0 && (
                            <span className="badge bg-warning text-dark">
                              + ₹{parseFloat(offer.cashDifference).toFixed(0)} cash difference
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Buyer Message */}
                    {offer.message && (
                      <p
                        className="text-muted-cs mt-2 mb-0"
                        style={{
                          fontSize: '0.88rem',
                          background: 'var(--cs-surface2)',
                          padding: '0.5rem 0.8rem',
                          borderRadius: 'var(--cs-radius-sm)',
                          fontStyle: 'italic',
                        }}
                      >
                        "{offer.message}"
                      </p>
                    )}

                    <div className="text-dim mt-2" style={{ fontSize: '0.75rem' }}>
                      Submitted {new Date(offer.createdAt).toLocaleString()}
                    </div>
                  </div>

                  {/* Actions for Listing Owner */}
                  <div className="col-12 col-md-auto d-flex flex-column gap-2 justify-content-md-end">
                    {/* Accept button (available if offer is PENDING and listing is ACTIVE) */}
                    {isPending && isTargetActive && (
                      <button
                        type="button"
                        className="btn btn-success btn-sm px-3"
                        onClick={() => setAcceptingOffer(offer)}
                        disabled={actionLoading}
                      >
                        ✓ Accept Offer
                      </button>
                    )}

                    {/* Counter button (available if offer is PENDING, for SELL offers, and listing is ACTIVE) */}
                    {isPending && !isBarter && isTargetActive && (
                      <button
                        type="button"
                        className="btn btn-outline-info btn-sm px-3"
                        onClick={() => {
                          setCounteringOfferId(offer.id);
                          setCounterPrice('');
                          setCounterMsg('');
                          setCounterError('');
                        }}
                        disabled={actionLoading}
                      >
                        🔄 Counteroffer
                      </button>
                    )}

                    {/* Reject button (available if offer is PENDING or COUNTERED) */}
                    {(isPending || isCountered) && (
                      <button
                        type="button"
                        className="btn btn-outline-danger btn-sm px-3"
                        onClick={() => handleReject(offer.id)}
                        disabled={actionLoading}
                      >
                        ✕ Reject
                      </button>
                    )}

                    {/* Chat with Buyer */}
                    <Link
                      to={`/messages?offerId=${offer.id}`}
                      className="btn btn-outline-secondary btn-sm px-3"
                    >
                      💬 Chat
                    </Link>

                    {offer.status === 'ACCEPTED' && (
                      <span className="badge bg-success py-2 px-3 text-center">
                        🤝 Agreement Finalized
                      </span>
                    )}
                  </div>
                </div>

                {/* Inline Counteroffer Drawer */}
                {counteringOfferId === offer.id && (
                  <div className="mt-3 pt-3 border-top border-cs">
                    <h6 style={{ color: 'var(--cs-text)', fontWeight: 700, fontSize: '0.9rem' }}>
                      Submit Counteroffer to {offer.buyer?.fullName}
                    </h6>

                    {counterError && (
                      <div className="alert alert-danger py-1 mb-2 small">{counterError}</div>
                    )}

                    <form onSubmit={handleCounter}>
                      <div className="row g-2 mb-2">
                        <div className="col-md-5">
                          <label className="form-label" style={{ fontSize: '0.8rem' }}>
                            Counter Price (₹) *
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            className="form-control form-control-sm"
                            placeholder="e.g. 420.00"
                            value={counterPrice}
                            onChange={(e) => setCounterPrice(e.target.value)}
                            required
                          />
                        </div>
                        <div className="col-md-7">
                          <label className="form-label" style={{ fontSize: '0.8rem' }}>
                            Counter Note (optional)
                          </label>
                          <input
                            type="text"
                            className="form-control form-control-sm"
                            placeholder="e.g. Can meet you halfway at $42"
                            value={counterMsg}
                            onChange={(e) => setCounterMsg(e.target.value)}
                          />
                        </div>
                      </div>

                      <div className="d-flex justify-content-end gap-2">
                        <button
                          type="button"
                          className="btn btn-outline-secondary btn-sm"
                          onClick={() => setCounteringOfferId(null)}
                        >
                          Cancel
                        </button>
                        <button type="submit" className="btn btn-primary btn-sm" disabled={actionLoading}>
                          {actionLoading ? <span className="spinner-border spinner-border-sm me-1" /> : null}
                          Send Counteroffer
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Accept Offer Confirmation Dialog / Modal Overlay */}
      {acceptingOffer && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1050,
            padding: '1rem',
          }}
        >
          <div className="card p-4 fade-in-up" style={{ maxWidth: 500, width: '100%', background: 'var(--cs-surface)' }}>
            <div className="d-flex align-items-center gap-2 mb-3">
              <span style={{ fontSize: '1.8rem' }}>🤝</span>
              <h4 style={{ color: 'var(--cs-text)', fontWeight: 800, margin: 0 }}>
                Accept Offer?
              </h4>
            </div>

            <p style={{ color: 'var(--cs-text-muted)', fontSize: '0.92rem' }}>
              You are about to accept the proposal from{' '}
              <strong style={{ color: 'var(--cs-text)' }}>{acceptingOffer.buyer?.fullName}</strong>{' '}
              for{' '}
              <strong style={{ color: 'var(--cs-accent)' }}>
                {acceptingOffer.offerType === 'PURCHASE'
                  ? `₹${parseFloat(acceptingOffer.offeredPrice || 0).toFixed(0)}`
                  : `Barter Exchange (+₹${parseFloat(acceptingOffer.cashDifference || 0).toFixed(0)})`}
              </strong>
              .
            </p>

            <div
              className="p-3 mb-4 rounded"
              style={{ background: 'var(--cs-surface2)', fontSize: '0.85rem', color: 'var(--cs-text-muted)' }}
            >
              <div className="mb-1 text-warning font-weight-bold">⚠️ Concurrency &amp; State Action:</div>
              <ul className="mb-0 ps-3">
                <li>Listing status will transition immediately to <strong>RESERVED</strong>.</li>
                <li>All competing pending offers will be cancelled automatically by the system.</li>
                <li>A verified meetup transaction will be initiated.</li>
              </ul>
            </div>

            <div className="d-flex justify-content-end gap-2">
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => setAcceptingOffer(null)}
                disabled={actionLoading}
              >
                Go Back
              </button>
              <button
                type="button"
                className="btn btn-success px-4"
                onClick={handleAccept}
                disabled={actionLoading}
              >
                {actionLoading ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" role="status" />
                    Accepting…
                  </>
                ) : (
                  'Confirm & Reserve Item'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
