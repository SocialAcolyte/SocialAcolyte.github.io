// sound.js: plays this component's sounds (sounds.json beside it) at the moments they are wired to.
// Copied into a component by the viewer's Sound panel (tools/sound/studio.py); edit sounds.json, not this file.
//
// Off until the visitor turns it on: a small speaker button (sounds.json "toggle": false hides it, then call
// setSound(true) from your own control). The choice is remembered per site in localStorage "sf-sound".
//
// sounds.json: { "toggle": true, "sounds": [ { "name", "file", "on", "target", "volume", "vary", "once" } ] }
//   on      press | release | click | drag | hover | enter | key | load | event:<name>
//   target  a CSS selector the moment happens on ("body" = anywhere)
//   volume  0-1      vary  random pitch, +- semitones      once  only the first time
//
// Exports sound(opts) -> { destroy } and setSound(on). Auto-starts when loaded.

const KEY = 'sf-sound';
const BASE = new URL('.', import.meta.url);
const listeners = new Set();

function stored() { try { return localStorage.getItem(KEY) === 'on'; } catch { return false; } }
export function setSound(on) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch {}
  listeners.forEach((f) => f(on));
}

export function sound(opts = {}) {
  const off = [];
  const listen = (el, type, fn, o) => { el.addEventListener(type, fn, o); off.push(() => el.removeEventListener(type, fn, o)); };
  let ctx = null, cfg = null, enabled = stored(), dead = false, button = null;
  const buffers = new Map(), last = new Map(), played = new Set();

  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      for (const s of cfg.sounds) load(s);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  async function load(s) {
    if (buffers.has(s.name)) return;
    buffers.set(s.name, null);
    try {
      const r = await fetch(new URL(s.file, BASE));
      buffers.set(s.name, await ctx.decodeAudioData(await r.arrayBuffer()));
      if (s.on === 'load') play(s);
    } catch { buffers.delete(s.name); }
  }
  function play(s) {
    if (!enabled || dead) return;
    if (s.once && played.has(s.name)) return;
    const now = performance.now();
    if (now - (last.get(s.name) || 0) < (s.cooldown ?? 50)) return;
    const c = audio(), buf = c && buffers.get(s.name);
    if (!buf) return;
    last.set(s.name, now); played.add(s.name);
    const src = c.createBufferSource(), g = c.createGain();
    src.buffer = buf;
    if (s.vary) src.playbackRate.value = 2 ** (((Math.random() * 2 - 1) * s.vary) / 12);
    g.gain.value = s.volume ?? 0.8;
    src.connect(g).connect(c.destination);
    src.start();
  }

  const within = (e, sel) => e.target instanceof Element && (sel === 'body' ? e.target : e.target.closest(sel));

  function bind(s) {
    const sel = s.target || 'body';
    const on = s.on || 'press';
    if (on === 'press') listen(document, 'pointerdown', (e) => within(e, sel) && play(s));
    else if (on === 'click') listen(document, 'click', (e) => within(e, sel) && play(s));
    else if (on === 'release') {
      let down = false;
      listen(document, 'pointerdown', (e) => { down = !!within(e, sel); });
      listen(document, 'pointerup', () => { if (down) play(s); down = false; });
    } else if (on === 'drag') {
      let start = null;
      listen(document, 'pointerdown', (e) => { start = within(e, sel) ? { x: e.clientX, y: e.clientY, fired: false } : null; });
      listen(document, 'pointermove', (e) => {
        if (start && !start.fired && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) { start.fired = true; play(s); }
      });
      const end = () => { start = null; };
      listen(document, 'pointerup', end); listen(document, 'pointercancel', end);
    } else if (on === 'hover') {
      listen(document, 'pointerover', (e) => {
        const el = e.pointerType === 'mouse' && within(e, sel);
        if (el && !(e.relatedTarget instanceof Node && el.contains(e.relatedTarget))) play(s);
      });
    } else if (on === 'enter') {
      const seen = new WeakSet();
      const io = new IntersectionObserver((es) => es.forEach((en) => {
        if (en.isIntersecting && !seen.has(en.target)) { seen.add(en.target); play(s); }
        else if (!en.isIntersecting) seen.delete(en.target);
      }), { threshold: 0.35 });
      document.querySelectorAll(sel).forEach((el) => io.observe(el));
      off.push(() => io.disconnect());
    } else if (on === 'key') {
      listen(document, 'keydown', (e) => {
        if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.key.length > 1 && !/^(Enter| |Backspace)$/.test(e.key)) return;
        if (sel === 'body' || document.activeElement?.closest(sel)) play(s);
      });
    } else if (on === 'load') {
      s.once = true;
      const tryPlay = () => play(s);
      listeners.add(tryPlay); off.push(() => listeners.delete(tryPlay));
      tryPlay();
    } else if (on.startsWith('event:')) {
      listen(document, on.slice(6), (e) => (sel === 'body' || within(e, sel)) && play(s), true);
    }
  }

  // the first touch or key after sound is on is what lets a browser start audio
  const unlock = () => { if (enabled && cfg) { audio(); listeners.forEach((f) => f(true)); } };
  listen(document, 'pointerdown', unlock, true);
  listen(document, 'keydown', unlock, true);
  const sync = (on) => {
    enabled = on;
    if (button) { button.setAttribute('aria-pressed', String(on)); button.setAttribute('aria-label', on ? 'Sound on' : 'Sound off'); }
    if (on && cfg) audio();
  };
  listeners.add(sync); off.push(() => listeners.delete(sync));
  listen(window, 'storage', (e) => { if (e.key === KEY) sync(stored()); });

  function addButton() {
    if (!document.getElementById('sfs-style')) {
      const st = document.createElement('style'); st.id = 'sfs-style';
      st.textContent = `.sfs-toggle{position:fixed;right:max(14px,env(safe-area-inset-right));bottom:max(14px,env(safe-area-inset-bottom));z-index:2147483000;
        width:36px;height:36px;border-radius:50%;border:1px solid var(--rule,#cfcac0);background:var(--paper,#f3f0e8);color:var(--ink-2,#4a4744);
        display:grid;place-items:center;cursor:pointer;padding:0;opacity:.82;transition:opacity .3s,background .3s,color .3s}
        .sfs-toggle:hover{opacity:1}.sfs-toggle[aria-pressed=true]{background:var(--ink,#141312);color:var(--paper,#f3f0e8);border-color:var(--ink,#141312)}
        .sfs-toggle:focus-visible{outline:2px solid var(--accent,#c96f4a);outline-offset:2px}
        .sfs-toggle svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
        .sfs-toggle .w{transition:opacity .3s}.sfs-toggle[aria-pressed=false] .w{opacity:0}.sfs-toggle[aria-pressed=true] .x{opacity:0}`;
      document.head.append(st);
    }
    button = document.createElement('button');
    button.type = 'button'; button.className = 'sfs-toggle'; button.title = 'Sound';
    button.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z"/>' +
      '<path class="w" d="M10.6 5.6a3.4 3.4 0 0 1 0 4.8M12.4 3.8a6 6 0 0 1 0 8.4"/><path class="x" d="M10.5 6.2l3.2 3.6M13.7 6.2l-3.2 3.6"/></svg>';
    button.addEventListener('click', () => setSound(!enabled));
    document.body.append(button);
    off.push(() => button.remove());
    sync(enabled);
  }

  (async () => {
    try {
      cfg = opts.config || await (await fetch(new URL('sounds.json', BASE), { cache: 'no-store' })).json();
    } catch { return; }
    if (dead || !cfg.sounds?.length) return;
    cfg.sounds.forEach(bind);
    if (cfg.toggle !== false) addButton();
    if (enabled) audio();
  })();

  return { destroy() { dead = true; off.forEach((f) => f()); off.length = 0; ctx?.close(); } };
}

if (!window.__sfSound) window.__sfSound = sound();
