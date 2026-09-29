/**
 * rag_pipeline.service.ts
 *
 * Adapter layer between the Express backend and the FastAPI RAG Pipeline
 * deployed at RAG_HOST_URL (e.g. https://engram-kwyr.onrender.com).
 * All requests are authenticated via RAG_API_KEY in the X-Api-Key header.
 *
 * Scoping:
 * - Tenant context (org_id, workspace_id, user_id) is automatically resolved by
 *   the microservice from the API key.
 * - Folders map to Collections in the microservice (POST /collections, etc.).
 * - Document ingestion links files/URLs to collections via folder_id.
 * - Query and Search requests scope retrieval to collection_id and/or document_ids.
 */

import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const BASE_HOST = process.env.RAG_HOST_URL || 'https://engram-kwyr.onrender.com';
const RAG_URL = `${BASE_HOST.replace(/\/$/, '')}/api/v1`;
const API_KEY = process.env.RAG_API_KEY || '';

// Fallback tenant UUIDs for backwards compatibility if needed
export const ORG_ID = '00000000-0000-0000-0000-000000000001';
export const WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
export const USER_ID = '00000000-0000-0000-0000-000000000001';

const client = axios.create({
  baseURL: RAG_URL,
  headers: {
    'X-Api-Key': API_KEY,
  },
  timeout: 180000, // 3 min timeout for larger embeddings/LLM calls
});

// Interceptor for logging cURL and response debugging
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      console.error(`[RAG Service HTTP Error] Status ${error.response.status} from ${error.config?.url}`);
      console.error(
        `[RAG Service Error Body]:`,
        typeof error.response.data === 'object' ? JSON.stringify(error.response.data) : error.response.data,
      );
    } else {
      console.error(`[RAG Service Network/Timeout Error]: ${error.message}`);
    }
    return Promise.reject(error);
  },
);

// ─── MIME Type & Extension Resolver ──────────────────────────────────────────

/**
 * Resolves appropriate MIME types corresponding to RAG Pipeline parser factory.
 * Supported types in parser_factory.py:
 * - PDF: application/pdf
 * - DOCX / DOC: application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/msword
 * - XLSX / XLS: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel
 * - CSV: text/csv, application/csv
 * - Images: image/png, image/jpeg, image/webp, image/tiff, image/bmp, image/gif
 * - HTML: text/html, application/xhtml+xml
 * - Text: text/plain, text/markdown, text/x-rst
 */
