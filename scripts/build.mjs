// Builds the extension, the playground and the test harness.
//   --serve    watch + playground server
//   --release  package to publish: no diagnostic logs, no sourcemaps
import * as esbuild from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const serve = process.argv.includes('--serve');
const release = process.argv.includes('--release');

const common = {
  bundle: true,
  target: ['firefox140'],
  loader: { '.glsl': 'text' },
  sourcemap: !release,
  define: { __DEV__: JSON.stringify(!release) },
  // In the package, drop dead branches (the logs) but keep names readable for AMO review.
  minifySyntax: release,
  logLevel: 'info',
};

const extension = {
  ...common,
  entryPoints: {
    content: 'src/content/main.ts',
    background: 'src/background/main.ts',
    onboarding: 'src/onboarding/onboarding.ts',
  },
  outdir: 'dist/extension',
  format: 'iife',
};

// Extension pages: ES modules (they use top-level await).
const pages = {
  ...common,
  entryPoints: { popup: 'src/popup/popup.ts', options: 'src/options/options.ts' },
  outdir: 'dist/extension',
  format: 'esm',
};

// Content script logic without extension APIs, to inject into test pages.
const harness = {
  ...common,
  entryPoints: { harness: 'src/content/harness.ts' },
  outdir: 'dist/test',
  format: 'iife',
  sourcemap: false,
  define: { __DEV__: 'true' },
};

const playground = {
  ...common,
  entryPoints: ['playground/main.ts'],
  outfile: 'dist/playground/main.js',
  format: 'esm',
};

await rm('dist', { recursive: true, force: true });
await mkdir('dist/playground', { recursive: true });
await cp('extension', 'dist/extension', { recursive: true });
await cp('THIRD_PARTY_NOTICES.md', 'dist/extension/THIRD_PARTY_NOTICES.md');
await cp('playground/index.html', 'dist/playground/index.html');
await cp('playground/style.css', 'dist/playground/style.css');

if (serve) {
  for (const options of [extension, pages, harness]) await (await esbuild.context(options)).watch();
  const ctx = await esbuild.context(playground);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: 'dist/playground', port: 8080 });
  console.log(`\nPlayground: http://localhost:${port}/\n(static files are copied only at startup)`);
} else {
  await Promise.all((release ? [extension, pages] : [extension, pages, harness, playground]).map((o) => esbuild.build(o)));
}
