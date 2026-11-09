const Sim = require('../src/sim.js'); global.Sim = Sim; const Score = require('../src/score.js');
let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const bad = []; let min = 1e9, max = -1e9, n = 0; const byPan = {};
for (let i = 0; i < 120; i++) {
  const cut = pick(Object.keys(Sim.CUTS)), c = Sim.CUTS[cut];
  const setup = { cut, thicknessMm: Math.round(c.thMin + rnd() * (c.thMax - c.thMin)), pan: pick(Object.keys(Sim.PANS)), heat: pick(Object.keys(Sim.HEATS)), oil: pick(Object.keys(Sim.FATS)),
    baste: pick(Object.keys(Sim.BASTES)), aromatic: pick(['none', 'thyme', 'garlic']), startC: pick([6, 15]), pat: rnd() > 0.3, salt: pick(['overnight', 'now', 'mid']), doneness: pick(Object.keys(Sim.DONENESS)), seed: 1 + Math.floor(rnd() * 9999), panStartC: 25, dial: 0 };
  try {
    const k = Sim.create(setup);
    k.cmd('dial', rnd());
    const preheat = rnd() * 500; for (let t = 0; t < preheat / Sim.DT; t++) k.step();
    k.cmd('place', 0, { x: (rnd() - 0.5) * 0.12, y: (rnd() - 0.5) * 0.12 });
    const stopCore = 40 + rnd() * 40, flipEvery = 15 + rnd() * 120; let nextFlip = k.time() + flipEvery, g = 0;
    while (k.probeCore() < stopCore && g++ < 20000) {
      if (rnd() < 0.001) k.cmd('dial', rnd());
      if (rnd() < 0.002 && setup.baste !== 'none') k.cmd('baste', rnd() > 0.5);
      if (k.time() >= nextFlip) { k.cmd('flip'); nextFlip += flipEvery; }
      k.step();
    }
    k.cmd('pull'); k.cmd('dial', 0);
    const rest = rnd() * 600; for (let t = 0; t < rest / Sim.DT; t++) k.step();
    k.cmd('finish');
    const r = Score.compute(k);
    const finite = [r.total, ...r.cats.map(x => x.points)].every(Number.isFinite);
    if (!finite || r.total < 0 || r.total > 100.01) bad.push({ i, setup, total: r.total });
    for (const f of r.fixes) if (/NaN|undefined|Infinity/.test(f.head + f.fix)) bad.push({ i, text: f.head + ' / ' + f.fix });
    min = Math.min(min, r.total); max = Math.max(max, r.total); n++;
    (byPan[setup.pan] = byPan[setup.pan] || []).push(r.total);
  } catch (e) { bad.push({ i, setup, err: e.stack.split('\n').slice(0, 3).join(' | ') }); }
}
console.log('cooks', n, 'score range', min.toFixed(1), '-', max.toFixed(1), 'problems', bad.length);
for (const [p, v] of Object.entries(byPan)) console.log(' ', p.padEnd(13), 'mean', (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1), 'n', v.length);
if (bad.length) console.log(JSON.stringify(bad.slice(0, 3), null, 1));
