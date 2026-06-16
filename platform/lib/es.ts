const ELASTICSEARCH_URL = process.env.SELK_ELASTICSEARCH_URL ?? 'http://elasticsearch:9200';
const ELASTICSEARCH_USERNAME = process.env.SELK_ELASTICSEARCH_USERNAME ?? '';
const ELASTICSEARCH_PASSWORD = process.env.SELK_ELASTICSEARCH_PASSWORD ?? '';

function buildHeaders() {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (ELASTICSEARCH_USERNAME) {
    const credentials = Buffer.from(`${ELASTICSEARCH_USERNAME}:${ELASTICSEARCH_PASSWORD}`).toString('base64');
    headers.Authorization = `Basic ${credentials}`;
  }

  return headers;
}

function buildElasticsearchUrl(path: string) {
  const base = ELASTICSEARCH_URL.replace(/\/+$/, '');
  const normalizedPath = path.replace(/^\/+/, '');
  return `${base}/${normalizedPath}`;
}

export async function esRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildElasticsearchUrl(path), {
    ...init,
    headers: {
      ...buildHeaders(),
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(typeof payload?.error === 'object' ? JSON.stringify(payload.error) : text || `Request failed with ${response.status}`);
  }

  return payload as T;
}
