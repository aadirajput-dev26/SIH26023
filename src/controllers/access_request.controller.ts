/**
 * access_request.controller.ts — Handles access-request submission and admin review.
 *
 * Public:
 *   POST /api/access-requests        — Submit an access request (no auth required)
 *
 * Admin (requires authenticate + authorize('access_requests:read/update')):
 *   GET  /api/access-requests        — List all requests
 *   PATCH /api/access-requests/:id/approve — Approve + create user + send email
 *   PATCH /api/access-requests/:id/reject  — Reject with optional note
 */

import { Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import AccessRequestModel from '../models/AccessRequest';
import UserModel from '../models/User';
import RoleModel from '../models/Role';
import { sendPasswordSetupEmail, sendRejectionEmail } from '../services/email.service';
import { noPrivilegeEscalation } from '../middleware/auth.middleware';

// ─── Submit Access Request (public) ──────────────────────────────────────────

export const submitAccessRequest = async (req: Request, res: Response) => {
  try {
    const { name, email, designation, department, requestedRole, projectScope, reason } = req.body;

    if (!name || !email || !designation || !department || !requestedRole || !reason) {
      return res.status(400).json({ error: 'All required fields must be filled.' });
    }

    if (!['dept_admin', 'analyst', 'viewer'].includes(requestedRole)) {
      return res.status(400).json({ error: 'Invalid requested role.' });
    }

    // Check for duplicate pending request
    const existing = await AccessRequestModel.findOne({
      email: email.toLowerCase().trim(),
      status: 'pending',
    });
    if (existing) {
      return res.status(409).json({
        error: 'An access request with this email is already pending review.',
      });
    }

    // Also check if user already exists
    const existingUser = await UserModel.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const accessRequest = new AccessRequestModel({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      designation: designation.trim(),
      department: department.trim(),
      requestedRole,
      projectScope: projectScope?.trim(),
      reason: reason.trim(),
    });

    await accessRequest.save();

    return res.status(201).json({
      message: 'Access request submitted successfully. You will be notified by email once reviewed.',
      requestId: accessRequest._id,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

// ─── List Access Requests (admin) ─────────────────────────────────────────────

export const listAccessRequests = async (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    const filter: any = {};

    if (status && ['pending', 'approved', 'rejected'].includes(status as string)) {
      filter.status = status;
    }

    const requests = await AccessRequestModel.find(filter)
      .populate('reviewedBy', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    return res.json(requests);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

// ─── Get pending count (admin notification) ────────────────────────────────

export const getPendingCount = async (req: Request, res: Response) => {
  try {
    const count = await AccessRequestModel.countDocuments({ status: 'pending' });
    return res.json({ count });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

// ─── Approve Access Request ───────────────────────────────────────────────────

export const approveAccessRequest = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { roleOverride, departmentId, departmentScope, projectScope, reviewNote } = req.body;

    const accessRequest = await AccessRequestModel.findById(id);
    if (!accessRequest) {
      return res.status(404).json({ error: 'Access request not found.' });
    }
    if (accessRequest.status !== 'pending') {
      return res.status(409).json({ error: 'This request has already been reviewed.' });
    }

    // Determine the role to assign
    const roleName = roleOverride || accessRequest.requestedRole;
    const role = await RoleModel.findOne({ name: roleName });
    if (!role) {
      return res.status(400).json({ error: `Role '${roleName}' not found.` });
    }

    // Privilege escalation guard — admin cannot grant roles >= their own level
    if (!noPrivilegeEscalation(role.level, req, res)) return;

    // Create the user account with 'pending' status until they set their password
    const tempPasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
    const user = new UserModel({
      name: accessRequest.name,
      email: accessRequest.email,
      passwordHash: tempPasswordHash,
      designation: accessRequest.designation,
      departmentId: departmentId || undefined,
      roleId: role._id,
      departmentScope: departmentScope || [],
      projectScope: projectScope || [],
      status: 'pending',   // activated after password setup
      emailVerified: false,
      createdBy: req.user!.id,
    });
    await user.save();

    // Generate a secure plaintext token, store its SHA-256 hash
    const plainToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(plainToken).digest('hex');
    const tokenExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    await AccessRequestModel.findByIdAndUpdate(id, {
      status: 'approved',
      reviewedBy: req.user!.id,
      reviewNote: reviewNote || undefined,
      reviewedAt: new Date(),
      passwordSetupToken: tokenHash,
      passwordSetupTokenExpiresAt: tokenExpiry,
    });

    // Send the setup email (non-blocking — errors are logged but don't fail the API)
    try {
      await sendPasswordSetupEmail(accessRequest.email, accessRequest.name, plainToken);
    } catch (emailErr: any) {
      console.error('[Email] Failed to send setup email:', emailErr.message);
    }

    return res.json({
      message: 'Request approved. User account created and setup email sent.',
      userId: user._id,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

// ─── Reject Access Request ────────────────────────────────────────────────────

export const rejectAccessRequest = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reviewNote } = req.body;

    const accessRequest = await AccessRequestModel.findById(id);
    if (!accessRequest) {
      return res.status(404).json({ error: 'Access request not found.' });
    }
    if (accessRequest.status !== 'pending') {
      return res.status(409).json({ error: 'This request has already been reviewed.' });
    }

    await AccessRequestModel.findByIdAndUpdate(id, {
      status: 'rejected',
      reviewedBy: req.user!.id,
      reviewNote: reviewNote || undefined,
      reviewedAt: new Date(),
    });

    // Send rejection email
    try {
      await sendRejectionEmail(accessRequest.email, accessRequest.name, reviewNote);
    } catch (emailErr: any) {
      console.error('[Email] Failed to send rejection email:', emailErr.message);
    }

    return res.json({ message: 'Request rejected. Applicant notified by email.' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};
