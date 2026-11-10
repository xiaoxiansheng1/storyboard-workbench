import fs from 'node:fs';

/** 读 JSON：文件缺失、内容损坏或清洗抛错时返回 fallback。map 在 try 内执行，清洗失败也当作读不到。 */
export function readJsonSafe(file, fallback = null, map = (value) => value) {
  try {
    return map(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return fallback;
  }
}

/** 先写临时文件再改名，避免进程中断留下半份 JSON。 */
export function writeJsonAtomic(file, data, pretty = true) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, pretty ? 2 : undefined), 'utf8');
  fs.renameSync(tmp, file);
}
