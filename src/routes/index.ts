import { Router } from 'express';
import folderRoutes from './folders.routes';
import reportRoutes from './reports.routes';
import jobRoutes from './jobs.routes';

const router = Router();

router.use('/folders', folderRoutes);
router.use('/reports', reportRoutes);
router.use('/jobs', jobRoutes);

export default router;
