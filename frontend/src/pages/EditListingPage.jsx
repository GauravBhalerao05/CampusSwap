import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { listingsApi } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import Spinner from '../components/Spinner';

const CONDITIONS = [
  { value: 'NEW', label: '🌟 New (Unopened/Unused)' },
  { value: 'LIKE_NEW', label: '✨ Like New (Barely used, pristine)' },
  { value: 'GOOD', label: '👍 Good (Normal wear, fully functional)' },
  { value: 'FAIR', label: '📖 Fair (Noticeable wear, fully usable)' },
];

export default function EditListingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [serverError, setServerError] = useState('');
  const [errors, setErrors] = useState({});

  // Immutable listing metadata
  const [listingMeta, setListingMeta] = useState(null);

  // Editable fields form state
  const [form, setForm] = useState({
    title: '',
    description: '',
    price: '',
    isNegotiable: false,
    barterPreferences: '',
    itemCondition: 'GOOD',
    pickupLocation: '',
  });

  useEffect(() => {
    setLoading(true);
    setLoadError('');

    listingsApi
      .get(id)
      .then((res) => {
        const item = res.data.data;
        if (!item) {
          setLoadError('Listing not found.');
          return;
        }

        // Ownership validation
        if (user && item.seller && item.seller.id !== user.id) {
          setLoadError('You are not authorized to edit this listing.');
          return;
        }

        // State machine restriction
        if (item.status !== 'ACTIVE') {
          setLoadError(
            `Only ACTIVE listings can be edited. This listing is currently marked as ${item.status}.`
          );
          return;
        }

        setListingMeta(item);
        setForm({
          title: item.title || '',
          description: item.description || '',
          price: item.price !== null && item.price !== undefined ? String(parseFloat(item.price)) : '',
          isNegotiable: Boolean(item.isNegotiable),
          barterPreferences: item.barterPreferences || '',
          itemCondition: item.itemCondition || 'GOOD',
          pickupLocation: item.pickupLocation || '',
        });
      })
      .catch((err) => {
        setLoadError(err.response?.data?.error?.message || 'Failed to fetch listing details.');
      })
      .finally(() => setLoading(false));
  }, [id, user]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
    setServerError('');
  };

  const validate = () => {
    const newErrors = {};

    if (!form.title.trim()) {
      newErrors.title = 'Title is required.';
    } else if (form.title.trim().length < 5 || form.title.trim().length > 100) {
      newErrors.title = 'Title must be between 5 and 100 characters.';
    }

    if (!form.description.trim()) {
      newErrors.description = 'Description is required.';
    } else if (form.description.trim().length < 10 || form.description.trim().length > 2000) {
      newErrors.description = 'Description must be between 10 and 2000 characters.';
    }

    if (!form.pickupLocation.trim()) {
      newErrors.pickupLocation = 'Campus pickup location is required.';
    }

    if (listingMeta?.mode === 'SELL') {
      const p = parseFloat(form.price);
      if (!form.price || isNaN(p) || p <= 0) {
        newErrors.price = 'Price is required and must be greater than ₹0.00 for SELL listings.';
      }
    } else if (listingMeta?.mode === 'BARTER') {
      if (!form.barterPreferences.trim()) {
        newErrors.barterPreferences = 'Barter preferences description cannot be empty.';
      }
      if (form.price) {
        const p = parseFloat(form.price);
        if (isNaN(p) || p < 0) {
          newErrors.price = 'Cash adjustment must be ₹0.00 or greater.';
        }
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    setServerError('');

    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim(),
        itemCondition: form.itemCondition,
        pickupLocation: form.pickupLocation.trim(),
      };

      if (listingMeta.mode === 'SELL') {
        payload.price = parseFloat(form.price);
        payload.isNegotiable = form.isNegotiable;
      } else if (listingMeta.mode === 'BARTER') {
        payload.barterPreferences = form.barterPreferences.trim();
        if (form.price !== '') {
          payload.price = parseFloat(form.price);
        } else {
          payload.price = null;
        }
      }

      await listingsApi.update(id, payload);
      navigate(`/listings/${id}`);
    } catch (err) {
      const msg =
        err.response?.data?.error?.message ||
        'Failed to update listing. Please verify inputs and try again.';
      setServerError(msg);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="container py-5">
        <Spinner text="Loading listing details…" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="container py-5 text-center fade-in-up" style={{ maxWidth: 540 }}>
        <div className="card p-4">
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
          <h4 style={{ color: 'var(--cs-text)', fontWeight: 700 }}>Cannot Edit Listing</h4>
          <p className="text-muted-cs mb-4">{loadError}</p>
          <div className="d-flex justify-content-center gap-2">
            <Link to={`/listings/${id}`} className="btn btn-primary">
              View Listing
            </Link>
            <Link to="/my-listings" className="btn btn-outline-secondary">
              My Listings
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-4 fade-in-up" style={{ maxWidth: 840 }}>
      {/* Breadcrumbs */}
      <div className="d-flex align-items-center justify-content-between mb-3">
        <Link to={`/listings/${id}`} className="text-muted-cs text-decoration-none" style={{ fontSize: '0.9rem' }}>
          ← Back to Listing Details
        </Link>
        <Link to="/my-listings" className="text-muted-cs text-decoration-none" style={{ fontSize: '0.9rem' }}>
          My Listings
        </Link>
      </div>

      <div className="card p-4 p-md-5">
        <div className="d-flex align-items-start justify-content-between mb-4 flex-wrap gap-2">
          <div>
            <h1 style={{ fontWeight: 800, fontSize: '1.6rem', color: 'var(--cs-text)', marginBottom: '0.2rem' }}>
              Edit Listing
            </h1>
            <p className="text-muted-cs mb-0" style={{ fontSize: '0.88rem' }}>
              Update your listing information, pricing, and pickup details.
            </p>
          </div>

          <div className="d-flex align-items-center gap-2">
            <span className={`badge mode-${listingMeta?.mode}`}>
              {listingMeta?.mode}
            </span>
            <span className="badge bg-success">
              {listingMeta?.status}
            </span>
          </div>
        </div>

        {serverError && (
          <div className="alert alert-danger py-2 mb-4" role="alert">
            {serverError}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          {/* Title */}
          <div className="mb-3">
            <label className="form-label" htmlFor="title">
              Listing Title *
            </label>
            <input
              id="title"
              name="title"
              type="text"
              className={`form-control ${errors.title ? 'is-invalid' : ''}`}
              value={form.title}
              onChange={handleChange}
              maxLength={100}
            />
            {errors.title && <div className="invalid-feedback d-block">{errors.title}</div>}
          </div>

          {/* Condition */}
          <div className="mb-3">
            <label className="form-label" htmlFor="itemCondition">
              Item Condition *
            </label>
            <select
              id="itemCondition"
              name="itemCondition"
              className="form-select"
              value={form.itemCondition}
              onChange={handleChange}
            >
              {CONDITIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          {/* Mode-Specific Pricing */}
          {listingMeta?.mode === 'SELL' && (
            <div className="card p-3 mb-3" style={{ background: 'var(--cs-surface2)', border: '1px solid var(--cs-border)' }}>
              <div className="row g-3 align-items-center">
                <div className="col-md-6">
                  <label className="form-label" htmlFor="price">
                    Price (₹) *
                  </label>
                  <div className="input-group">
                    <span className="input-group-text" style={{ background: 'var(--cs-surface)', borderColor: 'var(--cs-border)', color: 'var(--cs-text)' }}>
                      ₹
                    </span>
                    <input
                      id="price"
                      name="price"
                      type="number"
                      step="0.01"
                      min="0.01"
                      className={`form-control ${errors.price ? 'is-invalid' : ''}`}
                      value={form.price}
                      onChange={handleChange}
                    />
                  </div>
                  {errors.price && <div className="invalid-feedback d-block">{errors.price}</div>}
                </div>

                <div className="col-md-6 pt-md-4">
                  <div className="form-check">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id="isNegotiable"
                      name="isNegotiable"
                      checked={form.isNegotiable}
                      onChange={handleChange}
                    />
                    <label className="form-check-label" htmlFor="isNegotiable" style={{ color: 'var(--cs-text)' }}>
                      Price is negotiable
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}

          {listingMeta?.mode === 'BARTER' && (
            <div className="card p-3 mb-3" style={{ background: 'var(--cs-surface2)', border: '1px solid var(--cs-border)' }}>
              <div className="mb-3">
                <label className="form-label" htmlFor="barterPreferences">
                  Barter Preferences *
                </label>
                <textarea
                  id="barterPreferences"
                  name="barterPreferences"
                  className={`form-control ${errors.barterPreferences ? 'is-invalid' : ''}`}
                  rows={2}
                  value={form.barterPreferences}
                  onChange={handleChange}
                />
                {errors.barterPreferences && (
                  <div className="invalid-feedback d-block">{errors.barterPreferences}</div>
                )}
              </div>

              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label" htmlFor="price">
                    Cash Adjustment (₹)
                  </label>
                  <div className="input-group input-group-sm">
                    <span className="input-group-text" style={{ background: 'var(--cs-surface)', borderColor: 'var(--cs-border)', color: 'var(--cs-text)' }}>
                      ₹
                    </span>
                    <input
                      id="price"
                      name="price"
                      type="number"
                      step="0.01"
                      min="0"
                      className={`form-control ${errors.price ? 'is-invalid' : ''}`}
                      value={form.price}
                      onChange={handleChange}
                    />
                  </div>
                  {errors.price && <div className="invalid-feedback d-block">{errors.price}</div>}
                </div>
              </div>
            </div>
          )}

          {listingMeta?.mode === 'FREE' && (
            <div className="alert alert-info py-2 mb-3">
              🎁 Free Giveaway item: Price remains ₹0.00.
            </div>
          )}

          {/* Description */}
          <div className="mb-3">
            <label className="form-label" htmlFor="description">
              Description *
            </label>
            <textarea
              id="description"
              name="description"
              className={`form-control ${errors.description ? 'is-invalid' : ''}`}
              rows={4}
              value={form.description}
              onChange={handleChange}
              maxLength={2000}
            />
            {errors.description && <div className="invalid-feedback d-block">{errors.description}</div>}
            <div className="text-dim mt-1" style={{ fontSize: '0.75rem', textAlign: 'right' }}>
              {form.description.length}/2000
            </div>
          </div>

          {/* Pickup Location */}
          <div className="mb-4">
            <label className="form-label" htmlFor="pickupLocation">
              Campus Pickup Location *
            </label>
            <input
              id="pickupLocation"
              name="pickupLocation"
              type="text"
              className={`form-control ${errors.pickupLocation ? 'is-invalid' : ''}`}
              value={form.pickupLocation}
              onChange={handleChange}
            />
            {errors.pickupLocation && (
              <div className="invalid-feedback d-block">{errors.pickupLocation}</div>
            )}
          </div>

          {/* Buttons */}
          <div className="d-flex align-items-center justify-content-end gap-3 mt-4">
            <Link to={`/listings/${id}`} className="btn btn-outline-secondary">
              Cancel
            </Link>
            <button type="submit" className="btn btn-primary px-4" disabled={submitting}>
              {submitting ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" role="status" />
                  Saving Changes…
                </>
              ) : (
                'Save Changes'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
