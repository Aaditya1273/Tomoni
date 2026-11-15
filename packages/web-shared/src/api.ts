'use client';
import type { ErrorBody } from '@tomoni/contracts';

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: ErrorBody,
  ) {
    super(body.message);
  }
}

function csrfToken(): string | undefined {
  return document.cookie
    .split('; ')
    .find((c) => c.startsWith('__Host-tomoni_csrf='))
    ?.split('=')[1];
}

/** Browser → same-origin /api. Sends the CSRF header on every unsafe method (SECURITY S9). */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const csrf = csrfToken();
  if (method !== 'GET' && csrf) headers['x-csrf-token'] = csrf;
  const res = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({ error: 'bad_response', message: 'Unexpected response.' }));
  if (!res.ok) throw new ApiError(res.status, json as ErrorBody);
  return json as T;
}
