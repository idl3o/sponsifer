/**
 * The gate, as one command: typecheck, lint, vitest, pytest. Run before every
 * push, because a push is public and CI is the only other check there is.
 *
 * Each tool is run through its own entry point rather than through npm or a
 * shell, so the same command works on Windows and Linux and nothing is
 * interpolated into a command line. The first failure stops the run and is the
 * exit code.
 *
 * Usage: npm run check
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The repo's own venv, which has the test dependencies, or whatever `python` is on the PATH. */
function python() {
  const candidates = [join('.venv', 'Scripts', 'python.exe'), join('.venv', 'bin', 'python')];
  return candidates.find((path) => existsSync(path)) ?? 'python';
}

const GATES = [
  ['typecheck', process.execPath, [join('node_modules', 'typescript', 'bin', 'tsc'), '--noEmit']],
  ['lint', process.execPath, [join('node_modules', 'eslint', 'bin', 'eslint.js'), '.']],
  ['vitest', process.execPath, [join('node_modules', 'vitest', 'vitest.mjs'), 'run']],
  ['pytest', python(), ['-m', 'pytest', '-q']],
];

for (const [name, command, args] of GATES) {
  console.log(`\n== ${name}`);
  // One dependency's setup reads a file as cp1252 on Windows and dies without this.
  const result = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, PYTHONUTF8: '1' } });
  if (result.error) {
    console.error(`${name} could not be run: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\n${name} failed. Nothing should be pushed.`);
    process.exit(result.status ?? 1);
  }
}
console.log('\nAll four gates pass.');
