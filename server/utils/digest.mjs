import crypto from 'node:crypto';

/** 提示词指纹与音频文本指纹共用：sha1 取前 12 位。 */
export function sha1Short(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 12);
}
