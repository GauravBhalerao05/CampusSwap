import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { listingsApi, categoriesApi } from '../api/client';
import ListingCard from '../components/ListingCard';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';
import { useAuth } from '../contexts/AuthContext';

const MODES = ['SELL', 'BARTER', 'FREE'];
const CONDITIONS = ['NEW', 'LIKE_NEW', 'GOOD', 'FAIR'];
const SORTS = [
  { value: 'newest', label: 'Newest First' },
  { value: 'price_asc', label: 'Price ↑' },
  { value: 'price_desc', label: 'Price ↓' },
  { value: 'rating_desc', label: 'Top Rated' },
];

export default function ListingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAuthenticated } = useAuth();

  const [listings, setListings] = useState([]);
  const [categories, setCategories] = useState([]);
  const [pagination, setPagination] = useState({ currentPage: 1, totalPages: 1, totalItems: 0, limit: 20 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filter state derived from URL
  const [filters, setFilters] = useState({
    q: searchParams.get('q') || '',
    categoryId: searchParams.get('categoryId') || '',
    mode: searchParams.get('mode') || '',
    condition: searchParams.get('condition') || '',
    minPrice: searchParams.get('minPrice') || '',
    maxPrice: searchParams.get('maxPrice') || '',
    sortBy: searchParams.get('sortBy') || 'newest',
    page: parseInt(searchParams.get('page') || '1', 10),
  });

  const [draft, setDraft] = useState({ q: filters.q, minPrice: filters.minPrice, maxPrice: filters.maxPrice });

  const fetchListings = useCallback(async (f) => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (f.q) params.q = f.q;
      if (f.categoryId) params.categoryId = f.categoryId;
      if (f.mode) params.mode = f.mode;
      if (f.condition) params.condition = f.condition;
      if (f.minPrice) params.minPrice = f.minPrice;
      if (f.maxPrice) params.maxPrice = f.maxPrice;
      params.sortBy = f.sortBy || 'newest';
      params.page = f.page || 1;
      params.limit = 20;

      const res = await listingsApi.search(params);
      setListings(res.data.data.items || []);
      setPagination(res.data.data.pagination || {});
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to load listings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    categoriesApi.list().then(r => setCategories(r.data.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    fetchListings(filters);
  }, [filters, fetchListings]);

  const applyFilters = (newFilters) => {
    const f = { ...filters, ...newFilters, page: 1 };
    setFilters(f);
    const params = {};
    Object.entries(f).forEach(([k, v]) => { if (v) params[k] = v; });
    setSearchParams(params);
  };

  const setPage = (pg) => {
    const f = { ...filters, page: pg };
    setFilters(f);
    const params = {};
    Object.entries(f).forEach(([k, v]) => { if (v) params[k] = v; });
    setSearchParams(params);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="container py-4">
      {/* Hero bar */}
      <div className="d-flex align-items-center justify-content-between mb-4 flex-wrap gap-3">
        <div>
          <h1 style={{ fontWeight: 800, fontSize: '1.8rem', color: 'var(--cs-text)' }}>Campus Marketplace</h1>
          <p className="text-muted-cs mb-0" style={{ fontSize: '0.9rem' }}>{pagination.totalItems} listing{pagination.totalItems !== 1 ? 's' : ''} available</p>
        </div>
        {isAuthenticated && (
          <Link to="/listings/new" className="btn btn-primary">
            + New Listing
          </Link>
        )}
      </div>

      <div className="row g-4">
        {/* Sidebar filters */}
        <div className="col-lg-3">
          <div className="card p-3">
            <h6 style={{ color: 'var(--cs-text)', fontWeight: 700, marginBottom: '1rem' }}>🔍 Search &amp; Filter</h6>

            {/* Keyword */}
            <div className="mb-3">
              <form onSubmit={(e) => { e.preventDefault(); applyFilters({ q: draft.q }); }}>
                <div className="input-group input-group-sm">
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Search listings…"
                    value={draft.q}
                    onChange={(e) => setDraft(d => ({ ...d, q: e.target.value }))}
                  />
                  <button className="btn btn-primary" type="submit">Go</button>
                </div>
              </form>
            </div>

            {/* Category */}
            <div className="mb-3">
              <label className="form-label" style={{ fontSize: '0.78rem' }}>Category</label>
              <select className="form-select form-select-sm" value={filters.categoryId} onChange={(e) => applyFilters({ categoryId: e.target.value })}>
                <option value="">All Categories</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            {/* Mode */}
            <div className="mb-3">
              <label className="form-label" style={{ fontSize: '0.78rem' }}>Listing Type</label>
              <div className="d-flex flex-wrap gap-1">
                {MODES.map(m => (
                  <button
                    key={m}
                    className={`btn btn-sm ${filters.mode === m ? 'btn-primary' : 'btn-outline-secondary'}`}
                    style={{ fontSize: '0.72rem', borderRadius: '20px', padding: '0.25rem 0.65rem' }}
                    onClick={() => applyFilters({ mode: filters.mode === m ? '' : m })}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* Condition */}
            <div className="mb-3">
              <label className="form-label" style={{ fontSize: '0.78rem' }}>Condition</label>
              <select className="form-select form-select-sm" value={filters.condition} onChange={(e) => applyFilters({ condition: e.target.value })}>
                <option value="">Any Condition</option>
                {CONDITIONS.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
              </select>
            </div>

            {/* Price range */}
            <div className="mb-3">
              <label className="form-label" style={{ fontSize: '0.78rem' }}>Price Range (₹)</label>
              <div className="d-flex gap-2">
                <input
                  type="number"
                  className="form-control form-control-sm"
                  placeholder="Min"
                  value={draft.minPrice}
                  min={0}
                  onChange={(e) => setDraft(d => ({ ...d, minPrice: e.target.value }))}
                  onBlur={() => applyFilters({ minPrice: draft.minPrice })}
                />
                <input
                  type="number"
                  className="form-control form-control-sm"
                  placeholder="Max"
                  value={draft.maxPrice}
                  min={0}
                  onChange={(e) => setDraft(d => ({ ...d, maxPrice: e.target.value }))}
                  onBlur={() => applyFilters({ maxPrice: draft.maxPrice })}
                />
              </div>
            </div>

            {/* Sort */}
            <div className="mb-3">
              <label className="form-label" style={{ fontSize: '0.78rem' }}>Sort By</label>
              <select className="form-select form-select-sm" value={filters.sortBy} onChange={(e) => applyFilters({ sortBy: e.target.value })}>
                {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>

            {/* Clear */}
            <button
              className="btn btn-outline-secondary btn-sm w-100"
              onClick={() => {
                setDraft({ q: '', minPrice: '', maxPrice: '' });
                setFilters({ q: '', categoryId: '', mode: '', condition: '', minPrice: '', maxPrice: '', sortBy: 'newest', page: 1 });
                setSearchParams({});
              }}
            >
              Clear Filters
            </button>
          </div>
        </div>

        {/* Listings grid */}
        <div className="col-lg-9">
          {loading ? (
            <Spinner text="Loading listings…" />
          ) : error ? (
            <div className="alert alert-danger">{error}</div>
          ) : listings.length === 0 ? (
            <EmptyState icon="📭" title="No listings found" message="Try adjusting your filters or search terms." />
          ) : (
            <>
              <div className="row row-cols-1 row-cols-sm-2 row-cols-xl-3 g-3 mb-4 fade-in-up">
                {listings.map(l => (
                  <div className="col" key={l.id}>
                    <ListingCard listing={l} />
                  </div>
                ))}
              </div>

              {/* Pagination */}
              {pagination.totalPages > 1 && (
                <nav>
                  <ul className="pagination justify-content-center">
                    <li className={`page-item ${pagination.currentPage <= 1 ? 'disabled' : ''}`}>
                      <button className="page-link" onClick={() => setPage(pagination.currentPage - 1)}>‹</button>
                    </li>
                    {Array.from({ length: pagination.totalPages }, (_, i) => i + 1)
                      .filter(p => Math.abs(p - pagination.currentPage) <= 2)
                      .map(p => (
                        <li key={p} className={`page-item ${p === pagination.currentPage ? 'active' : ''}`}>
                          <button className="page-link" onClick={() => setPage(p)}>{p}</button>
                        </li>
                      ))}
                    <li className={`page-item ${pagination.currentPage >= pagination.totalPages ? 'disabled' : ''}`}>
                      <button className="page-link" onClick={() => setPage(pagination.currentPage + 1)}>›</button>
                    </li>
                  </ul>
                </nav>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
