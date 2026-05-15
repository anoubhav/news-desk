/**
 * WebGL chroma-key: takes an HTMLVideoElement (a LiveAvatar green-screen feed),
 * runs every frame through a small fragment shader that turns green pixels
 * transparent, and renders the result to an HTMLCanvasElement. The canvas can
 * then be CSS-composited over a backdrop image to fake "anchor in a newsroom".
 *
 * Tuning: defaults work for HeyGen-style pure-green-screen avatars. Adjust
 * `keyColor` for a different chroma (e.g. blue screen), `threshold` for more
 * aggressive keying, `smoothness` for halo softness, and `spill` to desaturate
 * green tint that leaks onto the subject's edges.
 */

const VERT_SRC = /* glsl */ `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2((a_pos.x + 1.0) * 0.5, 1.0 - (a_pos.y + 1.0) * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG_SRC = /* glsl */ `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec3 u_keyColor;
uniform float u_threshold;
uniform float u_smoothness;
uniform float u_spill;

float colorDist(vec3 a, vec3 b) {
  // distance in YCbCr-ish space: chroma-only, ignoring brightness.
  float ay = 0.299 * a.r + 0.587 * a.g + 0.114 * a.b;
  float by = 0.299 * b.r + 0.587 * b.g + 0.114 * b.b;
  vec2 acb = vec2(a.b - ay, a.r - ay);
  vec2 bcb = vec2(b.b - by, b.r - by);
  return distance(acb, bcb);
}

void main() {
  vec4 px = texture2D(u_tex, v_uv);
  float d = colorDist(px.rgb, u_keyColor);
  // alpha = 0 when very close to key, 1 when far, smoothstep ramp in between.
  float alpha = smoothstep(u_threshold, u_threshold + u_smoothness, d);
  if (alpha <= 0.001) discard;
  // green-spill suppression: desaturate any pixel whose green channel
  // exceeds avg(r,b) by more than u_spill.
  vec3 rgb = px.rgb;
  float avgRB = (rgb.r + rgb.b) * 0.5;
  if (rgb.g > avgRB + u_spill) {
    rgb.g = avgRB + u_spill;
  }
  gl_FragColor = vec4(rgb, alpha);
}
`;

export type ChromaKeyOptions = {
  /** Key color in 0..1 RGB; default pure HeyGen green. */
  keyColor?: [number, number, number];
  /** Chroma distance below which alpha=0. Lower = more aggressive. */
  threshold?: number;
  /** Width of the alpha ramp from key to keep. Higher = softer edges. */
  smoothness?: number;
  /** Green-spill suppression strength. Higher = more aggressive desaturation. */
  spill?: number;
};

const DEFAULT_OPTS: Required<ChromaKeyOptions> = {
  keyColor: [40 / 255, 200 / 255, 60 / 255],
  threshold: 0.18,
  smoothness: 0.12,
  spill: 0.08,
};

export type ChromaKeyHandle = {
  stop: () => void;
  setOptions: (opts: ChromaKeyOptions) => void;
};

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error("createShader failed");
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error("chromakey shader compile error: " + log);
  }
  return s;
}

/**
 * Attach a chroma-key pipeline. The video's intrinsic frame size is mirrored
 * onto the canvas's drawing buffer the first time we see a non-zero frame, so
 * the canvas's CSS size can be whatever the parent layout dictates.
 */
export function attachChromaKey(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  opts: ChromaKeyOptions = {},
): ChromaKeyHandle {
  let options = { ...DEFAULT_OPTS, ...opts };

  const gl = canvas.getContext("webgl", { premultipliedAlpha: false, alpha: true });
  if (!gl) throw new Error("WebGL not available for chroma-key");

  const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
  const program = gl.createProgram();
  if (!program) throw new Error("createProgram failed");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error("chromakey program link error: " + gl.getProgramInfoLog(program));
  }
  gl.useProgram(program);

  const posLoc = gl.getAttribLocation(program, "a_pos");
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  // Full-screen quad (two triangles).
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const uTex = gl.getUniformLocation(program, "u_tex");
  const uKey = gl.getUniformLocation(program, "u_keyColor");
  const uThr = gl.getUniformLocation(program, "u_threshold");
  const uSmt = gl.getUniformLocation(program, "u_smoothness");
  const uSpl = gl.getUniformLocation(program, "u_spill");
  gl.uniform1i(uTex, 0);
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  function applyUniforms(): void {
    gl!.uniform3fv(uKey, options.keyColor);
    gl!.uniform1f(uThr, options.threshold);
    gl!.uniform1f(uSmt, options.smoothness);
    gl!.uniform1f(uSpl, options.spill);
  }
  applyUniforms();

  let raf = 0;
  let stopped = false;
  let sizedTo = { w: 0, h: 0 };

  function frame(): void {
    if (stopped) return;
    raf = requestAnimationFrame(frame);

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh || video.readyState < 2) return;
    if (sizedTo.w !== vw || sizedTo.h !== vh) {
      canvas.width = vw;
      canvas.height = vh;
      gl!.viewport(0, 0, vw, vh);
      sizedTo = { w: vw, h: vh };
    }

    try {
      gl!.bindTexture(gl!.TEXTURE_2D, tex);
      gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, video);
    } catch (err) {
      // Cross-origin or tainted: skip this frame; will retry next.
      return;
    }
    gl!.clearColor(0, 0, 0, 0);
    gl!.clear(gl!.COLOR_BUFFER_BIT);
    gl!.drawArrays(gl!.TRIANGLES, 0, 6);
  }
  raf = requestAnimationFrame(frame);

  return {
    stop() {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      gl!.deleteTexture(tex);
      gl!.deleteBuffer(buf);
      gl!.deleteProgram(program);
      gl!.deleteShader(vs);
      gl!.deleteShader(fs);
    },
    setOptions(next) {
      options = { ...options, ...next };
      gl!.useProgram(program);
      applyUniforms();
    },
  };
}
