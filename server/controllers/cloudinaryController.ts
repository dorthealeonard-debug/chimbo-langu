import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * Generates a secure HMAC-SHA1 signature for direct client-side uploads to Cloudinary.
 * Bypasses the need for any external Cloudinary SDK by using Node's native 'crypto' module.
 * 
 * Route: POST /api/v1/cloudinary/sign
 * Body: { folder: string }
 */
export async function generateUploadSignature(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const folder = req.body.folder || 'general';
    const timestamp = Math.round(new Date().getTime() / 1000);

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      return res.status(500).json({
        status: 'error',
        message: 'Missing Cloudinary configuration credentials in environment variables.'
      });
    }

    // Parameters to sign must be sorted alphabetically: 'folder' then 'timestamp'
    const paramsToSign = `folder=${folder}&timestamp=${timestamp}`;
    
    // Cloudinary signature is computed by appending the API Secret directly to the sorted parameter string
    const signatureToHash = `${paramsToSign}${apiSecret}`;
    
    // Hash using SHA-1 as required by Cloudinary
    const signature = crypto
      .createHash('sha1')
      .update(signatureToHash)
      .digest('hex');

    res.status(200).json({
      status: 'success',
      signature,
      timestamp,
      folder,
      apiKey,
      cloudName
    });
  } catch (error) {
    next(error);
  }
}
