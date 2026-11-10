// 取消信号与超时信号取交集；旧版 Node 没有 AbortSignal.any 时退回纯超时
export function timeoutSignal(ms, signal) {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([timeout, signal]);
  return timeout;
}
