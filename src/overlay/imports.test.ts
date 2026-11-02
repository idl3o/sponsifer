/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

/**
 * The overlay and the dock never load the pricing engine. They read only the
 * stream's part of the workspace (`stage.ts`), so a pricing field the app
 * cannot read never blanks what is on stream, and a page OBS loads stays small.
 *
 * Walks the runtime imports from each entry, skipping `import type`, which
 * the compiler erases. The sources come through Vite, so the walk needs no
 * file system.
 */

// Root-relative, so every key names its file the same way, this folder's included.
const SOURCES = Object.fromEntries(
  Object.entries(import.meta.glob<string>('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }))
    .map(([path, text]) => [path.replace(/^\/src\//, ''), text]),
);
const IMPORT = /^import\s+(?!type\s)[^'"]*?['"](\.[^'"]+)['"]/gm;

/** A relative import's target, from the importing file, both relative to src/. */
function target(from: string, spec: string): string | undefined {
  const parts = from.split('/').slice(0, -1);
  for (const segment of spec.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.') parts.push(segment);
  }
  const base = parts.join('/');
  return [`${base}.ts`, `${base}.tsx`].find((path) => path in SOURCES);
}

function runtimeGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const match of (SOURCES[file] ?? '').matchAll(IMPORT)) {
      const found = target(file, match[1] ?? '');
      if (found) visit(found);
    }
  };
  visit(entry);
  return seen;
}

const PRICING = ['domain/workspace.ts', 'domain/pricing.ts', 'domain/benchmarks.ts', 'domain/board.ts', 'domain/deals.ts',
  'domain/pitch.ts', 'domain/scoring.ts', 'domain/mediakit.ts', 'domain/offer.ts', 'store/workspaceClient.ts', 'store/useStore.ts'];

it('finds the pricing side where it is, so an empty finding below means something', () => {
  const app = runtimeGraph('main.tsx');
  expect(PRICING.filter((file) => app.has(file))).toEqual(PRICING);
});

describe.each(['overlay/main.tsx', 'dock/main.tsx'])('%s', (entry) => {
  it('loads nothing from the pricing side', () => {
    const graph = runtimeGraph(entry);
    expect(graph.has('domain/stage.ts')).toBe(true);
    expect(PRICING.filter((file) => graph.has(file))).toEqual([]);
  });
});
