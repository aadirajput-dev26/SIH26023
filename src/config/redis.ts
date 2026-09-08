import IORedis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

let isRedisConnected = false;
let hasWarned = false;

export function createRedisConnection(name = 'default'): IORedis {
  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

  const client = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times) {
      // Exponential backoff capped at 20 seconds, prevents log spam
      return Math.min(times * 2000, 20000);
    },
    lazyConnect: true,
  });

  client.on('connect', () => {
    isRedisConnected = true;
    console.log(`✅ [Redis:${name}] Connected successfully`);
  });

  client.on('ready', () => {
    isRedisConnected = true;
  });

  client.on('error', (err: any) => {
    isRedisConnected = false;
    if (!hasWarned) {
      console.warn(`⚠️ [Redis:${name}] Connection notice: ${err.message}. If running on Render without Redis, background fallback will handle tasks seamlessly.`);
      hasWarned = true;
    }
  });

  client.on('close', () => {
    isRedisConnected = false;
  });

  // Attempt initial connect without throwing uncaught exceptions
  client.connect().catch((err: any) => {
    if (!hasWarned) {
      console.warn(`⚠️ [Redis:${name}] Initial connect notice: ${err.message}. In-process fallback active.`);
      hasWarned = true;
    }
  });

  return client;
}

export const isRedisReady = () => isRedisConnected;
