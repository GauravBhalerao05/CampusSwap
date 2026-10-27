import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { listingsApi, categoriesApi } from '../api/client';
import Spinner from '../components/Spinner';

const MODES = [
  { value: 'SELL', label: '💰 Sell', desc: 'Set a fixed or negotiable monetary price' },
  { value: 'BARTER', label: '🔄 Barter', desc: 'Swap for another student item' },
  { value: 'FREE', label: '🎁 Free', desc: 'Give away to fellow students for free' },
];

const CONDITIONS = [
  { value: 'NEW', label: '🌟 New (Unopened/Unused)' },
  { value: 'LIKE_NEW', label: '✨ Like New (Barely used, pristine)' },
  { value: 'GOOD', label: '👍 Good (Normal wear, fully functional)' },
  { value: 'FAIR', label: '📖 Fair (Noticeable wear, fully usable)' },
];

export default function CreateListingPage() {
  const navigate = useNavigate();

  const [categories, setCategories] = useState([]);
  const [loadingCategories, setLoadingCategories] = useState(true);

  const [form, setForm] = useState({
    title: '',
    description: '',
    categoryId: '',
    mode: 'SELL',
    price: '',
    isNegotiable: false,
    barterPreferences: '',
    itemCondition: 'GOOD',
    pickupLocation: '',
  });

  // Array of image URL strings (up to 5)
  const [imageUrls, setImageUrls] = useState(['']);

  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');

  useEffect(() => {
    categoriesApi
      .list()
      .then((res) => {
        const activeCats = res.data.data || [];
        setCategories(activeCats);
        if (activeCats.length > 0) {
          setForm((prev) => ({ ...prev, categoryId: String(activeCats[0].id) }));
        }
      })
      .catch(() => {
        setServerError('Failed to load categories. Please refresh the page.');
      })
      .finally(() => setLoadingCategories(false));
  }, []);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
    // Clear field-specific error on change
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
    setServerError('');
  };

  const handleImageUrlChange = (index, value) => {
    setImageUrls((prev) => {
      const updated = [...prev];
      updated[index] = value;
      return updated;
    });
    if (errors.imageUrls) {
      setErrors((prev) => ({ ...prev, imageUrls: '' }));
    }
  };

  const addImageUrlField = () => {
    if (imageUrls.length < 5) {
      setImageUrls((prev) => [...prev, '']);
    }
  };

  const removeImageUrlField = (index) => {
    setImageUrls((prev) => prev.filter((_, i) => i !== index));
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

    if (!form.categoryId) {
      newErrors.categoryId = 'Please select a category.';
    }

    if (!form.pickupLocation.trim()) {
      newErrors.pickupLocation = 'Campus pickup location is required (e.g. Library Foyer).';
    }

    // Mode-specific validation
    if (form.mode === 'SELL') {
      const p = parseFloat(form.price);
      if (!form.price || isNaN(p) || p <= 0) {
        newErrors.price = 'Price is required and must be greater than ₹0.00 in SELL mode.';
      }
    } else if (form.mode === 'BARTER') {
      if (!form.barterPreferences.trim()) {
        newErrors.barterPreferences = 'Please describe what items you are willing to trade for.';
      }
      if (form.price) {
        const p = parseFloat(form.price);
        if (isNaN(p) || p < 0) {
          newErrors.price = 'Cash difference must be ₹0.00 or greater if specified.';
        }
      }
    }

    // Cleaned images
    const validImages = imageUrls.map((u) => u.trim()).filter(Boolean);
    if (validImages.length > 5) {
      newErrors.imageUrls = 'A maximum of 5 images can be attached.';
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
      const validImages = imageUrls.map((u) => u.trim()).filter(Boolean);

      const payload = {
        categoryId: parseInt(form.categoryId, 10),
        title: form.title.trim(),
        description: form.description.trim(),
        mode: form.mode,
        itemCondition: form.itemCondition,
        pickupLocation: form.pickupLocation.trim(),
        imageUrls: validImages,
      };

      if (form.mode === 'SELL') {
        payload.price = parseFloat(form.price);
        payload.isNegotiable = form.isNegotiable;
      } else if (form.mode === 'FREE') {
        payload.price = 0.0;
        payload.isNegotiable = false;
      } else if (form.mode === 'BARTER') {
        payload.barterPreferences = form.barterPreferences.trim();
        if (form.price !== '') {
          payload.price = parseFloat(form.price);
        }
        payload.isNegotiable = false;
      }

      const res = await listingsApi.create(payload);
      const newListingId = res.data.data?.id;

      if (newListingId) {
        navigate(`/listings/${newListingId}`);
      } else {
        navigate('/my-listings');
      }
    } catch (err) {
      const msg =
        err.response?.data?.error?.message ||
        'Failed to publish listing. Please verify all inputs and try again.';
      setServerError(msg);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingCategories) {
    return (
      <div className="container py-5">
        <Spinner text="Loading listing creator…" />
      </div>
    );
  }

  return (
    <div className="container py-4 fade-in-up" style={{ maxWidth: 860 }}>
      {/* Breadcrumb navigation */}
      <div className="d-flex align-items-center justify-content-between mb-3">
        <Link to="/listings" className="text-muted-cs text-decoration-none" style={{ fontSize: '0.9rem' }}>
          ← Back to Marketplace
        </Link>
        <Link to="/my-listings" className="text-muted-cs text-decoration-none" style={{ fontSize: '0.9rem' }}>
          My Listings
        </Link>
      </div>

      <div className="card p-4 p-md-5">
        <div className="d-flex align-items-center gap-3 mb-4">
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 'var(--cs-radius-sm)',
              background: 'linear-gradient(135deg,var(--cs-primary),var(--cs-primary-dark))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.5rem',
            }}
          >
            📦
          </div>
          <div>
            <h1 style={{ fontWeight: 800, fontSize: '1.6rem', color: 'var(--cs-text)', marginBottom: '0.2rem' }}>
              Create New Listing
            </h1>
            <p className="text-muted-cs mb-0" style={{ fontSize: '0.88rem' }}>
              Publish a resource to the campus marketplace for sale, barter, or giveaway.
            </p>
          </div>
        </div>

        {serverError && (
          <div className="alert alert-danger py-2 mb-4" role="alert">
            {serverError}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          {/* Exchange Mode Selection */}
          <div className="mb-4">
            <label className="form-label d-block mb-2">Exchange Mode *</label>
            <div className="row g-2">
              {MODES.map((m) => {
                const isSelected = form.mode === m.value;
                return (
                  <div className="col-12 col-md-4" key={m.value}>
                    <div
                      onClick={() => setForm((prev) => ({ ...prev, mode: m.value }))}
                      style={{
                        cursor: 'pointer',
                        padding: '1rem',
                        borderRadius: 'var(--cs-radius-sm)',
                        background: isSelected ? 'rgba(99,102,241,0.15)' : 'var(--cs-surface2)',
                        border: `2px solid ${isSelected ? 'var(--cs-primary)' : 'var(--cs-border)'}`,
                        transition: 'var(--cs-transition)',
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--cs-text)' }}>
                        {m.label}
                      </div>
                      <div className="text-muted-cs mt-1" style={{ fontSize: '0.78rem' }}>
                        {m.desc}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

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
              placeholder="e.g. Introduction to Algorithms (CLRS 3rd Edition)"
              value={form.title}
              onChange={handleChange}
              maxLength={100}
            />
            {errors.title && <div className="invalid-feedback d-block">{errors.title}</div>}
            <div className="text-dim mt-1" style={{ fontSize: '0.75rem', textAlign: 'right' }}>
              {form.title.length}/100
            </div>
          </div>

          {/* Category & Condition */}
          <div className="row g-3 mb-3">
            <div className="col-md-6">
              <label className="form-label" htmlFor="categoryId">
                Category *
              </label>
              <select
                id="categoryId"
                name="categoryId"
                className={`form-select ${errors.categoryId ? 'is-invalid' : ''}`}
                value={form.categoryId}
                onChange={handleChange}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {errors.categoryId && <div className="invalid-feedback d-block">{errors.categoryId}</div>}
            </div>

            <div className="col-md-6">
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
          </div>

          {/* Mode-Specific Pricing / Barter Fields */}
          {form.mode === 'SELL' && (
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
                      placeholder="e.g. 450.00"
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
                    <label className="form-check-label" htmlFor="isNegotiable" style={{ color: 'var(--cs-text)', fontSize: '0.9rem' }}>
                      Price is negotiable
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}

          {form.mode === 'BARTER' && (
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
                  placeholder="e.g. Open to trade for CS204 Lab Kit, Graphing Calculator, or Electronics Components"
                  value={form.barterPreferences}
                  onChange={handleChange}
                />
                {errors.barterPreferences && (
                  <div className="invalid-feedback d-block">{errors.barterPreferences}</div>
                )}
                <div className="form-text" style={{ color: 'var(--cs-text-dim)', fontSize: '0.78rem' }}>
                  Specify the types of items or equipment you are willing to exchange for.
                </div>
              </div>

              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label" htmlFor="price">
                    Optional Cash Adjustment (₹)
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
                      placeholder="0.00 (optional difference)"
                      value={form.price}
                      onChange={handleChange}
                    />
                  </div>
                  {errors.price && <div className="invalid-feedback d-block">{errors.price}</div>}
                </div>
              </div>
            </div>
          )}

          {form.mode === 'FREE' && (
            <div className="alert alert-info py-2 mb-3 d-flex align-items-center gap-2">
              <span style={{ fontSize: '1.2rem' }}>🎁</span>
              <span style={{ fontSize: '0.88rem' }}>
                This item is listed as a free campus giveaway. Price is automatically set to <strong>₹0.00</strong>.
              </span>
            </div>
          )}

          {/* Description */}
          <div className="mb-3">
            <label className="form-label" htmlFor="description">
              Item Description *
            </label>
            <textarea
              id="description"
              name="description"
              className={`form-control ${errors.description ? 'is-invalid' : ''}`}
              rows={4}
              placeholder="Provide complete details: textbook edition, subject codes, equipment condition, or accessories included…"
              value={form.description}
              onChange={handleChange}
              maxLength={2000}
            />
            {errors.description && <div className="invalid-feedback d-block">{errors.description}</div>}
            <div className="text-dim mt-1" style={{ fontSize: '0.75rem', textAlign: 'right' }}>
              {form.description.length}/2000 (min 10)
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
              placeholder="e.g. Central Library Foyer, Student Center 2nd Floor, or Eng Block A"
              value={form.pickupLocation}
              onChange={handleChange}
            />
            {errors.pickupLocation && (
              <div className="invalid-feedback d-block">{errors.pickupLocation}</div>
            )}
            <div className="form-text" style={{ color: 'var(--cs-text-dim)', fontSize: '0.78rem' }}>
              Choose a public, safe, and well-lit campus meetup spot.
            </div>
          </div>

          {/* Image URLs (Up to 5) */}
          <div className="mb-4">
            <div className="d-flex align-items-center justify-content-between mb-2">
              <label className="form-label mb-0">Item Image URLs (Up to 5)</label>
              {imageUrls.length < 5 && (
                <button
                  type="button"
                  className="btn btn-outline-primary btn-sm py-1 px-2"
                  style={{ fontSize: '0.75rem' }}
                  onClick={addImageUrlField}
                >
                  + Add URL
                </button>
              )}
            </div>

            {errors.imageUrls && <div className="alert alert-danger py-1 small">{errors.imageUrls}</div>}

            <div className="d-flex flex-column gap-2">
              {imageUrls.map((url, idx) => (
                <div key={idx} className="d-flex gap-2">
                  <input
                    type="url"
                    className="form-control form-control-sm"
                    placeholder={`Image ${idx + 1} URL (https://...)`}
                    value={url}
                    onChange={(e) => handleImageUrlChange(idx, e.target.value)}
                  />
                  {imageUrls.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-outline-danger btn-sm px-2"
                      onClick={() => removeImageUrlField(idx)}
                      title="Remove image field"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Thumbnail preview strip */}
            {imageUrls.some((u) => u.trim()) && (
              <div className="d-flex gap-2 mt-3 flex-wrap">
                {imageUrls
                  .filter((u) => u.trim())
                  .map((u, i) => (
                    <div
                      key={i}
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: 6,
                        overflow: 'hidden',
                        border: '1px solid var(--cs-border)',
                        background: 'var(--cs-surface2)',
                      }}
                    >
                      <img
                        src={u.trim()}
                        alt={`Preview ${i + 1}`}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={(e) => {
                          e.target.style.display = 'none';
                        }}
                      />
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Submit Actions */}
          <div className="d-flex align-items-center justify-content-end gap-3 mt-4">
            <Link to="/listings" className="btn btn-outline-secondary">
              Cancel
            </Link>
            <button type="submit" className="btn btn-primary px-4" disabled={submitting}>
              {submitting ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" role="status" />
                  Publishing Listing…
                </>
              ) : (
                'Publish Listing'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
