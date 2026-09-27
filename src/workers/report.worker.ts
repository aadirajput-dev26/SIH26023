import { Worker } from 'bullmq';
import dotenv from 'dotenv';
import FolderModel from '../models/Folder';
import DocumentModel from '../models/Document';
import { createRedisConnection } from '../config/redis';
import { queryPipeline } from '../services/rag_pipeline.service';

dotenv.config();

const connection = createRedisConnection('report-worker');

/**
 * Self-contained report generation task.
 *
 * Flow:
 *   1. Load folder + all its documents from MongoDB
 *   2. Collect all ragDocumentIds from completed docs
 *   3. Query the RAG pipeline with a rich report prompt scoped to those docs
 *   4. Store the generated report in the Folder document
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

    // ── Step 2: Build a rich report prompt ───────────────────────────────────
    const reportTitle = title || `Analysis Report - ${folder.name}`;
    const userInstructions = instructions || prompt || 'Generate a comprehensive, professional report.';

    const fullPrompt = [
      `You are an expert report writer for the coal mining domain.`,
      `Generate a complete, detailed ${reportType || 'Comprehensive Operational Report'} in ${format || 'Markdown'} format.`,
      `Report Title: ${reportTitle}`,
      `Target Audience: ${audience || 'Executive & Mine Leadership'}`,
      ``,
      `User Instructions: ${userInstructions}`,
      ``,
      `Folder: ${folder.name}`,
      folder.description ? `Folder Description: ${folder.description}` : '',
      ``,
      `Folder Analytics Summary:`,
      JSON.stringify(folder.analyticsMetrics || {}, null, 2),
      ``,
      `Documents in this folder (${docs.length} total):`,
      JSON.stringify(documentsSummary, null, 2),
      ``,
      `Using the above context and the indexed document content, produce a thorough professional report.`,
      `Include executive summary, key findings, metrics analysis, recommendations, and conclusion.`,
      ...(customVariables ? [`Additional context: ${JSON.stringify(customVariables)}`] : []),
    ]
      .filter(Boolean)
      .join('\n');

    if (onProgress) onProgress(40);

    // ── Step 3: Query RAG pipeline (scoped to folder docs if available) ───────
    console.log(
      `[ReportTask] Calling RAG pipeline for report generation. Scoped docs: ${ragDocumentIds.length}`,
    );
    const result = await queryPipeline(
      fullPrompt,
      ragDocumentIds.length > 0 ? ragDocumentIds : undefined,
    );

    if (onProgress) onProgress(85);

    const reportContent = result.answer || 'Report generated with no content.';

    // ── Step 4: Save report to Folder ─────────────────────────────────────────
    const generatedReport = {
      title: reportTitle,
      content: reportContent,
      createdAt: new Date(),
    };

    folder.reports = folder.reports || [];
    folder.reports.push(generatedReport as any);
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
