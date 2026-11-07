import fs from 'node:fs';
import path from 'node:path';
import { emptyRun } from './hash.mjs';

function todayKey(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function blank() {
  return {
    version: 1,
    meta: {
      name: '未命名分镜',
      sourceFile: null,
      importedAt: null,
      createdAt: new Date().toISOString(),
      stats: null,
    },
    nodes: [],
    edges: [],
    usage: { date: todayKey(), count: 0 },
  };
}

function normalize(data) {
  const base = blank();
  const merged = { ...base, ...data };
  merged.meta = { ...base.meta, ...(data.meta || {}) };
  merged.usage = { ...base.usage, ...(data.usage || {}) };
  merged.nodes = Array.isArray(data.nodes) ? data.nodes : [];
  merged.edges = Array.isArray(data.edges) ? data.edges : [];
  for (const node of merged.nodes) {
    node.data = node.data || {};
    node.data.run = { ...emptyRun(), ...(node.data.run || {}) };
    if (!Array.isArray(node.data.run.candidates)) node.data.run.candidates = [];
  }
  return merged;
}

export class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'project.json');
    this.assetsDir = path.join(dir, 'assets');
    fs.mkdirSync(this.assetsDir, { recursive: true });
    this.data = this.#load();
    this.#recoverInterrupted();
    this.#syncLatestSelection();
  }

  // 单图模式下节点展示最新一次生成结果，修正历史遗留的旧选中项
  #syncLatestSelection() {
    let changed = 0;
    for (const node of this.data.nodes) {
      const run = node.data?.run;
      const latest = run?.candidates?.[run.candidates.length - 1];
      if (latest && run.selectedId !== latest.id) {
        run.selectedId = latest.id;
        changed += 1;
      }
    }
    if (changed) this.save();
  }

  #recoverInterrupted() {
    let recovered = 0;
    for (const node of this.data.nodes) {
      const run = node.data?.run;
      if (run && (run.status === 'queued' || run.status === 'running')) {
        run.status = 'error';
        run.error = '服务重启，任务已中断，请重新生成';
        run.progress = null;
        run.updatedAt = new Date().toISOString();
        recovered += 1;
      }
    }
    if (recovered) this.save();
  }

  #load() {
    try {
      return normalize(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      return blank();
    }
  }

  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  usageCount() {
    const today = todayKey();
    if (this.data.usage.date !== today) {
      this.data.usage = { date: today, count: 0 };
      this.save();
    }
    return this.data.usage.count;
  }

  bumpUsage(n = 1) {
    this.usageCount();
    this.data.usage.count += n;
    this.save();
  }

  resetUsage() {
    this.data.usage = { date: todayKey(), count: 0 };
    this.save();
    return 0;
  }

  node(id) {
    return this.data.nodes.find((n) => n.id === id) || null;
  }

  saveNode(node) {
    const idx = this.data.nodes.findIndex((n) => n.id === node.id);
    if (idx >= 0) this.data.nodes[idx] = node;
    this.save();
  }

  replaceProject({ nodes, edges, meta }) {
    this.data.nodes = nodes;
    this.data.edges = edges;
    this.data.meta = { ...this.data.meta, ...meta };
    this.save();
  }
}
