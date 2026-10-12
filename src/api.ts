let csrfToken = '';
export function setCsrf(token: string) {
  csrfToken = token;
}
export class APIError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal; keepalive?: boolean } = {},
): Promise<T> {
  const response = await fetch('/api' + path, {
    method: options.method || 'GET',
    credentials: 'same-origin',
    signal: options.signal,
    keepalive: options.keepalive,
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/me' && path !== '/auth/login')
      window.dispatchEvent(new Event('krona:auth-expired'));
    const details = data.details
      ?.map((d: any) => `${d.field || 'Input'}: ${d.message}`)
      .join(' · ');
    throw new APIError(
      response.status,
      data.error || 'REQUEST_FAILED',
      details || data.message || 'The request could not be completed.',
    );
  }
  return data;
}
export function refresh() {
  window.dispatchEvent(new Event('krona:refresh'));
}
export async function exportData() {
  const data = await api('/data/export');
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'krona-personal-data.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
