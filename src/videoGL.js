/* The photo editor's colour work (photoFx.js process) as a WebGL shader, fast enough for every frame of a video
   (Alex, 21 Nov: "the editor on videos too, with every setting the photos have"). Same values, same order: sharpen,
   exposure, brightness, contrast, highlights / shadows, warmth, tint, split toning, saturation, HSL, fade, vignette,
   grain, then the curves through a 256-step table. getGL() gives one renderer, or null where WebGL is missing. */
import { BANDS, lutOf } from './photoFx.js'

const VS = `attribute vec2 p; varying vec2 v; void main(){ v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`
const FS = `precision highp float;
varying vec2 v;
uniform sampler2D img; uniform sampler2D lut;
uniform vec2 px; uniform vec2 size;
uniform float ex, br, ct, sat, hl, sh, wm, tn, fd, vg, gr, shp, useLut, hsOn, seed, spA;
uniform vec3 spSh, spHl;
uniform vec4 bands[8];
float rnd(vec2 q){ return fract(sin(dot(q, vec2(12.9898, 78.233)) + seed) * 43758.5453); }
vec3 hsl2rgb(float h, float s, float l){
  float C = (1.0 - abs(2.0 * l - 1.0)) * s; float hp = h / 60.0; float X = C * (1.0 - abs(mod(hp, 2.0) - 1.0)); vec3 r;
  if (hp < 1.0) r = vec3(C, X, 0.0); else if (hp < 2.0) r = vec3(X, C, 0.0); else if (hp < 3.0) r = vec3(0.0, C, X);
  else if (hp < 4.0) r = vec3(0.0, X, C); else if (hp < 5.0) r = vec3(X, 0.0, C); else r = vec3(C, 0.0, X);
  return r + (l - C / 2.0);
}
void main(){
  vec3 c = texture2D(img, v).rgb;
  if (shp > 0.0) {
    vec3 b = (texture2D(img, v + vec2(px.x, 0.0)).rgb + texture2D(img, v - vec2(px.x, 0.0)).rgb + texture2D(img, v + vec2(0.0, px.y)).rgb + texture2D(img, v - vec2(0.0, px.y)).rgb) / 4.0;
    c = c + (c - b) * shp * 0.9;
  }
  c *= ex; c += br; c = (c - 0.5) * ct + 0.5;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  if (hl != 0.0 || sh != 0.0) { float l = clamp(lum, 0.0, 1.0); c += sh * (1.0 - l) * (1.0 - l) + hl * l * l; }
  c.r += wm; c.b -= wm;
  c.g -= tn; c.r += tn / 2.0; c.b += tn / 2.0;
  if (spA > 0.0) { float l = clamp(lum, 0.0, 1.0); c += spA * ((1.0 - l) * spSh + l * spHl); }
  lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = lum + (c - lum) * sat;
  if (hsOn > 0.0) {
    c = clamp(c, 0.0, 1.0);
    float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), L = (mx + mn) / 2.0, D = mx - mn;
    if (D > 0.002) {
      float S = D / max(1.0 - abs(2.0 * L - 1.0), 1e-6);
      float H = mx == c.r ? mod((c.g - c.b) / D, 6.0) : mx == c.g ? (c.b - c.r) / D + 2.0 : (c.r - c.g) / D + 4.0;
      H *= 60.0; if (H < 0.0) H += 360.0;
      float dh = 0.0, ds = 0.0, dL = 0.0;
      for (int i = 0; i < 8; i++) {
        vec4 b = bands[i];
        float diff = abs(H - b.x); if (diff > 180.0) diff = 360.0 - diff;
        if (diff < 38.0) { float w = 1.0 - diff / 38.0; dh += b.y * w; ds += b.z * w; dL += b.w * w; }
      }
      if (dh != 0.0 || ds != 0.0 || dL != 0.0) {
        float H2 = mod(H + dh + 360.0, 360.0), S2 = clamp(S * (1.0 + ds), 0.0, 1.0), L2 = clamp(L + dL * S, 0.0, 1.0);
        c = hsl2rgb(H2, S2, L2);
      }
    }
  }
  if (fd > 0.0) c = 0.1 * fd + c * (1.0 - 0.18 * fd);
  if (vg > 0.0) {
    vec2 d = (v - 0.5) * size; float dd = length(d) / length(size * 0.5);
    float f = dd < 0.45 ? 1.0 : 1.0 - vg * 0.85 * min(1.0, pow((dd - 0.45) / 0.6, 2.0));
    c *= f;
  }
  if (gr > 0.0) c += (rnd(v * size) - 0.5) * gr;
  c = clamp(c, 0.0, 1.0);
  if (useLut > 0.0) {
    c = vec3(texture2D(lut, vec2((c.r * 255.0 + 0.5) / 256.0, 0.5)).r, texture2D(lut, vec2((c.g * 255.0 + 0.5) / 256.0, 0.5)).g, texture2D(lut, vec2((c.b * 255.0 + 0.5) / 256.0, 0.5)).b);
  }
  gl_FragColor = vec4(c, 1.0);
}`

