import { Queue, QueueEvents } from 'bullmq';
import { createRedisConnection, isRedisReady } from '../config/redis';
import { processDocumentTask } from '../workers/document.worker';
import { processReportTask } from '../workers/report.worker';

const redisConnection = createRedisConnection('queues');

export const documentQueue = new Queue('document-processing-queue', { connection: redisConnection });
export const reportQueue = new Queue('report-generation-queue', { connection: redisConnection });

export const documentQueueEvents = new QueueEvents('document-processing-queue', { connection: redisConnection });
export const reportQueueEvents = new QueueEvents('report-generation-queue', { connection: redisConnection });

// Prevent unhandled error events from crashing the process if Redis is unavailable
documentQueue.on('error', () => {});
reportQueue.on('error', () => {});
documentQueueEvents.on('error', () => {});
reportQueueEvents.on('error', () => {});

export interface FallbackJob {
  id: string;
  queue: string;
  state: 'active' | 'completed' | 'failed';
  progress: number;
  result?: any;
  failedReason?: string;
  data?: any;
  createdAt: number;
}

export const fallbackJobs = new Map<string, FallbackJob>();

/**
 * Dispatch document processing job.
 * Attempts BullMQ if Redis is reachable; otherwise seamlessly executes in-process.
 */
export async function dispatchDocumentJob(data: any): Promise<{ id: string }> {
  const jobId = `doc_${data.documentId}_${Date.now()}`;

  if (isRedisReady()) {
    try {
      const job = await documentQueue.add('process-document', data, {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      });
      return { id: (job.id || jobId) as string };
    } catch (queueErr: any) {
      console.warn('[DocumentQueue] BullMQ dispatch notice, using in-process execution:', queueErr.message);
    }
  }

  console.log(`[DocumentQueue] Dispatching document task ${jobId} via in-process background worker`);
  fallbackJobs.set(jobId, {
    id: jobId,
    queue: 'document-processing',
    state: 'active',
    progress: 15,
    data,
    createdAt: Date.now()
  });

  setImmediate(async () => {
    try {
      const result = await processDocumentTask(data, (p: number) => {
        const j = fallbackJobs.get(jobId);
        if (j) j.progress = p;
      });
      const j = fallbackJobs.get(jobId);
      if (j) {
        j.state = 'completed';
        j.progress = 100;
        j.result = result;
      }
    } catch (err: any) {
      console.error(`[DocumentQueue] In-process task ${jobId} failed:`, err.message);
      const j = fallbackJobs.get(jobId);
      if (j) {
        j.state = 'failed';
        j.failedReason = err.message;
      }
    }
  });

  return { id: jobId };
}

/**
 * Dispatch report generation job.
 * Attempts BullMQ if Redis is reachable; otherwise seamlessly executes in-process.
 */
export async function dispatchReportJob(data: any): Promise<{ id: string }> {
  const jobId = `report_${data.folderId}_${Date.now()}`;

  if (isRedisReady()) {
    try {
      const job = await reportQueue.add('generate-report', data, { jobId });
      return { id: (job.id || jobId) as string };
    } catch (queueErr: any) {
      console.warn('[ReportQueue] BullMQ dispatch notice, using in-process execution:', queueErr.message);
    }
  }

  console.log(`[ReportQueue] Dispatching report task ${jobId} via in-process background worker`);
  fallbackJobs.set(jobId, {
    id: jobId,
    queue: 'report-generation',
    state: 'active',
    progress: 15,
    data,
    createdAt: Date.now()
  });

  setImmediate(async () => {
    try {
      const result = await processReportTask(data, (p: number) => {
        const j = fallbackJobs.get(jobId);
        if (j) j.progress = p;
      });
      const j = fallbackJobs.get(jobId);
      if (j) {
        j.state = 'completed';
        j.progress = 100;
        j.result = result;
      }
    } catch (err: any) {
      console.error(`[ReportQueue] In-process report task ${jobId} failed:`, err.message);
      const j = fallbackJobs.get(jobId);
      if (j) {
        j.state = 'failed';
        j.failedReason = err.message;
      }
    }
  });

  return { id: jobId };
}
