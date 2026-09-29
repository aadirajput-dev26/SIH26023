import { Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import FolderModel, { IFolder } from '../models/Folder';
import DocumentModel from '../models/Document';
import { dispatchDocumentJob } from '../queues';
import { streamGtwyChatAgent, getChatHistory } from '../services/gtwy.service';
import {
  queryPipeline,
  searchPipeline,
  createCollection,
  deleteCollection,
} from '../services/rag_pipeline.service';

// ─── Helper: Lazy provision Collection in Microservice ────────────────────────

export const ensureFolderCollection = async (folder: any): Promise<string | undefined> => {
  if (folder.ragCollectionId) return folder.ragCollectionId;
  try {
    const col = await createCollection({
      name: folder.name,
      description: folder.description || undefined,
    });
    folder.ragCollectionId = col.id;
    await folder.save();
    console.log(`[FolderController] Provisioned collection ${col.id} for folder "${folder.name}"`);
    return col.id;
  } catch (err: any) {
    console.warn(`[FolderController] Warning: Could not provision RAG collection for folder "${folder.name}":`, err.message);
    return undefined;
  }
};

// ─── Folder CRUD ──────────────────────────────────────────────────────────────

export const createFolder = async (req: Request, res: Response) => {
  console.log('>>> createFolder called with body:', req.body);
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Folder name is required' });

    // Provision collection in Engram RAG microservice for this folder
    let ragCollectionId: string | undefined;
    try {
      const col = await createCollection({ name, description });
      ragCollectionId = col.id;
      console.log(`[FolderController] Collection created in RAG microservice: ${ragCollectionId}`);
    } catch (colErr: any) {
      console.warn(`[FolderController] Collection creation notice (will retry on upload): ${colErr.message}`);
    }

    const folder = new FolderModel({ name, description, ragCollectionId });
    await folder.save();

    res.status(201).json(folder);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getFolders = async (req: Request, res: Response) => {
  try {
    const folders = await FolderModel.find().lean().sort({ createdAt: -1 });
    const foldersWithDocs = await Promise.all(folders.map(async (folder) => {
      const documents = await DocumentModel.find({ folderId: folder._id }).lean();
      return { ...folder, documents };
    }));
    res.json(foldersWithDocs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getFolderById = async (req: Request, res: Response) => {
  try {
    const folder = await FolderModel.findById(req.params.id);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const documents = await DocumentModel.find({ folderId: folder._id }).sort({ createdAt: -1 });
    // Return folder + documents merged, convenient for the frontend
    res.json({ ...folder.toObject(), documents });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ─── Document Upload (File) ────────────────────────────────────────────────────

/**
 * POST /api/folders/:id/upload
 * Accepts a multipart form-data file. The BullMQ worker will then call
 * the GTWY RAG API (via the file's temporary path or a stored URL) asynchronously.
 */
export const uploadDocument = async (req: Request, res: Response) => {
  try {
    const folderId = req.params.id;
    const file = req.file;
    const { title, description } = req.body;

    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const folder = await FolderModel.findById(folderId);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    // Use pre-provisioned collection ID; if absent, the background worker will resolve/provision it asynchronously
    const ragCollectionId = folder.ragCollectionId;
    const ragDocumentId = crypto.randomUUID();

    const doc = new DocumentModel({
      folderId,
      originalName: file.originalname,
      title: title || file.originalname,
      description: description || undefined,
      mimetype: file.mimetype,
      size: file.size,
      status: 'pending',
      ragDocumentId,
    });
    await doc.save();

    // Dispatch for processing (BullMQ if Redis is live, otherwise resilient in-process)
    const job = await dispatchDocumentJob({
      documentId: doc._id.toString(),
      ragDocumentId,
      folderId,
      ragCollectionId,
      filePath: file.path,
      fileType: file.mimetype,
      originalName: doc.title || file.originalname,
      description: doc.description,
    });

    res.status(202).json({
      message: 'Document uploaded and queued for processing',
      documentId: doc._id,
      ragDocumentId,
      jobId: job.id,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ─── Document Upload (URL / Link) ─────────────────────────────────────────────

/**
 * POST /api/folders/:id/upload-url
 * Body: { url: string, title?: string, description?: string }
 * Ingests a public URL via the unified RAG pipeline ingest endpoint.
 */
export const uploadDocumentByUrl = async (req: Request, res: Response) => {
  try {
    const folderId = req.params.id;
    const { url, title, description } = req.body;

    if (!url) return res.status(400).json({ error: 'URL is required' });

    const folder = await FolderModel.findById(folderId);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const ragCollectionId = folder.ragCollectionId;
    const ragDocumentId = crypto.randomUUID();

    const doc = new DocumentModel({
      folderId,
      originalName: title || url,
      title: title || url,
      description: description || undefined,
      mimetype: 'text/html',
      size: 0,
      sourceUrl: url,
      status: 'pending',
      ragDocumentId,
    });
    await doc.save();

    const job = await dispatchDocumentJob({
      documentId: doc._id.toString(),
      ragDocumentId,
      folderId,
      ragCollectionId,
      sourceUrl: url,
      fileType: 'text/html',
      originalName: title || url,
      description,
    });

    res.status(202).json({
      message: 'URL document registered and queued for processing',
      documentId: doc._id,
      ragDocumentId,
      jobId: job.id,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ─── Document Upload (Raw Text Content) ───────────────────────────────────────

/**
 * POST /api/folders/:id/upload-content
 * Body: { title: string, content: string, description?: string }
 * Creates a text document entry and directly ingests into RAG pipeline as text/plain.
 */
export const uploadDocumentContent = async (req: Request, res: Response) => {
  try {
    const folderId = req.params.id;
    const { title, content, description } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required' });
    }

    const folder = await FolderModel.findById(folderId);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const ragCollectionId = folder.ragCollectionId;

    if (!fs.existsSync('uploads')) {
      fs.mkdirSync('uploads', { recursive: true });
    }

    const filename = `content_${Date.now()}.txt`;
    const filePath = path.join('uploads', filename);
    await fs.promises.writeFile(filePath, content, 'utf-8');

    const ragDocumentId = crypto.randomUUID();

    const doc = new DocumentModel({
      folderId,
      originalName: title,
      title,
      description: description || undefined,
      mimetype: 'text/plain',
      size: Buffer.byteLength(content),
      status: 'pending',
      ragDocumentId,
    });
    await doc.save();

    const job = await dispatchDocumentJob({
      documentId: doc._id.toString(),
      ragDocumentId,
      folderId,
      ragCollectionId,
      filePath,
      fileType: 'text/plain',
      originalName: title,
      description,
    });

    res.status(202).json({
      message: 'Text content document registered and queued for processing',
      documentId: doc._id,
      ragDocumentId,
      jobId: job.id,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ─── Delete Document ──────────────────────────────────────────────────────────

/**
 * DELETE /api/folders/:id/documents/:docId
 * Deletes the document from MongoDB.
 */
export const deleteDocument = async (req: Request, res: Response) => {
  try {
    const { docId } = req.params;

    const doc = await DocumentModel.findById(docId);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    await DocumentModel.findByIdAndDelete(docId);

    res.json({ message: 'Document deleted successfully', documentId: docId });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ─── Delete Folder ────────────────────────────────────────────────────────────

/**
 * DELETE /api/folders/:id
 * Deletes the collection from Engram RAG, all documents, and the folder from MongoDB.
 */
export const deleteFolder = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const folder = await FolderModel.findById(id);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    // Delete collection from Engram RAG microservice if exists
    if (folder.ragCollectionId) {
      try {
        await deleteCollection(folder.ragCollectionId);
        console.log(`[FolderController] Deleted RAG collection ${folder.ragCollectionId}`);
      } catch (err: any) {
        console.warn(`[FolderController] Could not delete RAG collection ${folder.ragCollectionId}:`, err.message);
      }
    }

    // Find and delete all documents
    await DocumentModel.deleteMany({ folderId: id });

    // Delete folder (including embedded reports)
    await FolderModel.findByIdAndDelete(id);

    res.json({ message: 'Folder deleted successfully', folderId: id });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ─── Chat Assistant ───────────────────────────────────────────────────────────

/**
 * POST /api/folders/:id/chats/:chatId
 * Sends a message to the RAG Pipeline scoped to the folder collection and its documents.
 */
export const postChatMessage = async (req: Request, res: Response) => {
  try {
    const { id, chatId } = req.params;
    const { message, stream } = req.body;

    if (!message) return res.status(400).json({ error: 'Message is required' });

    const folder = await FolderModel.findById(id);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const docs = await DocumentModel.find({ folderId: id });
    const documentsSummary = docs.map((doc) => ({
      name: doc.originalName,
      title: doc.title || doc.originalName,
      description: doc.description || doc.originalName,
      mimetype: doc.mimetype,
      status: doc.status,
      topic: doc.analytics?.topic,
      summary: doc.analytics?.summary,
      extractedMetrics: doc.analytics?.extractedMetrics,
    }));

    const agentId = process.env.GTWY_ASSISTANT_AGENT_ID || '6a9f18b4125b5dfba67e4017';
    const threadId = `folder_${id}_chat_${chatId}`;
    const variables = {
      folderName: folder.name,
      folderDescription: folder.description || '',
      userPrompt: message,
      message,
      query: message,
      documentsList: JSON.stringify(documentsSummary, null, 2),
      folderAnalytics: JSON.stringify(folder.analyticsMetrics || {}, null, 2),
    };

    const isStreaming = stream === true || req.headers.accept?.includes('text/event-stream') || req.query.stream === 'true';

    if (isStreaming) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      try {
        await streamGtwyChatAgent(
          agentId,
          threadId,
          message,
          variables,
          (delta: string) => {
            res.write(`data: ${JSON.stringify({ event: 'delta', content: delta })}\n\n`);
          },
        );
      } catch (gtwyErr: any) {
        console.warn('[Chat] GTWY stream notice, using RAG fallback:', gtwyErr.message);
        const ragResult = await queryPipeline(message);
        res.write(`data: ${JSON.stringify({ event: 'delta', content: ragResult.answer })}\n\n`);
      }

      res.write(`data: ${JSON.stringify({ event: 'done', threadId })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    } else {
      let reply = '';
      try {
        reply = await streamGtwyChatAgent(agentId, threadId, message, variables);
      } catch (gtwyErr: any) {
        console.warn('[Chat] GTWY notice, using RAG fallback:', gtwyErr.message);
        const ragResult = await queryPipeline(message);
        reply = ragResult.answer || 'No response returned';
      }

      return res.json({
        message: 'Chat completed',
        reply: reply || 'No content returned',
        threadId,
      });
    }
  } catch (error: any) {
    console.error('Chat error:', error.message);
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ event: 'error', error: error.message })}\n\n`);
      return res.end();
    }
    return res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/folders/:id/chats/:chatId/history
 */
export const getChatHistoryHandler = async (req: Request, res: Response) => {
  try {
    const { id, chatId } = req.params;
    const agentId = process.env.GTWY_ASSISTANT_AGENT_ID || '6a9f18b4125b5dfba67e4017';
    const threadId = `folder_${id}_chat_${chatId}`;
    try {
      const history = await getChatHistory(agentId, threadId);
      res.json(history || []);
    } catch {
      res.json([]);
    }
  } catch (error: any) {
    console.error('History error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

// ─── Semantic Search ──────────────────────────────────────────────────────────

/**
 * POST /api/folders/:id/search or GET /api/folders/:id/search?q=...
 * Performs retrieval-only hybrid search scoped to the folder collection.
 */
export const searchFolder = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const queryText = (req.query.q || req.body?.query || req.body?.query_text) as string;
    const topK = parseInt(String(req.query.top_k || req.body?.top_k || 10), 10);

    if (!queryText) return res.status(400).json({ error: 'Search query is required' });

    const folder = await FolderModel.findById(id);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const ragCollectionId = await ensureFolderCollection(folder);
    const docs = await DocumentModel.find({ folderId: id });
    const ragDocumentIds = docs
      .map((d) => (d as any).ragDocumentId)
      .filter(Boolean) as string[];

    const searchResults = await searchPipeline(queryText, {
      collectionId: ragCollectionId,
      documentIds: ragDocumentIds.length > 0 ? ragDocumentIds : undefined,
      topK,
    });

    res.json(searchResults);
  } catch (error: any) {
    console.error('Search error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

/**
 * POST /api/folders/:id/query or GET /api/folders/:id/query?q=...
 * Performs AI RAG generation scoped to the collection, returning factual answers and citations with document origin.
 */
export const queryFolder = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const queryText = (req.query.q || req.body?.query || req.body?.query_text) as string;
    const topK = parseInt(String(req.query.top_k || req.body?.top_k || 5), 10);

    if (!queryText) return res.status(400).json({ error: 'Query text is required' });

    const folder = await FolderModel.findById(id);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const ragCollectionId = await ensureFolderCollection(folder);
    const docs = await DocumentModel.find({ folderId: id });
    const ragDocumentIds = docs
      .map((d) => (d as any).ragDocumentId)
      .filter(Boolean) as string[];

    const result = await queryPipeline(queryText, {
      collectionId: ragCollectionId,
      documentIds: ragDocumentIds.length > 0 ? ragDocumentIds : undefined,
      topK,
    });

    res.json(result);
  } catch (error: any) {
    console.error('Folder Query error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

