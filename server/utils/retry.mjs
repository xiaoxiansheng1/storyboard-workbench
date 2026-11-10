export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

const RETRYABLE =
  /HTTP (5\d\d|429)|fetch failed|network|timeout|aborted|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i;

export function isRetryable(error) {
  return RETRYABLE.test(String(error?.message || error));
}

/** 仅用于幂等的轮询 GET；创建任务的 POST 不重试，避免重复扣积分 */
export async function withRetry(fn, attempts = 2) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      if (i === attempts - 1 || !isRetryable(error)) throw error;
      await delay(500 * (i + 1));
    }
  }
  throw last;
}
