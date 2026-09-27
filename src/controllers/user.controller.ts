/**
 * user.controller.ts — User management for GeoGyan RBAC.
 *
 * All routes require authentication. Scope enforcement:
 *   - super_admin: full access
 *   - dept_admin: can only read/manage users in their departmentScope
 *   - analyst/viewer: cannot access user management
 */

import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import UserModel from '../models/User';
import RoleModel from '../models/Role';
import { noPrivilegeEscalation } from '../middleware/auth.middleware';

// ─── List Users ───────────────────────────────────────────────────────────────

export const listUsers = async (req: Request, res: Response) => {
  try {
    const { departmentId, status, role } = req.query;
    const filter: any = {};

    // dept_admin can only see users in their scope
    if (req.user!.role === 'dept_admin') {
      filter.departmentId = { $in: req.user!.departmentScope };
    } else if (departmentId) {
      filter.departmentId = departmentId;
    }

    if (status) filter.status = status;
    if (role) {
      const roleDoc = await RoleModel.findOne({ name: role as any });
      if (roleDoc) filter.roleId = roleDoc._id;
    }

    const users = await UserModel.find(filter)
      .populate('roleId', 'name displayName level')
      .populate('departmentId', 'name code')
      .select('-passwordHash')
      .sort({ createdAt: -1 })
      .lean();

    return res.json(users);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

// ─── Get User by ID ───────────────────────────────────────────────────────────

export const getUserById = async (req: Request, res: Response) => {
  try {
    const user = await UserModel.findById(req.params.id)
      .populate('roleId', 'name displayName level permissions')
      .populate('departmentId', 'name code')
      .populate('departmentScope', 'name code')
      .populate('projectScope', 'name code')
      .select('-passwordHash')
      .lean();

    if (!user) return res.status(404).json({ error: 'User not found.' });

    // Scope check for dept_admin
    if (req.user!.role === 'dept_admin') {
      const userDept = user.departmentId?.toString();
      if (userDept && !req.user!.departmentScope.includes(userDept)) {
        return res.status(403).json({ error: 'Access denied — user is outside your scope.' });
      }
    }

    return res.json(user);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

// ─── Update User ──────────────────────────────────────────────────────────────

export const updateUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, designation, departmentId, roleId, departmentScope, projectScope } = req.body;

    const user = await UserModel.findById(id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    // If changing role, check privilege escalation
    if (roleId) {
      const newRole = await RoleModel.findById(roleId);
      if (!newRole) return res.status(400).json({ error: 'Role not found.' });
      if (!noPrivilegeEscalation(newRole.level, req, res)) return;
    }

    const updates: any = {};
    if (name) updates.name = name.trim();
    if (designation !== undefined) updates.designation = designation;
    if (departmentId !== undefined) updates.departmentId = departmentId;
    if (roleId) updates.roleId = roleId;
    if (departmentScope) updates.departmentScope = departmentScope;
    if (projectScope) updates.projectScope = projectScope;

    const updated = await UserModel.findByIdAndUpdate(id, { $set: updates }, { new: true })
      .populate('roleId', 'name displayName level')
      .select('-passwordHash')
      .lean();

    return res.json(updated);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

// ─── Suspend / Activate User ──────────────────────────────────────────────────

export const toggleUserStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { action } = req.body; // 'suspend' | 'activate'

    if (!['suspend', 'activate'].includes(action)) {
      return res.status(400).json({ error: "Action must be 'suspend' or 'activate'." });
    }

    // Cannot suspend yourself
    if (id === req.user!.id) {
      return res.status(400).json({ error: 'You cannot suspend your own account.' });
    }

    const user = await UserModel.findById(id).populate<{ roleId: { level: number } }>('roleId');
    if (!user) return res.status(404).json({ error: 'User not found.' });

    // Cannot suspend a user with higher or equal privilege
    const targetLevel = (user.roleId as any).level;
    if (targetLevel <= req.user!.roleLevel) {
      return res.status(403).json({ error: 'Cannot suspend a user with equal or higher privilege.' });
    }

    const newStatus = action === 'suspend' ? 'suspended' : 'active';
    await UserModel.findByIdAndUpdate(id, { status: newStatus });

    return res.json({ message: `User ${action}d successfully.`, status: newStatus });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

// ─── Delete User ──────────────────────────────────────────────────────────────

export const deleteUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (id === req.user!.id) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }

    const user = await UserModel.findById(id).populate<{ roleId: { level: number } }>('roleId');
    if (!user) return res.status(404).json({ error: 'User not found.' });

    if ((user.roleId as any).level <= req.user!.roleLevel) {
      return res.status(403).json({ error: 'Cannot delete a user with equal or higher privilege.' });
    }

    await UserModel.findByIdAndDelete(id);
    return res.json({ message: 'User deleted successfully.' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

// ─── List Roles (for dropdowns) ───────────────────────────────────────────────

export const listRoles = async (req: Request, res: Response) => {
  try {
    // Return only roles the requesting user can assign (lower level = higher privilege)
    const roles = await RoleModel.find({
      level: { $gt: req.user!.roleLevel }, // can only assign lower-privilege roles
    })
      .select('name displayName description level')
      .sort({ level: 1 })
      .lean();

    return res.json(roles);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};
