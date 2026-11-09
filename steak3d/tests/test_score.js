global.Sim = require('../src/sim.js');
const Score = require('../src/score.js');
function cook(setup, o) {
  const c = Sim.create(Object.assign({ seed: 5 }, setup));
  c.cmd('dial', 1);
  let g = 0;
  while (c.panMean() < o.placeAt && g++ < 100000) c.step();
  const t0 = c.time();
  c.cmd('place', 0, { x: o.x || 0, y: o.y || 0 });
  c.cmd('dial', o.dial);
  let nextFlip = o.flip, baste0 = o.basteAt, basteOn = false; g = 0;
  while (g++ < 100000) {
    const t = c.time() - t0;
    if (t >= nextFlip) { c.cmd('flip'); nextFlip += o.flip; }
    if (o.basteAt !== undefined && !basteOn && t >= o.basteAt) { c.cmd('baste', true); basteOn = true; }
    if (o.dial2 && t >= o.dial2[0]) c.cmd('dial', o.dial2[1]);
    c.step();
    if (c.probeCore() >= o.pullAt) break;
  }
  c.cmd('pull');
  c.steps(o.rest * 4);
  c.cmd('finish');
  return Score.compute(c);
}
const base = { cut: 'scotch_fillet', thicknessMm: 30, pan: 'cast_iron', heat: 'gas', startC: 6, doneness: 'mr', baste: 'butter', aromatic: 'thyme', salt: 'now', pat: true };
const cases = [
  ['good: 215C, dial .4, flip 45, pull 50, rest 280, baste', base, { placeAt: 215, dial: 0.4, flip: 45, pullAt: 50, rest: 280, basteAt: 400 }],
  ['good, no baste, salt overnight', Object.assign({}, base, { baste: 'none', salt: 'overnight' }), { placeAt: 215, dial: 0.4, flip: 45, pullAt: 50, rest: 280 }],
  ['dial left at 1.0', base, { placeAt: 215, dial: 1, flip: 45, pullAt: 50, rest: 280 }],
  ['pulled at 58 (over)', base, { placeAt: 215, dial: 0.4, flip: 45, pullAt: 58, rest: 280 }],
  ['pulled at 44 (under)', base, { placeAt: 215, dial: 0.4, flip: 45, pullAt: 44, rest: 280 }],
  ['no rest', base, { placeAt: 215, dial: 0.4, flip: 45, pullAt: 50, rest: 5 }],
  ['cold pan 150, not patted', Object.assign({}, base, { pat: false }), { placeAt: 150, dial: 0.4, flip: 45, pullAt: 50, rest: 280 }],
  ['no flips', base, { placeAt: 215, dial: 0.4, flip: 9999, pullAt: 50, rest: 280 }],
  ['salt 40 min before', Object.assign({}, base, { salt: 'mid' }), { placeAt: 215, dial: 0.4, flip: 45, pullAt: 50, rest: 280 }],
  ['dial .3 steady, flip 30', base, { placeAt: 215, dial: 0.3, flip: 30, pullAt: 50, rest: 280 }],
  ['dial .55, flip 30', base, { placeAt: 215, dial: 0.55, flip: 30, pullAt: 50, rest: 280 }],
  ['sear hot then low (dial 0.6 -> 0.3 at 120s)', base, { placeAt: 215, dial: 0.6, dial2: [120, 0.3], flip: 40, pullAt: 50, rest: 280 }],
  ['over-rested 900s', base, { placeAt: 215, dial: 0.4, flip: 45, pullAt: 50, rest: 900 }],
];
const f = (x, d = 1) => x.toFixed(d);
for (const [name, s, o] of cases) {
  const r = Score.compute ? cook(s, o) : null;
  console.log('\n' + name.padEnd(48), '=> TOTAL', r.total);
  console.log('  ', r.cats.map(c => c.id.slice(0, 5) + ' ' + f(c.points) + '/' + c.weight).join(' | '));
  const m = r.m;
  console.log('   peak', f(m.peakCore), 'carry', f(m.carry), 'zone', f(m.zone, 2), 'grey', f(m.greyFrac, 2), 'juice', f(m.juiceKept, 2), 'fat', f(m.fatRendered, 2), 'brownMed', m.brownMed.map(x => f(x, 2)).join('/'), 'min/max', f(m.brownMin, 2), f(m.brownMax, 2), 'flips', m.flips);
}
const r = cook(base, { placeAt: 215, dial: 1, flip: 45, pullAt: 58, rest: 5 });
console.log('\nFixes sample (bad cook):'); for (const x of r.fixes) console.log(' -', x.head, x.fix);
