/**
 * HTTP transport for the Ritkey SDK.
 *
 * Wraps `fetch` with:
 *   - default headers (Authorization + content-type)
 *   - per-request timeout (AbortController)
 *   - JSON serialization/parsing
 *   - rich error type that captures status, code, and parsed body
 */

import { RitkeyError, type RitkeyClientConfig } from './types.js';

type Fetcher = typeof fetch;

export class HttpTransport {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: Fetcher;
  private readonly timeoutMs: number;

  constructor(config: RitkeyClientConfig) {
    if (!config.baseUrl) throw new Error('RitkeyClient: baseUrl is required');
    // Strip trailing slash so path joins are simple.
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.fetchImpl = (config.fetch ?? globalThis.fetch).bind(globalThis);
    this.timeoutMs = config.timeoutMs ?? 30_000;

    if (typeof this.fetchImpl !== 'function') {
      throw new Error(
        'RitkeyClient: no fetch implementation available. Use Node 18+ or pass `fetch` in the config.'
      );
    }
  }

  async request<T = unknown>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    opts?: { timeoutMs?: number }
  ): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs ?? this.timeoutMs);

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err: any) {
      clearTimeout(timeout);
      if (err?.name === 'AbortError') {
        throw new RitkeyError(0, `Request timed out after ${opts?.timeoutMs ?? this.timeoutMs}ms`, null);
      }
      throw new RitkeyError(0, err?.message ?? 'Network error', null);
    }
    clearTimeout(timeout);

    // 204 No Content
    if (res.status === 204) return undefined as unknown as T;

    // Parse JSON (may be empty string).
    const text = await res.text();
    let parsed: any = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // Server returned non-JSON. Surface as a string body on the error.
        if (!res.ok) {
          throw new RitkeyError(res.status, `HTTP ${res.status}: ${text.slice(0, 200)}`, text);
        }
        return text as unknown as T;
      }
    }

    if (!res.ok) {
      const message =
        (parsed && typeof parsed === 'object' && (parsed.error ?? parsed.message)) ||
        `HTTP ${res.status}`;
      const code = parsed && typeof parsed === 'object' ? parsed.code : undefined;
      throw new RitkeyError(res.status, String(message), parsed, code);
    }

    return parsed as T;
  }
}
