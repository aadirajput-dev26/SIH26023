import { Worker } from 'bullmq';
import dotenv from 'dotenv';
import DocumentModel from '../models/Document';
import FolderModel from '../models/Folder';
import { callGtwyChatAgent, extractAllJsonObjects, extractGtwyContent } from '../services/gtwy.service';
import { createRedisConnection } from '../config/redis';
import { ingestDocument, ingestUrl, checkDocumentStatus, queryPipeline } from '../services/rag_pipeline.service';

dotenv.config();

const connection = createRedisConnection('doc-worker');

/**
 * Self-contained document processing task that can be executed either by BullMQ
 * or directly in-process when Redis is not available.
 */
export async function processDocumentTask(data: any, onProgress?: (progress: number) => void) {
  const { documentId, folderId, filePath, sourceUrl, fileType, originalName, description, gtwyResourceId } = data;
  console.log(`[DocumentTask] Processing document ${documentId} (${originalName})`);
  if (onProgress) onProgress(10);

  try {
    await DocumentModel.findByIdAndUpdate(documentId, { status: 'processing' });

    let resourceId = gtwyResourceId;

    // ── Step 1: Ingest into RAG Pipeline ──
    let ingestResult;
    if (filePath) {
      ingestResult = await ingestDocument(filePath, originalName || 'document', fileType || 'application/pdf');
    } else if (sourceUrl) {
      ingestResult = await ingestUrl(sourceUrl);
    } else {
      throw new Error("Neither filePath nor sourceUrl provided");
    }
    
    const ragDocumentId = ingestResult.document_id;
    if (onProgress) onProgress(40);

    // ── Step 2: Poll RAG Pipeline until processed ──
    let isProcessed = false;
    for (let i = 0; i < 60; i++) { // Wait up to 5 minutes
      const statusRes = await checkDocumentStatus(ragDocumentId);
      if (statusRes.overall_status === 'COMPLETED') {
        isProcessed = true;
        break;
      }
      if (statusRes.overall_status === 'FAILED') {
        throw new Error("RAG Pipeline processing failed.");
      }
      await new Promise(r => setTimeout(r, 5000));
    }
    if (!isProcessed) throw new Error("RAG Pipeline processing timeout");

    if (onProgress) onProgress(75);

    // ── Step 3: Extract Analytics via RAG Query Pipeline ──
    console.log(`[DocumentTask] Extracting analytics via RAG pipeline for document ${documentId}...`);
    const prompt = "Extract the key analytics, metrics, and topics from this document and return them in a strict JSON format including 'topic', 'summary', 'wordCloudKeywords' (array of strings), and 'extractedMetrics' (object of key-value pairs).";
    const queryResult = await queryPipeline(prompt, [ragDocumentId]);
    const gtwyResult = queryResult.answer;

    if (onProgress) onProgress(80);

    // Robust extraction of stringified JSON content returned by GTWY agent
    const rawContent = extractGtwyContent(gtwyResult);
    const cleanJson = rawContent.replace(/```json/gi, '').replace(/```/g, '').trim();
    
    let analyticsData: any = null;
    try {
      analyticsData = JSON.parse(cleanJson);
    } catch {
      // If direct parse fails, extract all JSON objects
      const objects = extractAllJsonObjects(rawContent);
      analyticsData = objects.find(obj => obj && (obj.topic || obj.wordCloudKeywords || obj.extractedMetrics || obj.summary)) || null;
    }

    if (!analyticsData || typeof analyticsData !== 'object') {
      analyticsData = {
        topic: originalName || 'Coal Mining Operational Report',
        summary: '',
        wordCloudKeywords: [],
        extractedMetrics: {}
      };
    }

    if (!analyticsData.extractedMetrics) {
      analyticsData.extractedMetrics = {};
    }

    // ── Dynamic Custom Metrics Normalization ──
    const rawKeyMetrics = analyticsData.extractedMetrics.keyMetrics || {};
    const customMetricsList: Array<{ name: string; value: string | number }> = [];
    const processedMetricKeys = new Set<string>();

    // 1. Extract paired customMetricName[N] and customMetricValue[N]
    const nameKeys = Object.keys(rawKeyMetrics).filter(k => /^customMetricName\d+$/i.test(k));
    nameKeys.sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
      const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
      return numA - numB;
    });

    for (const nKey of nameKeys) {
      const numStr = nKey.replace(/\D/g, '');
      const valKey = Object.keys(rawKeyMetrics).find(k => new RegExp(`^customMetricValue${numStr}$`, 'i').test(k));
      const name = rawKeyMetrics[nKey];
      const value = valKey ? rawKeyMetrics[valKey] : undefined;
      if (name !== undefined && value !== undefined && value !== null) {
        customMetricsList.push({ name: String(name), value });
        processedMetricKeys.add(nKey);
        if (valKey) processedMetricKeys.add(valKey);
      }
    }

    // 2. Extract any other non-indexed custom metrics
    for (const [k, v] of Object.entries(rawKeyMetrics)) {
      if (!processedMetricKeys.has(k) && !/^customMetricValue\d+$/i.test(k) && v !== undefined && v !== null) {
        customMetricsList.push({ name: k, value: v as any });
      }
    }

    analyticsData.extractedMetrics.customMetricsList = customMetricsList;

    // ── Step 3: Update Document record with analytics & complete status ──
    await DocumentModel.findByIdAndUpdate(documentId, {
      status: 'completed',
      analytics: analyticsData,
    });

    // ── Step 4: Recalculate and update Folder aggregated analytics ──
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
      }
    });

    if (onProgress) onProgress(100);
    console.log(`[DocumentTask] Document ${documentId} processed successfully.`);
    return { success: true, documentId };
  } catch (error: any) {
    console.error(`[DocumentTask] Processing failed for doc ${documentId}:`, error.message);
    await DocumentModel.findByIdAndUpdate(documentId, { status: 'failed' });
    throw error;
  }
}

export const documentWorker = new Worker('document-processing-queue', async job => {
  return await processDocumentTask(job.data, (p: number) => job.updateProgress(p));
}, { 
  connection,
  lockDuration: 300000,
  stalledInterval: 300000
});

documentWorker.on('completed', job => {
  console.log(`[DocumentWorker] Job ${job.id} completed!`);
});

documentWorker.on('failed', (job, err) => {
  console.error(`[DocumentWorker] Job ${job?.id} failed: ${err.message}`);
});

documentWorker.on('error', (err) => {
  // Gracefully handle BullMQ redis connection notice without crashing Node
});
