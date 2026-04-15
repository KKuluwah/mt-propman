import rateLimit from 'express-rate-limit';

// General API limit: 200 requests per minute per IP
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again shortly.' }
});

// Stricter limit for email sending: 10 per 10 minutes
export const emailLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Email rate limit reached. Please wait before sending more.' }
});
