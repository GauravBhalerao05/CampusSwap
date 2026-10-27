export default function Spinner({ text = 'Loading…' }) {
  return (
    <div className="spinner-cs flex-column gap-3">
      <div className="spinner-border" style={{ color: 'var(--cs-primary)', width: '2.5rem', height: '2.5rem' }} role="status" />
      {text && <p className="text-muted-cs mb-0">{text}</p>}
    </div>
  );
}
