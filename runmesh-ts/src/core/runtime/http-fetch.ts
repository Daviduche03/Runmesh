/**
 * Outbound HTTP for server-side calls (webhooks, task steps, OAuth exchanges, tool proxying).
 * Port of runmesh-main/src/runtime/http_fetch.py, which adapted the Workers `fetch` to the
 * call shape the app already used: `await fetch(url, method=, headers=, body=)` then
 * `.status` / `await .text()`.
 */

const DEFAULT_TIMEOUT_MS = 30_000;

export class FetchResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: Headers;
  private readonly body: ArrayBuffer;

  constructor(response: Response, body: ArrayBuffer) {
    this.status = response.status;
    this.ok = response.ok;
    this.headers = response.headers;
    this.body = body;
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(this.body);
  }

  async json<T = unknown>(): Promise<T> {
    return JSON.parse(await this.text()) as T;
  }

  async bodyBytes(): Promise<Buffer> {
    return Buffer.from(this.body);
  }
}

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export async function fetch(url: string, options: FetchOptions = {}): Promise<FetchResponse> {
  const { method = "GET", headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  let payload: string | undefined;
  if (body !== undefined && body !== null) {
    payload = typeof body === "string" ? body : JSON.stringify(body);
  }

  const response = await globalThis.fetch(url, {
    method,
    headers,
    body: payload,
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const buffer = await response.arrayBuffer();
  return new FetchResponse(response, buffer);
}

/** Reserved for symmetry with Python's `http_fetch.close()`. Bun's fetch pool is managed
 *  by the runtime, so there is nothing to release explicitly. */
export async function close(): Promise<void> {
  // no-op
}
