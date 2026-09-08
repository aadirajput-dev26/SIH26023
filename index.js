import { spawn } from 'child_process';

console.log('[Bootstrap] Starting backend server via tsx...');

const child = spawn('npx', ['tsx', 'src/index.ts'], {
  stdio: 'inherit',
  shell: true,
  env: process.env
});

child.on('error', (err) => {
  console.error('[Bootstrap] Failed to spawn process:', err);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});

process.on('SIGTERM', () => {
  child.kill('SIGTERM');
});

process.on('SIGINT', () => {
  child.kill('SIGINT');
});
