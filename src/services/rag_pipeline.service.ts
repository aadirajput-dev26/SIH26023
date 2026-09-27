/**
 * rag_pipeline.service.ts
 *
 * Adapter layer between the Express backend and the FastAPI RAG Pipeline
 * deployed at RAG_HOST_URL. All calls are authenticated via RAG_API_KEY
 * in the X-Api-Key header.
 *
 * The RAG pipeline requires tenant context (org_id, workspace_id) per request.
 * Since the Express backend doesn't have a multi-tenant model yet, we use
 * fixed UUIDs that are also hardcoded in the RAG pipeline's test fixtures.
 */

import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const RAG_URL = `${process.env.RAG_HOST_URL || 'http://localhost:8000'}/api/v1`;
const API_KEY = process.env.RAG_API_KEY || '';

// Fixed tenant UUIDs - the RAG pipeline uses these for scoping/indexing.
// Must be valid UUIDs (RFC 4122).
export const ORG_ID = '00000000-0000-0000-0000-000000000001';
export const WORKSPACE_ID = '00000000-0000-0000-0000-000000000002';
export const USER_ID = '00000000-0000-0000-0000-000000000003';

const client = axios.create({
  baseURL: RAG_URL,
  headers: { 'X-Api-Key': API_KEY },
  timeout: 120000, // 2 min for large file uploads
});

// ─── Document Ingestion ────────────────────────────────────────────────────────

/**
 * Upload a file to the RAG pipeline for chunking + embedding.
 * Returns { document_id, document_version_id, job_id, status }.
 */
export const ingestDocument = async (
  filePath: string,
  filename: string,
  mimeType: string,
  ragDocumentId?: string,
) => {
  const formData = new FormData();
  formData.append('file', fs.createReadStream(filePath));
  formData.append('org_id', ORG_ID);
  formData.append('workspace_id', WORKSPACE_ID);
  formData.append('uploaded_by_user_id', USER_ID);
  formData.append('filename', filename);
  formData.append('declared_mime_type', mimeType);
  if (ragDocumentId) formData.append('document_id', ragDocumentId);

  const response = await client.post('/documents/ingest', formData, {
    headers: formData.getHeaders(),
    timeout: 180000, // 3 min for large docs
  });
  return response.data as { document_id: string; document_version_id: string; job_id: string; status: string };
};

/**
 * Ingest a public URL. RAG pipeline will fetch + parse + embed it.
 * Returns { document_id, document_version_id, job_id, status }.
 */
export const ingestUrl = async (url: string, ragDocumentId?: string) => {
  const response = await client.post('/documents/ingest-url', {
    url,
    org_id: ORG_ID,
    workspace_id: WORKSPACE_ID,
    uploaded_by_user_id: USER_ID,
    document_id: ragDocumentId,
  });
  return response.data as { document_id: string; document_version_id: string; job_id: string; status: string };
};

// ─── Status Polling ────────────────────────────────────────────────────────────

/**
 * Poll /documents/{id}/status until COMPLETED, FAILED, or timeout.
 * Returns the final status response.
 */
export const checkDocumentStatus = async (ragDocId: string) => {
  const response = await client.get(`/documents/${ragDocId}/status`);
  return response.data as { overall_status: string; stage_details: any[] };
};

/**
 * Poll with exponential-back-off up to maxWaitMs (default 5 min).
 * Returns ragDocId when completed, throws on failure/timeout.
 */
export const waitForProcessing = async (
  ragDocId: string,
  maxWaitMs = 300_000,
  intervalMs = 5_000,
): Promise<string> => {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const { overall_status } = await checkDocumentStatus(ragDocId);
    if (overall_status === 'COMPLETED') return ragDocId;
    if (overall_status === 'FAILED') throw new Error(`RAG Pipeline processing FAILED for doc ${ragDocId}`);
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`RAG Pipeline processing TIMEOUT for doc ${ragDocId} after ${maxWaitMs / 1000}s`);
};

// ─── RAG Query ────────────────────────────────────────────────────────────────

/**
 * Run a RAG query scoped to specific document IDs (or workspace-wide if empty).
 * Returns { answer, route_used, citations, confidence, ... }
 */
export const queryPipeline = async (
  queryText: string,
  ragDocumentIds?: string[],
): Promise<{ answer: string; route_used: string; citations: any[]; no_evidence: boolean; confidence: number }> => {
  const response = await client.post('/query', {
    query_text: queryText,
    scope: {
      org_id: ORG_ID,
      workspace_id: WORKSPACE_ID,
      document_ids: ragDocumentIds && ragDocumentIds.length > 0 ? ragDocumentIds : undefined,
    },
  });
  return response.data;
};

/**
 * Pure retrieval without LLM generation (faster, returns ranked chunks).
 */
export const searchPipeline = async (
  queryText: string,
  ragDocumentIds?: string[],
  topK = 10,
) => {
  const response = await client.post('/search', {
    query_text: queryText,
    scope: {
      org_id: ORG_ID,
      workspace_id: WORKSPACE_ID,
      document_ids: ragDocumentIds && ragDocumentIds.length > 0 ? ragDocumentIds : undefined,
    },
    top_k: topK,
  });
  return response.data;
};
