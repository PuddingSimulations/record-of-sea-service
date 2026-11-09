/* ============================================================
   MAIN: renderer, camera, input, and the glue between the soft body (what the
   steak physically does) and the cooking sim (what that does to the meat).
   The glue only ever talks to the sim through cook.cmd():
     place  first time the steak settles in the pan (x, y, yaw, which face is down)
     lift   steak is in the tongs or off the pan; its faces stop touching the pan
     move   steak set down again somewhere in the pan
     flip   it landed the other way up
     pull   it has sat on the cooktop for a moment: resting starts
   ============================================================ */
import './boot.js';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import Score from './score.js';
import physics from './physics.js';
import sectionLib from './section.js';
import Aud from './audio.js';
import { Kitchen, WORLD } from './scene.js';
import { SteakMesh } from './steakmesh.js';

const { SoftBody, qrot } = physics;
const U = Sim.util, clamp = U.clamp, lerp = U.lerp, smoothstep = U.smoothstep, DT = Sim.DT;
const $ = id => document.getElementById(id);
const fmt = (x, d = 0) => Number(x).toFixed(d);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- storage ---------- */
const KEY = 'steak3d.v1'; const store = { bests: {}, muted: false, hints: true, fx: true };
try { Object.assign(store, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* private window */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* ignore */ } };

/* ---------- renderer ---------- */
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.9;
const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 30);
const kitchen = new Kitchen(renderer);
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(kitchen.scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.55, 0.9); composer.addPass(bloom);
composer.addPass(new OutputPass());
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h; camera.fov = w / h < 0.9 ? 52 : 34; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();

/* ---------- camera orbit ---------- */
const cam = { az: 0.0, el: 0.62, dist: 1.3, target: new THREE.Vector3(0.1, 0.03, 0.04) };
function placeCamera() {
  const ce = Math.cos(cam.el);
  camera.position.set(cam.target.x + cam.dist * Math.sin(cam.az) * ce, cam.target.y + cam.dist * Math.sin(cam.el), cam.target.z + cam.dist * Math.cos(cam.az) * ce);
  camera.lookAt(cam.target); camera.updateMatrixWorld();
}

/* ---------- game state ---------- */
const CUT_IDS = Object.keys(Sim.CUTS), DONE_IDS = ['rare', 'mr', 'medium', 'mw', 'well'], OILS = ['canola', 'avocado', 'tallow'];
const setup = { cut: 'scotch_fillet', thicknessMm: 30, doneness: 'mr', pan: 'cast_iron', heat: 'gas', oil: 'canola', baste: 'butter', aromatic: 'none', startC: 6, pat: true, salt: 'now', seed: 1, panStartC: 25, dial: 0 };
let cook = null, body = null, steak = null, started = false, finished = false, result = null;
let speedOverride = 0, paused = false, acc = 0, simTime = 0;
const glue = { onPan: 0, onCounter: 0, offPan: 0, lifted: false, lastPose: null, placedPose: null };
const input = { orbit: null, knob: null, holding: false, ptr: new THREE.Vector2(), off: [0, 0], holdY: 0.15 };
const ray = new THREE.Raycaster();

function newCook() {
  setup.seed = 1 + Math.floor(Math.random() * 99990);
  const cut = Sim.CUTS[setup.cut]; setup.thicknessMm = cut.thDef;
  cook = Sim.create(setup);
  if (steak) { kitchen.scene.remove(steak.mesh); steak.geo.dispose(); }
  body = new SoftBody(cook, WORLD);
  steak = new SteakMesh(cook, body);
  kitchen.scene.add(steak.mesh);
  acc = 0; speedOverride = 0; paused = false; finished = false; result = null; simTime = 0;
  Object.assign(glue, { onPan: 0, onCounter: 0, offPan: 0, lifted: false });
  lastPaint = 0; lastShape = 0; steak.paint(true); steak.skin();
  $('cutName').textContent = Sim.CUTS[setup.cut].alt.AU + ' · ' + setup.thicknessMm + ' mm · ' + Sim.DONENESS[setup.doneness].name.toLowerCase();
  $('dial').value = 0; $('vDial').textContent = '0%';
}

