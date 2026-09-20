// Copy the built web app into the Python package, so one `pipx install`
// carries both the app and the CLI. Run via `npm run bundle`.
import { cpSync, existsSync, rmSync } from 'node:fs';

const target = 'python/sponsifer/web';
if (!existsSync('dist/index.html')) {
  console.error('dist/ is missing. Run `npm run build` first.');
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
cpSync('dist', target, { recursive: true });
console.log(`Bundled dist/ into ${target}.`);
