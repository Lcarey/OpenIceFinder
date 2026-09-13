/** Browser-like headers: several rink sites (mass.gov, FMC) reject bare clients. */
export const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

export interface HttpOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  retries?: number;
}

export class HttpError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number,
    message?: string,
  ) {
    super(message ?? `HTTP ${status} for ${url}`);
    this.name = "HttpError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function httpFetch(url: string, options: HttpOptions = {}): Promise<Response> {
  const { method = "GET", headers = {}, body, timeoutMs = 25_000, retries = 2 } = options;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: { ...BROWSER_HEADERS, ...headers },
        body,
        signal: controller.signal,
        redirect: "follow",
      });
      if (res.status >= 500 || res.status === 429) {
        lastError = new HttpError(url, res.status);
      } else if (!res.ok) {
        throw new HttpError(url, res.status);
      } else {
        return res;
      }
    } catch (error) {
      if (error instanceof HttpError && error.status < 500 && error.status !== 429) throw error;
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) await sleep(500 * 2 ** attempt);
  }
  throw lastError instanceof Error ? lastError : new Error(`Request failed for ${url}`);
}

export async function fetchText(url: string, options: HttpOptions = {}): Promise<string> {
  const res = await httpFetch(url, options);
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") ?? "";
  const charsetMatch = contentType.match(/charset=([^;]+)/i);
  const charset = charsetMatch?.[1]?.trim().toLowerCase();
  if (charset && charset !== "utf-8" && charset !== "utf8") {
    try {
      return new TextDecoder(charset).decode(buf);
    } catch {
      /* fall through to utf-8 */
    }
  }
  return buf.toString("utf8");
}

export async function fetchJson<T>(url: string, options: HttpOptions = {}): Promise<T> {
  const res = await httpFetch(url, { ...options, headers: { Accept: "application/json", ...options.headers } });
  return (await res.json()) as T;
}

export async function fetchBinary(url: string, options: HttpOptions = {}): Promise<{ bytes: Buffer; contentType: string }> {
  const res = await httpFetch(url, options);
  return { bytes: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
}

export function formEncode(fields: Record<string, string | number | boolean>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}