/* ---------- start screen ---------- */
function chips(el, items, cur, onPick) {
  el.innerHTML = items.map(it => `<button type="button" class="chip" data-v="${it.id}" aria-pressed="${it.id === cur}">${esc(it.name)}</button>`).join('');
  el.onclick = e => { const b = e.target.closest('.chip'); if (!b) return; onPick(b.dataset.v); chips(el, items, b.dataset.v, onPick); };
}
chips($('cutChips'), CUT_IDS.map(id => ({ id, name: Sim.CUTS[id].alt.AU })), setup.cut, v => { setup.cut = v; });
chips($('doneChips'), DONE_IDS.map(id => ({ id, name: Sim.DONENESS[id].name })), setup.doneness, v => { setup.doneness = v; });
chips($('oilChips'), OILS.map(id => ({ id, name: Sim.FATS[id].name + ' (' + Sim.FATS[id].smokeC + ' °C)' })), setup.oil, v => { setup.oil = v; });
$('bStart').onclick = () => { Aud.init(); Aud.setMuted(!!store.muted); $('start').hidden = true; startRound(); };
function startRound() {
  newCook(); started = true;
  for (const id of ['stats', 'dialBox', 'actions', 'hint']) $(id).hidden = false;
  body.reset(WORLD.spawn);
}

/* ---------- sim <-> physics glue ---------- */
function onPanNow() { return !body.grip && body.contact.panFrac > 0.45; }
function updateGlue(dt) {
  if (!started || finished) return;
  const c = body.contact, held = !!body.grip, calm = body.speed < 0.06;
  const pan = onPanNow(), counter = !held && (c.counterFrac > 0.45 || c.floorFrac > 0.45);
  glue.onPan = pan && calm ? glue.onPan + dt : 0;
  glue.onCounter = counter && calm ? glue.onCounter + dt : 0;
  const pose = body.pose();
  const rel = () => ({ x: pose.center[0] - WORLD.pan.x, y: -(pose.center[2] - WORLD.pan.z), yaw: pose.yaw, down: pose.flipped ? 1 : 0 });
  if (cook.mode === 'preheat') {
    if (glue.onPan > 0.5) { const r = rel(); cook.cmd('place', 0, { x: r.x, y: r.y, yaw: r.yaw, down: r.down }); glue.lifted = false; Aud.thud(140, 0.14, 0.5); Aud.pop(0.5); }
  } else if (cook.mode === 'cook') {
    const lifted = held || !pan;
    if (lifted !== glue.lifted) { glue.offPan = lifted ? glue.offPan : 0; if (lifted) { cook.cmd('lift', 1); glue.lifted = true; } }
    if (glue.lifted && glue.onPan > 0.45) {
      const r = rel();
      if (r.down !== cook.down) { cook.cmd('flip'); Aud.pop(0.6); Aud.thud(160, 0.08, 0.25); }
      cook.cmd('move', 0, { x: r.x, y: r.y, yaw: r.yaw }); glue.lifted = false; Aud.thud(120, 0.1, 0.4); Aud.pop(0.4);
    }
    if (glue.onCounter > 1.2) { cook.cmd('pull'); toast('Resting'); }
  }
}

function simAdvance(dt) {
  if (!started || finished || paused || !cook || cook.mode === 'done') return;
  const speed = speedOverride || ({ preheat: 8, cook: 3, rest: 8 }[cook.mode] || 8);
  acc += dt * speed; let n = 0;
  while (acc >= DT && n < 80) { cook.step(); acc -= DT; n++; }
  if (acc > DT * 80) acc = 0;
}

