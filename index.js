import { spawn } from 'child_process';

console.log('[Bootstrap] Starting backend server via tsx...');

const child = spawn('npx', ['tsx', 'src/index.ts'], {
  stdio: 'inherit',
  shell: true,
  env: process.env
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
