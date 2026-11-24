import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { authApi } from '../api/client';

export default function RegisterPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [form, setForm] = useState({ email: '', password: '', fullName: '', phoneNumber: '', department: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
    setError('');
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(form.email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }

    setLoading(true);
    try {
      await authApi.register({
        email: form.email.trim(),
        password: form.password,
        fullName: form.fullName.trim(),
        phoneNumber: form.phoneNumber.trim() || undefined,
        department: form.department.trim() || undefined,
      });
      // Immediately log in user and navigate to marketplace listings
      await login(form.email.trim(), form.password);
      navigate('/listings', { replace: true });
    } catch (err) {
      const msg = err.response?.data?.error?.message || 'Registration failed. Please try again.';
      setError(msg);
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
          <p className="text-muted-cs mt-1" style={{ fontSize: '0.9rem' }}>
            Create your campus marketplace account
          </p>
        </div>

        {error && <div className="alert alert-danger py-2 mb-3" role="alert">{error}</div>}

        <form onSubmit={handleRegister} noValidate>
          <div className="mb-3">
            <label className="form-label">Full Name *</label>
            <input name="fullName" type="text" className="form-control" placeholder="Alex Smith" required value={form.fullName} onChange={handleChange} />
          </div>
          <div className="mb-3">
            <label className="form-label">Email *</label>
            <input name="email" type="email" className="form-control" placeholder="student@gmail.com" required value={form.email} onChange={handleChange} />
            <div className="form-text" style={{ color: 'var(--cs-text-dim)', fontSize: '0.78rem' }}>
              Any valid email address (e.g. Gmail, Outlook, Yahoo) is accepted.
            </div>
          </div>
          <div className="mb-3">
            <label className="form-label">Password *</label>
            <input name="password" type="password" className="form-control" placeholder="Min 8 chars, 1 upper, 1 number, 1 symbol" required value={form.password} onChange={handleChange} />
          </div>
          <div className="mb-3">
            <label className="form-label">Department</label>
            <input name="department" type="text" className="form-control" placeholder="Computer Science" value={form.department} onChange={handleChange} />
          </div>
          <div className="mb-4">
            <label className="form-label">Phone Number (optional)</label>
            <input name="phoneNumber" type="tel" className="form-control" placeholder="+1-555-0199" value={form.phoneNumber} onChange={handleChange} />
          </div>
          <button type="submit" className="btn btn-primary w-100" disabled={loading}>
            {loading ? <span className="spinner-border spinner-border-sm me-2" /> : null}
            Create Account
          </button>
        </form>

        <hr style={{ borderColor: 'var(--cs-border)', margin: '1.5rem 0' }} />
        <p className="text-center mb-0" style={{ fontSize: '0.875rem', color: 'var(--cs-text-muted)' }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
