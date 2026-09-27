import { Router } from 'express';
import folderRoutes from './folders.routes';
import reportRoutes from './reports.routes';
import jobRoutes from './jobs.routes';
import authRoutes from './auth.routes';
import accessRequestRoutes from './access_requests.routes';
import userRoutes from './users.routes';

const router = Router();

// ── Public auth routes ─────────────────────────────────────────────────────────
router.use('/auth', authRoutes);

// ── Public access requests (submit only) ──────────────────────────────────────
router.use('/access-requests', accessRequestRoutes);

// ── Protected routes — authentication enforced per-route or at route level ─────
router.use('/folders', folderRoutes);
router.use('/reports', reportRoutes);
router.use('/jobs', jobRoutes);

// ── User management (admin only) ───────────────────────────────────────────────
router.use('/users', userRoutes);

export default router;