/* ---------- visuals driven by the sim ---------- */
let lastPaint = 0, lastShape = 0, shape = { shrink: 0, thicken: 0, curl: 0 };
function updateMaterial(now) {
  if (now - lastShape < 0.3) return; lastShape = now;
  if (cook.mode === 'preheat') return;
  const L = cook.L; let core = 0, t0 = 0, t1 = 0;
  for (const c of cook.cols) { core += cook.coreAt(c); t0 += cook.T[c * L]; t1 += cook.T[c * L + L - 1]; }
  const n = cook.cols.length; core /= n; t0 /= n; t1 /= n;
  const done = smoothstep(46, 78, core);
  body.setCooked(done);
  const surf = smoothstep(55, 110, (t0 + t1) / 2);
  const tgt = { shrink: 0.075 * done + 0.035 * surf, thicken: 0.04 * done, curl: clamp((t0 - t1) / 100, -1, 1) * 0.007 * smoothstep(60, 100, Math.max(t0, t1)) };
  for (const k in shape) shape[k] += (tgt[k] - shape[k]) * 0.35;
  body.setShape(shape.shrink, shape.thicken, shape.curl);
}
function updateEffects(dt, now) {
  const pan = WORLD.pan, active = cook.mode === 'cook' || cook.mode === 'rest';
  const pm = cook.panMean(), over = cook.mode === 'preheat' ? clamp((pm - cook.oil.smokeC) / 30, 0, 1) : cook.smokeI;
  const evap = cook.mode === 'cook' && !glue.lifted ? clamp(cook.evapRate / 6e-5, 0, 1) : 0;
  const pose = body.pose(), c = pose.center, topY = c[1] + cook.thickness * 0.5;
  const rate = dt * (paused ? 0 : 1);
  // steam off the face, then off the resting steak
  let steamRate = evap * 55;
  if (cook.mode === 'rest') steamRate = clamp(((cook.restCore || 40) - 50) / 20, 0, 1) * 7;
  if (cook.mode === 'cook' && glue.lifted && !input.holding) steamRate = 3;
  steamRate *= rate; while (steamRate > 0) { if (Math.random() < Math.min(1, steamRate)) kitchen.emit(0, c[0] + (Math.random() - 0.5) * 0.12, topY + 0.004, c[2] + (Math.random() - 0.5) * 0.08, { a: 0.05 + 0.07 * evap }); steamRate -= 1; }
  // smoke from the pan
  let smokeRate = over * 45 * rate; while (smokeRate > 0) { if (Math.random() < Math.min(1, smokeRate)) kitchen.emit(1, pan.x + (Math.random() - 0.5) * 0.18, pan.floorY + 0.02, pan.z + (Math.random() - 0.5) * 0.18, { a: 0.08 + 0.22 * over }); smokeRate -= 1; }
  // spitting fat
  let spit = (evap > 0.25 ? evap * 12 : 0) * rate; while (spit > 0) { if (Math.random() < Math.min(1, spit)) { kitchen.emit(2, c[0] + (Math.random() - 0.5) * 0.14, topY, c[2] + (Math.random() - 0.5) * 0.09); if (Math.random() < 0.5) Aud.pop(0.12 + 0.16 * Math.random()); } spit -= 1; }
  // audio
  const act = cook.mode === 'cook' && !glue.lifted ? clamp(0.18 + evap, 0, 1) * smoothstep(90, 140, pm) : 0;
  Aud.update({ sizzle: act, flame: (cook.mode === 'preheat' || cook.mode === 'cook') ? cook.power * 0.9 : 0 });
  void active; void now;
}

