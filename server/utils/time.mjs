import { pad2 } from './num.mjs';

/** 导出文件名用的 20260115-183042 时间戳。 */
export function fileTimestamp(date) {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(
    date.getHours(),
  )}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

/** 每日用量计数用的 YYYY-MM-DD 键。 */
export function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}
