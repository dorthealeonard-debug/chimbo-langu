import { Router } from 'express';
import { generateUploadSignature } from '../controllers/cloudinaryController.js';

export const cloudinaryRouter = Router();

// Route: POST /api/v1/cloudinary/sign
cloudinaryRouter.post('/sign', generateUploadSignature);
