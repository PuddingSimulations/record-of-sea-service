const Sim = require('../src/sim.js');
Sim.PANS.thin_steel = { id: 'thin_steel', name: 'Thin steel', cap: 9000, hc: 450, lat: 0, diam: 0.26 };

// [name, options, target pull s, carry, lowest pan, brownA, brownB]
const rows = [
  ['Reference 30 mm', {}, 522, 5.1, 165, 0.85, 0.58],
  ['Flip every 30 s', { flip: 30 }, 498, 5.9, 159, 0.50, 0.42],
  ['Flip every 120 s', { flip: 120 }, 563, 4.1, 168, 1.34, 0.74],
  ['20 mm', { th: 20 }, 261, 6.7, 162, 0.32, 0.18],
  ['40 mm', { th: 40 }, 866, 3.8, 164, 1.77, 1.57],
  ['Cold pan 150', { panStart: 150 }, 573, 5.2, 136, 0.44, 0.40],
  ['Very hot pan 280', { panStart: 280 }, 508, 5.3, 171, 1.53, 0.81],
  ['Thin steel', { pan: 'thin_steel' }, 549, 5.0, 136, 0.65, 0.45],
  ['Not patted dry', { pat: false }, 546, 5.0, 150, 0.65, 0.40],
  ['Tempered to 15', { startC: 15 }, 460, 5.2, 168, 0.81, 0.56],
];

function run(o) {
  const c = Sim.create({
    single: true, cut: 'scotch_fillet', thicknessMm: o.th || 30, pan: o.pan || 'cast_iron', heat: 'gas',
    oil: 'canola', baste: 'none', startC: o.startC || 6, pat: o.pat !== false, salt: 'now', panStartC: o.panStart || 230, dial: 1
  });
  c.cmd('place', 0, { x: 0, y: 0 });
  const flip = o.flip || 60;
  let nextFlip = flip, lowest = 1e9, safety = 0;
  while (c.probeCore() < (o.pullAt || 50) && safety++ < 20000) {
    if (c.time() >= nextFlip) { c.cmd('flip'); nextFlip += flip; }
    c.step();
    if (c.Tp[0] < lowest) lowest = c.Tp[0];
  }
  const pullT = c.time(), bA = c.brown[0], bB = c.brown[1];
  c.cmd('pull');
  let pk = 0;
  for (let i = 0; i < 2400; i++) { c.step(); if (c.restCore > pk) pk = c.restCore; }
  return { pull: pullT, carry: pk - c.pullCore, low: lowest, bA, bB };
}

let worst = 0;
console.log('scenario'.padEnd(20), 'pull(s) got/want', 'carry got/want', 'low got/want', 'brown A/B got | want');
for (const r of rows) {
  const g = run(r[1]);
  const dPull = (g.pull - r[2]) / r[2] * 100;
  worst = Math.max(worst, Math.abs(dPull));
  console.log(r[0].padEnd(20),
    `${g.pull.toFixed(0)}/${r[2]} (${dPull >= 0 ? '+' : ''}${dPull.toFixed(1)}%)`.padEnd(22),
    `${g.carry.toFixed(1)}/${r[3]}`.padEnd(12),
    `${g.low.toFixed(0)}/${r[4]}`.padEnd(10),
    `${g.bA.toFixed(2)}/${g.bB.toFixed(2)} | ${r[5]}/${r[6]}`);
}
console.log('worst pull-time error %:', worst.toFixed(1));
