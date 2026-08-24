/**
 * Parses an API error body. The platform returns `{ message, code?, details? }`
 * as JSON on failures; non-JSON bodies (proxies, gateways, plain text) yield an
 * empty result so the caller falls back to the status line.
 */
function parseErrorBody(body: string): {
  message?: string;
  code?: string;
  details?: unknown;
} {
  try {
    const json: unknown = JSON.parse(body);
    if (json && typeof json === 'object') {
      const obj = json as Record<string, unknown>;
      return {
        message: typeof obj.message === 'string' ? obj.message : undefined,
        code: typeof obj.code === 'string' ? obj.code : undefined,
        details: obj.details,
      };
    }
  } catch {}
  return {};
}

/**
 * Reads `details.retryAfter` (seconds) from a parsed error body. The platform
 * puts it there on `RATE_LIMITED` responses so the value survives proxies that
 * strip the `Retry-After` header.
 */
function retryAfterFromDetails(details: unknown): number | undefined {
  if (!details || typeof details !== 'object') return undefined;
  const value = (details as Record<string, unknown>).retryAfter;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/**
 * Error thrown by {@link EngineServicesClient} when the platform API responds
 * with a non-2xx status. Exposes the HTTP `status` and — when the API returns a
 * structured JSON body — its `code` and `details`, so callers can react to
 * specific failures (e.g. `code === 'LIMIT_EXCEEDED'`) instead of string-
 * matching the message.
 *
 * @example
 * ```ts
 * try {
 *   await client.createComponent(props);
 * } catch (err) {
 *   if (err instanceof RequestError && err.code === 'LIMIT_EXCEEDED') {
 *     console.error(err.message); // "Components limit reached (10/10)..."
 *   }
 * }
 * ```
 *
 * @example Rate limiting
 * ```ts
 * catch (err) {
 *   if (err instanceof RequestError && err.status === 429) {
 *     console.log(err.code);       // "RATE_LIMITED"
 *     console.log(err.details);    // { limit, windowSeconds, retryAfter, scope }
 *     console.log(err.retryAfter); // seconds to wait before trying again
 *   }
 * }
 * ```
 */
export class RequestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;
  readonly body: string;

  /**
   * Seconds to wait before retrying, taken from the `Retry-After` header or
   * from `details.retryAfter`. Only present on rate-limited (429) responses.
   */
  readonly retryAfter?: number;

  constructor(
    status: number,
    statusText: string,
    body: string,
    retryAfter?: number,
  ) {
    const parsed = parseErrorBody(body);
    super(parsed.message ?? `${statusText || 'Request failed'} (${status})`);
    this.name = 'RequestError';
    this.status = status;
    this.code = parsed.code;
    this.details = parsed.details;
    this.body = body;
    this.retryAfter = retryAfter ?? retryAfterFromDetails(parsed.details);
  }
}
