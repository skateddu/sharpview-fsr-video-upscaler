import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { evalRpn, parseHooks } from '../../src/core/mpv-hooks.ts';

const SHADERS = 'src/core/shaders/anime4k';

const sizes: Record<string, [number, number]> = { OUTPUT: [2560, 1440], MAIN: [1920, 1080], NATIVE: [1920, 1080] };
const size = (tex: string, dim: 'w' | 'h') => sizes[tex][dim === 'w' ? 0 : 1];

test('RPN: sizes and arithmetic', () => {
  assert.equal(evalRpn('MAIN.w 2 *', size), 3840);
  assert.equal(evalRpn('OUTPUT.h 2 /', size), 720);
  assert.equal(evalRpn('MAIN.width MAIN.height -', size), 840);
});

test('RPN: comparisons give 1 or 0, as in mpv', () => {
  // Upscale_CNN_x2: runs when the output is more than 1.2 times the image.
  assert.equal(evalRpn('OUTPUT.w MAIN.w / 1.200 > OUTPUT.h MAIN.h / 1.200 > *', size), 1);
  assert.equal(evalRpn('OUTPUT.w NATIVE.w / 2.4 > OUTPUT.h NATIVE.h / 2.4 > *', size), 0);
  assert.equal(evalRpn('1 2 = !', size), 1);
});

test('RPN: malformed expressions are rejected', () => {
  assert.throws(() => evalRpn('MAIN.w *', size));
  assert.throws(() => evalRpn('1 2', size));
  assert.throws(() => evalRpn('1 2 %', size));
});

test('parser: directives, bindings and code of each pass', () => {
  const passes = parseHooks(`// license
//!DESC First
//!HOOK MAIN
//!BIND HOOKED
//!SAVE A
//!WIDTH MAIN.w 2 *
//!COMPONENTS 1
vec4 hook() { return HOOKED_tex(HOOKED_pos); }

//!DESC Second
//!HOOK MAIN
//!BIND MAIN
//!BIND A
//!WHEN OUTPUT.w MAIN.w >
vec4 hook() { return A_tex(A_pos); }
`);
  assert.equal(passes.length, 2);
  assert.deepEqual(
    { ...passes[0], body: undefined },
    { desc: 'First', hook: 'MAIN', binds: ['HOOKED'], save: 'A', width: 'MAIN.w 2 *', height: null, when: null, components: 1, body: undefined },
  );
  assert.match(passes[0].body, /HOOKED_tex/);
  assert.doesNotMatch(passes[0].body, /Second/);
  assert.deepEqual(passes[1].binds, ['MAIN', 'A']);
  assert.equal(passes[1].save, null);
  assert.equal(passes[1].when, 'OUTPUT.w MAIN.w >');
});

test('parser: unknown directives and passes without hook() are rejected', () => {
  assert.throws(() => parseHooks('//!HOOK MAIN\n//!TEXTURE LUT\nvec4 hook() {}'), /TEXTURE/);
  assert.throws(() => parseHooks('//!DESC Empty\n//!HOOK MAIN\nvoid main() {}'), /Empty/);
});

test('Anime4K shaders: every pass parses and its sizes evaluate', () => {
  const files = readdirSync(SHADERS).filter((f) => f.endsWith('.glsl'));
  assert.ok(files.length >= 5);
  for (const file of files) {
    const passes = parseHooks(readFileSync(`${SHADERS}/${file}`, 'utf8'));
    assert.ok(passes.length > 0, file);
    for (const p of passes) {
      assert.ok(['MAIN', 'PREKERNEL'].includes(p.hook), `${file}: ${p.desc} hooks ${p.hook}`);
      // Saved textures are at the source size here: enough to check that the expressions are valid.
      const any = (tex: string, dim: 'w' | 'h') => (sizes[tex] ?? sizes.MAIN)[dim === 'w' ? 0 : 1];
      for (const expr of [p.width, p.height, p.when]) if (expr) assert.ok(Number.isFinite(evalRpn(expr, any)), `${file}: ${expr}`);
    }
  }
});
