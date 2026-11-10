type StoreKind = 'local' | 'session';

function store(kind: StoreKind): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    // 浏览器禁用存储时（隐私模式）当作不可用
    return null;
  }
}

/** 读取并解析存储里的 JSON，缺失或损坏统一返回 null。 */
export function readStoredJson<T>(kind: StoreKind, key: string): T | null {
  try {
    const raw = store(kind)?.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeStoredJson(kind: StoreKind, key: string, value: unknown): void {
  try {
    void store(kind)?.setItem(key, JSON.stringify(value));
  } catch {
    // 配额不足或存储不可用，静默忽略
  }
}
