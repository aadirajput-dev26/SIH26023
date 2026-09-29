import { Worker } from 'bullmq';
import dotenv from 'dotenv';
import FolderModel from '../models/Folder';
import DocumentModel from '../models/Document';
import { createRedisConnection } from '../config/redis';
import { callGtwyChatAgent, extractGtwyContent } from '../services/gtwy.service';
import { queryPipeline } from '../services/rag_pipeline.service';

dotenv.config();

const connection = createRedisConnection('report-worker');

/**
 * Self-contained report generation task.
 * Calls GTWY Report Generation Agent with fallback to local RAG pipeline.
 */
export async function processReportTask(data: any, onProgress?: (progress: number) => void) {
  const { folderId, title, prompt, instructions, reportType, audience, format, customVariables } = data;
  console.log(`[ReportTask] Starting report generation for folder ${folderId} with title: ${title}`);
  if (onProgress) onProgress(10);

  try {
    const folder = await FolderModel.findById(folderId);
    if (!folder) throw new Error('Folder not found');

    // ── Step 1: Fetch documents + collect RAG doc IDs ─────────────────────────
    const docs = await DocumentModel.find({ folderId: folder._id, status: 'completed' });
    const ragDocumentIds = docs
      .map((d) => (d as any).ragDocumentId)
      .filter(Boolean) as string[];

    const documentsSummary = docs.map((doc) => ({
      name: doc.originalName,
      title: doc.title || doc.originalName,
      description: (doc as any).description || doc.originalName,
      mimetype: doc.mimetype,
      status: doc.status,
      topic: doc.analytics?.topic,
      summary: doc.analytics?.summary,
      extractedMetrics: doc.analytics?.extractedMetrics,
    }));

    if (onProgress) onProgress(25);

    // ── Step 2: Build GTWY Agent Variables & Prompt ──────────────────────────
    const reportTitle = title || `Analysis Report - ${folder.name}`;
    const userPrompt = prompt || instructions || 'Generate a comprehensive, detailed, professional report based on the following folder context and documents.';

    const agentId = process.env.GTWY_REPORT_GENERATION_AGENT_ID || '6a9f17ef0869a6b2a2333e34';
    const threadId = `folder_${folder._id}_report_${Date.now()}`;

    const variables = {
      folderName: folder.name,
      folderDescription: folder.description || '',
      reportTitle,
      userInstructions: instructions || prompt || '',
      instructions: instructions || prompt || '',
      prompt: prompt || instructions || '',
      reportType: reportType || 'Comprehensive Operational Report',
      audience: audience || 'Executive & Mine Leadership',
      format: format || 'Detailed Markdown Report',
      existingReportContent: customVariables?.existingReportContent || '',
      documentsList: JSON.stringify(documentsSummary, null, 2),
      folderAnalytics: JSON.stringify(folder.analyticsMetrics || {}, null, 2),
      ...(customVariables || {}),
    };

    if (onProgress) onProgress(45);

    // ── Step 3: Call GTWY Report Generation Agent ────────────────────────────
    console.log(`[ReportTask] Calling GTWY Report Generation Agent (${agentId}) for folder: ${folder.name}...`);
    let reportContent = '';
    try {
      const gtwyData = await callGtwyChatAgent(agentId, threadId, userPrompt, variables);
      reportContent = extractGtwyContent(gtwyData);
    } catch (gtwyErr: any) {
      console.warn(`[ReportTask] GTWY Report Agent notice: ${gtwyErr.message}. Attempting RAG pipeline fallback.`);
      const result = await queryPipeline(userPrompt, {
        collectionId: folder.ragCollectionId,
        documentIds: ragDocumentIds.length > 0 ? ragDocumentIds : undefined,
      });
      reportContent = result.answer || 'Report generated with no content.';
    }

    if (onProgress) onProgress(85);

    // ── Step 4: Save report to Folder ─────────────────────────────────────────
    const generatedReport = {
      title: reportTitle,
      content: reportContent || 'Report generated with no content.',
      createdAt: new Date(),
    };

    folder.reports = folder.reports || [];
    const existingIndex = folder.reports.findIndex((r: any) => r.title === reportTitle);
    if (existingIndex !== -1 && customVariables?.existingReportContent) {
      folder.reports[existingIndex].content = reportContent || folder.reports[existingIndex].content;
      folder.reports[existingIndex].createdAt = new Date();
    } else {
      folder.reports.push(generatedReport as any);
    }
    await folder.save();

    if (onProgress) onProgress(100);
    console.log(`[ReportTask] Successfully generated report for folder: ${folder.name}`);
    return { success: true, report: generatedReport };
  } catch (error: any) {
    console.error('[ReportTask] Report task failed:', error.message);
    throw error;
  }
}

export const reportWorker = new Worker(
  'report-generation-queue',
  async (job) => processReportTask(job.data, (p: number) => job.updateProgress(p)),
  { connection, lockDuration: 600000, stalledInterval: 600000 },
);

reportWorker.on('completed', (job) => {
  console.log(`[ReportWorker] Report Job ${job.id} has completed!`);
});

reportWorker.on('failed', (job, err) => {
  console.error(`[ReportWorker] Report Job ${job?.id} failed: ${err.message}`);
});

reportWorker.on('error', () => {
  // Suppress BullMQ redis connection noise
});
