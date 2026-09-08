import { Worker } from 'bullmq';
import dotenv from 'dotenv';
import FolderModel from '../models/Folder';
import DocumentModel from '../models/Document';
import { callGtwyChatAgent, extractGtwyContent } from '../services/gtwy.service';
import { createRedisConnection } from '../config/redis';

dotenv.config();

const connection = createRedisConnection('report-worker');

/**
 * Self-contained report generation task that can be executed either by BullMQ
 * or directly in-process when Redis is not available.
 */
export async function processReportTask(data: any, onProgress?: (progress: number) => void) {
  const { folderId, title, prompt, instructions, reportType, audience, format, customVariables } = data;
  console.log(`[ReportTask] Starting report generation for folder ${folderId} with title: ${title}`);
  if (onProgress) onProgress(10);

  try {
    const folder = await FolderModel.findById(folderId);
    if (!folder) throw new Error('Folder not found');

    // Fetch all documents for this folder to pass into variables
    const docs = await DocumentModel.find({ folderId: folder._id });
    
    // Create rich summary of documents
    const documentsSummary = docs.map(doc => ({
      name: doc.originalName,
      title: doc.title || doc.originalName,
      description: (doc as any).description || doc.originalName,
      mimetype: doc.mimetype,
      status: doc.status,
      topic: doc.analytics?.topic,
      summary: doc.analytics?.summary,
      extractedMetrics: doc.analytics?.extractedMetrics,
    }));

    const agentId = process.env.GTWY_REPORT_GENERATION_AGENT_ID || '6a9f17ef0869a6b2a2333e34';
    const threadId = `folder_${folder._id}_report_${Date.now()}`;
    const userPrompt = prompt || instructions || 'Generate a comprehensive, detailed, professional report based on the following folder context and documents.';

    const variables = {
      folderName: folder.name,
      folderDescription: folder.description || '',
      reportTitle: title || `Report for ${folder.name}`,
      userInstructions: instructions || prompt || '',
      instructions: instructions || prompt || '',
      prompt: prompt || instructions || '',
      reportType: reportType || 'Comprehensive Operational Report',
      audience: audience || 'Executive & Mine Leadership',
      format: format || 'Detailed Markdown Report',
      documentsList: JSON.stringify(documentsSummary, null, 2),
      folderAnalytics: JSON.stringify(folder.analyticsMetrics || {}, null, 2),
      ...(customVariables || {})
    };

    if (onProgress) onProgress(30);

    console.log(`[ReportTask] Calling GTWY report agent (${agentId}) for folder: ${folder.name}...`);
    const gtwyData = await callGtwyChatAgent(agentId, threadId, userPrompt, variables);

    if (onProgress) onProgress(85);

    const rawContent = extractGtwyContent(gtwyData);

    const generatedReport = {
      title: title || `Analysis Report - ${folder.name}`,
      content: rawContent || 'Report generated with no content.',
      createdAt: new Date()
    };

    folder.reports = folder.reports || [];
    folder.reports.push(generatedReport as any);
    await folder.save();

    if (onProgress) onProgress(100);
    console.log(`[ReportTask] Successfully generated and stored report for folder: ${folder.name}`);
    return { success: true, report: generatedReport };
  } catch (error: any) {
    console.error(`[ReportTask] Report task failed:`, error.message);
    throw error;
  }
}

export const reportWorker = new Worker('report-generation-queue', async job => {
  return await processReportTask(job.data, (p: number) => job.updateProgress(p));
}, { 
  connection,
  lockDuration: 300000,
  stalledInterval: 300000
});

reportWorker.on('completed', job => {
  console.log(`[ReportWorker] Report Job ${job.id} has completed!`);
});

reportWorker.on('failed', (job, err) => {
  console.error(`[ReportWorker] Report Job ${job?.id} failed: ${err.message}`);
});

reportWorker.on('error', (err) => {
  // Gracefully handle BullMQ redis connection notice without crashing Node
});
