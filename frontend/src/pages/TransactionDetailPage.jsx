import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { transactionsApi, reviewsApi } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import Spinner from '../components/Spinner';
import ReviewCard from '../components/ReviewCard';

const STATUS_CONFIG = {
  PENDING_MEETUP: { label: '🤝 Meetup Pending', badge: 'bg-warning text-dark' },
  COMPLETED: { label: '✅ Completed', badge: 'bg-success' },
  CANCELLED: { label: '✕ Cancelled', badge: 'bg-danger' },
};

const TYPE_CONFIG = {
  SALE: { label: '💰 Purchase & Sale', badge: 'mode-SELL' },
  BARTER: { label: '🔄 Barter Exchange', badge: 'mode-BARTER' },
  FREE_GIVEAWAY: { label: '🎁 Free Giveaway', badge: 'mode-FREE' },
};

const RATING_LABELS = {
  1: '1 Star — Poor experience',
  2: '2 Stars — Below expectations',
  3: '3 Stars — Average / acceptable',
  4: '4 Stars — Very good exchange',
  5: '5 Stars — Excellent peer!',
};

export default function TransactionDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();

  const [tx, setTx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  // Dialog states for complete & cancel confirmation
  const [confirmModal, setConfirmModal] = useState(null); // 'COMPLETE' | 'CANCEL' | null
  const [actionLoading, setActionLoading] = useState(false);

  // Review System States
  const [reviews, setReviews] = useState([]);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [reviewSuccess, setReviewSuccess] = useState('');

  const fetchDetails = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const res = await transactionsApi.get(id);
      const data = res.data.data;
      setTx(data);

      // If completed, fetch reviews
      if (data.status === 'COMPLETED') {
        fetchReviews();
      }
    } catch (err) {
      setError(
        err.response?.data?.error?.message ||
          'Failed to load transaction details. You may not have permission to view this transaction.'
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchReviews = async () => {
    setLoadingReviews(true);
    try {
      const res = await reviewsApi.list({ transactionId: id });
      setReviews(res.data.data?.reviews || []);
    } catch {
      // Ignore background review fetch error
    } finally {
      setLoadingReviews(false);
    }
  };

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  // Complete handover action
  const handleComplete = async () => {
    setActionLoading(true);
    setError('');
    setActionSuccess('');

    try {
      const res = await transactionsApi.complete(id);
      const msg = res.data.data?.message || 'Handover confirmed! The transaction is now COMPLETED.';
      setActionSuccess(`🎉 ${msg}`);
      setConfirmModal(null);
      await fetchDetails();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to complete transaction.');
      setConfirmModal(null);
    } finally {
      setActionLoading(false);
    }
  };

  // Cancel meetup action
  const handleCancel = async () => {
    setActionLoading(true);
    setError('');
    setActionSuccess('');

    try {
      await transactionsApi.cancel(id);
      setActionSuccess('🚫 Transaction cancelled. Reserved listing(s) have been restored to ACTIVE status.');
      setConfirmModal(null);
      await fetchDetails();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to cancel transaction.');
      setConfirmModal(null);
    } finally {
      setActionLoading(false);
    }
  };

  // Submit peer review
  const handleReviewSubmit = async (e) => {
    e.preventDefault();
    if (rating < 1 || rating > 5) {
      setReviewError('Please select a star rating between 1 and 5.');
      return;
    }

    setSubmittingReview(true);
    setReviewError('');
    setReviewSuccess('');

    try {
      await reviewsApi.submit({
        transactionId: parseInt(id, 10),
        rating: parseInt(rating, 10),
        comment: comment.trim() || undefined,
      });

      setReviewSuccess('🌟 Thank you! Your review has been recorded.');
      setComment('');
      await fetchReviews();
    } catch (err) {
      const msg =
        err.response?.data?.error?.message ||
        'Failed to submit review. You may have already reviewed this transaction.';
      setReviewError(msg);
    } finally {
      setSubmittingReview(false);
    }
  };

  if (loading) {
    return (
      <div className="container py-5">
        <Spinner text="Loading transaction details…" />
      </div>
    );
  }

  if (error || !tx) {
    return (
      <div className="container py-5 text-center fade-in-up" style={{ maxWidth: 540 }}>
        <div className="card p-4">
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
          <h4 style={{ color: 'var(--cs-text)', fontWeight: 700 }}>Unable to Load Transaction</h4>
          <p className="text-muted-cs mb-4">{error || 'Transaction could not be found.'}</p>
          <Link to="/transactions" className="btn btn-primary">
            ← Back to Transactions
          </Link>
        </div>
      </div>
    );
  }

  const isPending = tx.status === 'PENDING_MEETUP';
  const isCompleted = tx.status === 'COMPLETED';
  const isCancelled = tx.status === 'CANCELLED';
  const isBarter = tx.transactionType === 'BARTER';
  const isSeller = user && tx.seller && user.id === tx.seller.id;
  const isBuyer = user && tx.buyer && user.id === tx.buyer.id;
  const counterpartyName = isSeller ? tx.buyer?.fullName : tx.seller?.fullName;

  // Determine if current user already submitted a review on this transaction
  const userReview = reviews.find((r) => r.reviewer?.id === user?.id);
  const hasUserReviewed = Boolean(userReview);

  const statusInfo = STATUS_CONFIG[tx.status] || { label: tx.status, badge: 'bg-secondary' };
  const typeInfo = TYPE_CONFIG[tx.transactionType] || { label: tx.transactionType, badge: 'bg-secondary' };

  return (
    <div className="container py-4 fade-in-up" style={{ maxWidth: 860 }}>
      {/* Top Breadcrumb */}
      <div className="d-flex align-items-center justify-content-between mb-3">
        <Link to="/transactions" className="text-muted-cs text-decoration-none" style={{ fontSize: '0.9rem' }}>
          ← Back to All Transactions
        </Link>
        <span className="text-dim" style={{ fontSize: '0.85rem' }}>
          Transaction #{tx.id}
        </span>
      </div>

      {/* Global Alerts */}
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

      {/* Status Notice Banner */}
      {isPending && (
        <div className="alert alert-warning py-3 mb-4 d-flex align-items-center gap-3">
          <span style={{ fontSize: '1.8rem' }}>🤝</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>Meetup in Progress</div>
            <div style={{ fontSize: '0.85rem' }}>
              Meet your campus peer at the pickup location. After item exchange, confirm completion below to finalize the transaction.
            </div>
          </div>
        </div>
      )}

      {isCompleted && (
        <div className="alert alert-success py-3 mb-4 d-flex align-items-center gap-3">
          <span style={{ fontSize: '1.8rem' }}>🎉</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>Transaction Completed</div>
            <div style={{ fontSize: '0.85rem' }}>
              Handover verified on {tx.completedAt ? new Date(tx.completedAt).toLocaleString() : 'record'}. Both participants can leave ratings below.
            </div>
          </div>
        </div>
      )}

      {isCancelled && (
        <div className="alert alert-danger py-3 mb-4 d-flex align-items-center gap-3">
          <span style={{ fontSize: '1.8rem' }}>✕</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>Transaction Cancelled</div>
            <div style={{ fontSize: '0.85rem' }}>
              This meetup was cancelled. The listing has been restored back to ACTIVE status.
            </div>
          </div>
        </div>
      )}

      {/* Main Details Card */}
      <div className="card p-4 p-md-5 mb-4">
        {/* Title & Badges */}
        <div className="d-flex align-items-start justify-content-between mb-4 flex-wrap gap-2">
          <div>
            <div className="d-flex align-items-center gap-2 mb-2 flex-wrap">
              <span className={`badge ${statusInfo.badge}`}>{statusInfo.label}</span>
              <span className={`badge ${typeInfo.badge}`}>{typeInfo.label}</span>
              {isSeller && <span className="badge bg-info text-dark">You are Seller</span>}
              {isBuyer && <span className="badge bg-primary">You are Buyer</span>}
            </div>

            <h1 style={{ fontWeight: 800, fontSize: '1.6rem', color: 'var(--cs-text)', marginBottom: '0.2rem' }}>
              {tx.listing?.title}
            </h1>

            <div className="text-dim" style={{ fontSize: '0.85rem' }}>
              Initiated {new Date(tx.createdAt).toLocaleString()}
              {tx.completedAt && ` • Completed ${new Date(tx.completedAt).toLocaleString()}`}
            </div>
          </div>

          <div className="text-md-end">
            <div className="text-dim" style={{ fontSize: '0.78rem' }}>
              {isBarter ? 'Cash Difference' : 'Settlement Price'}
            </div>
            <div className="price-tag" style={{ fontSize: '1.8rem' }}>
              {tx.transactionType === 'FREE_GIVEAWAY'
                ? 'FREE'
                : `₹${parseFloat(tx.finalPrice || 0).toFixed(0)}`}
            </div>
          </div>
        </div>

        <hr style={{ borderColor: 'var(--cs-border)', margin: '1.5rem 0' }} />

        {/* Section: Campus Pickup Location */}
        <div className="mb-4">
          <h5 style={{ color: 'var(--cs-text)', fontWeight: 700, fontSize: '1.05rem', marginBottom: '0.6rem' }}>
            📍 Campus Meetup &amp; Handover Location
          </h5>
          <div
            className="p-3 rounded d-flex align-items-center gap-3"
            style={{ background: 'var(--cs-surface2)', border: '1px solid var(--cs-border)' }}
          >
            <span style={{ fontSize: '1.6rem' }}>🏛️</span>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--cs-text)' }}>
                {tx.listing?.pickupLocation || 'Main Campus'}
              </div>
              <div className="text-muted-cs" style={{ fontSize: '0.82rem' }}>
                Campus safety guideline: Meet in a well-lit, public campus spot (library, student center, or department foyer).
              </div>
            </div>
          </div>
        </div>

        {/* Section: Participants */}
        <div className="mb-4">
          <h5 style={{ color: 'var(--cs-text)', fontWeight: 700, fontSize: '1.05rem', marginBottom: '0.8rem' }}>
            👥 Exchange Participants
          </h5>
          <div className="row g-3">
            {/* Seller Card */}
            <div className="col-12 col-md-6">
              <div className="p-3 rounded" style={{ background: 'var(--cs-surface2)', border: '1px solid var(--cs-border)' }}>
                <div className="d-flex align-items-center justify-content-between mb-1">
                  <span className="text-dim" style={{ fontSize: '0.78rem' }}>SELLER</span>
                  {isSeller && <span className="badge bg-secondary" style={{ fontSize: '0.7rem' }}>You</span>}
                </div>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--cs-text)' }}>
                  {tx.seller?.fullName}
                </div>
              </div>
            </div>

            {/* Buyer Card */}
            <div className="col-12 col-md-6">
              <div className="p-3 rounded" style={{ background: 'var(--cs-surface2)', border: '1px solid var(--cs-border)' }}>
                <div className="d-flex align-items-center justify-content-between mb-1">
                  <span className="text-dim" style={{ fontSize: '0.78rem' }}>BUYER / CLAIMER</span>
                  {isBuyer && <span className="badge bg-secondary" style={{ fontSize: '0.7rem' }}>You</span>}
                </div>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--cs-text)' }}>
                  {tx.buyer?.fullName}
                </div>
              </div>
            </div>
          </div>
          <div className="mt-3 text-end">
            <Link
              to={`/messages?transactionId=${tx.id}`}
              className="btn btn-outline-primary btn-sm"
            >
              💬 Message {isSeller ? tx.buyer?.fullName : tx.seller?.fullName}
            </Link>
          </div>
        </div>

        {/* Section: Items Involved */}
        <div className="mb-4">
          <h5 style={{ color: 'var(--cs-text)', fontWeight: 700, fontSize: '1.05rem', marginBottom: '0.8rem' }}>
            📦 Items in this Exchange
          </h5>
          <div className="d-flex flex-column gap-2">
            <div className="p-3 rounded d-flex align-items-center justify-content-between flex-wrap gap-2" style={{ background: 'var(--cs-surface2)', border: '1px solid var(--cs-border)' }}>
              <div>
                <span className="badge bg-primary me-2">Primary Item</span>
                <span style={{ fontWeight: 600, color: 'var(--cs-text)' }}>{tx.listing?.title}</span>
              </div>
              <Link to={`/listings/${tx.listing?.id}`} className="btn btn-outline-primary btn-sm py-1">
                View Listing ↗
              </Link>
            </div>

            {tx.barterListing && (
              <div className="p-3 rounded d-flex align-items-center justify-content-between flex-wrap gap-2" style={{ background: 'var(--cs-surface2)', border: '1px solid var(--cs-border)' }}>
                <div>
                  <span className="badge mode-BARTER me-2">Traded Barter Item</span>
                  <span style={{ fontWeight: 600, color: 'var(--cs-text)' }}>{tx.barterListing?.title}</span>
                </div>
                <Link to={`/listings/${tx.barterListing?.id}`} className="btn btn-outline-warning btn-sm py-1">
                  View Traded Item ↗
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Handover Action Buttons */}
        {isPending && (
          <div className="pt-3 border-top border-cs">
            <div className="d-flex align-items-center justify-content-between flex-wrap gap-3">
              <div>
                <h6 style={{ color: 'var(--cs-text)', fontWeight: 700, marginBottom: '0.2rem' }}>
                  Handover Confirmation
                </h6>
                <p className="text-muted-cs mb-0" style={{ fontSize: '0.85rem' }}>
                  Have you met on campus and completed the item exchange?
                </p>
              </div>

              <div className="d-flex gap-2 flex-wrap">
                <button
                  type="button"
                  className="btn btn-outline-danger btn-sm px-3"
                  onClick={() => setConfirmModal('CANCEL')}
                  disabled={actionLoading}
                >
                  ✕ Cancel Meetup
                </button>

                <button
                  type="button"
                  className="btn btn-success btn-sm px-4"
                  onClick={() => setConfirmModal('COMPLETE')}
                  disabled={actionLoading}
                >
                  ✓ Mark as Completed
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Section: Peer Reviews & Reputation */}
      {isCompleted && (
        <div className="card p-4 p-md-5 mb-4">
          <div className="d-flex align-items-center gap-2 mb-3">
            <span style={{ fontSize: '1.5rem' }}>🌟</span>
            <h4 style={{ color: 'var(--cs-text)', fontWeight: 800, margin: 0, fontSize: '1.25rem' }}>
              Peer Rating &amp; Review
            </h4>
          </div>

          {/* Feedback submit success */}
          {reviewSuccess && (
            <div className="alert alert-success py-2 mb-3 small" role="alert">
              {reviewSuccess}
            </div>
          )}

          {/* Feedback submit error */}
          {reviewError && (
            <div className="alert alert-danger py-2 mb-3 small" role="alert">
              {reviewError}
            </div>
          )}

          {/* Review Submission Form if current user has not yet reviewed */}
          {!hasUserReviewed ? (
            <form onSubmit={handleReviewSubmit} className="p-3 mb-4 rounded" style={{ background: 'var(--cs-surface2)', border: '1px solid var(--cs-border)' }}>
              <h6 style={{ color: 'var(--cs-text)', fontWeight: 700, marginBottom: '0.3rem' }}>
                Rate your exchange with {counterpartyName}
              </h6>
              <p className="text-muted-cs mb-3" style={{ fontSize: '0.82rem' }}>
                Your feedback builds trust across the campus community.
              </p>

              {/* Interactive 5-Star Selection */}
              <div className="mb-3">
                <label className="form-label d-block mb-1" style={{ fontSize: '0.85rem' }}>
                  Rating (1 to 5 Stars) *
                </label>
                <div className="d-flex align-items-center gap-2">
                  {[1, 2, 3, 4, 5].map((starVal) => (
                    <button
                      key={starVal}
                      type="button"
                      className="btn p-0 border-0"
                      style={{
                        fontSize: '1.8rem',
                        lineHeight: 1,
                        color: starVal <= rating ? 'var(--cs-accent)' : 'var(--cs-text-dim)',
                        transition: 'transform 0.15s',
                        background: 'none',
                      }}
                      onClick={() => setRating(starVal)}
                      title={`${starVal} Star${starVal > 1 ? 's' : ''}`}
                    >
                      ★
                    </button>
                  ))}
                  <span className="text-muted-cs ms-2" style={{ fontSize: '0.85rem' }}>
                    {RATING_LABELS[rating]}
                  </span>
                </div>
              </div>

              {/* Optional Comment */}
              <div className="mb-3">
                <label className="form-label" style={{ fontSize: '0.85rem' }}>
                  Comments (optional)
                </label>
                <textarea
                  className="form-control form-control-sm"
                  rows={3}
                  placeholder="e.g. Prompt communication, met on time at the library, item in great shape!"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  maxLength={500}
                />
              </div>

              <div className="d-flex justify-content-end">
                <button type="submit" className="btn btn-primary btn-sm px-4" disabled={submittingReview}>
                  {submittingReview ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" role="status" />
                      Submitting Review…
                    </>
                  ) : (
                    'Submit Peer Review'
                  )}
                </button>
              </div>
            </form>
          ) : (
            <div className="p-3 mb-4 rounded d-flex align-items-center gap-2" style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: '#6ee7b7', fontSize: '0.88rem' }}>
              <span>✓</span>
              <span>You have already submitted a review for this transaction.</span>
            </div>
          )}

          {/* Display Existing Reviews for this transaction */}
          <div className="mt-2">
            <h6 style={{ color: 'var(--cs-text)', fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.8rem' }}>
              Reviews on this Transaction ({reviews.length})
            </h6>

            {loadingReviews ? (
              <div className="text-muted-cs small py-2">
                <span className="spinner-border spinner-border-sm me-2" />
                Loading peer feedback…
              </div>
            ) : reviews.length === 0 ? (
              <div className="text-muted-cs small fst-italic py-1">
                No reviews recorded yet for this completed exchange.
              </div>
            ) : (
              <div className="d-flex flex-column gap-2">
                {reviews.map((r) => (
                  <ReviewCard key={r.id} review={r} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirmation Modal Overlay */}
      {confirmModal && (
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
            {confirmModal === 'COMPLETE' && (
              <>
                <div className="d-flex align-items-center gap-2 mb-3">
                  <span style={{ fontSize: '1.8rem' }}>🤝</span>
                  <h4 style={{ color: 'var(--cs-text)', fontWeight: 800, margin: 0 }}>
                    Confirm Item Handover?
                  </h4>
                </div>

                <p style={{ color: 'var(--cs-text-muted)', fontSize: '0.9rem' }}>
                  Please confirm that you have physically met with{' '}
                  <strong style={{ color: 'var(--cs-text)' }}>
                    {counterpartyName}
                  </strong>{' '}
                  and that the item and payment/barter trade were verified.
                </p>

                <div
                  className="p-3 mb-4 rounded"
                  style={{ background: 'var(--cs-surface2)', fontSize: '0.85rem', color: 'var(--cs-text-muted)' }}
                >
                  <div className="text-success font-weight-bold mb-1">✓ Outcome of Completion:</div>
                  <ul className="mb-0 ps-3">
                    <li>Transaction status will permanently record as <strong>COMPLETED</strong>.</li>
                    <li>Associated listing status transitions to <strong>COMPLETED</strong>.</li>
                    <li>Both parties will unlock peer review &amp; rating eligibility.</li>
                  </ul>
                </div>

                <div className="d-flex justify-content-end gap-2">
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => setConfirmModal(null)}
                    disabled={actionLoading}
                  >
                    Not Yet
                  </button>
                  <button
                    type="button"
                    className="btn btn-success px-4"
                    onClick={handleComplete}
                    disabled={actionLoading}
                  >
                    {actionLoading ? <span className="spinner-border spinner-border-sm me-1" /> : null}
                    Yes, Handover Completed
                  </button>
                </div>
              </>
            )}

            {confirmModal === 'CANCEL' && (
              <>
                <div className="d-flex align-items-center gap-2 mb-3">
                  <span style={{ fontSize: '1.8rem' }}>⚠️</span>
                  <h4 style={{ color: 'var(--cs-text)', fontWeight: 800, margin: 0 }}>
                    Cancel This Meetup?
                  </h4>
                </div>

                <p style={{ color: 'var(--cs-text-muted)', fontSize: '0.9rem' }}>
                  Are you sure you want to abort this meetup with{' '}
                  <strong style={{ color: 'var(--cs-text)' }}>
                    {counterpartyName}
                  </strong>
                  ?
                </p>

                <div
                  className="p-3 mb-4 rounded"
                  style={{ background: 'var(--cs-surface2)', fontSize: '0.85rem', color: 'var(--cs-text-muted)' }}
                >
                  <div className="text-warning font-weight-bold mb-1">⚠️ Cancellation Details:</div>
                  <ul className="mb-0 ps-3">
                    <li>Transaction will be marked as <strong>CANCELLED</strong>.</li>
                    <li>The reserved listing(s) will be restored to <strong>ACTIVE</strong> on the campus catalog.</li>
                    <li>New offers may be placed on the restored listing.</li>
                  </ul>
                </div>

                <div className="d-flex justify-content-end gap-2">
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => setConfirmModal(null)}
                    disabled={actionLoading}
                  >
                    Keep Meetup
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger px-4"
                    onClick={handleCancel}
                    disabled={actionLoading}
                  >
                    {actionLoading ? <span className="spinner-border spinner-border-sm me-1" /> : null}
                    Confirm Cancellation
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
