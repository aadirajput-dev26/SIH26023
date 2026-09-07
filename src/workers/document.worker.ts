import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';
import DocumentModel from '../models/Document';
import FolderModel from '../models/Folder';
import { processImage, processPDF, callGtwyChatAgent, extractAllJsonObjects, extractGtwyContent } from '../services/gtwy.service';
import { createUrlResource, createContentResource } from '../services/hippocampus.service';
import { ensurePdfFormat } from '../services/converter.service';

dotenv.config();

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const documentWorker = new Worker('document-processing-queue', async job => {
  const { documentId, folderId, filePath, sourceUrl, fileType, originalName, description, gtwyResourceId } = job.data;
  console.log(`[DocumentWorker] Processing job ${job.id} for document ${documentId}`);

  try {
    await DocumentModel.findByIdAndUpdate(documentId, { status: 'processing' });

    let resourceId = gtwyResourceId;

    // ── Step 1: Read/extract text locally ──
    let extractedText = '';
    if (filePath) {
      if (fileType === 'text/plain' || fileType === 'text/markdown' || filePath.endsWith('.txt') || filePath.endsWith('.md')) {
        try {
          const fs = await import('fs');
          extractedText = await fs.promises.readFile(filePath, 'utf-8');
        } catch (e) {}
      } else if (filePath.endsWith('.docx') || fileType?.includes('word')) {
        try {
          const mammoth = await import('mammoth');
          const result = await mammoth.extractRawText({ path: filePath });
          extractedText = result.value || '';
        } catch (mErr: any) {
          console.warn('[DocumentWorker] Mammoth docx extraction fallback:', mErr.message);
        }
      } else if (filePath.endsWith('.xlsx') || filePath.endsWith('.xls') || fileType?.includes('sheet') || fileType?.includes('excel')) {
        try {
          const XLSX = await import('xlsx');
          const workbook = XLSX.readFile(filePath);
          const sheetNames = workbook.SheetNames;
          const rows: string[] = [];
          for (const sheetName of sheetNames) {
            const sheet = workbook.Sheets[sheetName];
            const csv = XLSX.utils.sheet_to_csv(sheet);
            rows.push(`--- Sheet: ${sheetName} ---\n${csv}`);
          }
          extractedText = rows.join('\n\n');
        } catch (xErr: any) {
          console.warn('[DocumentWorker] XLSX extraction fallback:', xErr.message);
        }
      }

      // If still empty, read raw text or metadata
      if (!extractedText) {
        try {
          const fs = await import('fs');
          extractedText = await fs.promises.readFile(filePath, 'utf-8');
        } catch (readErr: any) {
          extractedText = `Document: ${originalName}\nType: ${fileType}\nDescription: ${description || 'N/A'}`;
        }
      }
    } else if (sourceUrl) {
      extractedText = `Source URL: ${sourceUrl}\nDocument: ${originalName}\nDescription: ${description || 'N/A'}`;
    }

    // ── Step 2: SINGLE API CALL to GTWY Document Processing Agent ──
    console.log(`[DocumentWorker] Executing GTWY agent extraction call for job ${job.id}...`);
    const agentId = process.env.GTWY_DOCUMENT_PROCESSING_AGENT_ID || process.env.GTWY_DOC_AGENT_ID || '6a9e8ea6125b5dfba67d66e6';
    const threadId = `folder_${folderId}_doc_${documentId}`;
    
    const folder = await FolderModel.findById(folderId);
    const variables = {
      folderName: folder?.name || '',
      folderDescription: folder?.description || '',
      documentText: extractedText ? extractedText.substring(0, 35000) : (description || originalName || ''),
      fileName: originalName || 'uploaded_document',
      fileType: fileType || 'application/pdf',
      folderAnalytics: JSON.stringify(folder?.analyticsMetrics || { totalDocuments: 1, lastProcessed: new Date().toISOString() })
    };

    const gtwyResult = await callGtwyChatAgent(
      agentId,
      threadId,
      "Extract the analytics",
      variables
    );

    // Robust extraction of stringified JSON content returned by GTWY agent
    const rawContent = extractGtwyContent(gtwyResult);
    const cleanJson = rawContent.replace(/```json/gi, '').replace(/```/g, '').trim();
    
    let analyticsData: any = null;
    try {
      analyticsData = JSON.parse(cleanJson);
    } catch {
      // If direct parse fails (e.g. gateway error prepended), extract all JSON objects
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

    // 2. Extract any other non-indexed custom metrics (e.g. 'Daily Dispatch': '45,000 Tonnes')
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

    console.log(`[DocumentWorker] Job ${job.id} completed successfully for document ${documentId}.`);
    return { success: true, documentId };
  } catch (error: any) {
    console.error(`[DocumentWorker] Job ${job.id} failed:`, error.message);
    await DocumentModel.findByIdAndUpdate(documentId, { status: 'failed' });
    throw error;
  }
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
