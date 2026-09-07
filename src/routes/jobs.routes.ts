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

    const state = await job.getState();
    const progress = job.progress;
    const result = job.returnvalue;
    const failedReason = job.failedReason;

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
