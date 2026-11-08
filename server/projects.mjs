import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Store } from './store.mjs';
import { createJobs } from './jobs.mjs';
import { createExports } from './exports.mjs';
import { createAudioJobs } from './audio-jobs.mjs';
import { createAudioExports } from './audio-exports.mjs';

export const ID_PATTERN = /^p-[a-z0-9]{1,32}-[a-f0-9]{6}$/;
const NAME_MAX = 80;
const DEFAULT_NAME = '未命名项目';
const MIGRATION_MARKER = '.projects-migrated';

function newId() {
  return `p-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

function normalizeName(value) {
  const name = String(value ?? '').trim().slice(0, NAME_MAX);
  return name || DEFAULT_NAME;
}

function todayKey(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function namespaceUrl(value, kind, projectId) {
  if (typeof value !== 'string' || !value.startsWith(`/${kind}/`)) return value;
  const prefix = `/${kind}/${projectId}/`;
  if (value.startsWith(prefix)) return value;
  return `${prefix}${value.slice(kind.length + 2)}`;
}

function namespaceProjectUrls(project, projectId) {
  for (const node of Array.isArray(project.nodes) ? project.nodes : []) {
    const run = node.data?.run;
    for (const candidate of Array.isArray(run?.candidates) ? run.candidates : []) {
      candidate.url = namespaceUrl(candidate.url, 'assets', projectId);
    }
    const video = node.data?.video;
    if (video) {
      video.url = namespaceUrl(video.url, 'assets', projectId);
      video.posterUrl = namespaceUrl(video.posterUrl, 'assets', projectId);
    }
  }
  return project;
}

function moveInto(from, to) {
  if (!fs.existsSync(from) || fs.existsSync(to)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch {
    // 跨盘或被占用时退回复制，旧目录保留作为额外备份
    fs.cpSync(from, to, { recursive: true });
  }
  return true;
}

function summarize(id, dir, project) {
  const nodes = (Array.isArray(project.nodes) ? project.nodes : []).filter(
    (node) => node.type !== 'audio',
  );
  const ordered = [...nodes].sort(
    (a, b) =>
      Number(a.data?.startSec) - Number(b.data?.startSec) ||
      Number(a.data?.no) - Number(b.data?.no),
  );
  let generated = 0;
  let cover = null;
  for (const node of ordered) {
    const run = node.data?.run;
    const candidates = Array.isArray(run?.candidates) ? run.candidates : [];
    if (candidates.length) generated += 1;
    if (!cover) {
      const candidate =
        candidates.find((item) => item.id === run.selectedId) || candidates[candidates.length - 1];
      if (candidate?.url) cover = candidate.url;
      else if (node.data?.video?.posterUrl) cover = node.data.video.posterUrl;
    }
  }
  const stat = fs.statSync(path.join(dir, 'project.json'));
  return {
    id,
    name: project.meta?.name || DEFAULT_NAME,
    shots: nodes.length,
    generated,
    cover,
    sourceFile: project.meta?.sourceFile || null,
    createdAt: project.meta?.createdAt || stat.birthtime.toISOString(),
    updatedAt: stat.mtime.toISOString(),
  };
}

export class ProjectManager {
  constructor({ dataDir, config, getProvider, getAudioProvider, getVoice, broadcast }) {
    this.dataDir = dataDir;
    this.projectsDir = path.join(dataDir, 'projects');
    this.trashDir = path.join(dataDir, '.trash');
    this.backupDir = path.join(dataDir, '.backup');
    this.config = config;
    this.getProvider = getProvider;
    this.getAudioProvider = getAudioProvider;
    this.getVoice = getVoice;
    this.broadcast = broadcast;
    this.runtimes = new Map();
    fs.mkdirSync(this.projectsDir, { recursive: true });
    this.#migrateLegacy();
  }

  #migrateLegacy() {
    const legacyProject = path.join(this.dataDir, 'project.json');
    if (!fs.existsSync(legacyProject)) return;
    if (fs.existsSync(path.join(this.dataDir, MIGRATION_MARKER))) return;

    const id = newId();
    const dir = path.join(this.projectsDir, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(this.backupDir, { recursive: true });
    fs.copyFileSync(
      legacyProject,
      path.join(this.backupDir, `project-${Date.now().toString(36)}.json`),
    );
    moveInto(legacyProject, path.join(dir, 'project.json'));
    moveInto(path.join(this.dataDir, 'assets'), path.join(dir, 'assets'));
    moveInto(path.join(this.dataDir, 'exports'), path.join(dir, 'exports'));
    moveInto(path.join(this.dataDir, 'exports.json'), path.join(dir, 'exports.json'));

    const projectFile = path.join(dir, 'project.json');
    const project = readJson(projectFile, null);
    if (project) writeJson(projectFile, namespaceProjectUrls(project, id));

    const historyFile = path.join(dir, 'exports.json');
    const history = readJson(historyFile, null);
    if (Array.isArray(history)) {
      writeJson(
        historyFile,
        history.map((job) => ({ ...job, url: namespaceUrl(job.url, 'exports', id) })),
      );
    }

    fs.writeFileSync(
      path.join(this.dataDir, MIGRATION_MARKER),
      JSON.stringify({ id, at: new Date().toISOString() }, null, 2),
    );
    console.log(`[projects] 旧项目已迁移到 projects/${id}，原 project.json 备份在 .backup/`);
  }

  list() {
    const items = [];
    for (const name of fs.readdirSync(this.projectsDir)) {
      if (!ID_PATTERN.test(name)) continue;
      const dir = path.join(this.projectsDir, name);
      const file = path.join(dir, 'project.json');
      if (!fs.existsSync(file)) continue;
      const project = readJson(file, null);
      if (!project) continue;
      const runtime = this.runtimes.get(name);
      items.push(summarize(name, dir, runtime ? runtime.store.data : project));
    }
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return items;
  }

  summary(id) {
    const dir = this.#dir(id);
    if (!dir) return null;
    const file = path.join(dir, 'project.json');
    if (!fs.existsSync(file)) return null;
    const runtime = this.runtimes.get(id);
    const project = runtime ? runtime.store.data : readJson(file, null);
    if (!project) return null;
    return summarize(id, dir, project);
  }

  open(id) {
    const dir = this.#dir(id);
    if (!dir) return null;
    if (this.runtimes.has(id)) return this.runtimes.get(id);
    if (!fs.existsSync(path.join(dir, 'project.json'))) return null;

    const store = new Store(dir);
    const assetBase = `/assets/${id}`;
    const runtime = {
      id,
      dir,
      store,
      assetBase,
      jobs: createJobs({
        store,
        getProvider: this.getProvider,
        config: this.config,
        broadcast: this.broadcast,
        projectId: id,
        assetBase,
      }),
      exports: createExports({
        store,
        config: this.config,
        broadcast: this.broadcast,
        projectId: id,
        exportDir: path.join(dir, 'exports'),
        historyFile: path.join(dir, 'exports.json'),
      }),
      audioJobs: createAudioJobs({
        store,
        config: this.config,
        broadcast: this.broadcast,
        projectId: id,
        assetBase,
        getProvider: this.getAudioProvider,
        getVoice: this.getVoice,
      }),
      audioExports: createAudioExports({
        store,
        config: this.config,
        broadcast: this.broadcast,
        projectId: id,
        exportDir: path.join(dir, 'exports'),
        historyFile: path.join(dir, 'audio-exports.json'),
      }),
    };
    this.runtimes.set(id, runtime);
    return runtime;
  }

  openAll() {
    return this.list()
      .map((item) => this.open(item.id))
      .filter(Boolean);
  }

  create(name) {
    const id = newId();
    const dir = path.join(this.projectsDir, id);
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    const now = new Date().toISOString();
    const project = {
      version: 1,
      meta: {
        name: normalizeName(name),
        sourceFile: null,
        importedAt: null,
        createdAt: now,
        stats: null,
      },
      nodes: [],
      edges: [],
      usage: { date: todayKey(), count: 0 },
    };
    writeJson(path.join(dir, 'project.json'), project);
    return this.summary(id);
  }

  rename(id, name) {
    const dir = this.#dir(id);
    if (!dir) return null;
    const runtime = this.runtimes.get(id);
    if (runtime) {
      runtime.store.data.meta.name = normalizeName(name);
      runtime.store.save();
      runtime.store.flush();
    } else {
      const file = path.join(dir, 'project.json');
      const project = readJson(file, null);
      if (!project) return null;
      project.meta = { ...(project.meta || {}), name: normalizeName(name) };
      writeJson(file, project);
    }
    return this.summary(id);
  }

  remove(id) {
    const dir = this.#dir(id);
    if (!dir || !fs.existsSync(dir)) return null;

    const runtime = this.runtimes.get(id);
    if (runtime) {
      const active = runtime.exports.list().active;
      if (active) {
        try {
          runtime.exports.cancel(active.id);
        } catch {
          // 任务可能刚好结束
        }
      }
      runtime.jobs.close();
      runtime.exports.dispose();
      runtime.audioJobs.close();
      runtime.audioExports.dispose();
      runtime.store.flush();
      runtime.store.dispose();
      this.runtimes.delete(id);
    }

    fs.mkdirSync(this.trashDir, { recursive: true });
    const target = path.join(this.trashDir, `${id}-${Date.now().toString(36)}`);
    fs.renameSync(dir, target);
    return target;
  }

  flushAll() {
    for (const runtime of this.runtimes.values()) runtime.store.flush();
  }

  #dir(id) {
    if (!ID_PATTERN.test(String(id || ''))) return null;
    return path.join(this.projectsDir, id);
  }
}
