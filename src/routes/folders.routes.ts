import { Router } from 'express';
import { createFolder, getFolders, getFolderById, uploadDocument, uploadDocumentByUrl, uploadDocumentContent, deleteDocument, deleteFolder, postChatMessage, getChatHistoryHandler } from '../controllers/folders.controller';
import { deleteReport } from '../controllers/reports.controller';
import multer from 'multer';

const router = Router();
const upload = multer({ dest: 'uploads/' });

router.post('/', createFolder);
router.get('/', getFolders);
router.get('/:id', getFolderById);
router.delete('/:id', deleteFolder);

// File upload (multipart) — triggers BullMQ job
router.post('/:id/upload', upload.single('file'), uploadDocument);

// URL / link upload — calls GTWY RAG directly, then queues analytics extraction
router.post('/:id/upload-url', uploadDocumentByUrl);

// Raw text content upload — creates text doc and queues conversion & analytics
router.post('/:id/upload-content', uploadDocumentContent);

// Delete document + GTWY RAG resource
router.delete('/:id/documents/:docId', deleteDocument);

// Chat endpoints
router.post('/:id/chats/:chatId', postChatMessage);
router.get('/:id/chats/:chatId/history', getChatHistoryHandler);

// Delete report
router.delete('/:id/reports/:reportId', deleteReport);

export default router;
