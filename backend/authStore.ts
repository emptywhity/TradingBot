import fs from 'fs/promises';
import path from 'path';

export type UserRole = 'standard' | 'vip' | 'admin';

export type UserRecord = {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  vipExpiresAt?: number;
  createdAt: number;
};

export type SessionRecord = {
  token: string;
  userId: string;
  expiresAt: number;
};

const USERS_PATH = path.resolve(process.cwd(), 'backend/data/users.json');
const SESSIONS_PATH = path.resolve(process.cwd(), 'backend/data/sessions.json');

export async function loadUsers(): Promise<UserRecord[]> {
  const data = await readJson<{ users: UserRecord[] }>(USERS_PATH, { users: [] });
  return data.users ?? [];
}

export async function saveUsers(users: UserRecord[]): Promise<void> {
  await writeJson(USERS_PATH, { users });
}

export async function loadSessions(): Promise<SessionRecord[]> {
  const data = await readJson<{ sessions: SessionRecord[] }>(SESSIONS_PATH, { sessions: [] });
  return data.sessions ?? [];
}

export async function saveSessions(sessions: SessionRecord[]): Promise<void> {
  await writeJson(SESSIONS_PATH, { sessions });
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf-8');
}
