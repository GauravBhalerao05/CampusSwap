import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { listingsApi, offersApi } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import Spinner from '../components/Spinner';

const STATUS_COLORS = {
  ACTIVE: 'success',
  RESERVED: 'warning',
  COMPLETED: 'info',
  CANCELLED: 'danger',
  DELETED_BY_ADMIN: 'danger',
};

const COND_LABELS = {
  NEW: '🌟 New',
  LIKE_NEW: '✨ Like New',
  GOOD: '👍 Good',
  FAIR: '📖 Fair',
};

function StarRow({ rating, count }) {
  const r = Math.round(rating || 0);
  return (
    <span className="d-inline-flex align-items-center gap-1" style={{ fontSize: '0.85rem' }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= r ? 'star' : 'star-empty'}>
          ★
        </span>
      ))}
      <span className="text-dim">({count || 0} reviews)</span>
    </span>
  );
}

export default function ListingDetailPage() {
  const { id } = useParams();
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Buyer Interaction State
  const [interactionTab, setInteractionTab] = useState('PURCHASE'); // 'PURCHASE' | 'BARTER'
  const [offerPrice, setOfferPrice] = useState('');
  const [offerMsg, setOfferMsg] = useState('');
  const [offerLoading, setOfferLoading] = useState(false);
  const [offerError, setOfferError] = useState('');
  const [offerSuccess, setOfferSuccess] = useState('');

  // Barter Offer State
  const [userActiveListings, setUserActiveListings] = useState([]);
  const [selectedOfferedId, setSelectedOfferedId] = useState('');
  const [cashDifference, setCashDifference] = useState('');
  const [loadingUserItems, setLoadingUserItems] = useState(false);

  // Active Submitted Offer tracking for current user (enables Withdraw action)
  const [activeOffer, setActiveOffer] = useState(() => {
    try {
      const stored = localStorage.getItem(`campusswap_offer_${id}`);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [withdrawing, setWithdrawing] = useState(false);

  // Cancel listing
  const [cancelling, setCancelling] = useState(false);

  // Image viewer index
  const [imgIdx, setImgIdx] = useState(0);

  // Fetch listing details
  useEffect(() => {
    setLoading(true);
    listingsApi
      .get(id)
      .then((r) => {
        const item = r.data.data;
        setListing(item);
        if (item.mode === 'BARTER') {
          setInteractionTab('BARTER');
        } else {
          setInteractionTab('PURCHASE');
        }
      })
      .catch(() => setError('Listing not found.'))
      .finally(() => setLoading(false));
  }, [id]);

  // Load current user's active listings if user is authenticated, not the seller, and listing is in BARTER mode
  useEffect(() => {
    if (isAuthenticated && user?.id && listing && Number(user.id) !== Number(listing.seller?.id) && listing.mode === 'BARTER') {
      setLoadingUserItems(true);
      listingsApi
        .search({ sellerId: user.id, status: 'ACTIVE', limit: 50 })
        .then((res) => {
          const items = (res.data.data.items || []).filter(
            (item) => String(item.id) !== String(id)
          );
          setUserActiveListings(items);
          if (items.length > 0) {
            setSelectedOfferedId(String(items[0].id));
          }
        })
        .catch(() => {})
        .finally(() => setLoadingUserItems(false));
    }
  }, [isAuthenticated, user?.id, listing, id]);

  if (loading) {
    return (
      <div className="container py-5">
        <Spinner />
      </div>
    );
  }

  if (error || !listing) {
    return (
      <div className="container py-5">
        <div className="alert alert-danger">{error || 'Listing not found.'}</div>
        <Link to="/listings" className="btn btn-outline-primary">
          ← Back to Marketplace
        </Link>
      </div>
    );
  }

  const isSeller = Boolean(user?.id && listing?.seller?.id && Number(user.id) === Number(listing.seller.id));
  const isActive = listing.status === 'ACTIVE';
  const isFree = listing.mode === 'FREE';
  const isBarter = listing.mode === 'BARTER';
  const isSell = listing.mode === 'SELL';
  const isNegotiable = Boolean(listing.isNegotiable);

  // Claim free item handler
  const handleClaim = async () => {
    setOfferLoading(true);
    setOfferError('');
    setOfferSuccess('');
    try {
      await listingsApi.claim(id, { message: offerMsg || undefined });
      setOfferSuccess('✅ Item claimed successfully! Check your transactions for pickup details.');
      setListing((prev) => ({ ...prev, status: 'RESERVED' }));
    } catch (err) {
      setOfferError(err.response?.data?.error?.message || 'Could not claim item.');
    } finally {
      setOfferLoading(false);
    }
  };

  // Submit monetary purchase offer or agreed-price purchase
  const handlePurchaseOffer = async (e) => {
    e.preventDefault();
    const price = isNegotiable ? parseFloat(offerPrice) : parseFloat(listing.price);
    if (isNaN(price) || price <= 0) {
      setOfferError('Please enter a valid price greater than zero.');
      return;
    }

    setOfferLoading(true);
    setOfferError('');
    setOfferSuccess('');

    try {
      const res = await listingsApi.createOffer(id, {
        offerType: 'PURCHASE',
        offeredPrice: price,
        message: offerMsg.trim() || undefined,
      });

      const offerData = res.data.data;
      const recorded = {
        offerId: offerData.offerId,
        type: 'PURCHASE',
        amount: price,
        status: 'PENDING',
      };
      setActiveOffer(recorded);
      localStorage.setItem(`campusswap_offer_${id}`, JSON.stringify(recorded));

      setOfferSuccess(
        isNegotiable
          ? '✅ Offer submitted! The seller will review your offer.'
          : `✅ Purchase request submitted at asking price (₹${price.toFixed(0)})! The seller will coordinate pickup.`
      );
    } catch (err) {
      setOfferError(err.response?.data?.error?.message || 'Could not submit offer.');
    } finally {
      setOfferLoading(false);
    }
  };

  // Submit barter proposal
  const handleBarterProposal = async (e) => {
    e.preventDefault();
    const offeredId = parseInt(selectedOfferedId, 10);
    if (isNaN(offeredId)) {
      setOfferError('Please select one of your active listings to offer.');
      return;
    }

    const cashDiff = cashDifference !== '' ? parseFloat(cashDifference) : 0.0;
    if (isNaN(cashDiff) || cashDiff < 0) {
      setOfferError('Cash difference must be ₹0.00 or greater.');
      return;
    }

    setOfferLoading(true);
    setOfferError('');
    setOfferSuccess('');

    try {
      const res = await listingsApi.createBarter(id, {
        offeredListingId: offeredId,
        cashDifference: cashDiff,
        message: offerMsg.trim() || undefined,
      });

      const offerData = res.data.data;
      const recorded = {
        offerId: offerData.offerId,
        type: 'BARTER',
        offeredListingId: offeredId,
        cashDifference: cashDiff,
        status: 'PENDING',
      };
      setActiveOffer(recorded);
      localStorage.setItem(`campusswap_offer_${id}`, JSON.stringify(recorded));

      setOfferSuccess('✅ Barter proposal submitted! The seller will review your exchange offer.');
    } catch (err) {
      setOfferError(err.response?.data?.error?.message || 'Could not submit barter proposal.');
    } finally {
      setOfferLoading(false);
    }
  };

  // Withdraw active offer
  const handleWithdrawOffer = async () => {
    if (!activeOffer?.offerId) return;
    if (!window.confirm('Are you sure you want to withdraw your offer?')) return;

    setWithdrawing(true);
    setOfferError('');

    try {
      await offersApi.withdraw(activeOffer.offerId);
      setActiveOffer(null);
      localStorage.removeItem(`campusswap_offer_${id}`);
      setOfferSuccess('Your offer was successfully withdrawn.');
    } catch (err) {
      setOfferError(err.response?.data?.error?.message || 'Could not withdraw offer.');
    } finally {
      setWithdrawing(false);
    }
  };

  // Cancel listing (Owner only)
  const handleCancel = async () => {
    if (!window.confirm('Are you sure you want to cancel this listing? All pending offers will be cancelled.')) return;
    setCancelling(true);
    try {
      await listingsApi.remove(id);
      navigate('/my-listings');
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Could not cancel listing.');
    } finally {
      setCancelling(false);
    }
  };

  const images = listing.images || [];

  return (
    <div className="container py-4 fade-in-up">
      <div className="mb-3">
        <Link to="/listings" className="text-muted-cs text-decoration-none" style={{ fontSize: '0.9rem' }}>
          ← Back to Marketplace
        </Link>
      </div>

      <div className="row g-4">
        {/* Images Column */}
        <div className="col-lg-6">
          <div
            style={{
              borderRadius: 'var(--cs-radius)',
              overflow: 'hidden',
              background: 'var(--cs-surface2)',
              aspectRatio: '4/3',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {images.length > 0 ? (
              <img
                src={images[imgIdx]?.imageUrl}
                alt={listing.title}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={(e) => {
                  e.target.style.display = 'none';
                }}
              />
            ) : (
              <div style={{ fontSize: '5rem', color: 'var(--cs-text-dim)' }}>📦</div>
            )}
          </div>

          {images.length > 1 && (
            <div className="d-flex gap-2 mt-2 flex-wrap">
              {images.map((img, i) => (
                <div
                  key={img.id}
                  onClick={() => setImgIdx(i)}
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 8,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    border: `2px solid ${i === imgIdx ? 'var(--cs-primary)' : 'var(--cs-border)'}`,
                  }}
                >
                  <img src={img.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Details Column */}
        <div className="col-lg-6">
          <div className="d-flex align-items-start gap-2 mb-2 flex-wrap">
            <span className={`badge mode-${listing.mode}`}>{listing.mode}</span>
            <span className={`badge bg-${STATUS_COLORS[listing.status] || 'secondary'}`}>{listing.status}</span>
            <span className="badge bg-secondary">{COND_LABELS[listing.itemCondition] || listing.itemCondition}</span>
          </div>

          <h1 style={{ fontWeight: 800, fontSize: '1.6rem', lineHeight: 1.3 }}>{listing.title}</h1>

          {listing.mode === 'SELL' && (
            <div className="my-3">
              <span className="price-tag" style={{ fontSize: '2rem' }}>
                ₹{parseFloat(listing.price).toFixed(0)}
              </span>
              {isNegotiable ? (
                <span className="badge bg-info ms-2">Negotiable</span>
              ) : (
                <span className="badge bg-secondary ms-2">Non-negotiable</span>
              )}
            </div>
          )}

          {listing.mode === 'FREE' && (
            <div className="my-3" style={{ color: 'var(--cs-success)', fontWeight: 800, fontSize: '1.8rem' }}>
              FREE 🎁
            </div>
          )}

          {listing.mode === 'BARTER' && (
            <div className="my-3">
              <span style={{ color: '#fcd34d', fontWeight: 800, fontSize: '1.4rem' }}>BARTER 🔄</span>
              {listing.barterPreferences && (
                <p className="text-muted-cs mt-1" style={{ fontSize: '0.9rem' }}>
                  Looking for: <strong>{listing.barterPreferences}</strong>
                </p>
              )}
            </div>
          )}

          <p style={{ color: 'var(--cs-text-muted)', lineHeight: 1.8 }}>{listing.description}</p>

          <div className="d-flex flex-wrap gap-3 mb-3">
            {listing.category && (
              <div style={{ fontSize: '0.85rem' }}>
                <span className="text-dim">Category:</span>{' '}
                <span className="text-muted-cs">{listing.category.name}</span>
              </div>
            )}
            <div style={{ fontSize: '0.85rem' }}>
              <span className="text-dim">📍 Pickup:</span>{' '}
              <span className="text-muted-cs">{listing.pickupLocation}</span>
            </div>
          </div>

          {/* Seller info */}
          {listing.seller && (
            <div className="card p-3 mb-4">
              <div className="d-flex align-items-center gap-3">
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
                    flexShrink: 0,
                  }}
                >
                  {listing.seller.fullName?.[0]?.toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 600 }}>{listing.seller.fullName}</div>
                  {listing.seller.department && (
                    <div className="text-muted-cs" style={{ fontSize: '0.8rem' }}>
                      {listing.seller.department}
                    </div>
                  )}
                  <StarRow rating={listing.seller.avgRating} count={listing.seller.totalReviews} />
                </div>
              </div>
            </div>
          )}

          {/* Owner actions */}
          {isSeller && (
            <div className="card p-3 mb-3">
              <div className="d-flex align-items-center gap-2 mb-3">
                <span style={{ fontSize: '1.2rem' }}>👑</span>
                <span style={{ fontWeight: 700, color: 'var(--cs-text)', fontSize: '0.95rem' }}>
                  You are the owner of this listing
                </span>
              </div>

              <div className="d-flex gap-2 flex-wrap">
                {isActive && (
                  <Link to={`/listings/${id}/edit`} className="btn btn-outline-primary btn-sm">
                    ✏️ Edit Listing
                  </Link>
                )}
                {isActive && (
                  <Link to={`/listings/${id}/offers`} className="btn btn-primary btn-sm">
                    📋 View Incoming Offers
                  </Link>
                )}
                {isActive && (
                  <button className="btn btn-outline-danger btn-sm" onClick={handleCancel} disabled={cancelling}>
                    {cancelling ? <span className="spinner-border spinner-border-sm" /> : '🗑 Cancel Listing'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Buyer actions */}
          {!isSeller && isAuthenticated && isActive && (
            <div className="card p-3">
              {/* If buyer has active pending offer on this listing */}
              {activeOffer && (
                <div className="p-3 mb-3 rounded" style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid var(--cs-border)' }}>
                  <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
                    <span className="badge bg-warning text-dark">Your Offer: {activeOffer.status}</span>
                    <span className="text-dim" style={{ fontSize: '0.8rem' }}>Offer #{activeOffer.offerId}</span>
                  </div>
                  <p className="text-muted-cs mb-2" style={{ fontSize: '0.88rem' }}>
                    {activeOffer.type === 'PURCHASE'
                      ? `You submitted a purchase offer of ₹${parseFloat(activeOffer.amount || 0).toFixed(0)}.`
                      : `You submitted a barter exchange proposal.`}
                  </p>
                  <button
                    type="button"
                    className="btn btn-outline-danger btn-sm"
                    onClick={handleWithdrawOffer}
                    disabled={withdrawing}
                  >
                    {withdrawing ? <span className="spinner-border spinner-border-sm me-1" /> : null}
                    ✕ Withdraw Offer
                  </button>
                </div>
              )}

              <h6 style={{ color: 'var(--cs-text)', fontWeight: 700, marginBottom: '1rem' }}>
                {isFree
                  ? '🎁 Claim this item'
                  : isBarter
                  ? '🔄 Propose Barter Exchange'
                  : isNegotiable
                  ? '💬 Make a Purchase Offer'
                  : '🛍 Purchase Item'}
              </h6>

              {offerError && <div className="alert alert-danger py-2 mb-2 small">{offerError}</div>}
              {offerSuccess && <div className="alert alert-success py-2 mb-2 small">{offerSuccess}</div>}

              {!offerSuccess && !activeOffer && (
                isFree ? (
                  <div>
                    <textarea
                      className="form-control mb-3"
                      rows={2}
                      placeholder="Introduction message to seller (optional)…"
                      value={offerMsg}
                      onChange={(e) => setOfferMsg(e.target.value)}
                      style={{ resize: 'none' }}
                    />
                    <button className="btn btn-primary w-100" onClick={handleClaim} disabled={offerLoading}>
                      {offerLoading ? <span className="spinner-border spinner-border-sm me-2" /> : null}
                      Claim Item
                    </button>
                  </div>
                ) : isBarter ? (
                  <div>
                    {loadingUserItems ? (
                      <div className="py-3 text-center">
                        <span className="spinner-border spinner-border-sm me-2" />
                        Loading your active items…
                      </div>
                    ) : userActiveListings.length === 0 ? (
                      <div className="alert alert-warning py-3 mb-0" style={{ fontSize: '0.88rem' }}>
                        <p className="mb-2">
                          To propose a barter, you need at least one <strong>ACTIVE</strong> listing of your own to offer in trade.
                        </p>
                        <Link to="/listings/new" className="btn btn-sm btn-primary">
                          + Create a Listing to Trade
                        </Link>
                      </div>
                    ) : (
                      <form onSubmit={handleBarterProposal}>
                        <div className="mb-3">
                          <label className="form-label" style={{ fontSize: '0.85rem' }}>
                            Select Your Item to Trade *
                          </label>
                          <select
                            className="form-select"
                            value={selectedOfferedId}
                            onChange={(e) => setSelectedOfferedId(e.target.value)}
                            required
                          >
                            {userActiveListings.map((it) => (
                              <option key={it.id} value={it.id}>
                                {it.title} ({it.mode} • ₹{parseFloat(it.price || 0).toFixed(0)})
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="mb-3">
                          <label className="form-label" style={{ fontSize: '0.85rem' }}>
                            Optional Cash Difference (₹)
                          </label>
                          <div className="input-group input-group-sm">
                            <span className="input-group-text" style={{ background: 'var(--cs-surface2)', borderColor: 'var(--cs-border)', color: 'var(--cs-text)' }}>
                              ₹
                            </span>
                            <input
                              type="number"
                              className="form-control"
                              placeholder="0.00 (additional cash you offer)"
                              value={cashDifference}
                              min={0}
                              step={0.01}
                              onChange={(e) => setCashDifference(e.target.value)}
                            />
                          </div>
                          <div className="form-text text-dim" style={{ fontSize: '0.75rem' }}>
                            Extra cash to balance the exchange value, if appropriate.
                          </div>
                        </div>

                        <div className="mb-3">
                          <label className="form-label" style={{ fontSize: '0.85rem' }}>
                            Message / Proposal Notes
                          </label>
                          <textarea
                            className="form-control"
                            rows={2}
                            placeholder="Describe why this trade makes sense and when you can meet…"
                            value={offerMsg}
                            onChange={(e) => setOfferMsg(e.target.value)}
                            style={{ resize: 'none' }}
                          />
                        </div>

                        <button type="submit" className="btn btn-primary w-100" disabled={offerLoading}>
                          {offerLoading ? <span className="spinner-border spinner-border-sm me-2" /> : null}
                          Submit Barter Proposal
                        </button>
                      </form>
                    )}
                  </div>
                ) : (
                  <div>
                    <form onSubmit={handlePurchaseOffer}>
                      {isNegotiable ? (
                        <div className="mb-3">
                          <label className="form-label" style={{ fontSize: '0.85rem' }}>
                            Your Offer Amount (₹) *
                          </label>
                          <input
                            type="number"
                            className="form-control"
                            placeholder={listing.price ? `Asking: ₹${parseFloat(listing.price).toFixed(0)}` : 'Enter amount'}
                            value={offerPrice}
                            min={0.01}
                            step={0.01}
                            onChange={(e) => {
                              setOfferPrice(e.target.value);
                              setOfferError('');
                            }}
                            required
                          />
                        </div>
                      ) : (
                        <div className="mb-3 p-3 rounded" style={{ background: 'var(--cs-surface2)', border: '1px solid var(--cs-border)' }}>
                          <div className="d-flex align-items-center justify-content-between mb-1">
                            <span className="text-dim" style={{ fontSize: '0.85rem' }}>Fixed Asking Price:</span>
                            <span style={{ fontWeight: 800, fontSize: '1.25rem', color: 'var(--cs-primary-light)' }}>
                              ₹{parseFloat(listing.price).toFixed(0)}
                            </span>
                          </div>
                          <div className="text-dim" style={{ fontSize: '0.8rem' }}>
                            This listing is non-negotiable. Purchases proceed at the seller's asking price.
                          </div>
                        </div>
                      )}

                      <div className="mb-3">
                        <label className="form-label" style={{ fontSize: '0.85rem' }}>
                          Message to Seller (optional)
                        </label>
                        <textarea
                          className="form-control"
                          rows={2}
                          placeholder="Hi! I'm interested and can meet on campus…"
                          value={offerMsg}
                          onChange={(e) => setOfferMsg(e.target.value)}
                          style={{ resize: 'none' }}
                        />
                      </div>

                      <button type="submit" className="btn btn-primary w-100" disabled={offerLoading}>
                        {offerLoading ? <span className="spinner-border spinner-border-sm me-2" /> : null}
                        {isNegotiable
                          ? 'Submit Purchase Offer'
                          : `Buy at Asking Price (₹${parseFloat(listing.price).toFixed(0)})`}
                      </button>
                    </form>
                  </div>
                )
              )}
            </div>
          )}

          {!isAuthenticated && isActive && !isSeller && (
            <Link to="/login" className="btn btn-primary w-100">
              {isFree ? 'Sign in to claim item' : 'Sign in to make an offer'}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
