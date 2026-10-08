import vertSrc from './shaders/fullscreen.vert.glsl';
import commonSrc from './shaders/common.glsl';
import bilinearSrc from './shaders/bilinear.frag.glsl';
import easuSrc from './shaders/easu.frag.glsl';
import rcasSrc from './shaders/rcas.frag.glsl';

import { DEFAULT_SHARPNESS, type UpscaleMode } from './modes';

export interface RenderOptions {
  mode: UpscaleMode;
  /** RCAS sharpening in percent (linear on the shader parameter): 100 = maximum, 0 = off. */
  sharpness: number;
  /** Reduces sharpening where RCAS detects noise. */
  denoise: boolean;
  /** Fraction (0..1) of the width shown with plain bilinear on the left, for comparison. < 0 disables. */
  split: number;
}

export const DEFAULT_OPTIONS: RenderOptions = {
  mode: 'fsr',
  sharpness: DEFAULT_SHARPNESS,
  denoise: true,
  split: -1,
};

const FRAG_HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

/** Uniforms set on every pass; the samplers (u_src, u_tex) are bound once per program. */
const UNIFORMS = ['u_outSize', 'u_flipY', 'u_split', 'u_inSize', 'u_sharpness', 'u_denoise'] as const;

type UniformName = (typeof UNIFORMS)[number];

interface Program {
  program: WebGLProgram;
  loc: Record<UniformName, WebGLUniformLocation | null>;
}

type ProgramName = 'bilinear' | 'easu' | 'rcas';

const SRC_UNIT = 0;
const MID_UNIT = 1;

/**
 * FSR1 upscaler on WebGL2. Draws `source` onto the canvas given to the constructor, at the
 * canvas's current resolution (canvas.width × canvas.height).
 */
export class Upscaler {
  readonly gl: WebGL2RenderingContext;
  readonly rendererName: string;
  /** Maximum output side (the GPU's texture limit). */
  readonly maxSize: number;

  private programs!: Record<ProgramName, Program>;
  private vao!: WebGLVertexArrayObject;
  private srcTex!: WebGLTexture;
  private midTex!: WebGLTexture;
  private midFbo!: WebGLFramebuffer;
  private srcW = 0;
  private srcH = 0;
  private midW = 0;
  private midH = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl;
    this.rendererName = String(gl.getParameter(gl.RENDERER));
    this.maxSize = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 8192);

    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    canvas.addEventListener('webglcontextrestored', () => this.init());
    this.init();
  }

  get contextLost(): boolean {
    return this.gl.isContextLost();
  }

  /**
   * Uploads the current frame of `source` and draws it onto the canvas.
   * Throws SecurityError if the source is cross-origin without CORS.
   */
  render(source: TexImageSource, srcW: number, srcH: number, opts: RenderOptions): void {
    const gl = this.gl;
    if (gl.isContextLost() || srcW === 0 || srcH === 0) return;
    const outW = gl.drawingBufferWidth;
    const outH = gl.drawingBufferHeight;
    const split = opts.split >= 0 ? opts.split * outW : -1;

    this.upload(source, srcW, srcH);
    gl.bindVertexArray(this.vao);

    const upscale: ProgramName = opts.mode === 'fsr' || opts.mode === 'easu' ? 'easu' : 'bilinear';
    // RCAS is skipped for the modes without it and at zero sharpening (it would change nothing).
    const sharpen = (opts.mode === 'fsr' || opts.mode === 'bilinear-rcas') && opts.sharpness > 0;
    if (!sharpen) {
      this.pass(upscale, null, outW, outH, split, opts);
      return;
    }
    this.ensureMid(outW, outH);
    this.pass(upscale, this.midFbo, outW, outH, -1, opts);
    this.pass('rcas', null, outW, outH, split, opts);
  }

  /**
   * Measures the average cost per frame (upload + passes) by rendering `frames` times.
   * readPixels forces synchronization with the GPU.
   */
  benchmark(source: TexImageSource, srcW: number, srcH: number, opts: RenderOptions, frames = 120): number {
    this.render(source, srcW, srcH, opts);
    this.finish();
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) this.render(source, srcW, srcH, opts);
    this.finish();
    return (performance.now() - t0) / frames;
  }

  dispose(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  /** Waits until the GPU has completed the submitted commands (by reading one pixel). */
  finish(): void {
    const px = new Uint8Array(4);
    this.gl.readPixels(0, 0, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, px);
  }

  private init(): void {
    const gl = this.gl;
    this.programs = {
      bilinear: this.link(bilinearSrc),
      easu: this.link(easuSrc),
      rcas: this.link(rcasSrc),
    };
    this.vao = gl.createVertexArray()!;
    this.srcTex = this.createTexture(gl.LINEAR);
    this.midTex = this.createTexture(gl.NEAREST);
    this.midFbo = gl.createFramebuffer()!;
    this.srcW = this.srcH = this.midW = this.midH = 0;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }

  private upload(source: TexImageSource, w: number, h: number): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + SRC_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    if (w !== this.srcW || h !== this.srcH) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
      this.srcW = w;
      this.srcH = h;
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    }
  }

  private ensureMid(w: number, h: number): void {
    if (w === this.midW && h === this.midH) return;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + MID_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, this.midTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.midFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.midTex, 0);
    this.midW = w;
    this.midH = h;
  }

  private pass(
    name: ProgramName,
    target: WebGLFramebuffer | null,
    outW: number,
    outH: number,
    split: number,
    opts: RenderOptions,
  ): void {
    const gl = this.gl;
    const { program, loc } = this.programs[name];
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, outW, outH);
    gl.useProgram(program);
    gl.uniform2f(loc.u_outSize, outW, outH);
    gl.uniform1i(loc.u_flipY, target === null ? 1 : 0);
    gl.uniform1f(loc.u_split, split);
    gl.uniform2f(loc.u_inSize, this.srcW, this.srcH);
    gl.uniform1f(loc.u_sharpness, Math.min(1, Math.max(0, opts.sharpness / 100)));
    gl.uniform1i(loc.u_denoise, opts.denoise ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private createTexture(filter: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private link(fragBody: string): Program {
    const gl = this.gl;
    const program = gl.createProgram()!;
    gl.attachShader(program, this.compile(gl.VERTEX_SHADER, vertSrc));
    gl.attachShader(program, this.compile(gl.FRAGMENT_SHADER, FRAG_HEADER + commonSrc + fragBody));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Shader link failed: ${gl.getProgramInfoLog(program)}`);
    }
    const loc = {} as Program['loc'];
    for (const name of UNIFORMS) loc[name] = gl.getUniformLocation(program, name);
    // Texture units never change: bind the samplers once.
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, 'u_src'), SRC_UNIT);
    gl.uniform1i(gl.getUniformLocation(program, 'u_tex'), MID_UNIT);
    return { program, loc };
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
