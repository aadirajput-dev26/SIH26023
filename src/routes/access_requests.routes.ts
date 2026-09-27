import { Router } from 'express';
import {
  submitAccessRequest,
  listAccessRequests,
  getPendingCount,
  approveAccessRequest,
  rejectAccessRequest,
} from '../controllers/access_request.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';

const router = Router();

// Public — anyone can submit a request
router.post('/', submitAccessRequest);

// Admin — authenticated + proper permission
router.get('/', authenticate, authorize('access_requests:read'), listAccessRequests);
router.get('/pending-count', authenticate, authorize('access_requests:read'), getPendingCount);
router.patch('/:id/approve', authenticate, authorize('access_requests:update'), approveAccessRequest);
router.patch('/:id/reject', authenticate, authorize('access_requests:update'), rejectAccessRequest);

export default router;
