/*
 *  TILT // one shared, smoothed read of how the phone is being held.
 *
 *  tilt.x / tilt.y run -1..1 (right / toward you). They are relative to how the
 *  phone was first held and the baseline drifts back slowly, so a phone resting
 *  at 50 degrees reads as level, and the effect is about *changing* the angle.
 *  Screen rotation is accounted for. Smoothed, so a shaky hand is a calm one.
 *
 *  iOS only hands over orientation after a tap, so the first touch asks. On
 *  desktop, or if permission is refused, tilt.active stays false and each piece
 *  falls back to its own pointer or drift behaviour.
 *
 *  Pages import this by the same URL so there is exactly one instance.
 */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const tilt = { x: 0, y: 0, active: false, listeners: new Set() };
let base = null;
let rx = 0;
let ry = 0;
let started = false;
let lastT = 0;

function read(ev) {
    if (ev.beta == null || ev.gamma == null) return;
    const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    const b = ev.beta;
    const g = ev.gamma;
    let x;
    let y;
    switch (((ang % 360) + 360) % 360) {
        case 90:  x = b;  y = -g; break;
        case 180: x = -g; y = -b; break;
        case 270: x = -b; y = g;  break;
        default:  x = g;  y = b;
    }
    const now = performance.now();
    const dt = lastT ? Math.min(0.2, (now - lastT) / 1000) : 0.016;
    lastT = now;
    if (!base) base = { x, y };
    // the baseline eases toward wherever the phone is now (about 12s to settle)
    const k = 1 - Math.exp(-dt / 12);
    base.x += (x - base.x) * k;
    base.y += (y - base.y) * k;
    rx = clamp((x - base.x) / 24, -1, 1);
    ry = clamp((y - base.y) / 24, -1, 1);
    // low-pass
    const s = 1 - Math.exp(-dt / 0.09);
    tilt.x += (rx - tilt.x) * s;
    tilt.y += (ry - tilt.y) * s;
    if (!tilt.active) {
        tilt.active = true;
        tilt.listeners.forEach((fn) => fn(tilt));
    }
}

function listen() {
    if (started) return;
    started = true;
    addEventListener('deviceorientation', read, { passive: true });
}

if (typeof DeviceOrientationEvent !== 'undefined') {
    // Listening costs nothing and works wherever no permission is needed
    // (Android, and Chrome which grants it quietly). iOS stays silent until the
    // user taps, so also ask on the first touch.
    listen();
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        addEventListener('touchend', () => {
            DeviceOrientationEvent.requestPermission()
                .then((st) => { if (st === 'granted') listen(); })
                .catch(() => {});
        }, { once: true, passive: true });
    }
}

// Desktop browsers fire one null event; only a real sensor flips .active.
export default tilt;
