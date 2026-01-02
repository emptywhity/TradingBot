const TOKEN_KEY = 'fsd.auth.token';

export function getBackendUrl(): string {
  const raw = import.meta.env.VITE_BACKEND_URL ?? '';
  return raw.replace(/\/$/, '');
}

export function getAuthToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string | null) {
  if (typeof localStorage === 'undefined') return;
  if (!token) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, token);
}

export async function apiFetch(path: string, init?: RequestInit) {
  const url = `${getBackendUrl()}${path}`;
  const headers = new Headers(init?.headers ?? {});
  const token = getAuthToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}
