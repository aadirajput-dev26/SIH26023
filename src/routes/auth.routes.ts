import { Router } from 'express';
import {
  login,
  refreshToken,
  getMe,
  setupPassword,
  verifySetupToken,
} from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Public
router.post('/login', login);
router.post('/refresh-token', refreshToken);
router.post('/setup-password', setupPassword);
router.get('/verify-setup-token', verifySetupToken);

// Protected
router.get('/me', authenticate, getMe);

export default router;
