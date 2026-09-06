import { Router } from 'express';
import { documentQueue, reportQueue } from '../queues';

const router = Router();

router.get('/:id', async (req, res) => {
  try {
    const jobId = req.params.id;
    // Check both queues
    let job = await documentQueue.getJob(jobId);
    let queueName = 'document-processing';
    
    if (!job) {
      job = await reportQueue.getJob(jobId);
      queueName = 'report-generation';
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
