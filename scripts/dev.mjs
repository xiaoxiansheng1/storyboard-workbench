import { spawn } from 'node:child_process';
import process from 'node:process';
import { createServer } from 'vite';

const node = spawn(process.execPath, ['--watch', 'server/index.mjs'], {
  stdio: 'inherit',
  env: process.env,
});

node.on('exit', (code) => {
  if (code && code !== 0) {
    console.error(`[server] exited with code ${code}`);
    process.exitCode = code;
  }
});

const vite = await createServer({ configFile: 'web/vite.config.ts' });
await vite.listen();

const shutdown = async () => {
  await vite.close().catch(() => {});
  node.kill();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
