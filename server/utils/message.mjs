/** 任务循环里写 error 字段的统一取法。 */
export function messageOf(error) {
  return error?.message || String(error);
}

/** provider 返回体里的人类可读错误，依次尝试 error / error.message / message / detail。 */
export function errorText(json, text) {
  if (typeof json?.error === 'string') return json.error;
  if (json?.error?.message) return json.error.message;
  if (json?.message) return json.message;
  if (typeof json?.detail === 'string') return json.detail;
  return String(text ?? '').slice(0, 300);
}
