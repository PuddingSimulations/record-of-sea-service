// Soft-body steak: settles, stays in the pan, survives tongs, flips, and never goes NaN.
const Sim = require('../src/sim.js'); global.Sim = Sim;
const { SoftBody, qaxis } = require('../src/physics.js');
const WORLD = () => ({ counterHX: 0.45, counterHZ: 0.32, counterY: 0, floorY: -0.9, roomHX: 2, roomHZ: 2, spawn: [0.3, 0, 0.12, 0.3],
  pan: { x: -0.05, z: 0, rIn: 0.125, rOut: 0.132, floorY: 0.035, rimY: 0.085 } });
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
for (const cutId of Object.keys(Sim.CUTS)) {
  const cook = Sim.create({ cut: cutId, thicknessMm: Sim.CUTS[cutId].thDef });
  const w = WORLD(), b = new SoftBody(cook, w);
  for (let i = 0; i < 120; i++) b.step(1 / 60);
  let st = b.speed;
  ok(st < 0.02 && b.contact.counterFrac > 0.5, `${cutId}: ${b.N} particles, ${b.M} constraints, rests on counter (speed ${st.toFixed(4)}, contact ${b.contact.counterFrac.toFixed(2)})`);
  // grab centre, lift, carry over the pan, drop
  const c = b.center; const idx = b.pick([c[0], 0.5, c[2]], [0, -1, 0]); ok(idx >= 0, 'pick hits');
  b.grab(idx, 0.16);
  for (let i = 0; i < 40; i++) { b.gripTarget(c[0], c[2], 0.16); b.step(1 / 60); }
  ok(b.contact.minY > 0.04, `lifted clear of the counter (minY ${b.contact.minY.toFixed(3)})`);
  for (let i = 0; i < 90; i++) { b.gripTarget(w.pan.x, w.pan.z, 0.16); b.step(1 / 60); }
  b.gripTurn([1, 0, 0], Math.PI);
  for (let i = 0; i < 60; i++) { b.gripTarget(w.pan.x, w.pan.z, 0.16); b.step(1 / 60); }
  b.release();
  for (let i = 0; i < 180; i++) b.step(1 / 60);
  const pose = b.pose(), P = b.p;
  let nan = false, outside = 0;
  for (let i = 0; i < b.N; i++) { if (!isFinite(P[i * 3] + P[i * 3 + 1] + P[i * 3 + 2])) nan = true; const r = Math.hypot(P[i * 3] - w.pan.x, P[i * 3 + 2] - w.pan.z); if (r > w.pan.rIn + 0.01) outside++; }
  ok(!nan, 'no NaN');
  ok(b.contact.panFrac > 0.5 && b.speed < 0.02, `${cutId}: settled in pan (panFrac ${b.contact.panFrac.toFixed(2)}, speed ${b.speed.toFixed(4)}), outside ${outside}`);
  ok(pose.flipped, `${cutId}: flip detected (ez.y ${pose.ez[1].toFixed(2)})`);
  ok(pose.tilt > 0.9, `${cutId}: lies flat (tilt ${pose.tilt.toFixed(2)})`);
  // thickness preserved
  let mn = 1e9, mx = -1e9; for (let i = 0; i < b.N; i++) { mn = Math.min(mn, P[i * 3 + 1]); mx = Math.max(mx, P[i * 3 + 1]); }
  ok(mx - mn > cook.thickness * 0.55 && mx - mn < cook.thickness * 1.6, `${cutId}: thickness ${(1000 * (mx - mn)).toFixed(1)} mm of ${(cook.thickness * 1000).toFixed(0)}`);
}
// cooked firmness changes drape
function sag(cooked) {
  const cook = Sim.create({}), w = WORLD(), b = new SoftBody(cook, w); b.setCooked(cooked);
  for (let i = 0; i < 60; i++) b.step(1 / 60);
  const idx = b.pick([b.center[0] + 0.06, 0.5, b.center[2]], [0, -1, 0]); b.grab(idx, 0.2);
  for (let i = 0; i < 90; i++) { b.gripTarget(b.grip.pos[0], b.grip.pos[2], 0.2); b.step(1 / 60); }
  let mn = 1e9; for (let i = 0; i < b.N; i++) mn = Math.min(mn, b.p[i * 3 + 1]); return 0.2 - mn;
}
const sr = sag(0), sc = sag(1); ok(sr > sc, `raw drapes more than cooked when held by one end (hang ${sr.toFixed(3)} vs ${sc.toFixed(3)} m)`);
process.exit(fails ? 1 : 0);
