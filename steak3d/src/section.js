/* Cross-section of the finished steak (2D canvas), used on the result screen. Ported from the 2D prototype. */
'use strict';
var U = Sim.util, clamp = U.clamp, smoothstep = U.smoothstep, lerp = U.lerp;
var C = require('./colors.js'), meatRGB = C.meatRGB, crustRGB = C.crustRGB;
var _rgb = [0, 0, 0], _rgb2 = [0, 0, 0];
  /* ============================================================
     Cross-section
     ============================================================ */
  function renderSection(cook, row, canvas, width) {
    var L = cook.L, nx = cook.nx, SW = width || 760;
    var lenM = 2 * cook.bboxX, thM = cook.thickness;
    var SH = Math.round(SW * thM / lenM), pad = 18;
    canvas.width = SW + pad * 2; canvas.height = SH + pad * 2;
    var ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
    var img = ctx.createImageData(SW, SH), d = img.data;
    // extent of this row from the outline
    var yRow = cook.cy[row * nx], xmin = 1e9, xmax = -1e9, P = cook.poly;
    for (var i = 0, j = P.length - 1; i < P.length; j = i++) {
      var yi = P[i][1], yj = P[j][1];
      if ((yi > yRow) !== (yj > yRow)) { var xx = P[i][0] + (yRow - yi) / (yj - yi) * (P[j][0] - P[i][0]); if (xx < xmin) xmin = xx; if (xx > xmax) xmax = xx; }
    }
    if (xmin > xmax) { xmin = -cook.cut.a; xmax = cook.cut.a; }
    var pxPerM = SW / lenM, offX = SW / 2;
    var corner = 0.0025 * pxPerM;
    // per-column profiles along this row
    var rowCols = []; for (var ci = 0; ci < nx; ci++) { var c = row * nx + ci; if (cook.active[c]) rowCols.push(c); }
    if (!rowCols.length) rowCols = [cook.probe];
    var seed = cook.setup.seed;
    for (var y = 0; y < SH; y++) {
      var depth = y / (SH - 1), lf = (1 - depth) * (L - 1);      // layer L-1 on top
      var l0 = Math.min(Math.floor(lf), L - 2), lt = lf - l0;
      for (var x = 0; x < SW; x++) {
        var X = (x - offX) / pxPerM;
        if (X < xmin || X > xmax) continue;
        // rounded corners
        var ex = Math.min(X - xmin, xmax - X) * pxPerM, ey = Math.min(y, SH - 1 - y), al = 1;
        if (ex < corner && ey < corner) { var cdx = corner - ex, cdy = corner - ey; al = clamp(corner - Math.sqrt(cdx * cdx + cdy * cdy) + 0.5, 0, 1); }
        if (al <= 0) continue;
        // locate columns
        var gi = clamp((X + cook.bboxX) / (lenM / nx) - 0.5, 0, nx - 1), i0 = Math.min(Math.floor(gi), nx - 2 < 0 ? 0 : nx - 2), ft = gi - i0;
        var ca = row * nx + i0, cb = row * nx + Math.min(i0 + 1, nx - 1);
        if (!cook.active[ca]) ca = nearestActive(cook, row, i0); if (!cook.active[cb]) cb = nearestActive(cook, row, Math.min(i0 + 1, nx - 1));
        var Tn = lerp(lerp(cook.peak[ca * L + l0], cook.peak[ca * L + l0 + 1], lt), lerp(cook.peak[cb * L + l0], cook.peak[cb * L + l0 + 1], lt), ft);
        var nz = U.vnoise(x * 0.5, y * 0.5, seed + 3), nz2 = U.fbm(x * 0.05, y * 0.05, seed + 17);
        meatRGB(Tn + (nz2 - 0.5) * 2.2, _rgb);
        var r = _rgb[0], g = _rgb[1], b = _rgb[2];
        // fat: opaque white while unrendered, clear and golden once rendered
        var mb = lerp(cook.colMarb[ca], cook.colMarb[cb], ft);
        var fn = U.fbm(x * 0.16 + 4, y * 0.34 + 2, seed + 29);
        var thr = 1 - clamp(mb * 2.1, 0, 0.62), fa = smoothstep(thr, thr + 0.08, fn);
        if (fa > 0) {
          var fp = lerp(Math.min(1, cook.fatP[ca * L + l0] / 0.8), Math.min(1, cook.fatP[cb * L + l0] / 0.8), ft);
          var op = 0.95 - 0.55 * fp;
          r = lerp(r, lerp(240, 224, fp), fa * op); g = lerp(g, lerp(228, 196, fp), fa * op); b = lerp(b, lerp(216, 150, fp), fa * op);
        }
        // crust on the two faces
        var bt = lerp(cook.brown[ca * 2 + 1], cook.brown[cb * 2 + 1], ft), bbm = lerp(cook.brown[ca * 2], cook.brown[cb * 2], ft);
        var cmm = function (bv) { return (0.35 + 0.9 * Math.min(bv, 1.6)) * 0.001 * pxPerM; };
        var ctp = cmm(bt), cbt = cmm(bbm);
        var wTop = bt > 0.04 ? smoothstep(ctp + 1.3, Math.max(0.2, ctp - 1.3), y) : 0, wBot = bbm > 0.04 ? smoothstep(cbt + 1.3, Math.max(0.2, cbt - 1.3), SH - 1 - y) : 0;
        if (wTop > 0) { crustRGB(bt * (0.85 + 0.3 * nz), _rgb2); r = lerp(r, _rgb2[0], wTop); g = lerp(g, _rgb2[1], wTop); b = lerp(b, _rgb2[2], wTop); }
        if (wBot > 0) { crustRGB(bbm * (0.85 + 0.3 * nz), _rgb2); r = lerp(r, _rgb2[0], wBot); g = lerp(g, _rgb2[1], wBot); b = lerp(b, _rgb2[2], wBot); }
        // juice sheen and fibre grain
        var juice = 1 - smoothstep(52, 78, Tn);
        var grain = 0.94 + 0.12 * nz;
        r *= grain; g *= grain; b *= grain;
        var sh = (1 - depth) * 26 * juice * (0.5 + nz2) * 0.5 + (depth < 0.06 ? 10 : 0);
        r += sh; g += sh * 0.8; b += sh * 0.7;
        var o = (y * SW + x) * 4; d[o] = clamp(r, 0, 255); d[o + 1] = clamp(g, 0, 255); d[o + 2] = clamp(b, 0, 255); d[o + 3] = al * 255;
      }
    }
    // draw with a soft shadow
    var tmp = document.createElement('canvas'); tmp.width = SW; tmp.height = SH; tmp.getContext('2d').putImageData(img, 0, 0);
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
    ctx.drawImage(tmp, pad, pad);
    ctx.restore();
    ctx.drawImage(tmp, pad, pad);
    return { x: pad, y: pad, w: SW, h: SH, xmin: xmin, xmax: xmax, rowCols: rowCols };
  }
  function nearestActive(cook, row, i) {
    var nx = cook.nx;
    for (var d = 1; d < nx; d++) {
      if (i - d >= 0 && cook.active[row * nx + i - d]) return row * nx + i - d;
      if (i + d < nx && cook.active[row * nx + i + d]) return row * nx + i + d;
    }
    return cook.probe;
  }

module.exports = { renderSection: renderSection };
