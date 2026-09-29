import { Router } from 'express';
import {
  createFolder,
  getFolders,
  getFolderById,
  uploadDocument,
  uploadDocumentByUrl,
  uploadDocumentContent,
  deleteDocument,
  deleteFolder,
  postChatMessage,
  getChatHistoryHandler,
  searchFolder,
  queryFolder,
} from '../controllers/folders.controller';
import { deleteReport } from '../controllers/reports.controller';
import multer from 'multer';

const router = Router();
const upload = multer({ dest: 'uploads/' });

router.post('/', createFolder);
router.get('/', getFolders);
router.get('/:id', getFolderById);
router.delete('/:id', deleteFolder);

// File upload (multipart) — triggers BullMQ / in-process worker
router.post('/:id/upload', upload.single('file'), uploadDocument);

// URL / link upload — unified RAG pipeline ingest endpoint
router.post('/:id/upload-url', uploadDocumentByUrl);

// Raw text content upload — creates text doc and ingests into RAG pipeline
router.post('/:id/upload-content', uploadDocumentContent);

// Delete document
router.delete('/:id/documents/:docId', deleteDocument);

// Chat endpoints
router.post('/:id/chats/:chatId', postChatMessage);
router.get('/:id/chats/:chatId/history', getChatHistoryHandler);

// Semantic Search retrieval endpoint
router.post('/:id/search', searchFolder);
router.get('/:id/search', searchFolder);

// AI RAG Query endpoint (collection-level with document citation)
router.post('/:id/query', queryFolder);
router.get('/:id/query', queryFolder);

// Delete report
router.delete('/:id/reports/:reportId', deleteReport);

export default router;
