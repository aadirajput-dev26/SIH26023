import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import FolderModel from '../models/Folder';
import DocumentModel from '../models/Document';
import { dispatchDocumentJob } from '../queues';
import { queryPipeline } from '../services/rag_pipeline.service';

// ─── Folder CRUD ──────────────────────────────────────────────────────────────

export const createFolder = async (req: Request, res: Response) => {
  console.log('>>> createFolder called with body:', req.body);
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Folder name is required' });

    // No longer creating a Hippocampus collection per folder.
    // All resources share one GTWY RAG workspace; ownership is via Document.folderId.
    const folder = new FolderModel({ name, description });
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

    const doc = new DocumentModel({
      folderId,
      originalName: file.originalname,
      title: title || file.originalname,
      description: description || undefined,
      mimetype: file.mimetype,
      size: file.size,
      status: 'pending',
    });
    await doc.save();

    // Dispatch for processing (BullMQ if Redis is live, otherwise resilient in-process)
    const job = await dispatchDocumentJob({
      documentId: doc._id.toString(),
      folderId,
      filePath: file.path,
      fileType: file.mimetype,
      originalName: doc.title || file.originalname,
      description: doc.description,
    });

    res.status(202).json({
      message: 'Document uploaded and queued for processing',
      documentId: doc._id,
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
 * Directly creates a GTWY RAG resource from a public URL (no file transfer needed).
 */
export const uploadDocumentByUrl = async (req: Request, res: Response) => {
  try {
    const folderId = req.params.id;
    const { url, title, description } = req.body;

    if (!url) return res.status(400).json({ error: 'URL is required' });

    const folder = await FolderModel.findById(folderId);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const doc = new DocumentModel({
      folderId,
      originalName: title || url,
      title: title || url,
      description: description || undefined,
      mimetype: 'application/pdf',
      size: 0,
      sourceUrl: url,
      status: 'pending',
    });
    await doc.save();

    const job = await dispatchDocumentJob({
      documentId: doc._id.toString(),
      folderId,
      sourceUrl: url,
      fileType: 'application/pdf',
      originalName: title || url,
      description,
    });

    res.status(202).json({
      message: 'URL document registered and queued for processing',
      documentId: doc._id,
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
 * Creates a text document entry and queues conversion to PDF + RAG processing.
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

    if (!fs.existsSync('uploads')) {
      fs.mkdirSync('uploads', { recursive: true });
    }

    const filename = `content_${Date.now()}.txt`;
    const filePath = path.join('uploads', filename);
    await fs.promises.writeFile(filePath, content, 'utf-8');

    const doc = new DocumentModel({
      folderId,
      originalName: title,
      title,
      description: description || undefined,
      mimetype: 'text/plain',
      size: Buffer.byteLength(content),
      status: 'pending',
    });
    await doc.save();

    const job = await dispatchDocumentJob({
      documentId: doc._id.toString(),
      folderId,
      filePath,
      fileType: 'text/plain',
      originalName: title,
      description,
    });

    res.status(202).json({
      message: 'Text content document registered and queued for processing',
      documentId: doc._id,
      jobId: job.id,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ─── Delete Document ──────────────────────────────────────────────────────────

/**
 * DELETE /api/folders/:id/documents/:docId
 * Deletes the document from MongoDB and removes the corresponding GTWY RAG resource.
 */
export const deleteDocument = async (req: Request, res: Response) => {
  try {
    const { docId } = req.params;

    const doc = await DocumentModel.findById(docId);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    // Remove the RAG resource if it was indexed (Implementation pending in RAG pipeline)
    if (doc.gtwyResourceId) {
      console.warn('[RAG] Deletion not yet supported by pipeline API');
    }

    await DocumentModel.findByIdAndDelete(docId);

    res.json({ message: 'Document deleted successfully', documentId: docId });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ─── Delete Folder ────────────────────────────────────────────────────────────

/**
 * DELETE /api/folders/:id
 * Deletes the folder, all its documents, and reports.
 */
export const deleteFolder = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const folder = await FolderModel.findById(id);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    // Find and delete all documents (and their GTWY resources)
    const docs = await DocumentModel.find({ folderId: id });
    for (const doc of docs) {
      if (doc.gtwyResourceId) {
        console.warn('[RAG] Deletion not yet supported by pipeline API');
      }
      await DocumentModel.findByIdAndDelete(doc._id);
    }

    // Reports are embedded in FolderModel, so deleting the folder deletes reports automatically.
    await FolderModel.findByIdAndDelete(id);

    res.json({ message: 'Folder deleted successfully', folderId: id });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ─── Chat Assistant ───────────────────────────────────────────────────────────

/**
 * POST /api/folders/:id/chats/:chatId
 * Sends a message to the GTWY Assistant Agent using the folder context.
 */
export const postChatMessage = async (req: Request, res: Response) => {
  try {
    const { id, chatId } = req.params;
    const { message, stream } = req.body;

    if (!message) return res.status(400).json({ error: 'Message is required' });

    const folder = await FolderModel.findById(id);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    // Fetch all documents for this folder to pass into variables
    const docs = await DocumentModel.find({ folderId: id });
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

    const agentId = process.env.GTWY_ASSISTANT_AGENT_ID;
    if (!agentId) return res.status(500).json({ error: 'GTWY_ASSISTANT_AGENT_ID is not configured' });

    const threadId = `folder_${id}_chat_${chatId}`;
    const variables = {
      folderName: folder.name,
      folderDescription: folder.description || "",
      documentsList: JSON.stringify(documentsSummary, null, 2),
      folderAnalytics: JSON.stringify(folder.analyticsMetrics || {}, null, 2)
    };

    const isStreaming = stream === true || req.headers.accept?.includes('text/event-stream') || req.query.stream === 'true';

    // RAG Pipeline doesn't support streaming yet, simulate a fallback
    const result = await queryPipeline(message);

    if (isStreaming) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      res.write(`data: ${JSON.stringify({ event: 'delta', content: result.answer })}\n\n`);
      res.write(`data: ${JSON.stringify({ event: 'done', threadId })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    } else {
      return res.json({
        message: 'Chat completed',
        reply: result.answer || "No content returned",
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
 * Fetches the GTWY Assistant Agent chat history for the given thread.
 */
export const getChatHistoryHandler = async (req: Request, res: Response) => {
  try {
    const { id, chatId } = req.params;
    
    // The RAG Pipeline doesn't have an explicit chat history endpoint yet.
    res.json([]);
  } catch (error: any) {
    console.error('History error:', error.message);
    res.status(500).json({ error: error.message });
  }
};
