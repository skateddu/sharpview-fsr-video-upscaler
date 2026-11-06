import { evalRpn, parseHooks, type HookPass } from './mpv-hooks';

/** A texture with its size, as passes see it. */
export interface Image {
  tex: WebGLTexture;
  w: number;
  h: number;
}

/** Render target owned by the pipeline, reused from frame to frame while its size does not change. */
interface Target extends Image {
  fbo: WebGLFramebuffer;
  components: number;
}

interface Pass extends HookPass {
  /** Real textures read, in sampler order (HOOKED is MAIN). */
  inputs: string[];
  program: WebGLProgram | null;
  /** Locations of each input's size and of the output size. */
  loc: { sizes: (WebGLUniformLocation | null)[]; out: WebGLUniformLocation | null } | null;
  /** Pool key of the target this pass writes, for the passes replacing MAIN. */
  mainKey: string;
}

export interface PipelineResult {
  /** Final image before scaling to the output. */
  main: Image;
  /** Textures saved by the passes, by name (e.g. STATSMAX for Clamp_Highlights). */
  saved: ReadonlyMap<string, Image>;
}

const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** First texture unit used for inputs; the ones below belong to the caller (the raw source). */
const FIRST_UNIT = 1;

/**
 * Runs mpv user shaders (the "hook" format of Anime4K) on WebGL2, as mpv would at the MAIN
 * stage: every pass reads the textures it binds and saves its result under a name, or replaces
 * MAIN. OUTPUT is the final size and NATIVE the input's, for the WHEN conditions and the sizes.
 * Intermediate textures are half float (EXT_color_buffer_float is required). PREKERNEL passes
 * are not run: the caller applies them while scaling to the output.
 * Programs are compiled the first time they are needed.
 */
