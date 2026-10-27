export default function ReviewCard({ review }) {
  if (!review) return null;

  const { rating, comment, createdAt, reviewer, reviewee } = review;
  const stars = Math.min(5, Math.max(1, Math.round(rating || 5)));

  return (
    <div
      className="p-3 rounded mb-2"
      style={{
        background: 'var(--cs-surface2)',
        border: '1px solid var(--cs-border)',
        transition: 'var(--cs-transition)',
      }}
    >
      <div className="d-flex align-items-center justify-content-between mb-2 flex-wrap gap-2">
        {/* Reviewer identity */}
        <div className="d-flex align-items-center gap-2">
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'linear-gradient(135deg,var(--cs-primary),var(--cs-primary-dark))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.8rem',
              fontWeight: 700,
              color: 'white',
              flexShrink: 0,
            }}
          >
            {reviewer?.fullName?.[0]?.toUpperCase() || '?'}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--cs-text)', lineHeight: 1.2 }}>
              {reviewer?.fullName || 'Verified Student'}
            </div>
            {reviewee?.fullName && (
              <div className="text-dim" style={{ fontSize: '0.72rem' }}>
                Reviewed {reviewee.fullName}
              </div>
            )}
          </div>
        </div>

        {/* Rating stars & date */}
        <div className="text-end">
          <div className="d-inline-flex gap-1" style={{ fontSize: '0.9rem' }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <span key={i} className={i <= stars ? 'star' : 'star-empty'}>
                ★
              </span>
            ))}
          </div>
          {createdAt && (
            <div className="text-dim" style={{ fontSize: '0.72rem' }}>
              {new Date(createdAt).toLocaleDateString()}
            </div>
          )}
        </div>
      </div>

      {/* Review Comment */}
      {comment ? (
        <p className="mb-0 text-muted-cs" style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>
          "{comment}"
        </p>
      ) : (
        <p className="mb-0 text-dim fst-italic" style={{ fontSize: '0.8rem' }}>
          No written feedback provided.
        </p>
      )}
    </div>
  );
}
