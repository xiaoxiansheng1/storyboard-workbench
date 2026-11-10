import crypto from 'node:crypto';

/** 前缀-时间戳36进制-随机hex，项目 id 与音频节点 id 共用同一形状。 */
export function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}
