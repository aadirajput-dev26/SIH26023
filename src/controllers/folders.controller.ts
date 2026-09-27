import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import FolderModel from '../models/Folder';
import { dispatchDocumentJob } from '../queues';
import { queryPipeline } from '../services/rag_pipeline.service';

// ─── Folder CRUD ──────────────────────────────────────────────────────────────

export const createFolder = async (req: Request, res: Response) => {
  console.log('>>> createFolder called with body:', req.body);
  try {
    const { name, description, departmentId, projectIds } = req.body;
    if (!name) return res.status(400).json({ error: 'Folder name is required' });

    const folder = new FolderModel({
      name,
      description,
      departmentId: departmentId || undefined,
      projectIds: projectIds || [],
      ownerId: req.user?.id || undefined,
    });
    await folder.save();

    res.status(201).json(folder);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getFolders = async (req: Request, res: Response) => {
  try {
    const filter: any = {};

    // Scope filtering for non-super_admin users
    if (req.user && req.user.role !== 'super_admin') {
      if (req.user.role === 'dept_admin' && req.user.departmentScope.length > 0) {
        filter.departmentId = { $in: req.user.departmentScope };
      } else if (req.user.projectScope.length > 0) {
        filter.projectIds = { $in: req.user.projectScope };
      }
    }

    const folders = await FolderModel.find(filter)
      .lean()
      .sort({ createdAt: -1 });

    // Shape for frontend: expose documentCount from embedded array
    const shaped = folders.map((folder) => ({
      ...folder,
      documentCount: (folder.documents || []).length,
      reportCount: (folder.reports || []).length,
      documents: folder.documents || [],
    }));

    res.json(shaped);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getFolderById = async (req: Request, res: Response) => {
  try {
    const folder = await FolderModel.findById(req.params.id).lean();
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    res.json({
      ...folder,
      documents: folder.documents || [],
      documentCount: (folder.documents || []).length,
      reportCount: (folder.reports || []).length,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ─── Document Upload (File) ────────────────────────────────────────────────────

/**
 * POST /api/folders/:id/upload
 * Accepts multipart/form-data. Embeds document metadata in Folder.documents[].
 * The BullMQ worker ingests the file into the RAG Pipeline and updates ragDocumentId.
 */
export const uploadDocument = async (req: Request, res: Response) => {
  try {
    const folderId = req.params.id;
    const file = req.file;
    const { title, description } = req.body;

    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const folder = await FolderModel.findById(folderId);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    // Create a new embedded document entry
    const docId = new mongoose.Types.ObjectId();
    const newDoc = {
      _id: docId,
      originalName: file.originalname,
      title: title || file.originalname,
      description: description || undefined,
      mimetype: file.mimetype,
      size: file.size,
      status: 'pending' as const,
    };

    await FolderModel.findByIdAndUpdate(folderId, {
      $push: { documents: newDoc },
    });

    // Dispatch for RAG pipeline processing
    const job = await dispatchDocumentJob({
      documentId: docId.toString(),
      folderId,
      filePath: file.path,
      fileType: file.mimetype,
      originalName: newDoc.title || file.originalname,
      description: newDoc.description,
    });

    res.status(202).json({
      message: 'Document uploaded and queued for processing',
      documentId: docId,
      jobId: job.id,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ─── Document Upload (URL / Link) ─────────────────────────────────────────────

export const uploadDocumentByUrl = async (req: Request, res: Response) => {
  try {
    const folderId = req.params.id;
    const { url, title, description } = req.body;

    if (!url) return res.status(400).json({ error: 'URL is required' });

    const folder = await FolderModel.findById(folderId);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const docId = new mongoose.Types.ObjectId();
    const newDoc = {
      _id: docId,
      originalName: title || url,
      title: title || url,
      description: description || undefined,
      mimetype: 'application/pdf',
      size: 0,
      sourceUrl: url,
      status: 'pending' as const,
    };

    await FolderModel.findByIdAndUpdate(folderId, {
      $push: { documents: newDoc },
    });

    const job = await dispatchDocumentJob({
      documentId: docId.toString(),
      folderId,
      sourceUrl: url,
      fileType: 'application/pdf',
      originalName: title || url,
      description,
    });

    res.status(202).json({
      message: 'URL document registered and queued for processing',
      documentId: docId,
      jobId: job.id,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ─── Document Upload (Raw Text Content) ───────────────────────────────────────

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

    const docId = new mongoose.Types.ObjectId();
    const newDoc = {
      _id: docId,
      originalName: title,
      title,
      description: description || undefined,
      mimetype: 'text/plain',
      size: Buffer.byteLength(content),
      status: 'pending' as const,
    };

    await FolderModel.findByIdAndUpdate(folderId, {
      $push: { documents: newDoc },
    });

    const job = await dispatchDocumentJob({
      documentId: docId.toString(),
      folderId,
      filePath,
      fileType: 'text/plain',
      originalName: title,
      description,
    });

    res.status(202).json({
      message: 'Text content document registered and queued for processing',
      documentId: docId,
      jobId: job.id,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ─── Delete Document ──────────────────────────────────────────────────────────

/**
 * DELETE /api/folders/:id/documents/:docId
 * Removes the embedded document from Folder.documents[].
 */
export const deleteDocument = async (req: Request, res: Response) => {
  try {
    const { id: folderId, docId } = req.params;

    const folder = await FolderModel.findById(folderId);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    const doc = folder.documents.find((d) => d._id.toString() === docId);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    if (doc.ragDocumentId) {
      console.warn('[RAG] Document deletion from vector store not yet supported by pipeline API. Removing from Folder only.');
    }

    await FolderModel.findByIdAndUpdate(folderId, {
      $pull: { documents: { _id: new mongoose.Types.ObjectId(docId as string) } },
    });

    res.json({ message: 'Document deleted successfully', documentId: docId });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ─── Delete Folder ────────────────────────────────────────────────────────────

export const deleteFolder = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const folder = await FolderModel.findById(id);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    // Log RAG cleanup notice for any indexed documents
    for (const doc of folder.documents) {
      if (doc.ragDocumentId) {
        console.warn('[RAG] Document deletion from vector store not yet supported. Removing from Folder only.');
      }
    }

    await FolderModel.findByIdAndDelete(id);

    res.json({ message: 'Folder deleted successfully', folderId: id });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ─── Chat Assistant ───────────────────────────────────────────────────────────

export const postChatMessage = async (req: Request, res: Response) => {
  try {
    const { id, chatId } = req.params;
    const { message, stream } = req.body;

    if (!message) return res.status(400).json({ error: 'Message is required' });

    const folder = await FolderModel.findById(id).lean();
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    // Collect RAG pipeline document IDs from embedded documents
    const ragDocumentIds = (folder.documents || [])
      .map((d) => d.ragDocumentId)
      .filter(Boolean) as string[];

    const threadId = `folder_${id}_chat_${chatId}`;

    const isStreaming =
      stream === true ||
      req.headers.accept?.includes('text/event-stream') ||
      req.query.stream === 'true';

    const result = await queryPipeline(message, ragDocumentIds.length > 0 ? ragDocumentIds : undefined);

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
        reply: result.answer || 'No content returned',
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

export const getChatHistoryHandler = async (req: Request, res: Response) => {
  try {
    res.json([]);
  } catch (error: any) {
    console.error('History error:', error.message);
    res.status(500).json({ error: error.message });
  }
};
