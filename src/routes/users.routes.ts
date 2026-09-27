import { Router } from 'express';
import {
  listUsers,
  getUserById,
  updateUser,
  toggleUserStatus,
  deleteUser,
  listRoles,
} from '../controllers/user.controller';
import { authenticate, authorize, requireAdmin } from '../middleware/auth.middleware';

const router = Router();

// All user management routes require authentication
router.use(authenticate);

// Roles list — accessible by any admin for dropdowns
router.get('/roles', requireAdmin, listRoles);

// User management
router.get('/', requireAdmin, authorize('users:read'), listUsers);
router.get('/:id', requireAdmin, authorize('users:read'), getUserById);
router.patch('/:id', requireAdmin, authorize('users:update'), updateUser);
router.patch('/:id/status', requireAdmin, authorize('users:update'), toggleUserStatus);
router.delete('/:id', requireAdmin, authorize('users:delete'), deleteUser);

export default router;
