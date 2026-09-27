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
} from '../controllers/folders.controller';
import { deleteReport } from '../controllers/reports.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';
import multer from 'multer';

const router = Router();
const upload = multer({ dest: 'uploads/' });

// ── All folder routes require authentication ────────────────────────────────────
router.use(authenticate);

// Folder CRUD
router.post('/', authorize('folders:create'), createFolder);
router.get('/', authorize('folders:read'), getFolders);
router.get('/:id', authorize('folders:read'), getFolderById);
router.delete('/:id', authorize('folders:delete'), deleteFolder);

// Document upload
router.post('/:id/upload', authorize('documents:create'), upload.single('file'), uploadDocument);
router.post('/:id/upload-url', authorize('documents:create'), uploadDocumentByUrl);
router.post('/:id/upload-content', authorize('documents:create'), uploadDocumentContent);
router.delete('/:id/documents/:docId', authorize('documents:delete'), deleteDocument);

// Chat (read access suffices — scoped to folder docs)
router.post('/:id/chats/:chatId', authorize('folders:read'), postChatMessage);
router.get('/:id/chats/:chatId/history', authorize('folders:read'), getChatHistoryHandler);

// Reports
router.delete('/:id/reports/:reportId', authorize('reports:delete'), deleteReport);

export default router;
