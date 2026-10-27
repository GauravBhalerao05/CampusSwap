import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const nextUrl = searchParams.get('next') || '/listings';
  const sessionExpired = searchParams.get('session') === 'expired';

  const handleChange = (e) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.email.trim() || !form.password) {
      setError('Email and password are required.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await login(form.email.trim(), form.password);
      navigate(nextUrl, { replace: true });
    } catch (err) {
      const code = err.response?.data?.error?.code;
      const msg  = err.response?.data?.error?.message;
      if (code === 'ACCOUNT_SUSPENDED') {
        setError('Your account has been suspended by campus moderators.');
      } else if (code === 'ACCOUNT_INACTIVE') {
        setError('Please verify your email first before signing in.');
      } else {
        setError(msg || 'Invalid email or password.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card fade-in-up">
        <div className="text-center mb-4">
          <div className="auth-logo" style={{ background: 'linear-gradient(135deg,var(--cs-primary-light),var(--cs-accent))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            🎓 CampusSwap
          </div>
          <p className="text-muted-cs mt-1" style={{ fontSize: '0.9rem' }}>Sign in to your campus account</p>
        </div>

        {sessionExpired && (
          <div className="alert alert-warning py-2 mb-3">
            Your session expired. Please sign in again.
          </div>
        )}
        {error && <div className="alert alert-danger py-2 mb-3" role="alert">{error}</div>}

        <form onSubmit={handleSubmit} noValidate>
          <div className="mb-3">
            <label className="form-label">College Email</label>
            <input
              name="email"
              type="email"
              className="form-control"
              placeholder="you@univ.edu"
              required
              autoComplete="email"
              value={form.email}
              onChange={handleChange}
            />
          </div>
          <div className="mb-4">
            <label className="form-label">Password</label>
            <input
              name="password"
              type="password"
              className="form-control"
              placeholder="Your password"
              required
              autoComplete="current-password"
              value={form.password}
              onChange={handleChange}
            />
          </div>
          <button type="submit" className="btn btn-primary w-100" disabled={loading}>
            {loading ? <span className="spinner-border spinner-border-sm me-2" /> : null}
            Sign In
          </button>
        </form>

        <hr style={{ borderColor: 'var(--cs-border)', margin: '1.5rem 0' }} />
        <p className="text-center mb-0" style={{ fontSize: '0.875rem', color: 'var(--cs-text-muted)' }}>
          Don't have an account? <Link to="/register">Create one</Link>
        </p>
      </div>
    </div>
  );
}
