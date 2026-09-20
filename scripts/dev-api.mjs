// Run the workspace API beside `npm run dev`, from this checkout.
//
// Vite serves the app on localhost:5180 and proxies /api to 127.0.0.1:5181,
// where this starts `sponsifer serve --api-only`. It uses the repo's .venv
// when there is one, and reads the package from python/ without installing it.
// Extra arguments pass through, e.g. `npm run dev:api -- --workspace scratch.json`.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const venv = process.platform === 'win32' ? join('.venv', 'Scripts', 'python.exe') : join('.venv', 'bin', 'python');
const python = existsSync(venv) ? venv : 'python';
const args = [
  '-m', 'sponsifer', 'serve', '--api-only', '--port', '5181', '--no-browser',
  '--allow-origin', 'http://localhost:5180',
  ...process.argv.slice(2),
];
const env = {
  ...process.env,
  PYTHONPATH: ['python', process.env.PYTHONPATH].filter(Boolean).join(delimiter),
  PYTHONUTF8: '1',
};

const child = spawn(python, args, { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
