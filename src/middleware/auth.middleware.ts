/**
 * auth.middleware.ts — Authentication & Authorization middleware for GeoGyan.
 *
 * Provides:
 *   authenticate  — verifies JWT, attaches req.user
 *   authorize     — checks that req.user has a required permission
 *   requireAdmin  — shorthand for super_admin or dept_admin
 *   requireSuperAdmin — super_admin only
 *   scopeGuard    — dept_admin can only affect users/folders in their departmentScope
 */

import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, JwtPayload } from '../config/jwt';
import UserModel, { IUser } from '../models/User';
import RoleModel from '../models/Role';

// Extend Express Request to carry auth context
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
        role: string;
        roleLevel: number;
        permissions: string[];
        departmentScope: string[];
        projectScope: string[];
        status: string;
      };
    }
  }
}

// ─── authenticate ─────────────────────────────────────────────────────────────

/**
 * Verifies the Bearer token in Authorization header.
 * Attaches a minimal auth context to req.user.
 * Does NOT hit the database — the JWT payload carries role/level.
 * Use authenticate + optionally fetch full user when DB data is needed.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  const token = authHeader.slice(7);
  try {
    const payload = verifyAccessToken(token) as JwtPayload;

    // Fetch role permissions from DB (cached in role document)
    const role = await RoleModel.findOne({ name: payload.role as any }).lean();
    if (!role) {
      return res.status(401).json({ error: 'Role not found. Please re-login.' });
    }

    // Fetch user's scope (lightweight — only scope arrays + status)
    const user = await UserModel.findById(payload.sub)
      .select('status departmentScope projectScope name email')
      .lean();

    if (!user) {
      return res.status(401).json({ error: 'User account not found.' });
    }
    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'Account suspended. Contact administrator.' });
    }

    req.user = {
      id: payload.sub,
      email: payload.email,
      name: user.name,
      role: payload.role,
      roleLevel: payload.roleLevel,
      permissions: role.permissions,
      departmentScope: user.departmentScope.map((id) => id.toString()),
      projectScope: user.projectScope.map((id) => id.toString()),
      status: user.status,
    };

    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    return res.status(401).json({ error: 'Invalid token.' });
  }
}

// ─── authorize ────────────────────────────────────────────────────────────────

/**
 * Checks that the authenticated user has the specified permission string.
 * Permission format: "resource:action" e.g. "folders:create", "users:manage"
 * super_admin implicitly has all permissions.
 */
export function authorize(...requiredPermissions: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }

    // super_admin bypasses all permission checks
    if (req.user.role === 'super_admin') {
      return next();
    }

    const hasAll = requiredPermissions.every((perm) =>
      req.user!.permissions.includes(perm),
    );

    if (!hasAll) {
      return res.status(403).json({
        error: 'Insufficient permissions for this action.',
        required: requiredPermissions,
      });
    }

    next();
  };
}

// ─── requireAdmin ─────────────────────────────────────────────────────────────

/** Requires super_admin or dept_admin role. */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated.' });
  if (req.user.roleLevel > 1) {
    return res.status(403).json({ error: 'Administrator access required.' });
  }
  next();
}

/** Requires super_admin only. */
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated.' });
  if (req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Super Administrator access required.' });
  }
  next();
}

// ─── scopeGuard ───────────────────────────────────────────────────────────────

/**
 * Ensures a dept_admin can only affect resources within their departmentScope.
 * Pass `targetDeptId` as a string — extracted from the request by the caller.
 * super_admin always passes.
 */
export function buildScopeGuard(getDeptId: (req: Request) => string | undefined) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated.' });

    // super_admin: no scope restriction
    if (req.user.role === 'super_admin') return next();

    const targetDept = getDeptId(req);
    if (!targetDept) return next(); // no scope restriction needed

    if (!req.user.departmentScope.includes(targetDept)) {
      return res.status(403).json({
        error: 'You do not have permission to manage resources in this department.',
      });
    }

    next();
  };
}

/**
 * Prevents a user from granting/assigning a role with equal or higher privilege
 * than their own (privilege escalation guard).
 * Call with the target role level to assign.
 */
export function noPrivilegeEscalation(targetRoleLevel: number, req: Request, res: Response): boolean {
  if (!req.user) return false;
  if (targetRoleLevel <= req.user.roleLevel) {
    res.status(403).json({
      error: 'You cannot assign a role with privilege level equal to or higher than your own.',
    });
    return false;
  }
  return true;
}
