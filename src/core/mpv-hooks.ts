// Parser for mpv user shaders ("hook" format), used by Anime4K. Pure logic, so node --test can import it.

/** One pass of an mpv user shader: the `//!` directives and the GLSL that follows them. */
export interface HookPass {
  desc: string;
  /** Stage the pass runs at: MAIN for the passes run here, PREKERNEL just before scaling to the output. */
  hook: string;
  /** Textures read by the pass. HOOKED is the image at the hooked stage, MAIN here. */
  binds: string[];
  /** Name the result is saved under; null replaces the hooked image. */
  save: string | null;
  /** Output size as RPN expressions; null keeps the size of the hooked image. */
  width: string | null;
  height: string | null;
  /** RPN condition: the pass is skipped when it evaluates to 0. */
  when: string | null;
  components: number;
  /** GLSL defining `vec4 hook()`. */
  body: string;
}

/** Splits an mpv user shader into its passes. Lines before the first directive (the license) are skipped. */
export function parseHooks(src: string): HookPass[] {
  const passes: HookPass[] = [];
  let pass: HookPass | null = null;
  let inHeader = false;
  for (const line of src.split(/\r?\n/)) {
    const m = /^\/\/!(\w+)\s*(.*?)\s*$/.exec(line);
    if (!m) {
      if (pass) {
        inHeader = false;
        pass.body += `${line}\n`;
      }
      continue;
    }
    if (!pass || !inHeader) {
      pass = { desc: '', hook: '', binds: [], save: null, width: null, height: null, when: null, components: 4, body: '' };
      passes.push(pass);
      inHeader = true;
    }
    const [, key, value] = m;
    switch (key) {
      case 'DESC':
        pass.desc = value;
        break;
      case 'HOOK':
        pass.hook = value;
        break;
      case 'BIND':
        pass.binds.push(value);
        break;
      case 'SAVE':
        pass.save = value;
        break;
      case 'WIDTH':
        pass.width = value;
        break;
      case 'HEIGHT':
        pass.height = value;
        break;
      case 'WHEN':
        pass.when = value;
        break;
      case 'COMPONENTS':
        pass.components = Number(value);
        break;
      default:
        throw new Error(`Unsupported mpv shader directive: //!${key}`);
    }
  }
  for (const p of passes) {
    if (!p.hook || !/\bhook\s*\(/.test(p.body)) throw new Error(`Incomplete mpv shader pass: ${p.desc || '(no name)'}`);
  }
  return passes;
}

/**
 * Evaluates an mpv RPN expression ("conv2d_tf.w 2 *", "OUTPUT.w MAIN.w / 1.2 >"). `size` gives
 * the width or height of a texture by name. Comparisons give 1 or 0, as in mpv.
 */
export function evalRpn(expr: string, size: (tex: string, dim: 'w' | 'h') => number): number {
  const stack: number[] = [];
  for (const tok of expr.trim().split(/\s+/)) {
    if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(tok)) {
      stack.push(Number(tok));
      continue;
    }
    const ref = /^(\w+)\.(w|h|width|height)$/.exec(tok);
    if (ref) {
      stack.push(size(ref[1], ref[2][0] as 'w' | 'h'));
      continue;
    }
    if (tok === '!') {
      if (!stack.length) throw new Error(`Invalid RPN expression: ${expr}`);
      stack.push(stack.pop() ? 0 : 1);
      continue;
    }
    const b = stack.pop();
    const a = stack.pop();
    if (a === undefined || b === undefined) throw new Error(`Invalid RPN expression: ${expr}`);
    switch (tok) {
      case '+': stack.push(a + b); break;
      case '-': stack.push(a - b); break;
      case '*': stack.push(a * b); break;
      case '/': stack.push(a / b); break;
      case '>': stack.push(a > b ? 1 : 0); break;
      case '<': stack.push(a < b ? 1 : 0); break;
      case '=': stack.push(a === b ? 1 : 0); break;
      default: throw new Error(`Unknown RPN operator "${tok}" in: ${expr}`);
    }
  }
  if (stack.length !== 1) throw new Error(`Invalid RPN expression: ${expr}`);
  return stack[0];
}
