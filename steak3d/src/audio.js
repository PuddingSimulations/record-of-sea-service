/* Synthesised sizzle, flame and pops (Web Audio, no files). Ported from the 2D prototype. */
'use strict';
var ctx = null, master, white, sizzleG, bodyG, flameG, muted = false;
function mk(c, secs, brown) {
  var n = Math.floor(c.sampleRate * secs), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0), l = 0;
  for (var i = 0; i < n; i++) { var w = Math.random() * 2 - 1; if (brown) { l = (l + 0.02 * w) / 1.02; d[i] = l * 3.5; } else d[i] = w; }
  return b;
}
function src(buf, off) { var s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, off || 0); return s; }
function filt(type, f, q) { var x = ctx.createBiquadFilter(); x.type = type; x.frequency.value = f; if (q) x.Q.value = q; return x; }
function init() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  try { ctx = new AC(); } catch (e) { ctx = null; return; }
  master = ctx.createGain(); master.gain.value = muted ? 0 : 0.8; master.connect(ctx.destination);
  white = mk(ctx, 2, false); var brown = mk(ctx, 3, true);
  sizzleG = ctx.createGain(); sizzleG.gain.value = 0;
  var s1 = src(white, 0.2), hp = filt('highpass', 3200), bp = filt('bandpass', 6500, 0.5);
  s1.connect(hp); hp.connect(bp); bp.connect(sizzleG); sizzleG.connect(master);
  bodyG = ctx.createGain(); bodyG.gain.value = 0;
  var s2 = src(white, 1.1), b2 = filt('bandpass', 1500, 0.6); s2.connect(b2); b2.connect(bodyG); bodyG.connect(master);
  flameG = ctx.createGain(); flameG.gain.value = 0;
  var s3 = src(brown, 0), lp = filt('lowpass', 520); s3.connect(lp); lp.connect(flameG); flameG.connect(master);
}
function ramp(g, v, tc) { if (g) g.gain.setTargetAtTime(v, ctx.currentTime, tc || 0.15); }
function update(o) { if (!ctx) return; ramp(sizzleG, o.sizzle * 0.20); ramp(bodyG, o.sizzle * 0.11); ramp(flameG, o.flame * 0.10, 0.3); }
function pop(vol) {
  if (!ctx || muted) return;
  var s = ctx.createBufferSource(); s.buffer = white; var g = ctx.createGain(), f = filt('bandpass', 1500 + Math.random() * 4500, 2 + Math.random() * 4), t = ctx.currentTime;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.03 + Math.random() * 0.05);
  s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random() * 1.5, 0.12);
}
function thud(freq, dur, vol) {
  if (!ctx || muted) return;
  var o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
  o.type = 'sine'; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * 0.45), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function setMuted(m) { muted = m; if (ctx) master.gain.setTargetAtTime(m ? 0 : 0.8, ctx.currentTime, 0.05); }
module.exports = { init: init, update: update, pop: pop, thud: thud, setMuted: setMuted };
