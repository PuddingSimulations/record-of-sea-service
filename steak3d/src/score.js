/* ============================================================
   SCORE — pure scoring + feedback. Reads a finished Sim cook.
   ============================================================ */
var Score = (function () {
  'use strict';
  var U = Sim.util, clamp = U.clamp, curve = U.curve, smoothstep = U.smoothstep;

  var CATS = [
    { id: 'doneness', name: 'Doneness accuracy' },
    { id: 'crust', name: 'Crust' },
    { id: 'consistency', name: 'Consistency' },
    { id: 'moisture', name: 'Moisture' },
    { id: 'fat', name: 'Fat rendering' },
    { id: 'rest', name: 'Resting' },
    { id: 'flavour', name: 'Flavour' },
    { id: 'technique', name: 'Technique' }
  ];

  // data-driven curves
  var CURVES = {
    doneness: [[0, 1], [1, 1], [3, 0.8], [6, 0.4], [10, 0]],            // |peak - target| in °C
    crust: [[0, 0], [0.3, 0.2], [0.6, 0.65], [0.85, 0.95], [1.0, 1], [1.45, 1], [1.9, 0.7], [2.6, 0.3], [3.6, 0]], // browning level -> quality
    rest: [[0, 0], [0.4, 0.35], [0.7, 0.9], [0.9, 1], [1.6, 1], [2.4, 0.7], [4, 0.3]], // rest / ideal
    flips: [[0, 0.3], [1, 0.55], [2, 0.85], [3, 1], [24, 1], [40, 0.5], [60, 0.2]],
    preheat: [[110, 0], [170, 0.55], [200, 1]],
    consistency: [[0.10, 0], [0.45, 1]],   // fraction of the thickness within the target zone
    moisture: [[0.20, 0], [0.50, 1]],      // mean juice retained
    fat: [[0.15, 0], [0.80, 1]]
  };

  function idealRest(cut, thMm) { return 130 + 5 * thMm; }   // steak-seconds

  function fmt(x, d) { return (Math.round(x * Math.pow(10, d || 0)) / Math.pow(10, d || 0)).toFixed(d || 0); }
  function mmss(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60); }

  function compute(c) {
    var s = c.setup, cut = c.cut, L = c.L, target = c.targetC, W = cut.weights;
    var centre = c.pullCols || c.centerCols();
    var m = {};

    // --- doneness
    var pk = 0, ci;
    for (ci = 0; ci < centre.length; ci++) pk += c.peakCore(centre[ci]);
    pk /= centre.length;
    m.peakCore = pk; m.delta = pk - target; m.target = target;
    m.carry = (c.restCore !== undefined ? Math.max(pk - c.pullCore, 0) : 0);
    m.pullCore = c.pullCore;
    var sDone = curve(Math.abs(m.delta), CURVES.doneness);

    // --- crust (both faces)
    var qsum = 0, qn = 0, cover = 0, bmin = 1e9, bmax = 0, bsum = 0;
    var faceB = [[], []];
    for (var n = 0; n < c.cols.length; n++) {
      var col = c.cols[n];
      for (var f = 0; f < 2; f++) {
        var b = c.brown[col * 2 + f];
        faceB[f].push(b);
        var q = curve(b, CURVES.crust);
        qsum += q; qn++; if (q >= 0.7) cover++;
        if (b < bmin) bmin = b; if (b > bmax) bmax = b; bsum += b;
      }
    }
    m.crustQ = qsum / qn; m.coverage = cover / qn; m.brownMean = bsum / qn; m.brownMin = bmin; m.brownMax = bmax;
    for (var f2 = 0; f2 < 2; f2++) { faceB[f2].sort(function (a, b) { return a - b; }); }
    m.brownMed = [faceB[0][faceB[0].length >> 1], faceB[1][faceB[1].length >> 1]];
    var sCrust = clamp(0.7 * m.crustQ + 0.3 * m.coverage, 0, 1);

    // --- consistency: correct zone + grey band, over centre columns
    var zone = 0, grey = 0, cnt = 0, juice = 0;
    for (ci = 0; ci < centre.length; ci++) {
      var cc = centre[ci], base = cc * L;
      for (var l = 0; l < L; l++) {
        var p = c.peak[base + l];
        if (Math.abs(p - target) <= 6) zone++;
        if (p > target + 14) grey++;
        juice += 1 - smoothstep(52, 78, p);
        cnt++;
      }
    }
    m.zone = zone / cnt; m.greyFrac = grey / cnt; m.greyMm = (grey / cnt) * c.thickness * 1000;
    var sCons = clamp(curve(m.zone, CURVES.consistency) * (1 - 0.30 * clamp((m.greyFrac - 0.35) / 0.4, 0, 1)), 0, 1);

    // --- moisture
    m.juiceKept = juice / cnt;
    var restT = c.restTime ? c.restTime() : 0;
    var ideal = idealRest(cut, s.thicknessMm);
    m.restT = restT; m.restIdeal = ideal; m.restRatio = restT / ideal;
    var runoff = (1 - clamp(restT / (ideal * 0.8), 0, 1)) * 0.14;   // slicing too early loses juice
    m.runoff = runoff;
    var onTarget = 0.5 + 0.5 * sDone;   // juiciness and evenness only count when you hit your target
    var sMoist = curve(m.juiceKept - runoff, CURVES.moisture) * onTarget;
    sCons *= onTarget;

    // --- fat rendering
    var fw = 0, fr = 0;
    for (n = 0; n < c.cols.length; n++) {
      var col2 = c.cols[n], mb = c.colMarb[col2] + 0.02, r = 0;
      for (l = 0; l < L; l++) r += Math.min(1, c.fatP[col2 * L + l] / 0.8);
      fw += mb; fr += mb * (r / L);
    }
    m.fatRendered = fw > 0 ? fr / fw : 0;
    var sFat = curve(m.fatRendered, CURVES.fat);

    // --- rest
    var sRest = curve(m.restRatio, CURVES.rest);

    // --- flavour
    var salt = s.salt === 'overnight' ? 0.15 : s.salt === 'now' ? 0.05 : 0;
    var baste = 0, burnPen = 0, arom = 0, garlicPen = 0;
    if (c.bfat.id !== 'none') {
      baste = 0.12 * clamp(c.basteTime / 30, 0, 1);
      burnPen = 0.30 * clamp(c.burnTime / 15, 0, 1);
      if (s.aromatic !== 'none' && c.basteTime >= 15) { arom = 0.08; if (s.aromatic === 'garlic' && c.garlicBurn > 12) garlicPen = 0.22; }
    }
    var smokePen = 0.30 * clamp(c.smokeTime / 25, 0, 1);
    smokePen += 0.25 * clamp((Math.max(m.brownMed[0], m.brownMed[1]) - 2) / 2, 0, 1);   // acrid char
    m.smokeTime = c.smokeTime; m.burnTime = c.burnTime; m.garlicBurn = c.garlicBurn; m.basteTime = c.basteTime;
    var sFlav = clamp(0.45 + 0.2 * sCrust + salt + baste + arom - burnPen - garlicPen - smokePen, 0, 1);

    // --- technique
    var tPre = curve(c.placePanC, CURVES.preheat);
    var tDry = s.pat ? (s.salt === 'mid' ? 0.45 : 1) : 0.3;
    if (s.salt === 'overnight') tDry = 1;
    var tFlip = curve(c.flips, CURVES.flips);
    var tPan = c.pan.maxSafeC ? 1 - clamp(c.nsDamage / 15, 0, 1) : 1;
    m.pre = tPre; m.dry = tDry; m.flipScore = tFlip; m.pan = tPan; m.flips = c.flips; m.placePanC = c.placePanC;
    var sTech = (tPre + tDry + tFlip + tPan) / 4;

    var raw = { doneness: sDone, crust: sCrust, consistency: sCons, moisture: sMoist, fat: sFat, rest: sRest, flavour: sFlav, technique: sTech };
    var cats = [], total = 0;
    for (var i = 0; i < CATS.length; i++) {
      var id = CATS[i].id, pts = W[id] * raw[id];
      total += pts;
      cats.push({ id: id, name: CATS[i].name, weight: W[id], score: raw[id], points: pts, loss: W[id] - pts });
    }
    total = Math.round(total * 10) / 10;

    var fixes = feedback(c, m, cats);
    return { total: total, cats: cats, fixes: fixes, m: m };
  }

  /* ---------- feedback: name the number, name the fix ---------- */
  function pullRate(c) { // °C per steak-second at the probe, over the last ~20 s before the pull
    var t = c.trace, n = t.core.length;
    if (n < 8) return 0.05;
    var a = n - 1, b = Math.max(0, n - 6);
    var dt = t.t[a] - t.t[b];
    return dt > 0 ? Math.max((t.core[a] - t.core[b]) / dt, 0.02) : 0.05;
  }

  function feedback(c, m, cats) {
    var s = c.setup, msgs = [];
    var by = {}; for (var i = 0; i < cats.length; i++) by[cats[i].id] = cats[i];

    // doneness
    if (by.doneness.loss > 0.4) {
      var over = m.delta > 0, rate = pullRate(c);
      var secs = Math.round(Math.abs(m.delta) / rate / 5) * 5;
      if (over) msgs.push({ cat: 'doneness', loss: by.doneness.loss,
        head: 'Centre peaked at ' + fmt(m.peakCore, 1) + ' °C, ' + fmt(Math.abs(m.delta), 1) + ' ° over the ' + fmt(m.target, 0) + ' °C target.',
        fix: 'Pull about ' + secs + ' seconds earlier. The probe still gained ' + fmt(m.carry, 1) + ' ° after you took it off.' });
      else msgs.push({ cat: 'doneness', loss: by.doneness.loss,
        head: 'Centre peaked at ' + fmt(m.peakCore, 1) + ' °C, ' + fmt(Math.abs(m.delta), 1) + ' ° under the ' + fmt(m.target, 0) + ' °C target.',
        fix: 'Leave it on about ' + secs + ' seconds longer. Expect roughly ' + fmt(Math.max(m.carry, 4), 0) + ' ° of carryover during the rest.' });
    }
    // crust
    if (by.crust.loss > 1.0) {
      var hi = m.brownMed[0] > 1.7 || m.brownMed[1] > 1.7, lo = Math.max(m.brownMed[0], m.brownMed[1]) < 0.6, spread = m.brownMax - m.brownMin;
      var head, fix;
      if (hi) { head = 'Crust is over-browned: median browning ' + fmt(Math.max(m.brownMed[0], m.brownMed[1]), 1) + ' where about 1.0 is a good crust.'; fix = 'The pan held far above searing heat. Back the dial off to around 40% once the steak is in.'; }
      else if (lo) {
        head = 'Crust is pale: median browning ' + fmt(Math.min(m.brownMed[0], m.brownMed[1]), 1) + ' against about 1.0 for a good crust.';
        fix = !s.pat || s.salt === 'mid' ? 'A wet surface sits at 100 °C and will not brown. Pat it dry, or salt at the last minute or the night before.' : (c.placePanC < 190 ? 'The pan was only ' + fmt(c.placePanC, 0) + ' °C when the steak went in. Preheat to about 215 °C.' : 'Keep the dial a little higher after the steak goes in, or leave each side down longer.');
      } else { head = 'Browning was uneven: it ranged from ' + fmt(m.brownMin, 1) + ' to ' + fmt(m.brownMax, 1) + ' across the faces.'; fix = 'Flip more often, and use a pan or burner that spreads heat evenly.'; }
      msgs.push({ cat: 'crust', loss: by.crust.loss, head: head, fix: fix });
    }
    // consistency
    if (by.consistency.loss > 1.0) {
      msgs.push({ cat: 'consistency', loss: by.consistency.loss,
        head: 'The grey band averaged ' + fmt(m.greyMm / 2, 1) + ' mm per side, and ' + fmt(m.zone * 100, 0) + '% of the thickness landed in the target zone.',
        fix: 'Sear hard and briefly, then drop the heat. A lower, steadier heat after the first side narrows the band.' });
    }
    // moisture
    if (by.moisture.loss > 1.0) {
      var early = m.runoff > 0.05;
      msgs.push({ cat: 'moisture', loss: by.moisture.loss,
        head: early ? 'You sliced after ' + mmss(m.restT) + ' of rest and the juice ran out onto the board.' : 'Too much of the steak passed 60 °C, where juice loss climbs steeply.',
        fix: early ? 'Give it closer to ' + mmss(m.restIdeal) + ' so the juices settle before you cut.' : 'Pull earlier, and keep the heat steadier so less of the outer meat overcooks.' });
    }
    // rest
    if (by.rest.loss > 1.0) {
      var short = m.restRatio < 1;
      msgs.push({ cat: 'rest', loss: by.rest.loss,
        head: 'Rested ' + mmss(m.restT) + '. The ideal for a ' + s.thicknessMm + ' mm ' + c.cut.name.toLowerCase() + ' is about ' + mmss(m.restIdeal) + '.',
        fix: short ? 'Rest it longer before you slice.' : 'It rested long enough to lose heat. Slice a little sooner.' });
    }
    // fat
    if (by.fat.loss > 1.5) {
      msgs.push({ cat: 'fat', loss: by.fat.loss,
        head: 'Only ' + fmt(m.fatRendered * 100, 0) + '% of the marbling rendered.',
        fix: 'Fat needs time above about 60 °C. A slightly higher doneness or a longer, gentler cook renders more.' });
    }
    // flavour
    if (by.flavour.loss > 1.2) {
      var fh, ff;
      if (m.smokeTime > 8) { fh = 'The oil smoked for ' + fmt(m.smokeTime, 0) + ' seconds, which adds acrid flavour.'; ff = 'Use a higher smoke point oil such as avocado or tallow, or run the pan cooler.'; }
      else if (m.burnTime > 4) { fh = 'The butter burned for about ' + fmt(m.burnTime, 0) + ' seconds.'; ff = 'Butter burns above about 175 °C. Drop the dial before basting, or baste with ghee.'; }
      else if (m.garlicBurn > 12) { fh = 'The garlic burned and turned bitter.'; ff = 'Add garlic only once the pan is below about 160 °C, or use thyme or rosemary.'; }
      else if (c.bfat.id !== 'none' && m.basteTime < 15) { fh = m.basteTime < 1 ? 'You did not baste.' : 'Basting lasted only ' + fmt(m.basteTime, 0) + ' seconds.'; ff = 'Hold baste for 20 to 30 seconds near the end for the full flavour bonus.'; }
      else { fh = 'Flavour was plain.'; ff = 'Salt the night before, then finish with butter basting and an aromatic.'; }
      msgs.push({ cat: 'flavour', loss: by.flavour.loss, head: fh, fix: ff });
    }
    // technique
    if (by.technique.loss > 1.0) {
      var th, tf;
      if (m.pre < 0.7) { th = 'The pan was ' + fmt(m.placePanC, 0) + ' °C when the steak went in.'; tf = 'Wait until the pan reads about 200 °C or more before you place the steak.'; }
      else if (m.dry < 0.7) { th = 'The surface was wet going into the pan.'; tf = 'Pat the steak dry, and avoid salting about 40 minutes ahead.'; }
      else if (m.pan < 0.8) { th = 'The non-stick pan went above 260 °C.'; tf = 'Use cast iron or carbon steel for a hard sear.'; }
      else if (m.flips > 12) { th = 'You flipped ' + m.flips + ' times.'; tf = 'Flipping every 30 to 60 seconds is plenty.'; }
      else { th = 'You flipped ' + m.flips + (m.flips === 1 ? ' time.' : ' times.'); tf = 'Flip two or three times so both faces cook evenly.'; }
      msgs.push({ cat: 'technique', loss: by.technique.loss, head: th, fix: tf });
    }
    msgs.sort(function (a, b) { return b.loss - a.loss; });
    return msgs.slice(0, 3);
  }

  return { CATS: CATS, CURVES: CURVES, compute: compute, idealRest: idealRest, mmss: mmss };
})();
if (typeof module !== 'undefined') module.exports = Score;
