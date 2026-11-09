/* ============================================================
   STEAK MESH: the visible steak. A rounded slab skinned to the soft-body particles,
   with face textures painted from the cooking sim (browning, doneness, fat, moisture).
   ============================================================ */
import * as THREE from 'three';
import { meatRGB, crustRGB } from './colors.js';

const U = Sim.util, clamp = U.clamp, smoothstep = U.smoothstep;
const RINGS = 9, SEG = 72;
const SIDE = [[0.96, 1.0], [0.985, 0.93], [1.0, 0.72], [1.012, 0.35], [1.016, 0.0], [1.012, -0.35], [1.0, -0.72], [0.985, -0.93], [0.96, -1.0]];
const TW = 288, TH = 192, SW = 360, SH = 64, K = 5;

function fillGrid(g, cook) {
  const nx = cook.nx, ny = cook.ny, have = new Uint8Array(cook.nc);
  for (let c = 0; c < cook.nc; c++) have[c] = cook.active[c];
  for (let it = 0; it < 4; it++) {
    const add = [];
    for (let c = 0; c < cook.nc; c++) {
      if (have[c]) continue;
      const ci = c % nx, cj = (c / nx) | 0; let s = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const i2 = ci + di, j2 = cj + dj; if (i2 < 0 || j2 < 0 || i2 >= nx || j2 >= ny) continue;
        const c2 = j2 * nx + i2; if (have[c2]) { s += g[c2]; n++; }
      }
      if (n) add.push([c, s / n]);
    }
    for (const [c, v] of add) { g[c] = v; have[c] = 1; }
  }
}

function canvasTex(w, h, srgb) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return { canvas: c, ctx: c.getContext('2d'), tex: t, img: c.getContext('2d').createImageData(w, h) };
}