export function resolveMimeType(filename: string, declaredMime?: string): string {
  if (declaredMime && declaredMime !== 'application/octet-stream') {
    return declaredMime;
  }
  const ext = path.extname(filename).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.csv': 'text/csv',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.rst': 'text/x-rst',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
    '.bmp': 'image/bmp',
    '.gif': 'image/gif',
    '.html': 'text/html',
    '.htm': 'text/html',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

// ─── Collections API ─────────────────────────────────────────────────────────

export interface CollectionResponse {
  id: string;
  name: string;
  description?: string | null;
  org_id: string;
  workspace_id: string;
  created_at: string;
  updated_at: string;
}

/**
 * Create a new collection in the microservice for a folder.
 * POST /api/v1/collections
 */
export const createCollection = async (payload: {
  name: string;
  description?: string;
}): Promise<CollectionResponse> => {
  console.log(`[RAG Service] Creating collection: "${payload.name}"`);
  const response = await client.post('/collections', {
    name: payload.name,
    description: payload.description || null,
  });
  return response.data as CollectionResponse;
};

/**
 * List all collections in caller's workspace.
 * GET /api/v1/collections
 */
export const listCollections = async (): Promise<CollectionResponse[]> => {
  const response = await client.get('/collections');
  return response.data as CollectionResponse[];
};

/**
 * Get details of a specific collection.
 * GET /api/v1/collections/{collection_id}
 */
export const getCollection = async (collectionId: string): Promise<CollectionResponse> => {
  const response = await client.get(`/collections/${collectionId}`);
  return response.data as CollectionResponse;
};

/**
 * Update collection name / description.
 * PUT /api/v1/collections/{collection_id}
 */
export const updateCollection = async (
  collectionId: string,
  payload: { name?: string; description?: string },
): Promise<CollectionResponse> => {
  const response = await client.put(`/collections/${collectionId}`, payload);
  return response.data as CollectionResponse;
};

/**
 * Delete a collection from caller's workspace.
 * DELETE /api/v1/collections/{collection_id}
 */
export const deleteCollection = async (collectionId: string): Promise<void> => {
  console.log(`[RAG Service] Deleting collection ${collectionId}`);
  await client.delete(`/collections/${collectionId}`);
};

// ─── Document Ingestion ────────────────────────────────────────────────────────

export interface IngestResponse {
  document_id: string;
  document_version_id: string;
  job_id: string;
  status: 'QUEUED' | 'ALREADY_PROCESSED';
}

/**
 * Upload a local file to the RAG pipeline.
 * Microservice Endpoint: POST /api/v1/documents/ingest (multipart/form-data)
 */
export const ingestDocument = async (
  filePath: string,
  filename: string,
  mimeType?: string,
  folderId?: string, // collection id in microservice
  ragDocumentId?: string,
  contentHash?: string,
): Promise<IngestResponse> => {
  const resolvedMime = resolveMimeType(filename, mimeType);
  const formData = new FormData();
  formData.append('file', fs.createReadStream(filePath));
  formData.append('filename', filename);
  formData.append('declared_mime_type', resolvedMime);
  if (folderId) formData.append('folder_id', folderId);
  if (ragDocumentId) formData.append('document_id', ragDocumentId);
  if (contentHash) formData.append('content_hash', contentHash);

  console.log(`[RAG Service] Ingesting file "${filename}" (MIME: ${resolvedMime}, Collection: ${folderId || 'none'})`);

  const response = await client.post('/documents/ingest', formData, {
    headers: formData.getHeaders(),
    timeout: 180000,
  });
  return response.data as IngestResponse;
};

/**
 * Ingest a public document URL into the unified ingestion endpoint.
 * Microservice Endpoint: POST /api/v1/documents/ingest (multipart/form-data)
 */
export const ingestUrl = async (
  url: string,
  filename?: string,
  folderId?: string,
  ragDocumentId?: string,
): Promise<IngestResponse> => {
  const formData = new FormData();
  formData.append('url', url.trim());
  if (filename) formData.append('filename', filename.trim());
  if (folderId) formData.append('folder_id', folderId);
  if (ragDocumentId) formData.append('document_id', ragDocumentId);

  console.log(`[RAG Service] Ingesting URL "${url}" (Collection: ${folderId || 'none'})`);

  const response = await client.post('/documents/ingest', formData, {
    headers: formData.getHeaders(),
    timeout: 180000,
  });
  return response.data as IngestResponse;
};

// ─── Status Polling ────────────────────────────────────────────────────────────

export interface ProcessingStageDetail {
  stage: string;
  progress_current?: number | null;
  progress_total?: number | null;
  error_message?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface ProcessingStatusResponse {
  document_id: string;
  document_version_id: string;
  job_id: string;
  overall_status: string; // "QUEUED" | "PROCESSING" | "READY" | "COMPLETED" | "FAILED"
  stage_details: ProcessingStageDetail[];
  updated_at: string;
}

/**
 * Poll /documents/{id}/status for document processing progress.
 */
export const checkDocumentStatus = async (ragDocId: string): Promise<ProcessingStatusResponse> => {
  const response = await client.get(`/documents/${ragDocId}/status`);
  return response.data as ProcessingStatusResponse;
};

/**
 * Poll with back-off until overall_status is READY or COMPLETED.
 * Returns ragDocId when completed, throws on FAILED or timeout.
 */
export const waitForProcessing = async (
  ragDocId: string,
  maxWaitMs = 300_000,
  intervalMs = 4_000,
): Promise<string> => {
  const deadline = Date.now() + maxWaitMs;
  let attempts = 0;

  while (Date.now() < deadline) {
    attempts++;
    try {
      const statusData = await checkDocumentStatus(ragDocId);
      const overall = (statusData.overall_status || '').toUpperCase();

      if (overall === 'READY' || overall === 'COMPLETED') {
        console.log(`[RAG Service] Doc ${ragDocId} processed successfully (${overall}).`);
        return ragDocId;
      }
      if (overall === 'FAILED') {
        throw new Error(`RAG Pipeline processing FAILED for doc ${ragDocId}`);
      }

      console.log(`[RAG Service] Doc ${ragDocId} status: ${overall} (poll #${attempts})`);
    } catch (err: any) {
      if (err.message?.includes('FAILED')) throw err;
      // Network hiccup or 404 during immediate queue ingestion, retry
      console.warn(`[RAG Service] Status poll warning for ${ragDocId}:`, err.message);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`RAG Pipeline processing TIMEOUT for doc ${ragDocId} after ${maxWaitMs / 1000}s`);
};

// ─── Query & Generation ───────────────────────────────────────────────────────

export interface CitationItem {
  citation_id: string;
  source_type: 'chunk' | 'fact';
  document_id: string;
  document_name: string;
  page_number?: number | null;
  section_path?: string | null;
  chunk_id?: string | null;
  fact_id?: string | null;
}

export interface ExtractedFactSummary {
  fact_id: string;
  metric: string;
  value: number;
  unit: string;
  mine_name?: string | null;
  period_value: string;
  page_number: number;
}

export interface QueryResponse {
  answer: string;
  route_used: 'structured' | 'rag' | 'hybrid';
  no_evidence: boolean;
  citations: CitationItem[];
  structured_evidence: ExtractedFactSummary[];
  confidence: number;
  latency_ms: number;
}

export interface QueryOptions {
  collectionId?: string;
  documentIds?: string[];
  routeOverride?: 'structured' | 'rag' | 'hybrid';
  topK?: number;
  conversationId?: string;
}

/**
 * AI-powered query with full RAG pipeline (POST /api/v1/query).
 * Supports both options object or legacy document IDs array.
 */
export const queryPipeline = async (
  queryText: string,
  optionsOrDocIds?: string[] | QueryOptions,
  collectionIdFallback?: string,
): Promise<QueryResponse> => {
  let opts: QueryOptions = {};

  if (Array.isArray(optionsOrDocIds)) {
    opts = {
      documentIds: optionsOrDocIds,
      collectionId: collectionIdFallback,
    };
  } else if (optionsOrDocIds && typeof optionsOrDocIds === 'object') {
    opts = optionsOrDocIds;
  }

  const body: Record<string, any> = {
    query_text: queryText,
  };

  if (opts.collectionId) {
    body.collection_id = opts.collectionId;
  }
  if (opts.documentIds && opts.documentIds.length > 0) {
    body.document_ids = opts.documentIds;
  }
  if (opts.routeOverride) {
    body.route_override = opts.routeOverride;
  }
  if (typeof opts.topK === 'number') {
    body.top_k = opts.topK;
  }
  if (opts.conversationId) {
    body.conversation_id = opts.conversationId;
  }

  // Also include scope block for completeness as per ScopeFilter schema
  if (opts.collectionId || (opts.documentIds && opts.documentIds.length > 0)) {
    body.scope = {
      collection_id: opts.collectionId || undefined,
      document_ids: opts.documentIds && opts.documentIds.length > 0 ? opts.documentIds : undefined,
    };
  }

  console.log(`[RAG Service] Executing Query (collection: ${opts.collectionId || 'all'}, docs: ${opts.documentIds?.length || 0})`);
  const response = await client.post('/query', body);
  return response.data as QueryResponse;
};

// ─── Semantic Search (Retrieval Only) ─────────────────────────────────────────

export interface RetrievalResult {
  chunk_id: string;
  document_id: string;
  document_name: string;
  page_start: number;
  page_end: number;
  section_path?: string | null;
  snippet: string;
  semantic_score?: number | null;
  keyword_score?: number | null;
  fused_score?: number | null;
  rerank_score?: number | null;
}

export interface SearchResponse {
  results: RetrievalResult[];
  total: number;
  latency_ms: number;
}

export interface SearchOptions {
  collectionId?: string;
  documentIds?: string[];
  topK?: number;
  filters?: Record<string, any>;
}

/**
 * Pure retrieval search returning ranked chunks without LLM generation (POST /api/v1/search).
 */
export const searchPipeline = async (
  queryText: string,
  optionsOrDocIds?: string[] | SearchOptions,
  topKFallback = 10,
): Promise<SearchResponse> => {
  let opts: SearchOptions = {};

  if (Array.isArray(optionsOrDocIds)) {
    opts = {
      documentIds: optionsOrDocIds,
      topK: topKFallback,
    };
  } else if (optionsOrDocIds && typeof optionsOrDocIds === 'object') {
    opts = optionsOrDocIds;
  }

  const body: Record<string, any> = {
    query_text: queryText,
    top_k: opts.topK || 10,
  };

  if (opts.collectionId) {
    body.collection_id = opts.collectionId;
  }
  if (opts.documentIds && opts.documentIds.length > 0) {
    body.document_ids = opts.documentIds;
  }
  if (opts.filters) {
    body.filters = opts.filters;
  }

  if (opts.collectionId || (opts.documentIds && opts.documentIds.length > 0)) {
    body.scope = {
      collection_id: opts.collectionId || undefined,
      document_ids: opts.documentIds && opts.documentIds.length > 0 ? opts.documentIds : undefined,
    };
  }

  console.log(`[RAG Service] Executing Search (query: "${queryText}", collection: ${opts.collectionId || 'all'})`);
  const response = await client.post('/search', body);
  return response.data as SearchResponse;
};

// ─── Document Chunks & Listing ────────────────────────────────────────────────

export interface DocumentChunkItem {
  chunk_id: string;
  document_id: string;
  document_version_id: string;
  page_start: number;
  page_end: number;
  section_path?: string | null;
  chunk_type: string;
  text: string;
  char_offset_start?: number;
  char_offset_end?: number;
  embedding_model?: string | null;
  created_at?: string | null;
}

export interface DocumentChunksResponse {
  document_id: string;
  chunks: DocumentChunkItem[];
  total: number;
  skip: number;
  limit: number;
}

/**
 * Retrieve all indexed chunks for a specific document with pagination.
 * GET /api/v1/documents/{document_id}/chunks
 */
export const getDocumentChunks = async (
  ragDocId: string,
  skip = 0,
  limit = 50,
): Promise<DocumentChunksResponse> => {
  const response = await client.get(`/documents/${ragDocId}/chunks`, {
    params: { skip, limit },
  });
  return response.data as DocumentChunksResponse;
};

/**
 * List all documents in microservice workspace with pagination and status.
 * GET /api/v1/documents
 */
export const listMicroserviceDocuments = async (options?: {
  skip?: number;
  limit?: number;
  folderId?: string;
}): Promise<{ documents: any[]; total: number; skip: number; limit: number }> => {
  const response = await client.get('/documents', {
    params: {
      skip: options?.skip || 0,
      limit: options?.limit || 20,
      folder_id: options?.folderId,
    },
  });
  return response.data;
};
