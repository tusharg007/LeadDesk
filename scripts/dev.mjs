import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const children = [
  spawn(process.execPath, [require.resolve('tsx/cli'), 'watch', 'server/index.ts'], {
    stdio: 'inherit',
  }),
  spawn(
    process.execPath,
    [join(dirname(require.resolve('vite/package.json')), 'bin/vite.js'), '--host', '127.0.0.1'],
    { stdio: 'inherit' },
  ),
];
let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  children.forEach((child) => child.kill());
  process.exitCode = code;
}
children.forEach((child) => child.on('exit', (code) => close(code || 0)));
process.on('SIGINT', () => close());
process.on('SIGTERM', () => close());