export class SteakMesh {
  constructor(cook, body) {
    this.cook = cook; this.body = body;
    const poly = cook.poly, t = cook.thickness;
    this.bx = cook.bboxX; this.by = cook.bboxY;
    // ---- rest-pose vertices (steak frame) ----
    const rest = [];                // [x, y, z, u, v]
    const uvOf = (x, y) => [(x / this.bx + 1) / 2, (y / this.by + 1) / 2];
    const idxTop = [], idxBot = [], idxSide = [];
    const addCap = (zs, list, flip) => {
      const base = rest.length;
      rest.push([0, 0, zs * t / 2, ...uvOf(0, 0)]);
      for (let r = 1; r <= RINGS; r++) {
        const s = 0.96 * r / RINGS;
        for (let i = 0; i < SEG; i++) { const x = poly[i][0] * s, y = poly[i][1] * s; rest.push([x, y, zs * t / 2, ...uvOf(x, y)]); }
      }
      const ring = (r, i) => base + 1 + (r - 1) * SEG + (i % SEG);
      for (let i = 0; i < SEG; i++) { // fan
        const a = base, b = ring(1, i), c = ring(1, i + 1);
        flip ? list.push(a, c, b) : list.push(a, b, c);
      }
      for (let r = 1; r < RINGS; r++) for (let i = 0; i < SEG; i++) {
        const a = ring(r, i), b = ring(r, i + 1), c = ring(r + 1, i), d = ring(r + 1, i + 1);
        if (flip) list.push(a, b, c, b, d, c); else list.push(a, c, b, b, c, d);
      }
      return base;
    };
    this.capTopBase = addCap(1, idxTop, false);
    this.capBotBase = addCap(-1, idxBot, true);
    this.sideBase = rest.length;
    for (let j = 0; j < SIDE.length; j++) for (let i = 0; i < SEG; i++) {
      const s = SIDE[j][0], x = poly[i][0] * s, y = poly[i][1] * s;
      rest.push([x, y, SIDE[j][1] * t / 2, i / SEG, 1 - j / (SIDE.length - 1)]);
    }
    for (let j = 0; j < SIDE.length - 1; j++) for (let i = 0; i < SEG; i++) {
      const A = this.sideBase + j * SEG + i, B = this.sideBase + j * SEG + (i + 1) % SEG, C = A + SEG, D = B + SEG;
      idxSide.push(A, C, B, B, C, D);
    }
    const nV = rest.length; this.nV = nV;
    // normal-sharing pairs: cap rim <-> side row 0 / last row
    this.pairs = [];
    for (let i = 0; i < SEG; i++) {
      this.pairs.push([this.capTopBase + 1 + (RINGS - 1) * SEG + i, this.sideBase + i]);
      this.pairs.push([this.capBotBase + 1 + (RINGS - 1) * SEG + i, this.sideBase + (SIDE.length - 1) * SEG + i]);
    }
    this.rest = rest;
    // ---- skin binding: K nearest particles, inverse-distance weights ----
    const q0 = body.q0, N = body.N;
    this.nb = new Int32Array(nV * K); this.wt = new Float32Array(nV * K);
    for (let v = 0; v < nV; v++) {
      const vx = rest[v][0] - body.centroidOffset[0], vy = rest[v][1] - body.centroidOffset[1], vz = rest[v][2] - body.centroidOffset[2];
      const best = [];
      for (let i = 0; i < N; i++) {
        const dx = q0[i * 3] - vx, dy = q0[i * 3 + 1] - vy, dz = q0[i * 3 + 2] - vz, d2 = dx * dx + dy * dy + dz * dz;
        if (best.length < K || d2 < best[best.length - 1][0]) { best.push([d2, i]); best.sort((a, b) => a[0] - b[0]); if (best.length > K) best.pop(); }
      }
      let sum = 0; const ws = best.map(b => { const w = 1 / (b[0] + 1e-6) ** 1.0; sum += w; return w; });
      for (let k = 0; k < K; k++) { this.nb[v * K + k] = best[k][1]; this.wt[v * K + k] = ws[k] / sum; }
    }
    this.vRest = new Float64Array(nV * 3);
    for (let v = 0; v < nV; v++) { this.vRest[v * 3] = rest[v][0] - body.centroidOffset[0]; this.vRest[v * 3 + 1] = rest[v][1] - body.centroidOffset[1]; this.vRest[v * 3 + 2] = rest[v][2] - body.centroidOffset[2]; }
    // ---- geometry ----
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(nV * 3);
    this.uv = new Float32Array(nV * 2);
    for (let v = 0; v < nV; v++) { this.uv[v * 2] = rest[v][3]; this.uv[v * 2 + 1] = rest[v][4]; }
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nV * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const index = [...idxTop, ...idxBot, ...idxSide];
    geo.setIndex(index);
    geo.addGroup(0, idxTop.length, 0); geo.addGroup(idxTop.length, idxBot.length, 1); geo.addGroup(idxTop.length + idxBot.length, idxSide.length, 2);
    this.geo = geo;
    // ---- textures ----
    this.faceTex = [canvasTex(TW, TH, true), canvasTex(TW, TH, true)];     // [0] = sim face 0 (z-), [1] = face 1 (z+)
    this.roughTex = [canvasTex(TW, TH, false), canvasTex(TW, TH, false)];
    this.bumpTex = [canvasTex(TW, TH, false), canvasTex(TW, TH, false)];
    this.sideTex = canvasTex(SW, SH, true); this.sideRough = canvasTex(SW, SH, false);
    this._buildStatic();
    const mk = (f) => {
      const m = new THREE.MeshPhysicalMaterial({
        map: this.faceTex[f].tex, roughnessMap: this.roughTex[f].tex, bumpMap: this.bumpTex[f].tex, bumpScale: 1.6,
        roughness: 1, metalness: 0, clearcoat: 0.0, clearcoatRoughness: 0.3, sheen: 0.0, specularIntensity: 0.7
      });
      return m;
    };
    const side = new THREE.MeshPhysicalMaterial({ map: this.sideTex.tex, roughnessMap: this.sideRough.tex, bumpMap: this.bumpTex[1].tex, bumpScale: 0.6, roughness: 1, metalness: 0, specularIntensity: 0.7 });
    this.materials = [mk(1), mk(0), side];
    this.mesh = new THREE.Mesh(geo, this.materials);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
    this.paint(true);
    this.skin();
  }