/* ---------- input ---------- */
function setPointer(e) { const r = canvas.getBoundingClientRect(); input.ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(input.ptr, camera); }
function planeHit(y) {
  const o = ray.ray.origin, d = ray.ray.direction; if (Math.abs(d.y) < 1e-4) return null;
  const t = (y - o.y) / d.y; if (t < 0) return null; return [o.x + d.x * t, o.z + d.z * t];
}
function pickSteak() { return body.pick([ray.ray.origin.x, ray.ray.origin.y, ray.ray.origin.z], [ray.ray.direction.x, ray.ray.direction.y, ray.ray.direction.z]); }
function overKnob() { return ray.intersectObject(kitchen.knobHit, false).length > 0; }
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => {
  if (!started) return; Aud.init(); canvas.setPointerCapture(e.pointerId); setPointer(e);
  if (e.button === 0 || e.pointerType === 'touch') {
    if (overKnob()) { input.knob = { x: e.clientX, v: cook.dial }; canvas.classList.add('knob'); return; }
    if (!finished && !body.grip) {
      const idx = pickSteak();
      if (idx >= 0) {
        body.grab(idx, input.holdY); input.holding = true; canvas.classList.add('holding');
        const hit = planeHit(body.grip.pos[1]); input.off = hit ? [body.grip.pos[0] - hit[0], body.grip.pos[2] - hit[1]] : [0, 0];
        Aud.thud(200, 0.05, 0.12); return;
      }
    }
  }
  input.orbit = { x: e.clientX, y: e.clientY, az: cam.az, el: cam.el };
});
canvas.addEventListener('pointermove', e => {
  if (!started) return; setPointer(e);
  if (input.knob) { setDial(clamp(input.knob.v + (e.clientX - input.knob.x) * 0.006, 0, 1)); return; }
  if (input.orbit) { cam.az = input.orbit.az - (e.clientX - input.orbit.x) * 0.006; cam.el = clamp(input.orbit.el + (e.clientY - input.orbit.y) * 0.005, 0.12, 1.35); return; }
  if (!input.holding) canvas.className = overKnob() ? 'knob' : (pickSteak() >= 0 ? 'canpick' : '');
});
const up = e => { input.orbit = null; input.knob = null; if (input.holding) { body.release(); input.holding = false; Aud.thud(90, 0.1, 0.2); } canvas.classList.remove('holding', 'knob'); void e; };
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
canvas.addEventListener('wheel', e => {
  e.preventDefault(); if (!started) return;
  if (input.holding) { input.holdY = clamp(input.holdY - e.deltaY * 0.0004, 0.045, 0.32); body.gripTarget(body.grip.tx, body.grip.tz, input.holdY); }
  else cam.dist = clamp(cam.dist * Math.exp(e.deltaY * 0.001), 0.4, 1.9);
}, { passive: false });
function camRight() { const f = new THREE.Vector3(); camera.getWorldDirection(f); f.y = 0; f.normalize(); return [-f.z, 0, f.x].map(v => v); }
function flipHeld() { if (!body.grip) return; const r = camRight(); body.gripTurn(r, Math.PI); Aud.thud(170, 0.06, 0.1); }
window.addEventListener('keydown', e => {
  if (!started) return;
  if (e.target.tagName === 'INPUT' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  const k = e.key;
  if (k === ' ' || k === 'f' || k === 'F') { if (body.grip) { e.preventDefault(); flipHeld(); } }
  else if (k === 'q' || k === 'Q') body.gripTurn([0, 1, 0], 0.35);
  else if (k === 'e' || k === 'E') body.gripTurn([0, 1, 0], -0.35);
  else if (k === 'ArrowUp') { e.preventDefault(); setDial(clamp(cook.dial + 0.05, 0, 1)); }
  else if (k === 'ArrowDown') { e.preventDefault(); setDial(clamp(cook.dial - 0.05, 0, 1)); }
  else if (k === 'b' || k === 'B') toggleBaste();
  else if (k === 'r' || k === 'R') resetSteak();
  else if (k === '1') speedOverride = 1; else if (k === '2') speedOverride = 3; else if (k === '3') speedOverride = 8;
  else if (k === 'p' || k === 'P') paused = !paused;
  else if (k === 'Enter') { if (cook.mode === 'cook') pullToRest(); else if (cook.mode === 'rest') finish(); }
});
function setDial(v) {
  if (!cook || cook.mode === 'done') return; v = Math.round(v * 200) / 200;
  if (Math.abs(v - cook.dial) < 1e-6) return;
  cook.cmd('dial', v); $('dial').value = Math.round(v * 100); $('vDial').textContent = Math.round(v * 100) + '%';
}
$('dial').addEventListener('input', e => setDial(e.target.value / 100));
function toggleBaste() { if (cook.mode !== 'cook' || cook.bfat.id === 'none') return; cook.cmd('baste', !cook.basting); $('bBaste').setAttribute('aria-pressed', String(cook.basting)); steak.paint(); toast(cook.basting ? 'Basting with butter' : 'Basting off'); }
function resetSteak() { if (!body) return; body.release(); input.holding = false; body.reset(WORLD.spawn); }
function pullToRest() { if (cook.mode !== 'cook') return; body.release(); input.holding = false; cook.cmd('pull'); body.reset(WORLD.spawn); steak.paint(); toast('Resting'); }
$('bBaste').onclick = toggleBaste; $('bReset').onclick = resetSteak; $('bPull').onclick = pullToRest;
$('bSpeed').onclick = () => { speedOverride = speedOverride === 0 ? 1 : speedOverride === 1 ? 3 : speedOverride === 3 ? 8 : 0; toast(speedOverride ? speedOverride + '× time' : 'Normal time'); };
$('bFinish').onclick = finish;
$('bHints').onclick = function () { store.hints = !store.hints; save(); this.setAttribute('aria-pressed', String(store.hints)); };
$('bSound').onclick = function () { store.muted = !store.muted; save(); Aud.setMuted(store.muted); this.setAttribute('aria-pressed', String(!store.muted)); };
$('bQuality').onclick = function () { store.fx = !store.fx; save(); this.setAttribute('aria-pressed', String(store.fx)); applyFx(); };
function applyFx() { bloom.enabled = !!store.fx; renderer.shadowMap.enabled = true; }
$('bHints').setAttribute('aria-pressed', String(!!store.hints)); $('bSound').setAttribute('aria-pressed', String(!store.muted)); $('bQuality').setAttribute('aria-pressed', String(!!store.fx)); applyFx();
let toastT = 0; function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 1600); }

