/* ============================================================
   SIM — pure cooking simulation. No DOM, no Math.random, no Date.
   Port of tab B (Technical Architecture) of the handover package.
   Temperatures °C, lengths m, time in steak-seconds.
   ============================================================ */
var Sim = (function () {
  'use strict';

  var SIM_VERSION = 1;
  var DT = 0.25;     // steak-seconds per tick
  var L = 20;        // layers through the thickness
  var NX = 12, NY = 8, PAN_N = 16;

  // Physical constants (tab B "Starting constants")
  var PH = {
    k: 0.55, rho: 1050, cp: 3300, Lv: 2.26e6,
    h_up: 85, h_rest: 120, T_air: 35, T_room: 25,
    pan_loss: 45, rest_bleed: 0.005, h_baste: 180,
    water_dry: 0.12, water_wet: 0.35
  };

  /* ---------- helpers ---------- */
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function smoothstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function curve(x, pts) { // piecewise-linear, pts = [[x,y],...] ascending in x
    if (x <= pts[0][0]) return pts[0][1];
    for (var i = 1; i < pts.length; i++) {
      if (x <= pts[i][0]) {
        var a = pts[i - 1], b = pts[i];
        return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
      }
    }
    return pts[pts.length - 1][1];
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash2(ix, iy, seed) {
    var h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  }
  function vnoise(x, y, seed) {
    var ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    var u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    var a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, seed) {
    return vnoise(x, y, seed) * 0.55 + vnoise(x * 2.1 + 3.7, y * 2.1 + 1.3, seed + 11) * 0.3 + vnoise(x * 4.3 + 9.1, y * 4.3 + 5.2, seed + 23) * 0.15;
  }

  /* ---------- data tables (gameplay numbers live here) ---------- */
  var CUTS = {
    scotch_fillet: { id: 'scotch_fillet', name: 'Scotch fillet', alt: { AU: 'Scotch fillet', US: 'Boneless ribeye', UK: 'Boneless ribeye' },
      thMin: 25, thMax: 35, thDef: 30, marbling: 0.70, a: 0.075, b: 0.047, n: 2.4, doneOffset: 0,
      blurb: 'The reference cut. Rich marbling, most forgiving.',
      weights: { doneness: 25, crust: 20, consistency: 12, moisture: 12, fat: 8, rest: 8, flavour: 7, technique: 8 } },
    ribeye: { id: 'ribeye', name: 'Ribeye', alt: { AU: 'Ribeye', US: 'Ribeye', UK: 'Ribeye' },
      thMin: 30, thMax: 40, thDef: 35, marbling: 0.85, a: 0.088, b: 0.056, n: 2.2, doneOffset: 1,
      blurb: 'Fat-rich and thick. Aim a degree higher so the fat renders.',
      weights: { doneness: 22, crust: 20, consistency: 11, moisture: 11, fat: 13, rest: 8, flavour: 7, technique: 8 } },
    strip: { id: 'strip', name: 'New York strip', alt: { AU: 'Porterhouse', US: 'New York strip', UK: 'Sirloin' },
      thMin: 25, thMax: 35, thDef: 30, marbling: 0.50, a: 0.092, b: 0.040, n: 3.4, doneOffset: 0,
      blurb: 'Long and even, with a fat strip along one edge.',
      weights: { doneness: 25, crust: 22, consistency: 12, moisture: 12, fat: 6, rest: 8, flavour: 7, technique: 8 } },
    tenderloin: { id: 'tenderloin', name: 'Tenderloin', alt: { AU: 'Eye fillet', US: 'Filet mignon', UK: 'Fillet' },
      thMin: 40, thMax: 55, thDef: 45, marbling: 0.10, a: 0.047, b: 0.042, n: 2.1, doneOffset: -2,
      blurb: 'Thick and lean. Rewards a lower target and a patient rest.',
      weights: { doneness: 30, crust: 18, consistency: 12, moisture: 15, fat: 1, rest: 8, flavour: 8, technique: 8 } }
  };

  // heat capacity J/m2K, contact W/m2K, lateral diffusivity m2/s. Tested: cast iron, thin steel, non-stick. Rest are estimates.
  var PANS = {
    cast_iron: { id: 'cast_iron', name: 'Cast iron', cap: 26000, hc: 450, lat: 1.4e-5, diam: 0.26, status: 'tested',
      blurb: 'Slow to heat, holds its temperature when the steak lands. Best crust.' },
    carbon_steel: { id: 'carbon_steel', name: 'Carbon steel', cap: 14000, hc: 450, lat: 1.2e-5, diam: 0.26, status: 'estimate',
      blurb: 'Faster response, less stored heat.' },
    stainless: { id: 'stainless', name: 'Stainless clad', cap: 13000, hc: 430, lat: 5e-5, diam: 0.26, status: 'estimate',
      blurb: 'Even heat across the pan.' },
    nonstick: { id: 'nonstick', name: 'Non-stick', cap: 12000, hc: 320, lat: 5.5e-5, diam: 0.26, status: 'tested', maxSafeC: 260,
      blurb: 'Weak crust, forgiving. The coating is damaged above 260 °C.' }
  };

  var HEATS = {
    gas: { id: 'gas', name: 'Gas burner', flux: 24000, tau: 1.5, pattern: 'ring', blurb: 'Fast response. Ring-shaped hot zone.' },
    induction: { id: 'induction', name: 'Induction', flux: 26000, tau: 0.4, pattern: 'flat', blurb: 'Instant response, even across the base.' },
    coil: { id: 'coil', name: 'Electric coil', flux: 18000, tau: 28, pattern: 'wide', blurb: 'Slow to respond. Overshoots if you are not careful.' }
  };

  var FATS = {
    canola: { id: 'canola', name: 'Canola oil', smokeC: 204, hf: 1.0 },
    grapeseed: { id: 'grapeseed', name: 'Grapeseed oil', smokeC: 216, hf: 1.0 },
    olive: { id: 'olive', name: 'Olive oil', smokeC: 190, hf: 0.98 },
    avocado: { id: 'avocado', name: 'Avocado oil', smokeC: 270, hf: 1.0 },
    tallow: { id: 'tallow', name: 'Beef tallow', smokeC: 250, hf: 1.04 },
    ghee: { id: 'ghee', name: 'Ghee', smokeC: 250, hf: 1.03 }
  };
  var BASTES = {
    none: { id: 'none', name: 'No basting', burnC: 999, maxC: 0 },
    butter: { id: 'butter', name: 'Butter', burnC: 175, maxC: 185 },
    ghee: { id: 'ghee', name: 'Ghee', burnC: 250, maxC: 240 },
    tallow: { id: 'tallow', name: 'Tallow', burnC: 245, maxC: 235 }
  };

  var DONENESS = {
    rare: { id: 'rare', name: 'Rare', c: 50 },
    mr: { id: 'mr', name: 'Medium-rare', c: 55 },
    medium: { id: 'medium', name: 'Medium', c: 60 },
    mw: { id: 'mw', name: 'Medium-well', c: 65 },
    well: { id: 'well', name: 'Well done', c: 70 }
  };

  var DEFAULTS = {
    cut: 'scotch_fillet', thicknessMm: 30, pan: 'cast_iron', heat: 'gas', oil: 'canola', baste: 'butter', aromatic: 'none',
    startC: 6, pat: true, salt: 'now', doneness: 'mr', seed: 1, single: false, panStartC: 25, dial: 0
  };

  /* ---------- steak geometry & marbling ---------- */
  function outlinePoints(cut, seed, count) {
    count = count || 72;
    var r = mulberry32((seed * 7919 + 13) | 0);
    var p1 = r() * 6.28, p2 = r() * 6.28, a1 = 0.04 + r() * 0.03, a2 = 0.025 + r() * 0.025;
    var pts = [], e = 2 / cut.n;
    for (var i = 0; i < count; i++) {
      var th = (i / count) * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th);
      var w = 1 + a1 * Math.sin(2 * th + p1) + a2 * Math.sin(3 * th + p2);
      pts.push([cut.a * w * Math.sign(cs) * Math.pow(Math.abs(cs), e), cut.b * w * Math.sign(sn) * Math.pow(Math.abs(sn), e)]);
    }
    return pts;
  }
  function inPoly(x, y, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  // Fat map on a w*h grid, values 0..1 (1 = white fat). Streaks run along the length.
  function marblingMap(seed, w, h, level) {
    var out = new Float32Array(w * h);
    for (var j = 0; j < h; j++) {
      for (var i = 0; i < w; i++) {
        var u = i / w, v = j / h;
        var n1 = fbm(u * 5.5, v * 20, seed * 3 + 1);
        var n2 = fbm(u * 12 + 7, v * 46, seed * 3 + 2);
        var vein = smoothstep(0.56, 0.80, n1 * 0.62 + n2 * 0.38);
        var fleck = smoothstep(0.78, 0.92, vnoise(u * 30, v * 30, seed * 3 + 3));
        out[j * w + i] = clamp((vein + fleck * 0.5) * (0.35 + level * 1.15), 0, 1);
      }
    }
    return out;
  }

  /* ---------- the cook ---------- */
  function create(setup) {
    var s = {}; for (var k in DEFAULTS) s[k] = DEFAULTS[k]; for (k in setup) s[k] = setup[k];
    var cut = CUTS[s.cut], pan = PANS[s.pan], heat = HEATS[s.heat], oil = FATS[s.oil] || FATS.canola, bfat = BASTES[s.baste] || BASTES.none;
    var th = s.thicknessMm / 1000, dx = th / (L - 1);
    var alpha = PH.k / (PH.rho * PH.cp);
    var targetC = DONENESS[s.doneness].c + cut.doneOffset;

    var nx = s.single ? 1 : NX, ny = s.single ? 1 : NY, nc = nx * ny;
    var bboxX = cut.a * 1.1, bboxY = cut.b * 1.1;
    var colW = s.single ? 0.01 : (2 * bboxX) / nx, colH = s.single ? 0.01 : (2 * bboxY) / ny;
    var colArea = colW * colH;
    var poly = outlinePoints(cut, s.seed);
    var cx = new Float64Array(nc), cy = new Float64Array(nc), active = new Uint8Array(nc), cols = [];
    var i, j, c;
    for (j = 0; j < ny; j++) for (i = 0; i < nx; i++) {
      c = j * nx + i;
      cx[c] = s.single ? 0 : -bboxX + (i + 0.5) * colW;
      cy[c] = s.single ? 0 : -bboxY + (j + 0.5) * colH;
      active[c] = (s.single || inPoly(cx[c], cy[c], poly)) ? 1 : 0;
      if (active[c]) cols.push(c);
    }
    var probe = 0, best = 1e9;
    for (i = 0; i < cols.length; i++) { c = cols[i]; var d2 = cx[c] * cx[c] + cy[c] * cy[c]; if (d2 < best) { best = d2; probe = c; } }

    // marbling: one fat map per face, columns take the average of the two
    var MW = 96, MH = 64;
    var fatMaps = [marblingMap(s.seed, MW, MH, cut.marbling), marblingMap(s.seed + 101, MW, MH, cut.marbling)];
    var colMarb = new Float64Array(nc);
    for (c = 0; c < nc; c++) {
      if (!active[c]) continue;
      var ci = c % nx, cj = (c / nx) | 0, sum = 0, cnt = 0;
      var i0 = Math.floor(ci / nx * MW), i1 = Math.max(i0 + 1, Math.floor((ci + 1) / nx * MW));
      var j0 = Math.floor(cj / ny * MH), j1 = Math.max(j0 + 1, Math.floor((cj + 1) / ny * MH));
      for (var jj = j0; jj < j1; jj++) for (var ii = i0; ii < i1; ii++) { sum += fatMaps[0][jj * MW + ii] + fatMaps[1][jj * MW + ii]; cnt += 2; }
      colMarb[c] = sum / cnt;
    }

    // pan grid
    var pn = s.single ? 1 : PAN_N, np = pn * pn, R = pan.diam / 2, dxp = s.single ? 0.01 : pan.diam / pn, cellArea = dxp * dxp;
    var pActive = new Uint8Array(np), pattern = new Float64Array(np), Tp = new Float64Array(np), Tp2 = new Float64Array(np);
    var pr = new Float64Array(np);
    var pcount = 0, psum = 0;
    for (j = 0; j < pn; j++) for (i = 0; i < pn; i++) {
      var q = j * pn + i;
      var px = s.single ? 0 : -R + (i + 0.5) * dxp, py = s.single ? 0 : -R + (j + 0.5) * dxp;
      var rr = Math.sqrt(px * px + py * py) / R;
      pr[q] = rr;
      pActive[q] = (s.single || rr <= 1) ? 1 : 0;
      var f = 1;
      if (!s.single) {
        if (heat.pattern === 'ring') f = 0.30 + 1.5 * Math.exp(-Math.pow((rr - 0.46) / 0.24, 2));
        else if (heat.pattern === 'wide') f = 0.55 + 0.9 * Math.exp(-Math.pow((rr - 0.55) / 0.35, 2));
        else f = 1;
      }
      pattern[q] = f;
      if (pActive[q]) { pcount++; psum += f; }
      Tp[q] = s.panStartC;
    }
    for (q = 0; q < np; q++) pattern[q] = pActive[q] ? pattern[q] * pcount / psum : 0;
    var latK = s.single ? 0 : pan.lat * DT / (dxp * dxp);

    // steak state
    var T = new Float64Array(nc * L), T2 = new Float64Array(nc * L), peak = new Float64Array(nc * L), fatP = new Float64Array(nc * L);
    var water = new Float64Array(nc * 2), brown = new Float64Array(nc * 2);
    var cellOf = new Int32Array(nc).fill(-1), panDraw = new Float64Array(np);

    var waterInit = (function () {
      var w;
      if (s.salt === 'overnight') w = 0.06;
      else if (s.salt === 'mid') w = s.pat ? 0.30 : 0.38;
      else w = s.pat ? PH.water_dry : PH.water_wet;
      return w;
    })();

    var S = {
      setup: s, cut: cut, pan: pan, heat: heat, oil: oil, bfat: bfat, thickness: th, dx: dx, targetC: targetC,
      nx: nx, ny: ny, nc: nc, cols: cols, active: active, cx: cx, cy: cy, colW: colW, colH: colH, colArea: colArea, probe: probe,
      poly: poly, fatMaps: fatMaps, MW: MW, MH: MH, colMarb: colMarb, bboxX: bboxX, bboxY: bboxY,
      pn: pn, np: np, R: R, dxp: dxp, pActive: pActive, pattern: pattern, Tp: Tp,
      T: T, peak: peak, fatP: fatP, water: water, brown: brown,
      L: L, DT: DT,
      waterInit: waterInit, mode: 'preheat', tick: 0, dial: s.dial, power: s.dial, down: 0, mirror: 0, basting: false, panX: 0, panY: 0, yaw: 0, lifted: false,
      cmds: [], pending: [], trace: { t: [], core: [], pan: [] },
      evapRate: 0, smokeI: 0, smokeTime: 0, burnTime: 0, garlicBurn: 0, basteTime: 0, nsDamage: 0, maxPanC: s.panStartC,
      flips: 0, flipTicks: [], placeTick: -1, pullTick: -1, placePanC: 0, placeDial: 0, pullCore: 0, pullCorePeakAfter: 0,
      restTicks: 0, minPanC: 1e9, cookTicks: 0, faceDownTicks: [0, 0], droppedPeak: 0
    };

    function coreAt(c) { var b = c * L; return 0.5 * (T[b + 9] + T[b + 10]); }
    S.coreAt = coreAt;
    S.probeCore = function () { return coreAt(probe); };
    S.coreMean = function () {
      var sum = 0; for (var n = 0; n < cols.length; n++) sum += coreAt(cols[n]); return sum / cols.length;
    };
    S.centerCols = function () { // columns in the middle of the steak
      var out = [];
      for (var n = 0; n < cols.length; n++) { var cc = cols[n]; var nxr = cx[cc] / cut.a, nyr = cy[cc] / cut.b; if (nxr * nxr + nyr * nyr < 0.45) out.push(cc); }
      return out.length ? out : [probe];
    };

    function mapColumns() {
      var cosY = Math.cos(S.yaw), sinY = Math.sin(S.yaw);
      for (var n = 0; n < cols.length; n++) {
        var c = cols[n];
        if (s.single) { cellOf[c] = 0; continue; }
        var lx = cx[c], ly = S.mirror ? -cy[c] : cy[c];
        var x = S.panX + lx * cosY - ly * sinY, y = S.panY + lx * sinY + ly * cosY;
        var ii = Math.floor((x + R) / dxp), jj = Math.floor((y + R) / dxp);
        if (ii < 0 || jj < 0 || ii >= pn || jj >= pn) { cellOf[c] = -1; continue; }
        var qq = jj * pn + ii;
        cellOf[c] = pActive[qq] ? qq : -1;
      }
    }

    function panUnderMean() {
      var sum = 0, cnt = 0;
      for (var n = 0; n < cols.length; n++) { var q = cellOf[cols[n]]; if (q >= 0) { sum += Tp[q]; cnt++; } }
      return cnt ? sum / cnt : Tp[0];
    }
    S.panUnderMean = panUnderMean;
    S.panMean = function () { var sum = 0, cnt = 0; for (var q = 0; q < np; q++) if (pActive[q]) { sum += Tp[q]; cnt++; } return sum / cnt; };

    /* ----- commands (the only way state changes besides step) ----- */
    function applyCmd(cmd) {
      var t = cmd.type;
      if (t === 'dial') { S.dial = clamp(cmd.v, 0, 1); }
      else if (t === 'place') {
        if (S.mode !== 'preheat') return;
        S.panX = s.single ? 0 : clamp(cmd.x || 0, -R * 0.6, R * 0.6);
        S.panY = s.single ? 0 : clamp(cmd.y || 0, -R * 0.6, R * 0.6);
        S.yaw = cmd.yaw || 0; S.lifted = false;
        for (var n = 0; n < nc * L; n++) { T[n] = s.startC; peak[n] = s.startC; }
        for (n = 0; n < nc * 2; n++) { water[n] = waterInit; brown[n] = 0; }
        S.mode = 'cook'; S.placeTick = S.tick; S.down = cmd.down ? 1 : 0; S.mirror = S.down;
        mapColumns();
        S.placePanC = panUnderMean(); S.placeDial = S.dial;
      }
      else if (t === 'flip') {
        if (S.mode !== 'cook') return;
        S.down = 1 - S.down; S.mirror = 1 - S.mirror; S.flips++; S.flipTicks.push(S.tick);
        mapColumns();
      }
      else if (t === 'move') {   // steak set down again somewhere else in the pan (3D game)
        if (S.mode !== 'cook') return;
        S.panX = clamp(cmd.x || 0, -R * 0.6, R * 0.6); S.panY = clamp(cmd.y || 0, -R * 0.6, R * 0.6);
        S.yaw = cmd.yaw || 0; S.lifted = false; mapColumns();
      }
      else if (t === 'lift') { if (S.mode === 'cook') S.lifted = !!cmd.v; }   // steak off the pan (in the tongs, falling)
      else if (t === 'baste') { S.basting = !!cmd.v && S.mode === 'cook' && bfat.id !== 'none'; }
      else if (t === 'pull') {
        if (S.mode !== 'cook') return;
        S.mode = 'rest'; S.pullTick = S.tick; S.basting = false; S.lifted = false;
        S.pullCore = S.probeCore();
        S.pullCols = S.centerCols();
        S.restTicks = 0;
      }
      else if (t === 'finish') { if (S.mode === 'rest' || S.mode === 'cook') { if (S.mode === 'cook') applyCmd({ type: 'pull' }); S.mode = 'done'; } }
    }
    S.cmd = function (type, v, extra) {
      var cmd = { tick: S.tick, type: type, v: v };
      if (extra) { for (var kk in extra) cmd[kk] = extra[kk]; }
      S.cmds.push(cmd); applyCmd(cmd);
    };
    S.applyReplay = function (list) { S.pending = list.slice(); };

    /* ----- one tick ----- */
    var invCap = 2 / (PH.rho * PH.cp * dx);
    var dif = alpha * DT / (dx * dx);
    var hfOil = oil.hf;
    function step() {
      if (S.mode === 'done') return;
      while (S.pending.length && S.pending[0].tick <= S.tick) applyCmd(S.pending.shift());
      var mode = S.mode, n, c, b, f, q, cell;

      // burner power lags the dial
      S.power += DT * (S.dial - S.power) / Math.max(heat.tau, DT);
      if (S.power < 0) S.power = 0; if (S.power > 1) S.power = 1;

      var evap = 0;
      var panAvgUnder = 0;
      if (mode === 'cook') panAvgUnder = panUnderMean();
      panDraw.fill(0);

      if (mode === 'cook' || mode === 'rest') {
        var smokeI = 0;
        for (n = 0; n < cols.length; n++) {
          c = cols[n]; b = c * L; cell = cellOf[c];
          // faces: face 0 = layer 0, face 1 = layer L-1
          for (f = 0; f < 2; f++) {
            var idx = f ? b + L - 1 : b, inner = f ? idx - 1 : idx + 1, Tf = T[idx];
            var qf;
            if (mode === 'rest') qf = PH.h_rest * (30 - Tf);
            else if (f === S.down && !S.lifted) {
              if (cell >= 0) { qf = pan.hc * hfOil * (Tp[cell] - Tf); panDraw[cell] += qf * colArea; }
              else qf = PH.h_up * (PH.T_air - Tf);
            } else {
              if (S.basting && cell >= 0) { var Tfat = Math.min(Tp[cell], bfat.maxC); qf = PH.h_baste * (Tfat - Tf); }
              else qf = PH.h_up * (PH.T_air - Tf);
            }
            var cond = PH.k * (T[inner] - Tf) / dx;
            var w = water[c * 2 + f];
            if (w > 0 && Tf >= 100 && mode === 'cook') {
              var m = Math.min(w / DT, Math.max(0, qf + cond) / PH.Lv);
              w -= m * DT; qf -= m * PH.Lv; evap += m * colArea;
            }
            var Tn = Tf + DT * invCap * (cond + qf);
            if (w > 0 && Tn > 100) Tn = 100;
            water[c * 2 + f] = w;
            if (mode === 'cook' && w <= 0 && Tn > 115) brown[c * 2 + f] += DT / 60 * Math.pow(2, (Tn - 170) / 14);
            T2[idx] = Tn;
          }
          // interior
          for (var l = 1; l < L - 1; l++) {
            var i0 = b + l;
            T2[i0] = T[i0] + dif * (T[i0 + 1] - 2 * T[i0] + T[i0 - 1]);
          }
          if (mode === 'rest') {
            for (l = 0; l < L; l++) {
              var depth = Math.abs(l - (L - 1) / 2) / ((L - 1) / 2);
              T2[b + l] -= DT * PH.rest_bleed * depth * (T2[b + l] - PH.T_air);
            }
          }
          // clamp + peak + fat render
          for (l = 0; l < L; l++) {
            var ii2 = b + l, tv = T2[ii2];
            if (l > 0 && l < L - 1 && tv > 100) tv = 100;
            T2[ii2] = tv;
            if (tv > peak[ii2]) peak[ii2] = tv;
            if (tv > 58) fatP[ii2] += DT / 60 * (tv - 58) / 10;
          }
        }
        // swap
        T.set(T2.subarray(0, nc * L));
      }

      // pan
      for (var qp = 0; qp < np; qp++) {
        if (!pActive[qp]) continue;
        var flux = heat.flux * S.power * pattern[qp];
        var draw = panDraw[qp] / cellArea;
        var Tq = Tp[qp];
        var dT = DT * (flux - draw - PH.pan_loss * (Tq - PH.T_room)) / pan.cap;
        if (latK > 0) {
          var ix = qp % pn, iy = (qp / pn) | 0, acc = 0;
          if (ix > 0 && pActive[qp - 1]) acc += Tp[qp - 1] - Tq;
          if (ix < pn - 1 && pActive[qp + 1]) acc += Tp[qp + 1] - Tq;
          if (iy > 0 && pActive[qp - pn]) acc += Tp[qp - pn] - Tq;
          if (iy < pn - 1 && pActive[qp + pn]) acc += Tp[qp + pn] - Tq;
          dT += latK * acc;
        }
        Tp2[qp] = Tq + dT;
      }
      for (qp = 0; qp < np; qp++) if (pActive[qp]) { Tp[qp] = Tp2[qp]; if (Tp[qp] > S.maxPanC) S.maxPanC = Tp[qp]; if (pan.maxSafeC && Tp[qp] > pan.maxSafeC) S.nsDamage += DT / np; }

      // bookkeeping
      S.evapRate = evap;
      if (mode === 'cook') {
        S.cookTicks++;
        S.faceDownTicks[S.down]++;
        var pm = panUnderMean();
        if (pm < S.minPanC) S.minPanC = pm;
        var si = clamp((pm - oil.smokeC) / 30, 0, 1);
        S.smokeI = si; S.smokeTime += DT * si;
        if (S.basting) {
          S.basteTime += DT;
          if (pm > bfat.burnC) S.burnTime += DT * clamp((pm - bfat.burnC) / 25, 0, 1);
          if (s.aromatic === 'garlic' && Math.min(pm, bfat.maxC) > 160) S.garlicBurn += DT;
        }
      } else { S.smokeI *= 0.9; }
      if (mode === 'rest') S.restTicks++;
      S.tick++;
      if (S.tick % 4 === 0) {
        S.trace.t.push(S.tick * DT); S.trace.core.push(mode === 'preheat' ? 0 : S.probeCore()); S.trace.pan.push(mode === 'cook' ? panUnderMean() : S.panMean());
      }
      if (mode === 'rest') {
        var cc2 = S.pullCols, sum2 = 0;
        for (var z = 0; z < cc2.length; z++) sum2 += coreAt(cc2[z]);
        S.restCore = sum2 / cc2.length;
      }
    }
    S.step = step;
    S.steps = function (n) { for (var z = 0; z < n; z++) step(); };
    S.time = function () { return S.tick * DT; };
    S.cookTime = function () { return S.cookTicks * DT; };
    S.restTime = function () { return S.restTicks * DT; };

    // Derived measurements used by scoring and the view
    S.juice = function (c, l) { return 1 - smoothstep(52, 78, peak[c * L + l]); };
    S.peakCore = function (c) { var b = c * L; return Math.max(peak[b + 9], peak[b + 10]); };

    // initial pan mapping for the preheat view
    S.mapColumns = mapColumns;
    return S;
  }

  function replay(setup, cmds, maxTicks) {
    var c = create(setup);
    c.applyReplay(cmds);
    var n = 0, limit = maxTicks || 200000;
    while (c.mode !== 'done' && n < limit) { c.step(); n++; }
    return c;
  }

  return {
    VERSION: SIM_VERSION, DT: DT, L: L, PH: PH, CUTS: CUTS, PANS: PANS, HEATS: HEATS, FATS: FATS, BASTES: BASTES, DONENESS: DONENESS, DEFAULTS: DEFAULTS,
    create: create, replay: replay, outlinePoints: outlinePoints, marblingMap: marblingMap,
    util: { clamp: clamp, smoothstep: smoothstep, lerp: lerp, curve: curve, mulberry32: mulberry32, vnoise: vnoise, fbm: fbm }
  };
})();
if (typeof module !== 'undefined') module.exports = Sim;
