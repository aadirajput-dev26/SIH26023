import { Router } from 'express';
import { documentQueue, reportQueue } from '../queues';

const router = Router();

router.get('/:id', async (req, res) => {
  try {
    const jobId = req.params.id;
    const requestedQueue = req.query.queue as string;
    let job = null;
    let queueName = '';

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

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    let state = await job.getState();
    const progress = job.progress;
    const result = job.returnvalue;
    const failedReason = job.failedReason;

    // Resilient fallback check: If state in Redis is active but document or report is already completed in Mongo
    if (state === 'active') {
      if (job.data?.documentId) {
        try {
          const DocumentModel = (await import('../models/Document')).default;
          const doc = await DocumentModel.findById(job.data.documentId);
          if (doc && doc.status === 'completed') {
            state = 'completed';
          } else if (doc && doc.status === 'failed') {
            state = 'failed';
          }
        } catch {}
      } else if (job.data?.folderId) {
        try {
          const FolderModel = (await import('../models/Folder')).default;
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

    res.json({
      id: job.id,
      queue: queueName,
      state,
      progress,
      result,
      failedReason
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
