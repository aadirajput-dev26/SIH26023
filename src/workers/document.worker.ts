import { Worker } from 'bullmq';
import dotenv from 'dotenv';
import DocumentModel from '../models/Document';
import FolderModel from '../models/Folder';
import { createRedisConnection } from '../config/redis';
import { ingestDocument, ingestUrl, waitForProcessing, queryPipeline } from '../services/rag_pipeline.service';
import { extractAllJsonObjects } from '../services/gtwy.service';

dotenv.config();

const connection = createRedisConnection('doc-worker');

/**
 * Self-contained document processing task that can be executed either by BullMQ
 * or directly in-process when Redis is not available.
 *
 * Flow:
 *   1. Ingest file/URL → RAG Pipeline (/api/v1/documents/ingest or /ingest-url)
 *   2. Poll /status until COMPLETED
 *   3. Query the pipeline for structured analytics JSON
 *   4. Parse + normalize analytics, save to MongoDB
 *   5. Aggregate folder-level metrics
 */
export async function processDocumentTask(data: any, onProgress?: (progress: number) => void) {
  const { documentId, folderId, filePath, sourceUrl, fileType, originalName, description } = data;
  console.log(`[DocumentTask] Processing document ${documentId} (${originalName})`);
  if (onProgress) onProgress(10);

  try {
    await DocumentModel.findByIdAndUpdate(documentId, { status: 'processing' });

    // ── Step 1: Ingest into RAG Pipeline ──────────────────────────────────────
    let ingestResult: { document_id: string; [key: string]: any };

    if (filePath) {
      console.log(`[DocumentTask] Ingesting file: ${filePath}`);
      ingestResult = await ingestDocument(filePath, originalName || 'document', fileType || 'application/octet-stream');
    } else if (sourceUrl) {
      console.log(`[DocumentTask] Ingesting URL: ${sourceUrl}`);
      ingestResult = await ingestUrl(sourceUrl);
    } else {
      throw new Error('Neither filePath nor sourceUrl provided');
    }

    const ragDocumentId = ingestResult.document_id;
    console.log(`[DocumentTask] RAG doc created: ${ragDocumentId}`);

    // Persist the RAG document ID immediately so we can track/delete later
    await DocumentModel.findByIdAndUpdate(documentId, { ragDocumentId });
    if (onProgress) onProgress(35);

    // ── Step 2: Poll until RAG Pipeline finishes processing ───────────────────
    console.log(`[DocumentTask] Waiting for RAG pipeline to process doc ${ragDocumentId}...`);
    await waitForProcessing(ragDocumentId, 300_000, 5_000);
    if (onProgress) onProgress(70);

    // ── Step 3: Query for structured analytics JSON ───────────────────────────
    console.log(`[DocumentTask] Querying RAG pipeline for analytics of doc ${ragDocumentId}...`);
    const analyticsPrompt = [
      'Analyze this document and return ONLY a raw JSON object (no markdown fences) with this exact shape:',
      '{',
      '  "topic": "<document main topic>",',
      '  "summary": "<2-3 sentence summary>",',
      '  "wordCloudKeywords": ["keyword1", "keyword2", ...],',
      '  "extractedMetrics": {',
      '    "subsidiaryName": "<mining company or subsidiary if present>",',
      '    "coalProductionMT": "<coal production in million tonnes if present>",',
      '    "overburdenRemovalCuM": "<OBR in cubic metres if present>",',
      '    "customMetricName1": "<metric label>",',
      '    "customMetricValue1": "<metric value>",',
      '    "customMetricName2": "<metric label>",',
      '    "customMetricValue2": "<metric value>"',
      '  }',
      '}',
      'Return only JSON. Do not include any explanation or markdown.',
    ].join('\n');

    const queryResult = await queryPipeline(analyticsPrompt, [ragDocumentId]);
    if (onProgress) onProgress(85);

    // ── Step 4: Parse analytics ───────────────────────────────────────────────
    const rawAnswer = queryResult.answer || '';
    const cleanJson = rawAnswer.replace(/```json/gi, '').replace(/```/g, '').trim();

    let analyticsData: any = null;
    try {
      analyticsData = JSON.parse(cleanJson);
    } catch {
      const objects = extractAllJsonObjects(rawAnswer);
      analyticsData = objects.find(
        (obj) => obj && (obj.topic || obj.wordCloudKeywords || obj.extractedMetrics || obj.summary),
      ) || null;
    }

    if (!analyticsData || typeof analyticsData !== 'object') {
      analyticsData = {
        topic: originalName || 'Document',
        summary: '',
        wordCloudKeywords: [],
        extractedMetrics: {},
      };
    }
    if (!analyticsData.extractedMetrics) analyticsData.extractedMetrics = {};

    // ── Dynamic Custom Metrics Normalization ──────────────────────────────────
    const rawKeyMetrics = analyticsData.extractedMetrics.keyMetrics || {};
    const customMetricsList: Array<{ name: string; value: string | number }> = [];
    const processedMetricKeys = new Set<string>();

    const nameKeys = Object.keys(rawKeyMetrics).filter(k => /^customMetricName\d+$/i.test(k));
    nameKeys.sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
      const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
      return numA - numB;
    });

    for (const nKey of nameKeys) {
      const numStr = nKey.replace(/\D/g, '');
      const valKey = Object.keys(rawKeyMetrics).find(k =>
        new RegExp(`^customMetricValue${numStr}$`, 'i').test(k),
      );
      const name = rawKeyMetrics[nKey];
      const value = valKey ? rawKeyMetrics[valKey] : undefined;
      if (name !== undefined && value !== undefined && value !== null) {
        customMetricsList.push({ name: String(name), value });
        processedMetricKeys.add(nKey);
        if (valKey) processedMetricKeys.add(valKey);
      }
    }

    // Also check top-level extractedMetrics for paired customMetricName/Value keys
    const topMetrics = analyticsData.extractedMetrics;
    const topNameKeys = Object.keys(topMetrics).filter(k => /^customMetricName\d+$/i.test(k));
    topNameKeys.sort((a, b) => parseInt(a.replace(/\D/g, '')) - parseInt(b.replace(/\D/g, '')));
    for (const nKey of topNameKeys) {
      const numStr = nKey.replace(/\D/g, '');
      const valKey = Object.keys(topMetrics).find(k =>
        new RegExp(`^customMetricValue${numStr}$`, 'i').test(k),
      );
      const name = topMetrics[nKey];
      const value = valKey ? topMetrics[valKey] : undefined;
      if (name !== undefined && value !== undefined && value !== null) {
        customMetricsList.push({ name: String(name), value });
      }
    }

    // Remaining non-indexed custom metric entries from rawKeyMetrics
    for (const [k, v] of Object.entries(rawKeyMetrics)) {
      if (!processedMetricKeys.has(k) && !/^customMetricValue\d+$/i.test(k) && v !== undefined && v !== null) {
        customMetricsList.push({ name: k, value: v as any });
      }
    }

    analyticsData.extractedMetrics.customMetricsList = customMetricsList;

    // ── Step 5: Save document analytics ──────────────────────────────────────
    await DocumentModel.findByIdAndUpdate(documentId, {
      status: 'completed',
      analytics: analyticsData,
    });

    // ── Step 6: Recalculate folder aggregated analytics ───────────────────────
    const allFolderDocs = await DocumentModel.find({ folderId, status: 'completed' });

    let totalCoal = 0;
    let totalOBR = 0;
    const allKeywords = new Set<string>();
    const subsidiaries = new Set<string>();
    const allAggregatedCustomMetrics: Array<{ name: string; value: string | number; docTitle?: string }> = [];
    const docsDataSummary: any[] = [];

    for (const doc of allFolderDocs) {
      const a = doc.analytics || {};
      const m = a.extractedMetrics || {};

      const coalVal = parseFloat(m.coalProductionMT) || 0;
      const obrVal = parseFloat(m.overburdenRemovalCuM) || 0;
      totalCoal += coalVal;
      totalOBR += obrVal;

      if (m.subsidiaryName) subsidiaries.add(m.subsidiaryName);
      if (Array.isArray(a.wordCloudKeywords)) {
        a.wordCloudKeywords.forEach((kw: string) => allKeywords.add(kw));
      }
      if (Array.isArray(m.customMetricsList)) {
        m.customMetricsList.forEach((cm: any) => {
          allAggregatedCustomMetrics.push({
            name: cm.name,
            value: cm.value,
            docTitle: doc.title || doc.originalName,
          });
        });
      }

      docsDataSummary.push({
        documentId: doc._id.toString(),
        name: doc.title || doc.originalName,
        topic: a.topic || doc.originalName,
        summary: a.summary || '',
        wordCloudKeywords: a.wordCloudKeywords || [],
        extractedMetrics: m,
        createdAt: doc.createdAt,
      });
    }

    const strippingRatio = totalCoal > 0 && totalOBR > 0 ? (totalOBR / totalCoal).toFixed(2) : null;

    await FolderModel.findByIdAndUpdate(folderId, {
      $set: {
        'analyticsMetrics.lastProcessed': new Date(),
        'analyticsMetrics.totalCoalProductionMT': totalCoal.toFixed(2),
        'analyticsMetrics.totalOverburdenCuM': totalOBR > 0 ? totalOBR.toFixed(2) : null,
        'analyticsMetrics.strippingRatio': strippingRatio,
        'analyticsMetrics.subsidiaries': Array.from(subsidiaries),
        'analyticsMetrics.keywords': Array.from(allKeywords),
        'analyticsMetrics.customMetricsList': allAggregatedCustomMetrics,
        'analyticsMetrics.documentsData': docsDataSummary,
      },
    });

    if (onProgress) onProgress(100);
    console.log(`[DocumentTask] Document ${documentId} processed successfully.`);
    return { success: true, documentId, ragDocumentId };
  } catch (error: any) {
    console.error(`[DocumentTask] Processing failed for doc ${documentId}:`, error.message);
    await DocumentModel.findByIdAndUpdate(documentId, { status: 'failed' });
    throw error;
  }
}

export const documentWorker = new Worker(
  'document-processing-queue',
  async (job) => processDocumentTask(job.data, (p: number) => job.updateProgress(p)),
  { connection, lockDuration: 600000, stalledInterval: 600000 },
);

documentWorker.on('completed', (job) => {
  console.log(`[DocumentWorker] Job ${job.id} completed!`);
});

documentWorker.on('failed', (job, err) => {
  console.error(`[DocumentWorker] Job ${job?.id} failed: ${err.message}`);
});

documentWorker.on('error', () => {
  // Suppress BullMQ redis connection noise
});
