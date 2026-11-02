import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The public site: a landing page with two doors, streamer onboarding, and the
 * sponsor's report verifier. A static build for GitHub Pages, separate from the
 * local app, which it never bundles.
 *
 * The built pages carry a Content-Security-Policy that forbids every request
 * after load (`connect-src 'none'`), so "nothing is uploaded" is enforced by
 * the browser, not promised. Vite's dev server injects inline scripts the
 * policy would block, so it is added to the build only.
 */
const POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'site-content-security-policy',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${POLICY}" />`),
  };
}

export default defineConfig({
  root: 'site',
  // Relative, so the site works under idl3o.github.io/sponsifer/ or anywhere else.
  base: './',
  plugins: [react(), contentSecurityPolicy()],
  // The verifier's code lives in src/site, beside the tests, outside this root.
  server: { port: 5190, fs: { allow: ['..'] } },
  build: {
    outDir: '../dist-site',
    emptyOutDir: true,
    // The preload polyfill is a fetch of the site's own chunks. The pages have none to preload, and a
    // page that says it sends nothing should hold no request at all.
    modulePreload: { polyfill: false },
    rollupOptions: { input: { index: 'site/index.html', streamers: 'site/streamers.html', verify: 'site/verify.html' } },
  },
});
