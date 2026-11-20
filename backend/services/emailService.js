/**
 * CampusSwap - Transactional Email Service
 * Powered by Resend API
 */

const { Resend } = require('resend');

let resendClient = null;

// Check if Resend API key is configured or a test client is injected
const isEmailConfigured = () => {
  if (resendClient) return true;
  const apiKey = process.env.RESEND_API_KEY;
  return Boolean(apiKey && apiKey.trim() !== '' && !apiKey.includes('your_resend_api_key') && !apiKey.includes('your_api_key'));
};

const getResendClient = () => {
  if (resendClient) return resendClient;
  if (!isEmailConfigured()) {
    const error = new Error('Email service is not configured. Please set RESEND_API_KEY in environment variables.');
    error.code = 'EMAIL_SERVICE_NOT_CONFIGURED';
    error.status = 503;
    throw error;
  }
  resendClient = new Resend(process.env.RESEND_API_KEY.trim());
  return resendClient;
};

// For testing purposes only: allow injecting a mock client
const _setClientForTesting = (mockClient) => {
  resendClient = mockClient;
};

/**
 * Generate a responsive HTML template for OTP verification
 */
const buildOtpEmailHtml = ({ fullName, otpCode, expiryMinutes = 5 }) => {
  const recipientName = fullName ? fullName.trim() : 'Student';
  const currentYear = new Date().getFullYear();

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CampusSwap Verification Code</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #0b0f19;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #e2e8f0;
    }
    .wrapper {
      width: 100%;
      table-layout: fixed;
      background-color: #0b0f19;
      padding: 40px 0;
    }
    .main-card {
      max-width: 540px;
      margin: 0 auto;
      background: #131a2a;
      border: 1px solid #1e293b;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
    }
    .header {
      background: linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%);
      padding: 32px 24px;
      text-align: center;
      border-bottom: 1px solid #1e293b;
    }
    .logo {
      font-size: 26px;
      font-weight: 800;
      color: #38bdf8;
      letter-spacing: -0.5px;
      margin: 0;
    }
    .tagline {
      font-size: 13px;
      color: #94a3b8;
      margin-top: 6px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .content {
      padding: 36px 32px;
    }
    .greeting {
      font-size: 20px;
      font-weight: 600;
      color: #f8fafc;
      margin-top: 0;
      margin-bottom: 16px;
    }
    .lead-text {
      font-size: 15px;
      line-height: 1.6;
      color: #cbd5e1;
      margin-bottom: 28px;
    }
    .otp-container {
      background: #0f172a;
      border: 2px dashed #38bdf8;
      border-radius: 12px;
      padding: 24px;
      text-align: center;
      margin: 28px 0;
    }
    .otp-label {
      font-size: 12px;
      font-weight: 600;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      margin-bottom: 8px;
    }
    .otp-code {
      font-family: 'SF Mono', Consolas, Monaco, 'Courier New', monospace;
      font-size: 38px;
      font-weight: 800;
      color: #38bdf8;
      letter-spacing: 10px;
      margin: 4px 0;
    }
    .expiry-note {
      font-size: 13px;
      color: #f59e0b;
      margin-top: 10px;
      font-weight: 500;
    }
    .security-box {
      background: #1c1917;
      border-left: 4px solid #ef4444;
      border-radius: 6px;
      padding: 14px 16px;
      margin: 28px 0 20px 0;
    }
    .security-title {
      color: #fca5a5;
      font-weight: 600;
      font-size: 13px;
      margin-bottom: 4px;
    }
    .security-text {
      color: #d6d3d1;
      font-size: 13px;
      line-height: 1.5;
      margin: 0;
    }
    .footer {
      padding: 24px 32px;
      background: #0d131f;
      text-align: center;
      border-top: 1px solid #1e293b;
      font-size: 12px;
      color: #64748b;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="main-card">
      <div class="header">
        <h1 class="logo">🎓 CampusSwap</h1>
        <div class="tagline">Student Marketplace & Barter Platform</div>
      </div>
      <div class="content">
        <h2 class="greeting">Hi ${recipientName},</h2>
        <p class="lead-text">
          Thank you for joining CampusSwap! To complete your registration and activate your student account, please enter the following 6-digit verification code:
        </p>
        <div class="otp-container">
          <div class="otp-label">Verification Code</div>
          <div class="otp-code">${otpCode}</div>
          <div class="expiry-note">⏱️ Expires in ${expiryMinutes} minutes</div>
        </div>
        <div class="security-box">
          <div class="security-title">🔒 Security Notice</div>
          <p class="security-text">
            Never share this OTP with anyone. CampusSwap support and moderators will never ask for your verification code.
          </p>
        </div>
        <p style="font-size: 13px; color: #94a3b8; margin-top: 24px; line-height: 1.5;">
          If you did not request this verification code, you can safely ignore this email. No changes will be made to your account.
        </p>
      </div>
      <div class="footer">
        © ${currentYear} CampusSwap. Safe and verified student marketplace.<br>
        This is an automated transactional message. Please do not reply directly to this email.
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();
};

/**
 * Generate a plaintext fallback for email clients that do not render HTML
 */
const buildOtpEmailText = ({ fullName, otpCode, expiryMinutes = 5 }) => {
  const recipientName = fullName ? fullName.trim() : 'Student';
  return `Hi ${recipientName},

Your CampusSwap 6-digit verification code is: ${otpCode}

This code will expire in ${expiryMinutes} minutes.

SECURITY WARNING: Never share this verification code with anyone. CampusSwap staff will never ask for your code.

If you did not request this verification code, you can safely ignore this message.

--
CampusSwap - Student Marketplace
`.trim();
};

/**
 * Send OTP verification email using Resend
 * In development mode (NODE_ENV=development) without Resend configured,
 * it safely logs the OTP to the backend terminal for local testing.
 * 
 * @param {Object} options
 * @param {string} options.toEmail
 * @param {string} [options.fullName]
 * @param {string} options.otpCode
 * @param {number} [options.expiryMinutes=5]
 */
const sendVerificationOtpEmail = async ({ toEmail, fullName, otpCode, expiryMinutes = 5 }) => {
  if (!toEmail || !otpCode) {
    const error = new Error('toEmail and otpCode are required to send verification email.');
    error.code = 'VALIDATION_ERROR';
    error.status = 400;
    throw error;
  }

  const isConfigured = isEmailConfigured();
  const isDev = process.env.NODE_ENV === 'development';

  // If Resend is NOT configured:
  if (!isConfigured) {
    // In development mode, allow OTP generation and log to terminal for local testing
    if (isDev) {
      console.log('--------------------------------------------------');
      console.log(`[DEV EMAIL] Verification OTP generated for ${toEmail.trim().toLowerCase()}`);
      console.log(`[DEV EMAIL] OTP: ${otpCode}`);
      console.log(`[DEV EMAIL] Expires in ${expiryMinutes} minutes.`);
      console.log('--------------------------------------------------');
      return { id: `dev_simulated_${Date.now()}`, simulated: true };
    }

    // In production mode (or any non-dev environment without configured Resend)
    const error = new Error('Email service is not configured. Please set RESEND_API_KEY in environment variables.');
    error.code = 'EMAIL_SERVICE_NOT_CONFIGURED';
    error.status = 503;
    throw error;
  }

  // When Resend IS configured (or a test client is injected), send email
  const client = getResendClient();
  const fromAddress = process.env.EMAIL_FROM || 'CampusSwap <onboarding@resend.dev>';
  const subject = `${otpCode} is your CampusSwap verification code`;

  const html = buildOtpEmailHtml({ fullName, otpCode, expiryMinutes });
  const text = buildOtpEmailText({ fullName, otpCode, expiryMinutes });

  try {
    const response = await client.emails.send({
      from: fromAddress,
      to: toEmail.trim().toLowerCase(),
      subject,
      html,
      text,
    });

    if (response.error) {
      const errorMsg = response.error.message || 'Unknown Resend delivery error';
      console.error('[Resend Error]:', response.error);
      const deliveryError = new Error(`Email delivery failed: ${errorMsg}`);
      deliveryError.code = 'EMAIL_DELIVERY_FAILED';
      deliveryError.status = 502;
      deliveryError.details = response.error;
      throw deliveryError;
    }

    return response.data;
  } catch (err) {
    if (err.code === 'EMAIL_SERVICE_NOT_CONFIGURED' || err.code === 'EMAIL_DELIVERY_FAILED') {
      throw err;
    }
    console.error('[Resend Exception]:', err.message);
    const wrapError = new Error(`Email delivery error: ${err.message}`);
    wrapError.code = 'EMAIL_DELIVERY_FAILED';
    wrapError.status = 502;
    wrapError.details = err;
    throw wrapError;
  }
};

module.exports = {
  isEmailConfigured,
  sendVerificationOtpEmail,
  buildOtpEmailHtml,
  buildOtpEmailText,
  _setClientForTesting
};
