import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { apiRouter } from './routes';
import { errorHandler } from './middleware/errorHandler';
import { securityHeaders } from './middleware/security';

// Load environment variables with robust absolute path resolution
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware setup
app.use(helmet());
app.use(securityHeaders);
app.use(cors({
  origin: process.env.CLIENT_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API Versioning routing
app.use('/api/v1', apiRouter);

// Serve static assets from the frontend build directory (parent of dist/server)
const distPath = path.resolve(__dirname, '..');
app.use(express.static(distPath));

// SPA fallback: Serve index.html for any request that doesn't match an API route or static asset
app.get('*', (req, res) => {
  res.sendFile(path.resolve(distPath, 'index.html'));
});

// Global Error Handler
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`[CHIMBO BACKEND] Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode.`);
});

export default app;
