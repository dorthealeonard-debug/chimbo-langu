import { Request, Response, NextFunction } from 'express';

/**
 * Custom security middleware to set additional security headers
 * that extend Helmet's default protections.
 */
export function securityHeaders(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Prevent clickjacking by disabling page framing
  res.setHeader('X-Frame-Options', 'DENY');

  // Disable MIME sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Enable browser XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Set Referrer Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  next();
}
