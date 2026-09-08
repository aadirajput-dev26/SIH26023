import { Router } from 'express';
import { documentQueue, reportQueue, fallbackJobs } from '../queues';
import DocumentModel from '../models/Document';
import FolderModel from '../models/Folder';

const router = Router();

router.get('/:id', async (req, res) => {
  try {
    const jobId = req.params.id;
    const requestedQueue = req.query.queue as string;

    // ── 1. Check in-memory fallback registry first ──
    const fallbackJob = fallbackJobs.get(jobId);
    if (fallbackJob) {
      let state = fallbackJob.state;
      let progress = fallbackJob.progress;

      // If active, cross check MongoDB
      if (state === 'active') {
        if (fallbackJob.data?.documentId) {
          try {
            const doc = await DocumentModel.findById(fallbackJob.data.documentId);
            if (doc && doc.status === 'completed') {
              state = 'completed';
              progress = 100;
            } else if (doc && doc.status === 'failed') {
              state = 'failed';
            }
          } catch {}
        } else if (fallbackJob.data?.folderId) {
          try {
            const folder = await FolderModel.findById(fallbackJob.data.folderId);
            if (folder && folder.reports && folder.reports.length > 0) {
              const matching = folder.reports.find((r: any) =>
                r.title === fallbackJob.data.title ||
                (Date.now() - new Date(r.createdAt).getTime()) < 600000
              );
              if (matching) {
                state = 'completed';
                progress = 100;
              }
            }
          } catch {}
        }
      }

      return res.json({
        id: fallbackJob.id,
        queue: fallbackJob.queue,
        state,
        progress: state === 'completed' ? 100 : progress,
        result: fallbackJob.result,
        failedReason: fallbackJob.failedReason
      });
    }

    // ── 2. Check BullMQ Redis queues (safely wrapped in try/catch) ──
    let job = null;
    let queueName = '';

    try {
      if (requestedQueue === 'report' || jobId.startsWith('report_')) {
        job = await reportQueue.getJob(jobId);
        queueName = 'report-generation';
        if (!job) {
          job = await documentQueue.getJob(jobId);
          queueName = 'document-processing';
        }
      } else {
        job = await documentQueue.getJob(jobId);
        queueName = 'document-processing';
        if (!job) {
          job = await reportQueue.getJob(jobId);
          queueName = 'report-generation';
        }
      }
    } catch (redisErr: any) {
      console.warn('[JobsRoute] Redis check notice:', redisErr.message);
    }

    if (job) {
      let state = await job.getState();
      const progress = job.progress;
      const result = job.returnvalue;
      const failedReason = job.failedReason;

      // Resilient fallback check: If state in Redis is active but document or report is already completed in Mongo
      if (state === 'active') {
        if (job.data?.documentId) {
          try {
            const doc = await DocumentModel.findById(job.data.documentId);
            if (doc && doc.status === 'completed') {
              state = 'completed';
            } else if (doc && doc.status === 'failed') {
              state = 'failed';
            }
          } catch {}
        } else if (job.data?.folderId) {
          try {
            const folder = await FolderModel.findById(job.data.folderId);
            if (folder && folder.reports && folder.reports.length > 0) {
              const matchingReport = folder.reports.find((r: any) => 
                r.title === job.data.title || 
                (new Date().getTime() - new Date(r.createdAt).getTime()) < 600000
              );
              if (matchingReport) {
                state = 'completed';
              }
            }
          } catch {}
        }
      }

      return res.json({
        id: job.id,
        queue: queueName,
        state,
        progress: state === 'completed' ? 100 : progress,
        result,
        failedReason
      });
    }

    // ── 3. Direct MongoDB inspection for document jobs (e.g. doc_<documentId>_...) ──
    if (jobId.includes('doc_')) {
      const parts = jobId.split('_');
      const docId = parts[1];
      if (docId && docId.length === 24) {
        try {
          const doc = await DocumentModel.findById(docId);
          if (doc) {
            return res.json({
              id: jobId,
              queue: 'document-processing',
              state: doc.status === 'completed' ? 'completed' : (doc.status === 'failed' ? 'failed' : 'active'),
              progress: doc.status === 'completed' ? 100 : 60,
            });
          }
        } catch {}
      }
    }

    return res.status(404).json({ error: 'Job not found' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
