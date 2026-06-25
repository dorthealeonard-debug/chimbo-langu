import { Router } from 'express';
import { generateUploadSignature } from '../controllers/cloudinaryController';

export const cloudinaryRouter = Router();

// Route: POST /api/v1/cloudinary/sign
cloudinaryRouter.post('/sign', generateUploadSignature);
