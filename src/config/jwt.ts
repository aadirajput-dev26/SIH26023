/**
 * jwt.ts — JWT token helpers for GeoGyan authentication system.
 *
 * Access tokens are short-lived (15 min). Refresh tokens are long-lived (7 days)
 * and stored securely (httpOnly cookies or sent in body for API clients).
 *
 * We store only minimal claims in the token to avoid stale-data issues;
 * the full user object is fetched from MongoDB when needed.
 */

import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'geogyan-access-secret-change-in-prod';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'geogyan-refresh-secret-change-in-prod';

export interface JwtPayload {
  sub: string;       // userId (MongoDB ObjectId string)
  role: string;      // role name e.g. 'super_admin'
  roleLevel: number; // hierarchy level
  email: string;
  iat?: number;
  exp?: number;
}

export function signAccessToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: '15m' });
}

export function signRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId }, REFRESH_SECRET, { expiresIn: '7d' });
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, ACCESS_SECRET) as JwtPayload;
}

export function verifyRefreshToken(token: string): { sub: string } {
  return jwt.verify(token, REFRESH_SECRET) as { sub: string };
}
