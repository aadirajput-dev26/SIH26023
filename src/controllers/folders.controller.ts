import { Request, Response } from 'express';
import FolderModel from '../models/Folder';
import DocumentModel from '../models/Document';
import { documentQueue } from '../queues';
import { createCollection } from '../services/hippocampus.service';

export const createFolder = async (req: Request, res: Response) => {
  try {
    const { name, description } = req.body;
    
    // 1. Create collection in Hippocampus
    const collectionData = await createCollection(name);
    
    // 2. Save in local DB
    const folder = new FolderModel({
      name,
      description,
      collectionId: collectionData.id || 'temp-collection-id' // Fallback for mocking
    });
    await folder.save();

    res.status(201).json(folder);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getFolders = async (req: Request, res: Response) => {
  try {
    const folders = await FolderModel.find().sort({ createdAt: -1 });
    res.json(folders);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getFolderById = async (req: Request, res: Response) => {
  try {
    const folder = await FolderModel.findById(req.params.id);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });
    
    const documents = await DocumentModel.find({ folderId: folder._id });
    res.json({ folder, documents });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const uploadDocument = async (req: Request, res: Response) => {
  try {
    const folderId = req.params.id;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const doc = new DocumentModel({
      folderId,
      originalName: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      status: 'pending'
    });
    await doc.save();

    // Dispatch to BullMQ
    const job = await documentQueue.add('process-document', {
      documentId: doc._id,
      folderId,
      filePath: file.path,
      fileType: file.mimetype
    });

    res.status(202).json({ 
      message: 'Document uploaded and queued for processing', 
      documentId: doc._id,
      jobId: job.id
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
