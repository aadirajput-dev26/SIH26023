import { Router } from 'express';
import { requestReportGeneration } from '../controllers/reports.controller';

const router = Router();

router.post('/generate', requestReportGeneration);

export default router;
