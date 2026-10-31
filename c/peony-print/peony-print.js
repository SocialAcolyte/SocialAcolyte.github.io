/* peony-print — Hokusai's Peonies and Canary, printed block by block as you
   scroll. The scan was separated offline into seven blocks (key, pink,
   yellow, leaf, blue ground in two impressions, grey, seal); one WebGL
   shader recombines them in optical density, so at full progress the
   printed density equals the scan's (mean error 5/255, in the dark leaves). */
const NB = 7;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const seg = (p, a, b) => clamp((p - a) / (b - a));

function paperTexture(gl) {
  const S = 256, data = new Uint8Array(S * S * 4);
  const grids = [];
  for (let o = 0; o < 4; o++) {
    const n = 4 * 2 ** o, g = new Float32Array((n + 1) * (n + 1));
    for (let i = 0; i < g.length; i++) g[i] = Math.random();
    grids.push({ n, g });
  }
  const noise = (x, y) => {
    let v = 0, amp = 0.55;
    for (const { n, g } of grids) {
      const fx = x * n, fy = y * n, ix = Math.floor(fx) % n, iy = Math.floor(fy) % n;
      const tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const at = (i, j) => g[(j % n) * (n + 1) + (i % n)];
      v += amp * (at(ix, iy) * (1 - sx) * (1 - sy) + at(ix + 1, iy) * sx * (1 - sy)
        + at(ix, iy + 1) * (1 - sx) * sy + at(ix + 1, iy + 1) * sx * sy);
      amp *= 0.55;
    }
    return v;
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4, u = x / S, v = y / S;
    data[i] = noise(u, v) * 255;                       // tooth
    data[i + 1] = noise(u + 9, v + 3) * 255;           // sweep unevenness
    data[i + 2] = noise(u * 3 % 1, v * 3 % 1) * 255;   // mottle
    data[i + 3] = noise(u + 5, v * 14 % 1) * 255;      // fibre direction
  }
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, S, S, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return tex;
}

const VS = `attribute vec2 aPos; varying vec2 vUv;
void main(){ vUv = vec2(aPos.x*.5+.5, aPos.y*.5+.5); gl_Position = vec4(aPos,0.,1.); }`;

