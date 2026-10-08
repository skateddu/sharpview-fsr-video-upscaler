// Shared helpers for the browser tests (render-test, e2e, ui-test).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.webm': 'video/webm',
  '.map': 'application/json',
};

/**
 * Static HTTP server on a free port. `files` maps URL paths to files, or is a directory
 * served as is ("/" → index.html). Resolves to the server and its base URL.
 */
export async function serve(files, host = 'localhost') {
  const resolve = typeof files === 'string' ? (path) => join(files, path === '/' ? 'index.html' : path) : (path) => files[path];
  const server = createServer(async (req, res) => {
    const file = resolve(new URL(req.url, 'http://x').pathname);
    try {
      if (!file) throw new Error('not found');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, host === 'localhost' ? undefined : host, r));
  return { server, base: `http://${host}:${server.address().port}/` };
}

/**
 * Collects the page's errors that come from our code (served from `base`): in this
 * environment an external script throws stack-less exceptions in test pages, which are ignored.
 */
export function trackErrors(page, base) {
  const errors = [];
  page.on('pageerror', (e) => e.stack?.includes(base) && errors.push(e.stack));
  page.on('console', (m) => m.type() === 'error' && m.location().url.startsWith(base) && errors.push(m.text()));
  return errors;
}

/** Check list printed at the end; the exit code reports failures. */
export function reporter() {
  const results = [];
  let failed = false;
  return {
    expect(name, ok, detail = '') {
      results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
      if (!ok) failed = true;
    },
    /** Line in the results that is not a check (e.g. a skipped one). */
    note(text) {
      results.push(text);
    },
    /** Prints the results, runs the cleanups and exits. */
    async finish(...cleanups) {
      console.log(results.join('\n'));
      for (const c of cleanups) await c();
      process.exit(failed ? 1 : 0);
    },
  };
}