export class HookPipeline {
  readonly passes: Pass[];
  private readonly pool = new Map<string, Target>();
  private readonly vert: WebGLShader;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    sources: readonly string[],
  ) {
    this.passes = sources.flatMap((src, file) =>
      parseHooks(src).map((p, i): Pass => {
        const inputs = [...new Set(p.binds.map((b) => (b === 'HOOKED' ? 'MAIN' : b)))];
        // MAIN is replaced several times at different sizes: one target for each pass writing it.
        return { ...p, inputs, program: null, loc: null, mainKey: `MAIN:${file}:${i}` };
      }),
    );
    this.vert = this.compile(gl.VERTEX_SHADER, VERT);
  }

  /**
   * Runs the MAIN passes on `input` for an output of outW × outH. Leaves the framebuffer and
   * the texture units from FIRST_UNIT on changed.
   */
  run(input: Image, outW: number, outH: number): PipelineResult {
    const gl = this.gl;
    const saved = new Map<string, Image>();
    let main: Image = input;
    const size = (name: string, dim: 'w' | 'h'): number => {
      const img = name === 'OUTPUT' ? { w: outW, h: outH } : name === 'NATIVE' ? input
        : name === 'MAIN' || name === 'HOOKED' ? main : saved.get(name);
      if (!img) throw new Error(`mpv shader: unknown texture ${name}`);
      return dim === 'w' ? img.w : img.h;
    };
    const get = (name: string, p: Pass): Image => {
      const img = name === 'MAIN' ? main : name === 'NATIVE' ? input : saved.get(name);
      if (!img) throw new Error(`mpv shader: ${p.desc} reads ${name}, which no pass has saved`);
      return img;
    };

    for (const p of this.passes) {
      if (p.hook !== 'MAIN') continue;
      if (p.when && !evalRpn(p.when, size)) continue;
      const w = Math.max(1, Math.round(p.width ? evalRpn(p.width, size) : main.w));
      const h = Math.max(1, Math.round(p.height ? evalRpn(p.height, size) : main.h));
      const inputs = p.inputs.map((n) => get(n, p));
      const writesMain = !p.save || p.save === 'MAIN';
      // Saved names are shared between shaders (conv2d_tf...), at the size of each use.
      let key = writesMain ? p.mainKey : `${p.save}@${w}x${h}`;
      // A pass may read the texture it saves (STATSMAX in Clamp_Highlights): write to its twin.
      if (inputs.some((img) => img.tex === this.pool.get(key)?.tex)) key += '#2';
      const target = this.target(key, w, h, p.components);
      this.draw(p, inputs, target);
      if (writesMain) main = target;
      else saved.set(p.save!, target);
    }
    return { main, saved };
  }

  /** Frees the textures (the programs stay, they are small). */
  release(): void {
    for (const t of this.pool.values()) {
      this.gl.deleteTexture(t.tex);
      this.gl.deleteFramebuffer(t.fbo);
    }
    this.pool.clear();
  }

  /** Compiles every program now, instead of at the first frame that needs it. */
  compileAll(): void {
    for (const p of this.passes) if (p.hook === 'MAIN') this.program(p);
  }

  private draw(p: Pass, inputs: Image[], target: Target): void {
    const gl = this.gl;
    const loc = this.program(p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.w, target.h);
    gl.useProgram(p.program);
    inputs.forEach((img, i) => {
      gl.activeTexture(gl.TEXTURE0 + FIRST_UNIT + i);
      gl.bindTexture(gl.TEXTURE_2D, img.tex);
      gl.uniform2f(loc.sizes[i], img.w, img.h);
    });
    gl.uniform2f(loc.out, target.w, target.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private target(key: string, w: number, h: number, components: number): Target {
    const gl = this.gl;
    let t = this.pool.get(key);
    if (t && t.w === w && t.h === h && t.components === components) return t;
    if (!t) {
      const tex = gl.createTexture()!;
      const fbo = gl.createFramebuffer()!;
      t = { tex, fbo, w: 0, h: 0, components };
      this.pool.set(key, t);
    }
    gl.activeTexture(gl.TEXTURE0 + FIRST_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    // Linear filtering: mpv samples every texture that way (the passes rely on it for MAIN and STATSMAX).
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (components === 1) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, w, h, 0, gl.RED, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    Object.assign(t, { w, h, components });
    return t;
  }

  private program(p: Pass): NonNullable<Pass['loc']> {
    if (p.loc) return p.loc;
    const gl = this.gl;
    const program = gl.createProgram()!;
    gl.attachShader(program, this.vert);
    gl.attachShader(program, this.compile(gl.FRAGMENT_SHADER, fragmentSource(p)));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Shader link failed (${p.desc}): ${gl.getProgramInfoLog(program)}`);
    }
    gl.useProgram(program);
    p.inputs.forEach((n, i) => gl.uniform1i(gl.getUniformLocation(program, `${n}_raw`), FIRST_UNIT + i));
    p.program = program;
    p.loc = {
      sizes: p.inputs.map((n) => gl.getUniformLocation(program, `${n}_size`)),
      out: gl.getUniformLocation(program, 'u_outSize'),
    };
    return p.loc;
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`Shader compilation failed: ${gl.getShaderInfoLog(shader)}`);
    }
    return shader;
  }
}

/**
 * GLSL ES 3.0 for a pass: mpv's helpers for every bound texture (NAME_tex, NAME_texOff,
 * NAME_pos, NAME_size, NAME_pt), then the pass's code and a main() calling hook(). All the
 * textures cover the same image, so the normalized position is the same for all of them.
 */
export function fragmentSource(p: Pick<HookPass, 'binds' | 'body'>): string {
  const names = new Set(p.binds);
  // mpv defines both names for the hooked image.
  if (names.has('HOOKED') || names.has('MAIN')) names.add('HOOKED').add('MAIN');
  const helpers = [...names].map((n) => {
    const raw = n === 'HOOKED' ? 'MAIN' : n;
    const decl = n === raw ? `uniform sampler2D ${raw}_raw;\nuniform vec2 ${raw}_size;\n` : `#define ${n}_size ${raw}_size\n`;
    return (
      decl +
      `#define ${n}_pos v_pos\n` +
      `#define ${n}_pt (1.0 / ${raw}_size)\n` +
      `#define ${n}_tex(pos) texture(${raw}_raw, pos)\n` +
      `#define ${n}_texOff(off) texture(${raw}_raw, v_pos + (off) / ${raw}_size)\n`
    );
  });
  return `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform vec2 u_outSize;
out vec4 fragColor;
vec2 v_pos;
${helpers.join('')}
${p.body}
void main() {
  v_pos = gl_FragCoord.xy / u_outSize;
  fragColor = hook();
}
`;
}
