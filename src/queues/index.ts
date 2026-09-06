import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
});

export const documentQueue = new Queue('document-processing-queue', { connection });
export const reportQueue = new Queue('report-generation-queue', { connection });

export const documentQueueEvents = new QueueEvents('document-processing-queue', { connection });
export const reportQueueEvents = new QueueEvents('report-generation-queue', { connection });
