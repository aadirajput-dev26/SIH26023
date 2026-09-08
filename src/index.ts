import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB, getDBStatus } from './config/db';
import { isRedisReady } from './config/redis';

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

import routes from './routes';
import './workers/document.worker';
import './workers/report.worker';

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.url}`);
  next();
});

// Root & Health check routes for Render / Uptime monitors
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'SIH26023 Backend API',
    version: '1.0.0'
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    database: getDBStatus() ? 'connected' : 'connecting_or_retrying',
    redis: isRedisReady() ? 'connected' : 'in_process_fallback_active',
    env: {
      mongoUriConfigured: !!process.env.MONGO_URI,
      redisUrlConfigured: !!process.env.REDIS_URL,
      gtwyApiKeyConfigured: !!process.env.GTWY_API_KEY,
      port: port,
    }
  });
});

// Routes
app.use('/api', routes);

// Start listening immediately on 0.0.0.0 so Render detects open port without delay
app.listen(Number(port), '0.0.0.0', () => {
  console.log(`🚀 [Server] Running on port ${port} (0.0.0.0)`);
});

// Initiate MongoDB connection asynchronously
connectDB().catch((error: any) => {
  console.error('[MongoDB] Initial connection error:', error?.message || error);
});
