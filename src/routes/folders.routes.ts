import { Router } from 'express';
import { createFolder, getFolders, getFolderById, uploadDocument } from '../controllers/folders.controller';
import multer from 'multer';

const router = Router();
const upload = multer({ dest: 'uploads/' });

router.post('/', createFolder);
router.get('/', getFolders);
router.get('/:id', getFolderById);
router.post('/:id/upload', upload.single('file'), uploadDocument);

export default router;
