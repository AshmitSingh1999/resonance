import { VERTEX_SHADER, FRAGMENT_SHADER, BACKDROP_INDEX } from './shaders.js';

export interface BackdropFrame {
  bass: number;
  mid: number;
  treble: number;
  onset: boolean;
  intensity: number;
  /** Which field to draw; `none` never reaches here. */
  backdrop: string;
  /** True when the scheme puts dark ink on a light ground. */
  light: boolean;
  background: [number, number, number];
  accent: [number, number, number];
}

/** How quickly a beat flash fades, per frame. */
const ONSET_DECAY = 0.86;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (shader === null) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('[resonance] shader failed to compile:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/**
 * The animated backdrop behind the lyrics.
 *
 * Deliberately a separate layer from the type: the text lives in the DOM so it
 * keeps real font shaping and accessibility, while this handles the parts DOM is
 * bad at. Both are GPU-composited and neither touches layout.
 *
 * Every failure path degrades to nothing at all. A missing WebGL context or a
 * failed compile leaves a plain background, which is a perfectly good screen —
 * so the backdrop never becomes a reason the lyrics do not appear.
 */
export class Backdrop {
  #gl: WebGLRenderingContext | null = null;
  #program: WebGLProgram | null = null;
  #uniforms: Record<string, WebGLUniformLocation | null> = {};
  #onsetLevel = 0;
  #startedAt = 0;

  get supported(): boolean {
    return this.#gl !== null && this.#program !== null;
  }

  init(canvas: HTMLCanvasElement): boolean {
    const gl =
      canvas.getContext('webgl', { alpha: false, antialias: false, depth: false }) ??
      (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);
    if (gl === null) return false;

    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (vertex === null || fragment === null) return false;

    const program = gl.createProgram();
    if (program === null) return false;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('[resonance] shader link failed:', gl.getProgramInfoLog(program));
      return false;
    }

    gl.useProgram(program);

    // A single triangle strip covering clip space; no geometry to speak of.
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    for (const name of [
      'uTime', 'uResolution', 'uBass', 'uMid', 'uTreble',
      'uOnset', 'uIntensity', 'uField', 'uIsLight', 'uBackground', 'uAccent',
    ]) {
      this.#uniforms[name] = gl.getUniformLocation(program, name);
    }

    this.#gl = gl;
    this.#program = program;
    this.#startedAt = performance.now();
    return true;
  }

  resize(canvas: HTMLCanvasElement): void {
    const gl = this.#gl;
    if (gl === null) return;
    // Rendered at a reduced ratio: it is a soft field, so there is nothing for
    // the extra pixels to resolve, and a retina display would cost four times
    // the fragments for no visible gain.
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.floor(canvas.clientWidth * ratio);
    const height = Math.floor(canvas.clientHeight * ratio);
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
  }

  render(frame: BackdropFrame): void {
    const gl = this.#gl;
    if (gl === null || this.#program === null) return;

    // Decay rather than a flag, so a beat reads as a flash with a tail instead
    // of a single-frame blink the eye would miss.
    this.#onsetLevel = frame.onset ? 1 : this.#onsetLevel * ONSET_DECAY;

    const u = this.#uniforms;
    gl.uniform1f(u['uTime']!, (performance.now() - this.#startedAt) / 1000);
    gl.uniform2f(u['uResolution']!, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform1f(u['uBass']!, frame.bass);
    gl.uniform1f(u['uMid']!, frame.mid);
    gl.uniform1f(u['uTreble']!, frame.treble);
    gl.uniform1f(u['uOnset']!, this.#onsetLevel);
    gl.uniform1f(u['uIntensity']!, frame.intensity);
    gl.uniform1i(u['uField']!, BACKDROP_INDEX[frame.backdrop] ?? 0);
    gl.uniform1f(u['uIsLight']!, frame.light ? 1 : 0);
    gl.uniform3f(u['uBackground']!, ...normalise(frame.background));
    gl.uniform3f(u['uAccent']!, ...normalise(frame.accent));

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose(): void {
    const gl = this.#gl;
    if (gl !== null && this.#program !== null) gl.deleteProgram(this.#program);
    this.#gl = null;
    this.#program = null;
  }
}

function normalise([r, g, b]: [number, number, number]): [number, number, number] {
  return [r / 255, g / 255, b / 255];
}

/**
 * Parse `#rrggbb` or `rgb()`/`rgba()` into 0-255 channels, with a safe fallback.
 *
 * Only these two forms are recognised, deliberately. Scraping any numbers out of
 * the string would turn `oklch(0.7 0.1 30)` into the colour `[0.7, 0.1, 30]` —
 * near-black, and silently wrong. The stylesheet uses `color-mix(in oklab, …)`,
 * so such values genuinely reach here and must fall back rather than be guessed.
 */
export function parseColour(
  value: string,
  fallback: [number, number, number],
): [number, number, number] {
  const trimmed = value.trim();

  const hex = /^#([0-9a-f]{6})$/i.exec(trimmed);
  if (hex !== null) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(trimmed);
  if (rgb !== null) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }

  return fallback;
}