/* ---------- result ---------- */
const mmss = Score.mmss;
const CAT = {}; Score.CATS.forEach(c => { CAT[c.id] = c.name; });
const grade = t => t >= 92 ? 'Exceptional' : t >= 84 ? 'Excellent' : t >= 74 ? 'Good' : t >= 62 ? 'Decent' : t >= 45 ? 'Needs work' : 'Back to the pan';
const barColor = f => f >= 0.85 ? 'var(--sage)' : f >= 0.6 ? 'var(--amber)' : 'var(--rose)';
function finish() {
  if (finished || cook.mode === 'done') return;
  if (cook.mode === 'cook') pullToRest();
  body.release(); input.holding = false;
  cook.cmd('finish'); finished = true; Aud.update({ sizzle: 0, flame: 0 });
  result = Score.compute(cook);
  const key = 'f:' + setup.cut + ':' + setup.doneness, prev = store.bests[key], isNew = prev === undefined || result.total > prev;
  if (isNew) { store.bests[key] = result.total; save(); }
  const m = result.m;
  let h = `<div class="score"><div class="big num">${fmt(result.total, 1)}<small>/100</small></div><div><div class="grade">${grade(result.total)}</div><div class="pb num">${prev === undefined ? 'First score for this setup' : isNew ? 'New personal best. Previous ' + fmt(prev, 1) : 'Personal best ' + fmt(prev, 1)}</div></div></div>`;
  h += `<h2>${esc(Sim.CUTS[setup.cut].alt.AU)}, ${setup.thicknessMm} mm, ${esc(Sim.DONENESS[setup.doneness].name.toLowerCase())} (${fmt(cook.targetC)} °C)</h2>`;
  h += `<div class="secnote">Pulled at ${fmt(m.pullCore, 1)} °C, peaked at ${fmt(m.peakCore, 1)} °C in the centre, rested ${mmss(m.restT)}. Colour is the hottest each spot got.</div><canvas id="section"></canvas>`;
  h += `<div class="cols" style="margin-top:14px"><ul class="cats">` + result.cats.map(c => `<li><span>${esc(c.name)}</span><b class="num">${fmt(c.points, 1)}<small> / ${c.weight}</small></b><span class="bar"><i style="width:${Math.round(c.score * 100)}%;background:${barColor(c.score)}"></i></span></li>`).join('') + `</ul><div><h2>What to fix</h2>`;
  if (!result.fixes.length) h += `<div class="fix"><b>Nothing big to fix.</b><p>A clean cook. Try a thicker cut, or a hotter pan.</p></div>`;
  result.fixes.forEach(f => { h += `<div class="fix"><span class="cat">${esc(CAT[f.cat] || f.cat)}</span><b>${esc(f.head)}</b><p>${esc(f.fix)}</p></div>`; });
  h += `</div></div><div class="go"><button class="btn primary" id="bAgain">Cook again</button><button class="btn" id="bNew">New steak</button></div>`;
  $('resultCard').innerHTML = h; $('result').hidden = false;
  const row = (cook.probe / cook.nx) | 0, cv = $('section'); sectionLib.renderSection(cook, row, cv, Math.min(820, window.innerWidth - 120));
  cv.style.width = Math.min(cv.width, window.innerWidth - 100) + 'px';
  $('bAgain').onclick = () => { $('result').hidden = true; startRound(); };
  $('bNew').onclick = () => { $('result').hidden = true; $('start').hidden = false; for (const id of ['stats', 'dialBox', 'actions', 'hint']) $(id).hidden = true; started = false; };
}

