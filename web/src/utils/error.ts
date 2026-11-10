import type { ApiError } from '../api';

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** api() 抛出的错误会挂上整个响应体，用于读取 error 之外的附加字段。 */
export function errorPayload<T = Record<string, unknown>>(error: unknown): T | null {
  const payload = (error as ApiError | null | undefined)?.payload;
  return (payload ?? null) as T | null;
}
