import { Worker } from 'bullmq';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import * as xlsx from 'xlsx';
import DocumentModel from '../models/Document';
import FolderModel from '../models/Folder';
import { createRedisConnection } from '../config/redis';
import { callGtwyChatAgent, extractAllJsonObjects, extractGtwyContent } from '../services/gtwy.service';
import { ingestDocument } from '../services/rag_pipeline.service';

dotenv.config();

const connection = createRedisConnection('doc-worker');

/**
 * Self-contained document processing task executed by BullMQ or in-process.
 * Calls GTWY Document Processing Agent for AI analytics extraction.
 */
export async function processDocumentTask(data: any, onProgress?: (progress: number) => void) {
  const { documentId, ragDocumentId, folderId, filePath, sourceUrl, fileType, originalName, description } = data;
  console.log(`[DocumentTask] Processing document ${documentId} (${originalName}) via GTWY`);
  if (onProgress) onProgress(15);

  try {
    await DocumentModel.findByIdAndUpdate(documentId, { status: 'processing' });

    // ── Step 1: Extract Document Text locally ──
    let extractedText = '';
    if (filePath && fs.existsSync(filePath)) {
      const ext = (path.extname(originalName || '') || path.extname(filePath || '')).toLowerCase();
      if (ext === '.txt' || ext === '.md' || ext === '.csv' || ext === '.json') {
        try {
          extractedText = fs.readFileSync(filePath, 'utf-8');
        } catch (e: any) {
          console.warn('[DocumentTask] Text read notice:', e.message);
        }
      } else if (ext === '.docx' || ext === '.doc') {
        try {
          const result = await mammoth.extractRawText({ path: filePath });
          extractedText = result.value || '';
        } catch (mErr: any) {
          console.warn('[DocumentTask] Mammoth docx extraction notice:', mErr.message);
        }
      } else if (ext === '.xlsx' || ext === '.xls') {
        try {
          const workbook = xlsx.readFile(filePath);
          const sheetNames = workbook.SheetNames;
          const rows: string[] = [];
          for (const sheetName of sheetNames) {
            const sheet = workbook.Sheets[sheetName];
            const csv = xlsx.utils.sheet_to_csv(sheet);
            if (csv) rows.push(`--- Sheet: ${sheetName} ---\n${csv}`);
          }
          extractedText = rows.join('\n\n');
        } catch (xErr: any) {
          console.warn('[DocumentTask] XLSX extraction notice:', xErr.message);
        }
      } else if (['.png', '.jpg', '.jpeg', '.webp', '.tiff', '.bmp'].includes(ext)) {
        extractedText = `Image Asset: ${originalName}\nFile Type: ${fileType || ext}\nDescription: ${description || 'Geological map, site photograph or operational diagram'}`;
      } else {
        // Fallback for PDFs or other formats
        try {
          const raw = fs.readFileSync(filePath, 'utf-8');
          if (raw.slice(0, 100).includes('\u0000')) {
            extractedText = `Document: ${originalName}\nType: ${fileType || ext}\nDescription: ${description || 'Operational document'}`;
          } else {
            extractedText = raw;
          }
        } catch {
          extractedText = `File: ${originalName}\nDescription: ${description || 'N/A'}`;
        }
      }
    } else if (sourceUrl) {
      try {
        const urlRes = await fetch(sourceUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(6000)
        });
        if (urlRes.ok) {
          const html = await urlRes.text();
          const plainText = html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          extractedText = `Source URL: ${sourceUrl}\nTitle: ${originalName}\n\nWeb Page Content:\n${plainText.substring(0, 30000)}`;
        } else {
          extractedText = `Source URL: ${sourceUrl}\nDocument: ${originalName}\nDescription: ${description || 'N/A'}`;
        }
      } catch {
        extractedText = `Source URL: ${sourceUrl}\nDocument: ${originalName}\nDescription: ${description || 'N/A'}`;
      }
    }

    if (onProgress) onProgress(40);

    // ── Step 2: Call GTWY Document Processing Agent ──
    const agentId = process.env.GTWY_DOCUMENT_PROCESSING_AGENT_ID || '6a9e8ea6125b5dfba67d66e6';
    const threadId = `folder_${folderId}_doc_${documentId}`;
    const folder = await FolderModel.findById(folderId);

    const docTextPayload = extractedText ? extractedText.substring(0, 35000) : (description || originalName || '');
    const variables = {
      folderName: folder?.name || '',
      folderDescription: folder?.description || '',
      documentText: docTextPayload,
      pre_function: docTextPayload,
      fileName: originalName || 'uploaded_document',
      fileType: fileType || 'application/pdf',
      folderAnalytics: JSON.stringify(folder?.analyticsMetrics || { totalDocuments: 1, lastProcessed: new Date().toISOString() })
    };

    console.log(`[DocumentTask] Calling GTWY Document Processing Agent (${agentId})...`);
    let gtwyResult = '';
    try {
      gtwyResult = await callGtwyChatAgent(
        agentId,
        threadId,
        "Extract the analytics",
        variables
      );
    } catch (agentErr: any) {
      console.warn(`[DocumentTask] GTWY Agent call notice:`, agentErr.message);
    }

    if (onProgress) onProgress(75);

    // ── Step 3: Parse and Normalize Analytics JSON ──
    const rawContent = extractGtwyContent(gtwyResult);
    const cleanJson = rawContent.replace(/```json/gi, '').replace(/```/g, '').trim();

    let analyticsData: any = null;
    try {
      analyticsData = JSON.parse(cleanJson);
    } catch {
      const objects = extractAllJsonObjects(rawContent);
      analyticsData = objects.find(obj => obj && (obj.topic || obj.wordCloudKeywords || obj.extractedMetrics || obj.summary)) || null;
    }

    if (!analyticsData || typeof analyticsData !== 'object') {
      analyticsData = {
        topic: originalName || 'Document',
        summary: description || '',
        wordCloudKeywords: ['Coal', 'Mining', 'Operations'],
        extractedMetrics: {}
      };
    }
    if (!analyticsData.extractedMetrics) analyticsData.extractedMetrics = {};

    // Dynamic Custom Metrics Normalization
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
      const valKey = Object.keys(rawKeyMetrics).find(k => new RegExp(`^customMetricValue${numStr}$`, 'i').test(k));
      const name = rawKeyMetrics[nKey];
      const value = valKey ? rawKeyMetrics[valKey] : undefined;
      if (name !== undefined && value !== undefined && value !== null) {
        customMetricsList.push({ name: String(name), value });
        processedMetricKeys.add(nKey);
        if (valKey) processedMetricKeys.add(valKey);
      }
    }

    const topMetrics = analyticsData.extractedMetrics;
    const topNameKeys = Object.keys(topMetrics).filter(k => /^customMetricName\d+$/i.test(k));
    topNameKeys.sort((a, b) => parseInt(a.replace(/\D/g, '')) - parseInt(b.replace(/\D/g, '')));
    for (const nKey of topNameKeys) {
      const numStr = nKey.replace(/\D/g, '');
      const valKey = Object.keys(topMetrics).find(k => new RegExp(`^customMetricValue${numStr}$`, 'i').test(k));
      const name = topMetrics[nKey];
      const value = valKey ? topMetrics[valKey] : undefined;
      if (name !== undefined && value !== undefined && value !== null) {
        customMetricsList.push({ name: String(name), value });
      }
    }

    for (const [k, v] of Object.entries(rawKeyMetrics)) {
      if (!processedMetricKeys.has(k) && !/^customMetricValue\d+$/i.test(k) && v !== undefined && v !== null) {
        customMetricsList.push({ name: k, value: v as any });
      }
    }

    analyticsData.extractedMetrics.customMetricsList = customMetricsList;

    // ── Step 4: Save document analytics ──
    await DocumentModel.findByIdAndUpdate(documentId, {
      status: 'completed',
      analytics: analyticsData,
    });

    // ── Step 5: Recalculate folder aggregated analytics ──
    const allFolderDocs = await DocumentModel.find({ folderId, status: 'completed' }).sort({ createdAt: -1 });

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
        'analyticsMetrics.latestDocumentId': documentId,
        'analyticsMetrics.latestDocumentTitle': originalName || 'Document',
        'analyticsMetrics.latestDocumentAnalytics': analyticsData,
        'analyticsMetrics.totalCoalProductionMT': totalCoal.toFixed(2),
        'analyticsMetrics.totalOverburdenCuM': totalOBR > 0 ? totalOBR.toFixed(2) : null,
        'analyticsMetrics.strippingRatio': strippingRatio,
        'analyticsMetrics.subsidiaries': Array.from(subsidiaries),
        'analyticsMetrics.keywords': Array.from(allKeywords),
        'analyticsMetrics.customMetricsList': allAggregatedCustomMetrics,
        'analyticsMetrics.documentsData': docsDataSummary,
      },
    });

    // Fire-and-forget RAG ingestion in background so vectors are indexed without blocking GTWY analytics
    if (filePath && fs.existsSync(filePath)) {
      ingestDocument(filePath, originalName || 'document', fileType || 'application/octet-stream', folder?.ragCollectionId, ragDocumentId)
        .catch(ragErr => console.warn('[DocumentTask] Background RAG indexing notice:', ragErr.message));
    }

    if (onProgress) onProgress(100);
    console.log(`[DocumentTask] Document ${documentId} processed successfully via GTWY.`);
    return { success: true, documentId, ragDocumentId };
  } catch (error: any) {
    console.error(`[DocumentTask] Processing failed for doc ${documentId}:`, error.message);
    await DocumentModel.findByIdAndUpdate(documentId, {
      status: 'failed',
      analytics: { error: error.message }
    });
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
