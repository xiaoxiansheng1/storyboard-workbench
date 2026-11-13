import { spawn } from 'node:child_process';
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';

// 不用 node --watch：Windows 上杀毒/索引服务读取刚加载的模块文件会触发 fs.watch
// 假事件，服务在没有任何文件变动时也会被重启、切断 SSE。这里自己盯 mtime，
// 只有真实修改才重启；进程意外退出时记录 code/signal 并自动拉起。
const serverDir = path.resolve('server');
const mtimes = new Map();

function collectMtimes(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectMtimes(full);
    else if (entry.name.endsWith('.mjs')) {
      try {
        mtimes.set(full, fs.statSync(full).mtimeMs);
      } catch {}
    }
  }
}
collectMtimes(serverDir);

let child = null;
let shuttingDown = false;
let fastExits = 0;

function startServer() {
  if (shuttingDown) return;
  const born = Date.now();
  child = spawn(process.execPath, ['server/index.mjs'], {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', (code, signal) => {
    child = null;
    if (shuttingDown) return;
    if (Date.now() - born > 30000) fastExits = 0;
    else fastExits += 1;
    const delay = Math.min(1000 * 2 ** Math.max(0, fastExits - 1), 10000);
    console.error(
      `[dev] 服务器进程退出 (code=${code}, signal=${signal ?? '无'})，${Math.round(delay / 1000)} 秒后重启`,
    );
    setTimeout(startServer, delay);
  });
}

function restartServer(file) {
  console.log(`[dev] 服务端文件变化，重启：${file}`);
  if (child) {
    const dying = child;
    child = null;
    dying.removeAllListeners('exit');
    dying.once('exit', startServer);
    dying.kill();
  } else {
    startServer();
  }
}

fs.watch(serverDir, { recursive: true }, (event, file) => {
  if (!file?.endsWith('.mjs')) return;
  const full = path.join(serverDir, file);
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    return;
  }
  const prev = mtimes.get(full);
  if (prev === stat.mtimeMs) return;
  mtimes.set(full, stat.mtimeMs);
  restartServer(file);
});

startServer();

const vite = await createServer({ configFile: 'web/vite.config.ts' });
await vite.listen();

const shutdown = async () => {
  shuttingDown = true;
  await vite.close().catch(() => {});
  child?.kill();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
