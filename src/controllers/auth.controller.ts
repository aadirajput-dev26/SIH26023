/**
 * auth.controller.ts — Authentication handlers for GeoGyan.
 *
 * Endpoints:
 *   POST /api/auth/login              — email + password → access + refresh tokens
 *   POST /api/auth/refresh-token      — refresh token → new access token
 *   POST /api/auth/logout             — invalidate refresh token (client-side)
 *   POST /api/auth/setup-password     — token-based password setup for new users
 *   GET  /api/auth/me                 — get current user profile
 */

import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import UserModel from '../models/User';
import RoleModel from '../models/Role';
import AccessRequestModel from '../models/AccessRequest';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../config/jwt';

// ─── Login ────────────────────────────────────────────────────────────────────

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await UserModel.findOne({ email: email.toLowerCase().trim() }).populate<{
      roleId: { name: string; level: number; permissions: string[] };
    }>('roleId');

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'Account suspended. Contact administrator.' });
    }

    if (user.status === 'pending') {
      return res.status(403).json({ error: 'Account pending setup. Check your email for a setup link.' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const role = user.roleId as any;

    const accessToken = signAccessToken({
      sub: user._id.toString(),
      email: user.email,
      role: role.name,
      roleLevel: role.level,
    });

    const refreshToken = signRefreshToken(user._id.toString());

    // Update last login
    await UserModel.findByIdAndUpdate(user._id, { lastLoginAt: new Date() });

    return res.json({
      accessToken,
      refreshToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: role.name,
        roleLevel: role.level,
        designation: user.designation,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

// ─── Refresh Token ────────────────────────────────────────────────────────────

export const refreshToken = async (req: Request, res: Response) => {
  try {
    const { refreshToken: token } = req.body;
    if (!token) return res.status(400).json({ error: 'Refresh token required.' });

    let payload: { sub: string };
    try {
      payload = verifyRefreshToken(token);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired refresh token.' });
    }

    const user = await UserModel.findById(payload.sub).populate<{
      roleId: { name: string; level: number };
    }>('roleId');

    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: 'User not found or inactive.' });
    }

    const role = user.roleId as any;
    const newAccessToken = signAccessToken({
      sub: user._id.toString(),
      email: user.email,
      role: role.name,
      roleLevel: role.level,
    });

    return res.json({ accessToken: newAccessToken });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

// ─── Me ───────────────────────────────────────────────────────────────────────

export const getMe = async (req: Request, res: Response) => {
  try {
    const user = await UserModel.findById(req.user!.id)
      .populate('roleId', 'name displayName level permissions')
      .populate('departmentId', 'name code')
      .populate('departmentScope', 'name code')
      .populate('projectScope', 'name code')
      .lean();

    if (!user) return res.status(404).json({ error: 'User not found.' });

    return res.json({
      id: user._id,
      name: user.name,
      email: user.email,
      designation: user.designation,
      department: user.departmentId,
      role: user.roleId,
      departmentScope: user.departmentScope,
      projectScope: user.projectScope,
      status: user.status,
      lastLoginAt: user.lastLoginAt,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

// ─── Setup Password ───────────────────────────────────────────────────────────

/**
 * POST /api/auth/setup-password
 * Body: { token: string, password: string }
 *
 * Called by new users clicking the email link. Verifies the token,
 * hashes the password, and activates the account.
 */
export const setupPassword = async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ error: 'Token and password are required.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    // Hash the provided token to compare with stored hash
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const accessRequest = await AccessRequestModel.findOne({
      passwordSetupToken: tokenHash,
      passwordSetupCompleted: false,
      passwordSetupTokenExpiresAt: { $gt: new Date() },
    });

    if (!accessRequest) {
      return res.status(400).json({
        error: 'Invalid or expired setup link. Please contact your administrator.',
      });
    }

    // Find the user created when the request was approved
    const user = await UserModel.findOne({ email: accessRequest.email });
    if (!user) {
      return res.status(404).json({ error: 'User account not found.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await UserModel.findByIdAndUpdate(user._id, {
      passwordHash,
      status: 'active',
      emailVerified: true,
    });

    // Mark token as used
    await AccessRequestModel.findByIdAndUpdate(accessRequest._id, {
      passwordSetupCompleted: true,
      passwordSetupToken: undefined,
      passwordSetupTokenExpiresAt: undefined,
    });

    return res.json({ message: 'Password set successfully. You can now log in.' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

// ─── Verify Setup Token ───────────────────────────────────────────────────────

/**
 * GET /api/auth/verify-setup-token?token=...
 * Used by the frontend to validate the token before showing the form.
 */
export const verifySetupToken = async (req: Request, res: Response) => {
  try {
    const { token } = req.query;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ valid: false, error: 'Token required.' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const accessRequest = await AccessRequestModel.findOne({
      passwordSetupToken: tokenHash,
      passwordSetupCompleted: false,
      passwordSetupTokenExpiresAt: { $gt: new Date() },
    }).select('name email');

    if (!accessRequest) {
      return res.json({ valid: false, error: 'Invalid or expired setup link.' });
    }

    return res.json({ valid: true, name: accessRequest.name, email: accessRequest.email });
  } catch (err: any) {
    return res.status(500).json({ valid: false, error: err.message });
  }
};
