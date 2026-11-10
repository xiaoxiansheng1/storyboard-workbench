import fs from 'node:fs';
import path from 'node:path';
import { emptyRun } from './hash.mjs';
import { normalizeAudioData } from './audio.mjs';
import { readJsonSafe, writeJsonAtomic } from './utils/json-file.mjs';

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
  };
}

function normalize(data) {
  const base = blank();
  const merged = { ...base, ...data };
  merged.meta = { ...base.meta, ...(data.meta || {}) };
  // 旧版本按项目记录用量，现在统一由 data/usage.json 管理
  delete merged.usage;
  merged.nodes = Array.isArray(data.nodes) ? data.nodes : [];
  merged.edges = Array.isArray(data.edges) ? data.edges : [];
  for (const node of merged.nodes) {
    node.data = node.data || {};
    if (node.type === 'audio') {
      normalizeAudioData(node.data);
      continue;
    }
    node.type = 'shot';
    node.data.run = { ...emptyRun(), ...(node.data.run || {}) };
    if (!Array.isArray(node.data.run.candidates)) node.data.run.candidates = [];
  }
  return merged;
}

export class Store {
  #pending = false;
  #timer = null;
  #byId = new Map();
  #disposed = false;

  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'project.json');
    this.assetsDir = path.join(dir, 'assets');
    fs.mkdirSync(this.assetsDir, { recursive: true });
    this.data = this.#load();
    this.#reindex();
    this.#recoverInterrupted();
    this.#syncLatestSelection();
  }

  #reindex() {
    this.#byId = new Map(this.data.nodes.map((node) => [node.id, node]));
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
    return readJsonSafe(this.file, blank(), normalize);
  }

  // 高频调用（拖拽、生成进度）合并成一次落盘，避免反复全量重写阻塞事件循环
  save() {
    if (this.#disposed) return;
    this.#pending = true;
    if (this.#timer) return;
    this.#timer = setTimeout(() => this.flush(), 150);
    this.#timer.unref?.();
  }

  flush() {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    if (this.#disposed || !this.#pending) return;
    this.#pending = false;
    writeJsonAtomic(this.file, this.data, false);
  }

  // 项目目录被移走后不能再落盘，否则会在原路径重建目录
  dispose() {
    this.#disposed = true;
    this.#pending = false;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  node(id) {
    return this.#byId.get(id) || null;
  }

  addNode(node) {
    this.data.nodes.push(node);
    this.#byId.set(node.id, node);
    this.save();
  }

  saveNode(node) {
    const idx = this.data.nodes.findIndex((n) => n.id === node.id);
    if (idx >= 0) this.data.nodes[idx] = node;
    this.#byId.set(node.id, node);
    this.save();
  }

  removeNode(id) {
    const idx = this.data.nodes.findIndex((node) => node.id === id);
    if (idx < 0) return null;
    const [node] = this.data.nodes.splice(idx, 1);
    this.#byId.delete(id);
    this.save();
    return node;
  }

  replaceProject({ nodes, edges, meta }) {
    this.data.nodes = nodes;
    this.data.edges = edges;
    this.data.meta = { ...this.data.meta, ...meta };
    this.#reindex();
    this.save();
  }
}
