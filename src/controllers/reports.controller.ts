import { Request, Response } from 'express';
import { dispatchReportJob } from '../queues';
import FolderModel from '../models/Folder';

export const requestReportGeneration = async (req: Request, res: Response) => {
  try {
    const { folderId, prompt, title, instructions, reportType, audience, format, customVariables } = req.body;

    const folder = await FolderModel.findById(folderId);
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    const job = await dispatchReportJob({
      folderId,
      title: title || `Analysis Report - ${folder.name}`,
      prompt: prompt || instructions || 'Generate a comprehensive, professional report based on the following folder context and documents.',
      instructions: instructions || prompt || '',
      reportType: reportType || 'Comprehensive Operational Report',
      audience: audience || 'Executive & Mine Leadership',
      format: format || 'Detailed Markdown Report',
      customVariables: customVariables || {}
    });

    res.status(202).json({
      message: 'Report generation queued successfully',
      jobId: job.id
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const deleteReport = async (req: Request, res: Response) => {
  try {
    const { id, reportId } = req.params;

    const folder = await FolderModel.findById(id);
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    const reportIndex = folder.reports.findIndex((r: any) => r._id.toString() === reportId);
    if (reportIndex === -1) {
      return res.status(404).json({ error: 'Report not found' });
    }

    folder.reports.splice(reportIndex, 1);
    await folder.save();

    res.json({ message: 'Report deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
