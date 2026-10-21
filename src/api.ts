import type { SupabaseClient } from '@supabase/supabase-js';
export type Config = { mode: 'demo' | 'supabase'; supabaseUrl: string; supabaseKey: string };
let authClient: SupabaseClient | null = null;
export function setAuth(client: SupabaseClient) {
  authClient = client;
}
export async function api<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const token = authClient
    ? (await authClient.auth.getSession()).data.session?.access_token
    : undefined;
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('The server is temporarily unavailable. Please try again.');
  }
  if (!response.ok) throw new Error(data.error || 'The request failed. Please try again.');
  return data as T;
}
