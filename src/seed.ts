/**
 * seed.ts — Seed script for GeoGyan RBAC system.
 *
 * Creates:
 *   1. System roles (super_admin, dept_admin, analyst, viewer) with permissions
 *   2. Default super admin user
 *
 * Run: npx tsx src/seed.ts
 * Idempotent — safe to run multiple times.
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import RoleModel from './models/Role';
import UserModel from './models/User';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/sih26023';

// ─── Role definitions ─────────────────────────────────────────────────────────

const ROLES = [
  {
    name: 'super_admin' as const,
    displayName: 'Super Administrator',
    level: 0,
    description: 'Full system access — can manage all users, roles, departments and projects.',
    isSystem: true,
    permissions: [
      'users:manage', 'users:create', 'users:read', 'users:update', 'users:delete',
      'roles:manage', 'roles:read',
      'departments:manage', 'departments:create', 'departments:read', 'departments:update', 'departments:delete',
      'projects:manage', 'projects:create', 'projects:read', 'projects:update', 'projects:delete',
      'folders:manage', 'folders:create', 'folders:read', 'folders:update', 'folders:delete',
      'documents:manage', 'documents:create', 'documents:read', 'documents:update', 'documents:delete',
      'reports:manage', 'reports:create', 'reports:read', 'reports:update', 'reports:delete',
      'access_requests:manage', 'access_requests:read', 'access_requests:update',
      'analytics:read',
    ],
  },
  {
    name: 'dept_admin' as const,
    displayName: 'Department Administrator',
    level: 1,
    description: 'Can manage users and resources within their department scope.',
    isSystem: true,
    permissions: [
      'users:create', 'users:read', 'users:update',
      'departments:read',
      'projects:read', 'projects:create',
      'folders:create', 'folders:read', 'folders:update', 'folders:delete',
      'documents:create', 'documents:read', 'documents:update', 'documents:delete',
      'reports:create', 'reports:read', 'reports:update', 'reports:delete',
      'access_requests:read', 'access_requests:update',
      'analytics:read',
    ],
  },
  {
    name: 'analyst' as const,
    displayName: 'Analyst',
    level: 2,
    description: 'Can upload documents, generate reports, and use the AI assistant for assigned projects.',
    isSystem: true,
    permissions: [
      'folders:read', 'folders:create',
      'documents:create', 'documents:read', 'documents:delete',
      'reports:create', 'reports:read',
      'analytics:read',
    ],
  },
  {
    name: 'viewer' as const,
    displayName: 'Viewer',
    level: 3,
    description: 'Read-only access to assigned project folders and reports.',
    isSystem: true,
    permissions: [
      'folders:read',
      'documents:read',
      'reports:read',
      'analytics:read',
    ],
  },
];

// ─── Super Admin config ───────────────────────────────────────────────────────

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'admin@geogyan.cmpdi.gov.in';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'GeoGyan@Admin2026';
const SUPER_ADMIN_NAME = process.env.SUPER_ADMIN_NAME || 'GeoGyan Super Admin';

// ─── Seed function ────────────────────────────────────────────────────────────

async function seed() {
  console.log('[Seed] Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('[Seed] Connected.');

  // 1. Upsert system roles
  for (const role of ROLES) {
    await RoleModel.findOneAndUpdate(
      { name: role.name },
      {
        $set: {
          displayName: role.displayName,
          level: role.level,
          description: role.description,
          isSystem: role.isSystem,
          permissions: role.permissions,
        },
      },
      { upsert: true, new: true },
    );
    console.log(`[Seed] Role upserted: ${role.name} (level ${role.level})`);
  }

  // 2. Create super admin user if not exists
  const superAdminRole = await RoleModel.findOne({ name: 'super_admin' });
  if (!superAdminRole) throw new Error('super_admin role not created.');

  const existing = await UserModel.findOne({ email: SUPER_ADMIN_EMAIL });
  if (existing) {
    console.log(`[Seed] Super admin already exists: ${SUPER_ADMIN_EMAIL}`);
  } else {
    const passwordHash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 12);
    const superAdmin = new UserModel({
      name: SUPER_ADMIN_NAME,
      email: SUPER_ADMIN_EMAIL,
      passwordHash,
      roleId: superAdminRole._id,
      departmentScope: [],
      projectScope: [],
      status: 'active',
      emailVerified: true,
    });
    await superAdmin.save();
    console.log(`[Seed] Super admin created: ${SUPER_ADMIN_EMAIL}`);
    console.log(`[Seed] Default password: ${SUPER_ADMIN_PASSWORD}`);
    console.log('[Seed] ⚠️  Change the password in production via SUPER_ADMIN_PASSWORD env var!');
  }

  console.log('[Seed] Done.');
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('[Seed] Error:', err.message);
  process.exit(1);
});
