export function roundTo(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/** 并发数、批量上限这类整数限制的取整钳制。 */
export function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

/** 两位补零；null/undefined 返回空串，避免把 "undefined" 写进文件名或图注。 */
export function pad2(value) {
  return String(value ?? '').padStart(2, '0');
}
