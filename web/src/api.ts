export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (!res.ok) {
    const message = (json as { error?: string } | null)?.error || `HTTP ${res.status}`;
    const error = new Error(message) as Error & { payload?: unknown };
    error.payload = json;
    throw error;
  }
  return json as T;
}