const flat = (c) => !c || ['l', 'r', 'g', 'b'].every((k) => c[k].length === 2 && c[k][0][0] === 0 && c[k][0][1] === 0 && c[k][1][0] === 1 && c[k][1][1] === 1)

let one
export function getGL() {
  if (one !== undefined) return one
  one = null
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true }) || canvas.getContext('experimental-webgl')
    if (!gl) return null
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s }
    const prog = gl.createProgram()
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog))
    gl.useProgram(prog)
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    const tex = (unit) => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t }
    const imgT = tex(0); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    const lutT = tex(1); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    const U = (n) => gl.getUniformLocation(prog, n)
    gl.uniform1i(U('img'), 0); gl.uniform1i(U('lut'), 1)
    let lutKey = ''
    const lutData = new Uint8Array(256 * 4)
    one = {
      canvas,
      // the source (a canvas or a video frame drawn in one) through the values p; returns the GL canvas, at the source's size
      render(src, p) {
        const w = src.width, h = src.height
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
        gl.viewport(0, 0, w, h)
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, imgT)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
        const e = (p.enhance || 0) / 100
        gl.uniform2f(U('px'), 1 / w, 1 / h); gl.uniform2f(U('size'), w, h)
        gl.uniform1f(U('ex'), 2 ** ((p.exposure || 0) / 100 + e * 0.05))
        gl.uniform1f(U('br'), (p.brightness || 0) / 250)
        gl.uniform1f(U('ct'), 1 + (p.contrast || 0) / 100 + e * 0.12)
        gl.uniform1f(U('sat'), 1 + (p.saturation || 0) / 100 + e * 0.2)
        gl.uniform1f(U('hl'), ((p.highlights || 0) / 100) * 0.35); gl.uniform1f(U('sh'), ((p.shadows || 0) / 100) * 0.35)
        gl.uniform1f(U('wm'), ((p.warmth || 0) / 100) * 0.09); gl.uniform1f(U('tn'), ((p.tint || 0) / 100) * 0.06)
        gl.uniform1f(U('fd'), (p.fade || 0) / 100); gl.uniform1f(U('vg'), (p.vignette || 0) / 100)
        gl.uniform1f(U('gr'), ((p.grain || 0) / 100) * 0.16); gl.uniform1f(U('shp'), Math.max(0, (p.sharpen || 0) / 100))
        gl.uniform1f(U('seed'), (Math.random() * 1000) | 0)
        const sp = p.split
        gl.uniform1f(U('spA'), sp?.a || 0)
        gl.uniform3fv(U('spSh'), sp ? sp.sh : [0, 0, 0]); gl.uniform3fv(U('spHl'), sp ? sp.hl : [0, 0, 0])
        const bands = new Float32Array(32)
        let on = false
        BANDS.forEach(([k, , c], i) => { const b = p.hsl?.[k]; bands.set([c, (b?.h || 0) * 0.3, (b?.s || 0) / 100, ((b?.l || 0) / 100) * 0.25], i * 4); if (b && (b.h || b.s || b.l)) on = true })
        gl.uniform4fv(U('bands'), bands); gl.uniform1f(U('hsOn'), on ? 1 : 0)
        const useLut = !flat(p.curves)
        gl.uniform1f(U('useLut'), useLut ? 1 : 0)
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lutT)
        const key = useLut ? JSON.stringify(p.curves) : 'id'
        if (key !== lutKey) {
          lutKey = key
          if (useLut) {
            const L = lutOf(p.curves.l), R = lutOf(p.curves.r), G = lutOf(p.curves.g), B = lutOf(p.curves.b)
            for (let i = 0; i < 256; i++) { lutData[i * 4] = L[R[i]]; lutData[i * 4 + 1] = L[G[i]]; lutData[i * 4 + 2] = L[B[i]]; lutData[i * 4 + 3] = 255 }
          } else for (let i = 0; i < 256; i++) { lutData[i * 4] = lutData[i * 4 + 1] = lutData[i * 4 + 2] = i; lutData[i * 4 + 3] = 255 }
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lutData)
        }
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        return canvas
      },
    }
  } catch { one = null }
  return one
}