/* ---------- HUD ---------- */
let hudAt = 0;
function hintText() {
  const pm = cook.panMean();
  switch (cook.mode) {
    case 'preheat':
      if (body.grip) return ['Lower it into the pan and let go.', 'Wheel: height · Space: flip · Q E: turn'];
      if (cook.dial < 0.05 && pm < 60) return ['Light the burner. Drag the knob on the cooktop sideways, or use the slider or the up and down arrow keys.', 'Right-drag or drag the room to look around · Wheel to zoom'];
      if (pm < 150) return ['Let the pan come up to heat. For a hard sear you want about 200 °C at the middle.', 'Time runs faster while you wait · keys 1 2 3 change the speed'];
      if (pm < 190) return ['Nearly there. A cooler pan gives a paler crust.', ''];
      if (pm > cook.oil.smokeC + 12) return ['The pan is ready but smoking past your oil’s limit (' + cook.oil.smokeC + ' °C). Put the steak in now.', 'Click and hold the steak to pick it up with the tongs'];
      return ['The pan is ready. Click and hold the steak to pick it up with the tongs, then lay it in the pan.', 'Wheel: height · Space: flip · Q E: turn'];
    case 'cook': {
      const d = cook.targetC - cook.probeCore();
      if (cook.dial > 0.62 && cook.cookTime() < 120) return ['The burner is high. Ease it back now the steak is down, or the crust will char.', ''];
      if (d <= -2) return ['Past the target. Lift it out onto the cooktop now.', 'Set it down beside the pan to start the rest'];
      if (d < 8) return ['Getting close. Heat keeps travelling inward after you pull it, so lift it out a little early.', 'Set it down beside the pan to start the rest'];
      return ['Flip every 30 to 60 seconds: pick it up, press Space to turn it over, lay it back down. Baste with B.', 'When the core reaches the target, set it down beside the pan to rest'];
    }
    case 'rest': return ['Resting. The centre keeps climbing and the juices settle. Thick steaks need longer. Slice when you are ready.', ''];
    default: return ['', ''];
  }
}
function updateHud(now) {
  if (!started || !cook || now - hudAt < 0.1) return; hudAt = now;
  const mode = cook.mode, pm = mode === 'cook' && !glue.lifted ? cook.panUnderMean() : cook.panMean();
  $('phase').textContent = mode === 'preheat' ? 'Heat' : mode === 'cook' ? 'Cook' : mode === 'rest' ? 'Rest' : 'Done';
  $('vPan').textContent = fmt(pm) + ' °C';
  const core = mode === 'preheat' ? setup.startC : mode === 'rest' ? (cook.restCore || cook.probeCore()) : cook.probeCore();
  $('vCore').textContent = fmt(core) + ' °C'; $('sCore').textContent = 'target ' + fmt(cook.targetC) + ' °C';
  $('coreBar').style.width = clamp((core - setup.startC) / (cook.targetC - setup.startC), 0, 1.1) * 100 + '%';
  $('lTime').textContent = mode === 'rest' ? 'Rest' : mode === 'preheat' ? 'Heat' : 'Cook';
  $('vTime').textContent = mmss(mode === 'rest' ? cook.restTime() : mode === 'preheat' ? cook.time() : cook.cookTime());
  const sp = paused ? 'paused' : (speedOverride || ({ preheat: 8, cook: 3, rest: 8 }[mode] || 8)) + '× time'; $('sSpeed').textContent = sp;
  $('bPull').hidden = true; $('bBaste').hidden = mode !== 'cook' || cook.bfat.id === 'none'; $('bFinish').hidden = mode !== 'rest';
  const [a, b] = store.hints ? hintText() : ['', '']; $('hint').hidden = !a; $('hintText').textContent = a; $('hintKeys').textContent = b;
}

/* ---------- main loop ---------- */
let last = performance.now() / 1000, frameN = 0;
function tick(ts) {
  requestAnimationFrame(tick);
  const now = ts / 1000, dt = Math.min(0.05, Math.max(0.0005, now - last)); last = now; frameN++;
  if (started && cook) {
    // drive the tongs from the pointer
    if (body.grip) { const h = planeHit(body.grip.pos[1]); if (h) body.gripTarget(h[0] + input.off[0], h[1] + input.off[1], input.holdY); }
    body.step(dt);
    updateGlue(dt); simAdvance(dt); updateMaterial(now);
    steak.skin();
    if (now - lastPaint > 0.4 && cook.mode !== 'preheat') { steak.paint(); lastPaint = now; }
    updateEffects(dt, now);
    const g = body.grip;
    if (g) { const q = g.quat, ax = qrot(q, [0, 0, 1]), cp = camera.position; kitchen.setTongs(true, g.pos, ax, cook.thickness * body.sz, [cp.x - g.pos[0], 0, cp.z - g.pos[2]]); } else kitchen.setTongs(false);
  }
  kitchen.update(dt, { power: cook ? cook.power : 0, dialKnob: cook ? cook.dial : 0, panC: cook ? cook.panMean() : 25, fov: camera.fov });
  placeCamera();
  composer.render();
  updateHud(now);
}
requestAnimationFrame(tick);

// For automated checks and tinkering from the console.
window.__steak = { get cook() { return cook; }, get body() { return body; }, get steak() { return steak; }, kitchen, camera, cam, setDial, finish, startRound, setup, glue, input, WORLD, get paused() { return paused; }, set speed(v) { speedOverride = v; } };
$('loadTip').textContent = 'Left-drag grabs the steak. Right-drag orbits.';
newCook(); body.reset(WORLD.spawn); placeCamera();
