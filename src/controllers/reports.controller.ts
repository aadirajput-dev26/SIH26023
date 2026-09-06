import { Request, Response } from 'express';
import { reportQueue } from '../queues';
import FolderModel from '../models/Folder';

export const requestReportGeneration = async (req: Request, res: Response) => {
  try {
    const { folderId, prompt } = req.body;

    const folder = await FolderModel.findById(folderId);
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    const job = await reportQueue.add('generate-report', {
      folderId,
      prompt
    });

    res.status(202).json({
      message: 'Report generation queued successfully',
      jobId: job.id
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
