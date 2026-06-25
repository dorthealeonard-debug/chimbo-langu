import dotenv from 'dotenv';

// Ensure environment variables are loaded
dotenv.config();

export const cloudinaryConfig = {
  cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
  apiKey: process.env.CLOUDINARY_API_KEY || '',
  apiSecret: process.env.CLOUDINARY_API_SECRET || ''
};

export function validateConfig() {
  const missing = [];
  if (!cloudinaryConfig.cloudName) missing.push('CLOUDINARY_CLOUD_NAME');
  if (!cloudinaryConfig.apiKey) missing.push('CLOUDINARY_API_KEY');
  if (!cloudinaryConfig.apiSecret) missing.push('CLOUDINARY_API_SECRET');

  if (missing.length > 0) {
    console.warn(`[WARNING]: Cloudinary config is missing environment variables: ${missing.join(', ')}`);
  }
}
