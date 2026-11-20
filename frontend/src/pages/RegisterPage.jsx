import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { authApi } from '../api/client';

export default function RegisterPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [step, setStep] = useState('register'); // 'register' | 'verify'
  const [form, setForm] = useState({ email: '', password: '', fullName: '', phoneNumber: '', department: '' });
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(60);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Handle 60s cooldown timer for OTP resend
  useEffect(() => {
    let timer = null;
    if (step === 'verify' && cooldown > 0) {
      timer = setInterval(() => {
        setCooldown(prev => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [step, cooldown]);

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
      setSuccess('Registration successful! Check your email inbox for the 6-digit verification code.');
      setStep('verify');
      setCooldown(60);
    } catch (err) {
      const msg = err.response?.data?.error?.message || 'Registration failed. Please try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await authApi.verifyEmail({ email: form.email.trim(), otpCode: otp.trim() });
      // Auto-login after verification
      await login(form.email.trim(), form.password);
      navigate('/listings', { replace: true });
    } catch (err) {
      const msg = err.response?.data?.error?.message || 'Verification failed. Please check your OTP.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (cooldown > 0 || resending) return;
    setResending(true);
    setError('');
    setSuccess('');
    try {
      const res = await authApi.resendOtp({ email: form.email.trim() });
      setSuccess(res.data?.data?.message || 'A new verification code has been dispatched to your email.');
      setCooldown(60);
    } catch (err) {
      const msg = err.response?.data?.error?.message || 'Failed to resend verification code. Please try again.';
      setError(msg);
    } finally {
      setResending(false);
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
            {step === 'register' ? 'Create your campus marketplace account' : 'Verify your email address'}
          </p>
        </div>

        {error && <div className="alert alert-danger py-2 mb-3" role="alert">{error}</div>}
        {success && <div className="alert alert-success py-2 mb-3" role="alert">{success}</div>}

        {step === 'register' ? (
          <form onSubmit={handleRegister} noValidate>
            <div className="mb-3">
              <label className="form-label">Full Name *</label>
              <input name="fullName" type="text" className="form-control" placeholder="Alex Smith" required value={form.fullName} onChange={handleChange} />
            </div>
            <div className="mb-3">
              <label className="form-label">Email *</label>
              <input name="email" type="email" className="form-control" placeholder="student@gmail.com" required value={form.email} onChange={handleChange} />
              <div className="form-text" style={{ color: 'var(--cs-text-dim)', fontSize: '0.78rem' }}>
                We'll send a 6-digit verification code to this email (Gmail and other providers supported).
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
        ) : (
          <form onSubmit={handleVerify} noValidate>
            <div className="mb-4 text-center">
              <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>📬</div>
              <p className="text-muted-cs" style={{ fontSize: '0.9rem' }}>
                We sent a 6-digit code to <strong style={{ color: 'var(--cs-text)' }}>{form.email}</strong>
              </p>
              <p style={{ fontSize: '0.8rem', color: 'var(--cs-text-dim)' }}>
                Code expires in 5 minutes. Check spam folder if not found.
              </p>
            </div>
            <div className="mb-4">
              <label className="form-label">Verification OTP *</label>
              <input
                type="text"
                className="form-control text-center"
                placeholder="000000"
                maxLength={6}
                value={otp}
                onChange={(e) => { setOtp(e.target.value.replace(/\D/g, '')); setError(''); }}
                style={{ fontSize: '1.5rem', letterSpacing: '0.4em', fontWeight: 700 }}
                required
              />
            </div>
            <button type="submit" className="btn btn-primary w-100 mb-3" disabled={loading || otp.length !== 6}>
              {loading ? <span className="spinner-border spinner-border-sm me-2" /> : null}
              Verify & Sign In
            </button>

            <div className="d-flex justify-content-between align-items-center mb-3">
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                disabled={cooldown > 0 || resending}
                onClick={handleResendOtp}
                style={{ fontSize: '0.82rem' }}
              >
                {resending ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-1" />
                    Resending...
                  </>
                ) : cooldown > 0 ? (
                  `Resend Code in ${cooldown}s`
                ) : (
                  'Resend Code'
                )}
              </button>

              <button
                type="button"
                className="btn btn-link p-0"
                style={{ color: 'var(--cs-text-muted)', fontSize: '0.85rem' }}
                onClick={() => { setStep('register'); setError(''); setSuccess(''); }}
              >
                ← Back to registration
              </button>
            </div>
          </form>
        )}

        <hr style={{ borderColor: 'var(--cs-border)', margin: '1.5rem 0' }} />
        <p className="text-center mb-0" style={{ fontSize: '0.875rem', color: 'var(--cs-text-muted)' }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