  /* ---- static noise: fibre grain and pits for bump; per-pixel noise for colour ---- */
  _buildStatic() {
    const seed = this.cook.setup.seed;
    this.noise = [0, 1].map(f => {
      const n1 = new Float32Array(TW * TH), n2 = new Float32Array(TW * TH), n3 = new Float32Array(TW * TH);
      for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
        const i = y * TW + x;
        n1[i] = U.fbm(x * 0.05, y * 0.05, seed + f * 7 + 1);
        n2[i] = U.fbm(x * 0.12 + 40, y * 0.12, seed + f * 7 + 2);
        n3[i] = U.vnoise(x * 0.9, y * 0.9, seed + f * 7 + 3);
      }
      return { n1, n2, n3 };
    });
    // marbling at texture resolution (cook.fatMaps are 96x64 over the bbox)
    this.marb = [0, 1].map(f => {
      const m = new Float32Array(TW * TH), src = this.cook.fatMaps[f], MW = this.cook.MW, MH = this.cook.MH;
      for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
        const gx = x / TW * (MW - 1), gy = y / TH * (MH - 1), i0 = Math.floor(gx), j0 = Math.floor(gy), fx = gx - i0, fy = gy - j0;
        const i1 = Math.min(i0 + 1, MW - 1), j1 = Math.min(j0 + 1, MH - 1);
        m[y * TW + x] = (src[j0 * MW + i0] * (1 - fx) + src[j0 * MW + i1] * fx) * (1 - fy) + (src[j1 * MW + i0] * (1 - fx) + src[j1 * MW + i1] * fx) * fy;
      }
      return m;
    });
    // bump: muscle fibre streaks + fat veins sit proud / pits
    for (let f = 0; f < 2; f++) {
      const bt = this.bumpTex[f], d = bt.img.data, nz = this.noise[f];
      for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
        const i = y * TW + x;
        const fibre = U.vnoise(x * 0.35, y * 0.05, seed + 50 + f) * 0.5 + nz.n3[i] * 0.25 + nz.n1[i] * 0.25;
        const v = clamp(0.5 + (fibre - 0.5) * 0.7 - this.marb[f][i] * 0.12, 0, 1) * 255;
        d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
      }
      bt.ctx.putImageData(bt.img, 0, 0); bt.tex.needsUpdate = true;
    }
  }

  /* ---- paint both faces and the side from the sim ---- */
  paint(raw) {
    const cook = this.cook, L = cook.L, nx = cook.nx, ny = cook.ny, preheat = raw || cook.mode === 'preheat';
    const rgb = [0, 0, 0], rgb2 = [0, 0, 0];
    let bAvg = 0, wetAvg = 0, nAvg = 0;
    for (let face = 0; face < 2; face++) {
      const li = face ? L - 1 : 0, bG = new Float64Array(cook.nc), tG = new Float64Array(cook.nc), wG = new Float64Array(cook.nc), fG = new Float64Array(cook.nc);
      for (const c of cook.cols) {
        if (preheat) { bG[c] = 0; tG[c] = cook.setup.startC; wG[c] = cook.waterInit; fG[c] = 0; continue; }
        bG[c] = cook.brown[c * 2 + face]; tG[c] = cook.T[c * L + li]; wG[c] = cook.water[c * 2 + face];
        let fr = 0; for (let k = 0; k < 4; k++) fr += Math.min(1, cook.fatP[c * L + (face ? L - 1 - k : k)] / 0.8);
        fG[c] = fr / 4;
      }
      fillGrid(bG, cook); fillGrid(tG, cook); fillGrid(wG, cook); fillGrid(fG, cook);
      const ft = this.faceTex[face], rt = this.roughTex[face], d = ft.img.data, rd = rt.img.data, nz = this.noise[face], mb = this.marb[face];
      const colW = cook.colW, colH = cook.colH;
      for (let y = 0; y < TH; y++) {
        const wy = ((y + 0.5) / TH * 2 - 1) * this.by, gj = clamp((wy + cook.bboxY) / colH - 0.5, 0, ny - 1), j0 = Math.min(Math.floor(gj), ny - 2), fy = gj - j0;
        for (let x = 0; x < TW; x++) {
          const wx = ((x + 0.5) / TW * 2 - 1) * this.bx, gi = clamp((wx + cook.bboxX) / colW - 0.5, 0, nx - 1), i0 = Math.min(Math.floor(gi), nx - 2), fx = gi - i0;
          const c00 = j0 * nx + i0, c01 = c00 + 1, c10 = c00 + nx, c11 = c10 + 1;
          const w0 = (1 - fx) * (1 - fy), w1 = fx * (1 - fy), w2 = (1 - fx) * fy, w3 = fx * fy;
          const b = bG[c00] * w0 + bG[c01] * w1 + bG[c10] * w2 + bG[c11] * w3;
          const T = tG[c00] * w0 + tG[c01] * w1 + tG[c10] * w2 + tG[c11] * w3;
          const wt = wG[c00] * w0 + wG[c01] * w1 + wG[c10] * w2 + wG[c11] * w3;
          const fr2 = fG[c00] * w0 + fG[c01] * w1 + fG[c10] * w2 + fG[c11] * w3;
          const i = y * TW + x, m = mb[i], nn1 = nz.n1[i], nn2 = nz.n2[i], nn3 = nz.n3[i];
          let r = 96 + 40 * nn1 + 14 * (nn2 - 0.5), g = 20 + 14 * nn1, bl = 28 + 10 * nn1;
          const gt = smoothstep(50, 84, T) * 0.88;
          r += (176 - r) * gt; g += (146 - g) * gt; bl += (122 - bl) * gt;
          const fw = smoothstep(0.30, 0.95, m) * 0.42, warm = smoothstep(48, 90, T);
          const fr_ = 214 + (214 - 214) * warm, fg_ = 182 + (176 - 182) * warm, fb_ = 160 + (126 - 160) * warm;
          r += (fr_ - r) * fw; g += (fg_ - g) * fw; bl += (fb_ - bl) * fw;
          const bb = b * (0.62 + 0.8 * nn2) + (nn3 - 0.5) * 0.08;
          if (bb > 0.03) {
            crustRGB(bb, rgb);
            const a2 = smoothstep(0.03, 0.55, bb) * 0.97, lift = fw * 0.25 * smoothstep(0.3, 1.0, bb);
            r += (rgb[0] * (1 + lift) - r) * a2; g += (rgb[1] * (1 + lift) - g) * a2; bl += (rgb[2] * (1 + lift) - bl) * a2;
          }
          const sh = 0.93 + 0.14 * nn3; r *= sh; g *= sh; bl *= sh;
          // physically based: the albedo carries no baked light; gloss goes into the roughness map
          const wet = clamp(wt / 0.10, 0, 1);
          let rough = 0.72 - 0.30 * wet - 0.22 * fr2 * fw - 0.04;
          if (b > 0.8) rough = Math.max(rough, 0.55 + 0.12 * Math.min(b, 2.2) / 2.2);
          const o = i * 4;
          d[o] = clamp(r * 0.8, 0, 255); d[o + 1] = clamp(g * 0.8, 0, 255); d[o + 2] = clamp(bl * 0.8, 0, 255); d[o + 3] = 255;
          rd[o] = 0; rd[o + 1] = clamp(rough, 0.12, 1) * 255; rd[o + 2] = 0; rd[o + 3] = 255;
          if (x % 4 === 0 && y % 4 === 0) { bAvg += b; wetAvg += wet; nAvg++; }
        }
      }
      ft.ctx.putImageData(ft.img, 0, 0); ft.tex.needsUpdate = true;
      rt.ctx.putImageData(rt.img, 0, 0); rt.tex.needsUpdate = true;
    }
    // side wall: each angle takes the through-thickness profile of its nearest edge column
    const sd = this.sideTex.img.data, sr = this.sideRough.img.data, poly = cook.poly;
    if (!this.edgeCol) {
      this.edgeCol = new Int32Array(SEG);
      for (let i = 0; i < SEG; i++) {
        const px = poly[i][0] * 0.94, py = poly[i][1] * 0.94; let best = cook.probe, bd = 1e9;
        for (const c of cook.cols) { const dx = cook.cx[c] - px, dy = cook.cy[c] - py, d2 = dx * dx + dy * dy; if (d2 < bd) { bd = d2; best = c; } }
        this.edgeCol[i] = best;
      }
    }
    for (let x = 0; x < SW; x++) {
      const fa = x / SW * SEG, i0 = Math.floor(fa) % SEG, i1 = (i0 + 1) % SEG, ft = fa - Math.floor(fa);
      for (let y = 0; y < SH; y++) {
        const depth = y / (SH - 1), lf = (1 - depth) * (L - 1), l0 = Math.min(Math.floor(lf), L - 2), lt = lf - l0;
        let r = 0, g = 0, b = 0, bt = 0, bbm = 0, mArr = 0;
        for (let k = 0; k < 2; k++) {
          const col = this.edgeCol[k ? i1 : i0], w = k ? ft : 1 - ft;
          const T = preheat ? cook.setup.startC : cook.T[col * L + l0] * (1 - lt) + cook.T[col * L + l0 + 1] * lt;
          const pk = preheat ? cook.setup.startC : cook.peak[col * L + l0];
          meatRGB(Math.max(T, pk * 0.98), rgb); r += rgb[0] * w; g += rgb[1] * w; b += rgb[2] * w;
          bt += (preheat ? 0 : cook.brown[col * 2 + 1]) * w; bbm += (preheat ? 0 : cook.brown[col * 2]) * w; mArr += cook.colMarb[col] * w;
        }
        const nn = U.fbm(x * 0.12, y * 0.35, 9), fat = smoothstep(0.58, 0.8, nn + mArr * 0.3);
        r += (214 - r) * fat * 0.45; g += (182 - g) * fat * 0.45; b += (160 - b) * fat * 0.45;
        const gr = 0.92 + 0.16 * U.vnoise(x * 0.8, y * 0.8, 4); r *= gr; g *= gr; b *= gr;
        const edgeTop = smoothstep(0.12, 0.0, depth) * Math.min(1, bt), edgeBot = smoothstep(0.88, 1.0, depth) * Math.min(1, bbm);
        if (edgeTop > 0.01) { crustRGB(bt * 0.6, rgb2); r += (rgb2[0] - r) * edgeTop; g += (rgb2[1] - g) * edgeTop; b += (rgb2[2] - b) * edgeTop; }
        if (edgeBot > 0.01) { crustRGB(bbm * 0.6, rgb2); r += (rgb2[0] - r) * edgeBot; g += (rgb2[1] - g) * edgeBot; b += (rgb2[2] - b) * edgeBot; }
        const o = (y * SW + x) * 4;
        sd[o] = clamp(r * 0.78, 0, 255); sd[o + 1] = clamp(g * 0.78, 0, 255); sd[o + 2] = clamp(b * 0.78, 0, 255); sd[o + 3] = 255; sr[o + 1] = 0.6 * 255; sr[o + 3] = 255;
      }
    }
    this.sideTex.ctx.putImageData(this.sideTex.img, 0, 0); this.sideTex.tex.needsUpdate = true;
    this.sideRough.ctx.putImageData(this.sideRough.img, 0, 0); this.sideRough.tex.needsUpdate = true;
    // wetness gives the whole steak a coat of juice and fat
    const wetMean = nAvg ? wetAvg / nAvg : 0, brownMean = nAvg ? bAvg / nAvg : 0;
    for (const m of this.materials) m.clearcoat = preheat ? 0.18 : clamp(0.10 + 0.5 * wetMean + (cook.basting ? 0.4 : 0) - 0.15 * Math.min(1, brownMean), 0, 0.9);
    for (let f = 0; f < 2; f++) this.materials[f].bumpScale = 1.2 + 1.6 * Math.min(1, brownMean);
  }

  /* ---- skin: particles -> render vertices ---- */
  skin() {
    const b = this.body, R = b.R, P = b.p, Qs = b.qs, nb = this.nb, wt = this.wt, pos = this.pos, V = this.vRest, nV = this.nV;
    const sxy = b.sxy, sz = b.sz, curl = b.curl, a = 0.075, bb = 0.047, ct = b.center || [0, 0, 0];
    void ct;
    for (let v = 0; v < nV; v++) {
      const vx = V[v * 3] * sxy, vy = V[v * 3 + 1] * sxy, vz = V[v * 3 + 2] * sz - curl * ((vx * vx) / (a * a) + (vy * vy) / (bb * bb));
      let px = 0, py = 0, pz = 0;
      for (let k = 0; k < K; k++) {
        const i = nb[v * K + k], w = wt[v * K + k];
        const dx = vx - Qs[i * 3], dy = vy - Qs[i * 3 + 1], dz = vz - Qs[i * 3 + 2];
        px += w * (P[i * 3] + R[0] * dx + R[3] * dy + R[6] * dz);
        py += w * (P[i * 3 + 1] + R[1] * dx + R[4] * dy + R[7] * dz);
        pz += w * (P[i * 3 + 2] + R[2] * dx + R[5] * dy + R[8] * dz);
      }
      pos[v * 3] = px; pos[v * 3 + 1] = py; pos[v * 3 + 2] = pz;
    }
    const g = this.geo;
    g.attributes.position.needsUpdate = true;
    g.computeVertexNormals();
    const n = g.attributes.normal.array;
    for (const [a1, b1] of this.pairs) {
      const x = n[a1 * 3] + n[b1 * 3], y = n[a1 * 3 + 1] + n[b1 * 3 + 1], z = n[a1 * 3 + 2] + n[b1 * 3 + 2], l = Math.hypot(x, y, z) || 1;
      n[a1 * 3] = n[b1 * 3] = x / l; n[a1 * 3 + 1] = n[b1 * 3 + 1] = y / l; n[a1 * 3 + 2] = n[b1 * 3 + 2] = z / l;
    }
    g.attributes.normal.needsUpdate = true;
  }
}
