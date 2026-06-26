import { Router } from 'express';
import { cloudinaryRouter } from './cloudinary.js';

export const apiRouter = Router();

// Mount Cloudinary routes under /api/v1/cloudinary
apiRouter.use('/cloudinary', cloudinaryRouter);
