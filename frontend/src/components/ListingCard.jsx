import { Link } from 'react-router-dom';

const MODE_EMOJI = { SELL: '💰', BARTER: '🔄', FREE: '🎁' };

function StarRating({ rating, count }) {
  const r = Math.round(rating || 0);
  return (
    <span className="d-flex align-items-center gap-1" style={{ fontSize: '0.8rem' }}>
      {[1,2,3,4,5].map(i => (
        <span key={i} className={i <= r ? 'star' : 'star-empty'}>★</span>
      ))}
      {count > 0 && <span className="text-dim ms-1">({count})</span>}
    </span>
  );
}

export default function ListingCard({ listing }) {
  const { id, title, mode, price, itemCondition, status, category, seller, primaryImageUrl, createdAt } = listing;

  const formatPrice = () => {
    if (mode === 'FREE') return <span style={{ color: 'var(--cs-success)', fontWeight: 800 }}>FREE</span>;
    if (mode === 'BARTER') return <span style={{ color: '#fcd34d', fontWeight: 700 }}>BARTER</span>;
    return <span className="price-tag">₹{parseFloat(price).toFixed(0)}</span>;
  };

  const CONDITION_LABEL = { NEW: '🌟 New', LIKE_NEW: '✨ Like New', GOOD: '👍 Good', FAIR: '📖 Fair' };

  return (
    <Link to={`/listings/${id}`} className="text-decoration-none">
      <div className="listing-card">
        {primaryImageUrl ? (
          <img src={primaryImageUrl} alt={title} className="card-img-top" onError={(e) => { e.target.style.display = 'none'; }} />
        ) : (
          <div className="card-img-placeholder">{MODE_EMOJI[mode] || '📦'}</div>
        )}
        <div className="card-body">
          <div className="d-flex align-items-start justify-content-between gap-2 mb-1">
            <h3 className="card-title mb-0">{title}</h3>
            <span className={`badge mode-badge mode-${mode} flex-shrink-0`}>{mode}</span>
          </div>

          {category && (
            <div className="text-dim mb-1" style={{ fontSize: '0.78rem' }}>{category.name}</div>
          )}

          <div className="mt-auto">
            <div className="d-flex align-items-center justify-content-between mt-2">
              {formatPrice()}
              <span className="badge bg-secondary" style={{ fontSize: '0.7rem' }}>{CONDITION_LABEL[itemCondition] || itemCondition}</span>
            </div>

            {seller && (
              <div className="mt-2 d-flex align-items-center gap-2">
                <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'linear-gradient(135deg,var(--cs-primary),var(--cs-primary-dark))', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 700, flexShrink: 0, color: 'white' }}>
                  {seller.fullName?.[0]?.toUpperCase()}
                </span>
                <span className="text-muted-cs" style={{ fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {seller.fullName}
                </span>
                <StarRating rating={seller.avgRating} count={seller.totalReviews} />
              </div>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