const FS = `precision highp float;
varying vec2 vUv;
uniform sampler2D uAtlasA, uAtlasB, uResid, uNoise;
uniform vec3 uPaper;
uniform vec3 uInk[7];
uniform float uScale[7], uProg[7], uOff[7];
uniform float uResidArr;
vec3 dens(vec3 c){ return -log(max(c, vec3(1e-4)) / uPaper); }
void main(){
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec4 nz = texture2D(uNoise, uv * vec2(7.0, 9.0));
  vec3 D = vec3(0.0);
  float printed = 0.0;
  { float t = uProg[0];
    if (t > 0.0) {
      vec2 off = vec2(sin(0.0*17.3), cos(0.0*23.7)) * uOff[0];
      float cx = clamp(uv.x + off.x, 0.001, 0.999);
      float cy = clamp(uv.y + off.y, 0.001, 0.999);
      float cov = texture2D(uAtlasA, vec2(cx, (0.0 + cy) / 4.0)).r * uScale[0];
      cov *= smoothstep(0.05, 0.28, cov); // bare paper stays bare: only drawn line prints
      float sweep = uv.y * 0.72 + (nz.g - 0.5) * 0.34 + (nz.b - 0.5) * 0.10;
      float arr = smoothstep(sweep - 0.10, sweep + 0.03, t * 1.12);
      float tooth = mix(0.45, 1.0, smoothstep(0.15, 0.85, nz.r + (arr - 0.5) * 0.55));
      float eff = (t >= 0.999) ? cov : cov * arr * mix(tooth, 1.0, arr);
      float wet = arr * (1.0 - smoothstep(t - 0.22, t, sweep)) * (1.0 - step(0.999, t));
      D += eff * uInk[0] * (1.0 + 0.16 * wet);
      printed += eff;
    } }
  { float t = uProg[1];
    if (t > 0.0) {
      vec2 off = vec2(sin(1.0*17.3), cos(1.0*23.7)) * uOff[1];
      float cx = clamp(uv.x + off.x, 0.001, 0.999);
      float cy = clamp(uv.y + off.y, 0.001, 0.999);
      float cov = texture2D(uAtlasA, vec2(cx, (1.0 + cy) / 4.0)).r * uScale[1];
      float sweep = uv.y * 0.72 + (nz.g - 0.5) * 0.34 + (nz.b - 0.5) * 0.10;
      float arr = smoothstep(sweep - 0.10, sweep + 0.03, t * 1.12);
      float tooth = mix(0.45, 1.0, smoothstep(0.15, 0.85, nz.r + (arr - 0.5) * 0.55));
      float eff = (t >= 0.999) ? cov : cov * arr * mix(tooth, 1.0, arr);
      float wet = arr * (1.0 - smoothstep(t - 0.22, t, sweep)) * (1.0 - step(0.999, t));
      D += eff * uInk[1] * (1.0 + 0.16 * wet);
      printed += eff;
    } }
  { float t = uProg[2];
    if (t > 0.0) {
      vec2 off = vec2(sin(2.0*17.3), cos(2.0*23.7)) * uOff[2];
      float cx = clamp(uv.x + off.x, 0.001, 0.999);
      float cy = clamp(uv.y + off.y, 0.001, 0.999);
      float cov = texture2D(uAtlasA, vec2(cx, (2.0 + cy) / 4.0)).r * uScale[2];
      float sweep = uv.y * 0.72 + (nz.g - 0.5) * 0.34 + (nz.b - 0.5) * 0.10;
      float arr = smoothstep(sweep - 0.10, sweep + 0.03, t * 1.12);
      float tooth = mix(0.45, 1.0, smoothstep(0.15, 0.85, nz.r + (arr - 0.5) * 0.55));
      float eff = (t >= 0.999) ? cov : cov * arr * mix(tooth, 1.0, arr);
      float wet = arr * (1.0 - smoothstep(t - 0.22, t, sweep)) * (1.0 - step(0.999, t));
      D += eff * uInk[2] * (1.0 + 0.16 * wet);
      printed += eff;
    } }
  { float t = uProg[3];
    if (t > 0.0) {
      vec2 off = vec2(sin(3.0*17.3), cos(3.0*23.7)) * uOff[3];
      float cx = clamp(uv.x + off.x, 0.001, 0.999);
      float cy = clamp(uv.y + off.y, 0.001, 0.999);
      float cov = texture2D(uAtlasA, vec2(cx, (3.0 + cy) / 4.0)).r * uScale[3];
      float sweep = uv.y * 0.72 + (nz.g - 0.5) * 0.34 + (nz.b - 0.5) * 0.10;
      float arr = smoothstep(sweep - 0.10, sweep + 0.03, t * 1.12);
      float tooth = mix(0.45, 1.0, smoothstep(0.15, 0.85, nz.r + (arr - 0.5) * 0.55));
      float eff = (t >= 0.999) ? cov : cov * arr * mix(tooth, 1.0, arr);
      float wet = arr * (1.0 - smoothstep(t - 0.22, t, sweep)) * (1.0 - step(0.999, t));
      D += eff * uInk[3] * (1.0 + 0.16 * wet);
      printed += eff;
    } }
  { float t = uProg[4];
    if (t > 0.0) {
      vec2 off = vec2(sin(4.0*17.3), cos(4.0*23.7)) * uOff[4];
      float cx = clamp(uv.x + off.x, 0.001, 0.999);
      float cy = clamp(uv.y + off.y, 0.001, 0.999);
      float cov = texture2D(uAtlasB, vec2(cx, (0.0 + cy) / 3.0)).r * uScale[4];
      float sweep = uv.y * 0.72 + (nz.g - 0.5) * 0.34 + (nz.b - 0.5) * 0.10;
      float arr = smoothstep(sweep - 0.10, sweep + 0.03, t * 1.12);
      float tooth = mix(0.45, 1.0, smoothstep(0.15, 0.85, nz.r + (arr - 0.5) * 0.55));
      float eff = (t >= 0.999) ? cov : cov * arr * mix(tooth, 1.0, arr);
      float wet = arr * (1.0 - smoothstep(t - 0.22, t, sweep)) * (1.0 - step(0.999, t));
      D += eff * uInk[4] * (1.0 + 0.16 * wet);
      printed += eff;
    } }
  { float t = uProg[5];
    if (t > 0.0) {
      vec2 off = vec2(sin(5.0*17.3), cos(5.0*23.7)) * uOff[5];
      float cx = clamp(uv.x + off.x, 0.001, 0.999);
      float cy = clamp(uv.y + off.y, 0.001, 0.999);
      float cov = texture2D(uAtlasB, vec2(cx, (1.0 + cy) / 3.0)).r * uScale[5];
      float sweep = uv.y * 0.72 + (nz.g - 0.5) * 0.34 + (nz.b - 0.5) * 0.10;
      float arr = smoothstep(sweep - 0.10, sweep + 0.03, t * 1.12);
      float tooth = mix(0.45, 1.0, smoothstep(0.15, 0.85, nz.r + (arr - 0.5) * 0.55));
      float eff = (t >= 0.999) ? cov : cov * arr * mix(tooth, 1.0, arr);
      float wet = arr * (1.0 - smoothstep(t - 0.22, t, sweep)) * (1.0 - step(0.999, t));
      D += eff * uInk[5] * (1.0 + 0.16 * wet);
      printed += eff;
    } }
  { float t = uProg[6];
    if (t > 0.0) {
      vec2 off = vec2(sin(6.0*17.3), cos(6.0*23.7)) * uOff[6];
      float cx = clamp(uv.x + off.x, 0.001, 0.999);
      float cy = clamp(uv.y + off.y, 0.001, 0.999);
      float cov = texture2D(uAtlasB, vec2(cx, (2.0 + cy) / 3.0)).r * uScale[6];
      float sweep = uv.y * 0.72 + (nz.g - 0.5) * 0.34 + (nz.b - 0.5) * 0.10;
      float arr = smoothstep(sweep - 0.10, sweep + 0.03, t * 1.12);
      float tooth = mix(0.45, 1.0, smoothstep(0.15, 0.85, nz.r + (arr - 0.5) * 0.55));
      float eff = (t >= 0.999) ? cov : cov * arr * mix(tooth, 1.0, arr);
      float wet = arr * (1.0 - smoothstep(t - 0.22, t, sweep)) * (1.0 - step(0.999, t));
      D += eff * uInk[6] * (1.0 + 0.16 * wet);
      printed += eff;
    } }
  D += dens(texture2D(uResid, uv).rgb) * uResidArr;
  vec3 col = uPaper * exp(-D);
  gl_FragColor = vec4(col, 1.0);
}`;

