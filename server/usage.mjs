import fs from 'node:fs';
import path from 'node:path';
import { dayKey } from './utils/time.mjs';

// 所有项目共享同一份每日计数，避免每个项目各自拥有完整额度
export class Usage {
  #pending = false;
  #timer = null;

  constructor(dataDir) {
    this.file = path.join(dataDir, 'usage.json');
    this.data = this.#load();
  }

  #load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && typeof raw.date === 'string' && Number.isFinite(raw.count)) {
        return { date: raw.date, count: Math.max(0, Math.trunc(raw.count)) };
      }
    } catch {
      // 文件不存在或损坏时从零开始
    }
    return { date: dayKey(), count: 0 };
  }

  #roll() {
    const today = dayKey();
    if (this.data.date !== today) {
      this.data = { date: today, count: 0 };
      this.save();
    }
  }

  count() {
    this.#roll();
    return this.data.count;
  }

  bump(n = 1) {
    this.#roll();
    this.data.count += n;
    this.save();
  }

  reset() {
    this.data = { date: dayKey(), count: 0 };
    this.save();
    return 0;
  }

  save() {
    this.#pending = true;
    if (this.#timer) return;
    this.#timer = setTimeout(() => this.#flush(), 200);
    this.#timer.unref?.();
  }

  #flush() {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    if (!this.#pending) return;
    this.#pending = false;
    const tmp = `${this.file}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(this.data), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch {
      // 计数落盘失败不阻塞生成，下次 bump 会重试
    }
  }
}
