export default function EmptyState({ icon = '📭', title, message, children }) {
  return (
    <div className="text-center py-5 fade-in-up">
      <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>{icon}</div>
      <h4 style={{ color: 'var(--cs-text)', fontWeight: 700 }}>{title}</h4>
      {message && <p className="text-muted-cs mb-3">{message}</p>}
      {children}
    </div>
  );
}