function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im); im.onerror = rej; im.src = src;
  });
}

export async function peonyPrint(section, opts = {}) {
  const src = opts.src || section.dataset.src;
  const img = section.querySelector('.pp-img');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  if (reduced.matches || !src) return { destroy() {} };
  let meta, atlasAIm, atlasBIm, residIm;
  try {
    meta = await (await fetch(src)).json();
    const base = src.replace(/[^/]+$/, '');
    [atlasAIm, atlasBIm, residIm] = await Promise.all([
      loadImage(base + 'peony-blocks-a.webp'), loadImage(base + 'peony-blocks-b.webp'), loadImage(base + 'peony-resid.webp')]);
  } catch { return { destroy() {} }; }
  // a quick check for WebGL; the probe's context is released at once, so it never counts
  // against the browser's limit on live contexts
  const gl0 = document.createElement('canvas').getContext('webgl');
  if (!gl0) return { destroy() {} };
  gl0.getExtension('WEBGL_lose_context')?.loseContext();

  // data-play="<seconds>": print by itself over that time, fitted to the section's own box
  // (no scroll runway). Otherwise the print follows the scroll as usual.
  const play = +(opts.play ?? section.dataset.play ?? 0);
  const t0 = performance.now();
  if (!play) {
    const runwaySv = NB * 72 + 150;
    section.style.setProperty('--pp-runway', runwaySv + 'svh');
    section.style.height = runwaySv + 'svh';
  }
  const canvas = document.createElement('canvas');
  canvas.className = 'pp-canvas'; canvas.setAttribute('aria-hidden', 'true');
  img.replaceWith(canvas);
  const gl = canvas.getContext('webgl', { antialias: false });
  if (!gl) { canvas.replaceWith(img); return { destroy() {} }; }

  const sh = (type, s) => {
    const o = gl.createShader(type); gl.shaderSource(o, s); gl.compileShader(o); return o;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.error('peony-print shader:', gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = n => gl.getUniformLocation(prog, n);
  const texFrom = (im, unit) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  };
  texFrom(atlasAIm, 0); texFrom(atlasBIm, 3); texFrom(residIm, 1);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, paperTexture(gl));
  gl.uniform1i(U('uAtlasA'), 0); gl.uniform1i(U('uAtlasB'), 3); gl.uniform1i(U('uResid'), 1); gl.uniform1i(U('uNoise'), 2);
  gl.uniform3fv(U('uPaper'), meta.paper);
  meta.blocks.forEach((b, i) => {
    gl.uniform3fv(U(`uInk[${i}]`), b.ink);
    gl.uniform1f(U(`uScale[${i}]`), b.scale);
    gl.uniform1f(U(`uOff[${i}]`), i === 0 ? 0 : 0.0035);
  });

  let raf = 0, shown = 0, vel = 0, last = 0, visible = true, destroyed = false;
  function size() {
    const boxW = play ? section.clientWidth : innerWidth * 0.94, boxH = play ? section.clientHeight : innerHeight * 0.94;
    const scaleFit = Math.min(boxH / meta.h, boxW / meta.w);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.style.height = (meta.h * scaleFit) + 'px';
    canvas.style.width = (meta.w * scaleFit) + 'px';
    canvas.width = Math.round(meta.w * scaleFit * dpr);
    canvas.height = Math.round(meta.h * scaleFit * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  function progress() {
    if (play) return clamp((performance.now() - t0) / (play * 1000));
    const r = section.getBoundingClientRect(), d = section.offsetHeight - innerHeight;
    return d > 0 ? clamp(-r.top / d) : 1;
  }
  function draw(p) {
    const lead = seg(p, 0.02, 0.10);
    for (let i = 0; i < NB; i++) {
      const a = 0.08 + i * (0.86 / NB), b = a + (0.86 / NB) * 1.35;
      const t = i === 0 ? lead * seg(p, 0.02, 0.16) : seg(p, a, Math.min(b, 0.97));
      gl.uniform1f(U(`uProg[${i}]`), clamp(t));
      gl.uniform1f(U(`uOff[${i}]`), i === 0 ? 0 : 0.0035 * (1 - clamp(t)));
    }
    gl.uniform1f(U('uResidArr'), seg(p, 0.52, 0.66));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function tick(now) {
    if (destroyed) return;
    const target = progress(), dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    const w = 10, x0 = shown - target, c2 = vel + w * x0, e = Math.exp(-w * dt);
    shown = target + (x0 + c2 * dt) * e; vel = (c2 - w * (x0 + c2 * dt)) * e;
    draw(clamp(shown));
    raf = (Math.abs(shown - target) > 1e-4 || Math.abs(vel) > 1e-4 || (play && target < 1)) && visible && !document.hidden
      ? requestAnimationFrame(tick) : 0;
  }
  function kick() { if (!raf && visible && !destroyed && !reduced.matches) raf = requestAnimationFrame(tick); }
  const io = new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) kick(); }, { threshold: 0.02 });
  io.observe(section);
  addEventListener('scroll', kick, { passive: true });
  addEventListener('resize', () => { size(); kick(); }, { passive: true });
  const onMQ = () => { if (reduced.matches) { cancelAnimationFrame(raf); raf = 0; draw(1); } else kick(); };
  reduced.addEventListener?.('change', onMQ);
  size();
  shown = progress(); draw(clamp(shown)); kick();
  return { destroy() {
    destroyed = true; cancelAnimationFrame(raf); io.disconnect();
    removeEventListener('scroll', kick); reduced.removeEventListener?.('change', onMQ);
    canvas.replaceWith(img); section.style.height = '';
  } };
}
window.peonyPrint = peonyPrint;
document.querySelectorAll('[data-peony-print]').forEach(el => { if (!el._pp) el._pp = peonyPrint(el); });
