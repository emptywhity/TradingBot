import crypto from 'crypto';
import { loadSessions, loadUsers, saveSessions, saveUsers, SessionRecord, UserRecord, UserRole } from './authStore';

const SESSION_TTL_DAYS = Number.parseInt(process.env.BACKEND_SESSION_TTL_DAYS ?? '30', 10) || 30;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
const VIP_DEFAULT_DAYS = 30;
const VIP_DEFAULT_MS = VIP_DEFAULT_DAYS * 24 * 60 * 60 * 1000;

export type PublicUser = {
  id: string;
  email: string;
  role: UserRole;
  vipExpiresAt?: number;
  createdAt: number;
};

export function sanitizeUser(user: UserRecord, now: number = Date.now()): PublicUser {
  const role = resolveRole(user, now);
  return { id: user.id, email: user.email, role, vipExpiresAt: user.vipExpiresAt, createdAt: user.createdAt };
}

export async function ensureAdminUser(email?: string, password?: string): Promise<void> {
  if (!email || !password) return;
  const normalized = normalizeEmail(email);
  const users = await loadUsers();
  const existing = users.find((u) => u.email === normalized);
  if (existing) {
    if (existing.role !== 'admin') {
      existing.role = 'admin';
      await saveUsers(users);
    }
    return;
  }
  const now = Date.now();
  const user: UserRecord = {
    id: `u_${crypto.randomUUID()}`,
    email: normalized,
    passwordHash: hashPassword(password),
    role: 'admin',
    createdAt: now
  };
  users.push(user);
  await saveUsers(users);
}

export async function registerUser(email: string, password: string): Promise<PublicUser> {
  const normalized = normalizeEmail(email);
  const users = await loadUsers();
  if (users.find((u) => u.email === normalized)) {
    throw new Error('Email already exists.');
  }
  const now = Date.now();
  const user: UserRecord = {
    id: `u_${crypto.randomUUID()}`,
    email: normalized,
    passwordHash: hashPassword(password),
    role: 'standard',
    vipExpiresAt: undefined,
    createdAt: now
  };
  users.push(user);
  await saveUsers(users);
  return sanitizeUser(user, now);
}

export async function authenticateUser(email: string, password: string): Promise<PublicUser | null> {
  const normalized = normalizeEmail(email);
  const users = await loadUsers();
  const now = Date.now();
  if (applyVipExpirations(users, now)) await saveUsers(users);
  const user = users.find((u) => u.email === normalized);
  if (!user) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return sanitizeUser(user, now);
}

export async function createSession(userId: string): Promise<SessionRecord> {
  const sessions = await loadSessions();
  const now = Date.now();
  const session: SessionRecord = {
    token: crypto.randomBytes(32).toString('hex'),
    userId,
    expiresAt: now + SESSION_TTL_MS
  };
  sessions.push(session);
  await saveSessions(pruneSessions(sessions, now));
  return session;
}

export async function invalidateSession(token: string): Promise<void> {
  const sessions = await loadSessions();
  const filtered = sessions.filter((s) => s.token !== token);
  await saveSessions(filtered);
}

export async function getUserByToken(token?: string): Promise<PublicUser | null> {
  if (!token) return null;
  const now = Date.now();
  const sessions = await loadSessions();
  const active = pruneSessions(sessions, now);
  if (active.length !== sessions.length) await saveSessions(active);
  const session = active.find((s) => s.token === token);
  if (!session) return null;
  const users = await loadUsers();
  if (applyVipExpirations(users, now)) await saveUsers(users);
  const user = users.find((u) => u.id === session.userId);
  return user ? sanitizeUser(user, now) : null;
}

export async function listUsers(): Promise<PublicUser[]> {
  const users = await loadUsers();
  const now = Date.now();
  if (applyVipExpirations(users, now)) await saveUsers(users);
  return users.map((u) => sanitizeUser(u, now));
}

export async function updateUserRole(
  userId: string,
  role: UserRole,
  options?: { vipExpiresAt?: number | null; vipDays?: number }
): Promise<PublicUser | null> {
  const users = await loadUsers();
  const user = users.find((u) => u.id === userId);
  if (!user) return null;
  const now = Date.now();
  user.role = role;
  if (role === 'vip') {
    if (typeof options?.vipExpiresAt === 'number') {
      user.vipExpiresAt = options.vipExpiresAt;
    } else if (typeof options?.vipDays === 'number' && Number.isFinite(options.vipDays) && options.vipDays > 0) {
      user.vipExpiresAt = now + options.vipDays * 24 * 60 * 60 * 1000;
    } else if (!user.vipExpiresAt || user.vipExpiresAt <= now) {
      user.vipExpiresAt = now + VIP_DEFAULT_MS;
    }
  } else {
    user.vipExpiresAt = undefined;
  }
  await saveUsers(users);
  return sanitizeUser(user, now);
}

export async function getUserByEmail(email: string): Promise<UserRecord | null> {
  const normalized = normalizeEmail(email);
  const users = await loadUsers();
  return users.find((u) => u.email === normalized) ?? null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function resolveRole(user: UserRecord, now: number): UserRole {
  if (user.role !== 'vip') return user.role;
  if (typeof user.vipExpiresAt !== 'number') return 'vip';
  return user.vipExpiresAt > now ? 'vip' : 'standard';
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 32).toString('hex');
  const hashBuf = Buffer.from(hash, 'hex');
  const candBuf = Buffer.from(candidate, 'hex');
  if (hashBuf.length !== candBuf.length) return false;
  return crypto.timingSafeEqual(hashBuf, candBuf);
}

function pruneSessions(sessions: SessionRecord[], now: number): SessionRecord[] {
  return sessions.filter((s) => s.expiresAt > now);
}

function applyVipExpirations(users: UserRecord[], now: number): boolean {
  let changed = false;
  for (const user of users) {
    if (user.role === 'vip' && typeof user.vipExpiresAt === 'number' && user.vipExpiresAt <= now) {
      user.role = 'standard';
      changed = true;
    }
  }
  return changed;
}
