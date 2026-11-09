/* ============================================================
   PHYSICS: soft-body steak. No DOM, no Three.js, runs in Node.
   Position-based dynamics on a lattice of particles that fills the steak outline:
     - distance constraints (in-plane, through-thickness, shear, skip-one bending)
     - global shape matching (keeps the steak a steak, gives it its wobble)
     - contacts with the pan floor, pan wall and rim, the cooktop and the room floor
     - a pair of tongs that pinch a patch of particles and drag them about
   Cooking changes the material: raw meat is floppy and drapes, cooked meat is firm,
   shrinks, thickens and curls toward the hot face.
   Units: metres, seconds. Y is up. Local steak frame: x long, y short, z through the
   thickness (z = -t/2 is sim face 0, z = +t/2 is sim face 1).
   ============================================================ */
'use strict';

var G = -9.81;

function inPoly(x, y, poly) {
  var inside = false;
  for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function distToPoly(x, y, poly) {
  var best = 1e9;
  for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    var ax = poly[j][0], ay = poly[j][1], bx = poly[i][0], by = poly[i][1];
    var dx = bx - ax, dy = by - ay, t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    var ex = ax + dx * t - x, ey = ay + dy * t - y, d = Math.sqrt(ex * ex + ey * ey);
    if (d < best) best = d;
  }
  return best;
}

/* quaternions as [x, y, z, w] */
function qmul(a, b) {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}
function qnorm(q) { var l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l; return q; }
function qaxis(ax, ay, az, ang) { var s = Math.sin(ang / 2), l = Math.hypot(ax, ay, az) || 1; return [ax / l * s, ay / l * s, az / l * s, Math.cos(ang / 2)]; }
function qmat(q, m) { // column-major 3x3 into m
  var x = q[0], y = q[1], z = q[2], w = q[3];
  m[0] = 1 - 2 * (y * y + z * z); m[1] = 2 * (x * y + z * w); m[2] = 2 * (x * z - y * w);
  m[3] = 2 * (x * y - z * w); m[4] = 1 - 2 * (x * x + z * z); m[5] = 2 * (y * z + x * w);
  m[6] = 2 * (x * z + y * w); m[7] = 2 * (y * z - x * w); m[8] = 1 - 2 * (x * x + y * y);
  return m;
}
function qrot(q, v) {
  var m = qmat(q, [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  return [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
}

/* ------------------------------------------------------------ */
function SoftBody(cook, world) {
  this.world = world;
  var cut = cook.cut, poly = cook.poly, t = cook.thickness;
  this.thickness = t;
  var h = 0.0125, a = cut.a * 1.02, b = cut.b * 1.02;
  var nzL = Math.max(3, Math.round(t / 0.0165) + 1);
  this.nzL = nzL;
  var cols = [], rowsI = [], i, j, k;
  var nxL = Math.floor(a / h), nyL = Math.floor(b / h);
  var map = {};
  var q = [];
  for (k = 0; k < nzL; k++) for (j = -nyL; j <= nyL; j++) for (i = -nxL; i <= nxL; i++) {
    var x = i * h, y = j * h;
    if (!(inPoly(x, y, poly) || distToPoly(x, y, poly) < h * 0.4)) continue;
    map[i + ',' + j + ',' + k] = q.length;
    q.push([x, y, -t / 2 + t * k / (nzL - 1), k]);
  }
  var N = q.length;
  this.N = N;
  this.q0 = new Float64Array(N * 3);     // unscaled rest positions (steak frame, centred)
  this.qs = new Float64Array(N * 3);     // scaled rest positions
  this.layer = new Uint8Array(N);
  this.p = new Float64Array(N * 3);
  this.pp = new Float64Array(N * 3);     // previous
  this.v = new Float64Array(N * 3);
  var cx = 0, cy = 0, cz = 0;
  for (i = 0; i < N; i++) { cx += q[i][0]; cy += q[i][1]; cz += q[i][2]; }
  cx /= N; cy /= N; cz /= N;
  for (i = 0; i < N; i++) {
    this.q0[i * 3] = q[i][0] - cx; this.q0[i * 3 + 1] = q[i][1] - cy; this.q0[i * 3 + 2] = q[i][2] - cz;
    this.layer[i] = q[i][3];
  }
  this.centroidOffset = [cx, cy, cz];

  // constraints
  var offs = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 1], [1, 1, 0, 0], [1, -1, 0, 0], [1, 0, 1, 1], [1, 0, -1, 1], [0, 1, 1, 1], [0, 1, -1, 1], [2, 0, 0, 2], [0, 2, 0, 2]];
  var ca = [], cb = [], ck = [];
  for (k = 0; k < nzL; k++) for (j = -nyL; j <= nyL; j++) for (i = -nxL; i <= nxL; i++) {
    var A = map[i + ',' + j + ',' + k]; if (A === undefined) continue;
    for (var o = 0; o < offs.length; o++) {
      var B = map[(i + offs[o][0]) + ',' + (j + offs[o][1]) + ',' + (k + offs[o][2])];
      if (B === undefined) continue;
      ca.push(A); cb.push(B); ck.push(offs[o][3]);
    }
  }
  this.M = ca.length; this.ca = Int32Array.from(ca); this.cb = Int32Array.from(cb); this.ck = Uint8Array.from(ck);
  this.rest = new Float64Array(this.M);

  // state
  this.R = [1, 0, 0, 0, 1, 0, 0, 0, 1]; this.quat = [0, 0, 0, 1];
  this.cooked = 0; this.kDist = [0.5, 0.5, 0.2]; this.kSM = 0.05;
  this.setShape(0, 0, 0);
  this.grip = null;
  this.contact = { pan: 0, counter: 0, floor: 0, panFrac: 0, maxY: 0, minY: 0 };
  this.speed = 0;
  this.reset(world.spawn);
}

SoftBody.prototype.setShape = function (shrink, thicken, curl) {
  var sxy = 1 - shrink, sz = 1 + thicken, N = this.N, i;
  this.sxy = sxy; this.sz = sz; this.curl = curl;
  var a = 0.075, b = 0.047;
  for (i = 0; i < N; i++) {
    var x = this.q0[i * 3] * sxy, y = this.q0[i * 3 + 1] * sxy;
    this.qs[i * 3] = x; this.qs[i * 3 + 1] = y;
    this.qs[i * 3 + 2] = this.q0[i * 3 + 2] * sz - curl * ((x * x) / (a * a) + (y * y) / (b * b));
  }
  for (var c = 0; c < this.M; c++) {
    var A = this.ca[c] * 3, B = this.cb[c] * 3;
    var dx = this.qs[A] - this.qs[B], dy = this.qs[A + 1] - this.qs[B + 1], dz = this.qs[A + 2] - this.qs[B + 2];
    this.rest[c] = Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
};

// cooked: 0 raw .. 1 well done. Raw meat drapes and wobbles, cooked meat is firm.
SoftBody.prototype.setCooked = function (c) {
  this.cooked = c;
  var f = c < 0 ? 0 : c > 1 ? 1 : c;
  this.kDist = [0.30 + 0.55 * f, 0.38 + 0.5 * f, 0.10 + 0.22 * f];   // in-plane, through-thickness, bending
  this.kSM = 0.035 + 0.20 * f;
};

SoftBody.prototype.reset = function (spawn) {
  // lay the steak flat at spawn = [x, y(surface height), z, yaw]
  var cy = Math.cos(spawn[3] || 0), sy = Math.sin(spawn[3] || 0);
  for (var i = 0; i < this.N; i++) {
    var x = this.qs[i * 3], y = this.qs[i * 3 + 1], z = this.qs[i * 3 + 2];
    // steak frame (x, y, z) -> world (x, z_up, -y) so local +z is world up
    var wx = x * cy - y * sy, wz = -(x * sy + y * cy);
    this.p[i * 3] = spawn[0] + wx; this.p[i * 3 + 1] = spawn[1] + this.thickness / 2 + z + 0.0005; this.p[i * 3 + 2] = spawn[2] + wz;
    this.pp[i * 3] = this.p[i * 3]; this.pp[i * 3 + 1] = this.p[i * 3 + 1]; this.pp[i * 3 + 2] = this.p[i * 3 + 2];
    this.v[i * 3] = this.v[i * 3 + 1] = this.v[i * 3 + 2] = 0;
  }
  // rotation: steak local (x, y, z) -> world (x, -z, y)?? we mapped local y -> world -z, local z -> world +y
  this.quat = qnorm(qmul(qaxis(0, 1, 0, (spawn[3] || 0)), qaxis(1, 0, 0, -Math.PI / 2)));
  qmat(this.quat, this.R);
  this.grip = null;
};

/* ---- world collision. returns contact code: 0 none, 1 pan floor, 2 pan wall/rim, 3 counter, 4 room floor ---- */
SoftBody.prototype._collide = function (i, rad) {
  var P = this.p, w = this.world, x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], code = 0;
  var pr = w.pan;
  var dx = x - pr.x, dz = z - pr.z, r = Math.sqrt(dx * dx + dz * dz);
  var onCounter = Math.abs(x) < w.counterHX && Math.abs(z) < w.counterHZ;
  if (r < pr.rOut + rad && y < pr.rimY + rad) {
    // inside the pan's footprint
    var px = this.pp[i * 3] - pr.x, pz = this.pp[i * 3 + 2] - pr.z, pr0 = Math.sqrt(px * px + pz * pz);
    if (r < pr.rIn) {
      // floor, with a slight curve up the walls near the edge
      var edge = Math.max(0, (r - (pr.rIn - 0.02)) / 0.02), fy = pr.floorY + 0.012 * edge * edge;
      if (y < fy + rad && pr0 < pr.rIn + 0.002) { y = fy + rad; code = 1; }
      else if (y < fy + rad) { /* came from outside, handled below */ }
    }
    if (r >= pr.rIn - rad) {
      if (pr0 <= pr.rIn + 0.003 && y < pr.rimY) {
        // inner wall: stay inside
        var lim = pr.rIn - rad;
        if (r > lim) { var s = lim / r; x = pr.x + dx * s; z = pr.z + dz * s; code = code || 2; }
      } else if (pr0 >= pr.rOut - 0.003 && y < pr.rimY) {
        var lim2 = pr.rOut + rad;
        if (r < lim2) { var s2 = lim2 / (r || 1e-6); x = pr.x + dx * s2; z = pr.z + dz * s2; code = code || 2; }
      } else if (r >= pr.rIn - rad && r <= pr.rOut + rad && y < pr.rimY + rad) {
        y = pr.rimY + rad; code = 2;     // sitting on the rim
      }
    }
  }
  if (onCounter) {
    if (y < w.counterY + rad) { y = w.counterY + rad; code = code || 3; }
  } else if (y < w.floorY + rad) { y = w.floorY + rad; code = code || 4; }
  // keep inside the room
  if (x > w.roomHX) x = w.roomHX; if (x < -w.roomHX) x = -w.roomHX;
  if (z > w.roomHZ) z = w.roomHZ; if (z < -w.roomHZ) z = -w.roomHZ;
  P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
  return code;
};

SoftBody.prototype._shapeMatch = function (k) {
  var N = this.N, P = this.p, Q = this.qs, i;
  var cx = 0, cy = 0, cz = 0;
  for (i = 0; i < N; i++) { cx += P[i * 3]; cy += P[i * 3 + 1]; cz += P[i * 3 + 2]; }
  cx /= N; cy /= N; cz /= N;
  // A = sum (p - c) q^T, column j = sum (p - c) * q_j
  var a00 = 0, a10 = 0, a20 = 0, a01 = 0, a11 = 0, a21 = 0, a02 = 0, a12 = 0, a22 = 0;
  for (i = 0; i < N; i++) {
    var px = P[i * 3] - cx, py = P[i * 3 + 1] - cy, pz = P[i * 3 + 2] - cz, qx = Q[i * 3], qy = Q[i * 3 + 1], qz = Q[i * 3 + 2];
    a00 += px * qx; a10 += py * qx; a20 += pz * qx;
    a01 += px * qy; a11 += py * qy; a21 += pz * qy;
    a02 += px * qz; a12 += py * qz; a22 += pz * qz;
  }
  var q = this.quat, R = this.R;
  for (var it = 0; it < 8; it++) {
    qmat(q, R);
    // r_k x a_k, r_k . a_k
    var c0x = R[1] * a20 - R[2] * a10, c0y = R[2] * a00 - R[0] * a20, c0z = R[0] * a10 - R[1] * a00;
    var c1x = R[4] * a21 - R[5] * a11, c1y = R[5] * a01 - R[3] * a21, c1z = R[3] * a11 - R[4] * a01;
    var c2x = R[7] * a22 - R[8] * a12, c2y = R[8] * a02 - R[6] * a22, c2z = R[6] * a12 - R[7] * a02;
    var d = Math.abs(R[0] * a00 + R[1] * a10 + R[2] * a20 + R[3] * a01 + R[4] * a11 + R[5] * a21 + R[6] * a02 + R[7] * a12 + R[8] * a22) + 1e-9;
    var ox = (c0x + c1x + c2x) / d, oy = (c0y + c1y + c2y) / d, oz = (c0z + c1z + c2z) / d, ang = Math.sqrt(ox * ox + oy * oy + oz * oz);
    if (ang < 1e-8) break;
    q = qnorm(qmul(qaxis(ox, oy, oz, ang), q));
  }
  this.quat = q; qmat(q, R);
  if (k > 0) {
    for (i = 0; i < N; i++) {
      var qx2 = Q[i * 3], qy2 = Q[i * 3 + 1], qz2 = Q[i * 3 + 2];
      var gx = cx + R[0] * qx2 + R[3] * qy2 + R[6] * qz2, gy = cy + R[1] * qx2 + R[4] * qy2 + R[7] * qz2, gz = cz + R[2] * qx2 + R[5] * qy2 + R[8] * qz2;
      P[i * 3] += (gx - P[i * 3]) * k; P[i * 3 + 1] += (gy - P[i * 3 + 1]) * k; P[i * 3 + 2] += (gz - P[i * 3 + 2]) * k;
    }
  }
  this.center = [cx, cy, cz];
};

/* ---- tongs ---- */
// ray: origin o, direction d (unit). Returns true when a pinch was made.
SoftBody.prototype.pick = function (o, d) {
  var best = -1, bt = 1e9, P = this.p;
  for (var i = 0; i < this.N; i++) {
    var rx = P[i * 3] - o[0], ry = P[i * 3 + 1] - o[1], rz = P[i * 3 + 2] - o[2];
    var t = rx * d[0] + ry * d[1] + rz * d[2]; if (t < 0) continue;
    var ex = rx - d[0] * t, ey = ry - d[1] * t, ez = rz - d[2] * t, dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (dist < 0.02 && t < bt) { bt = t; best = i; }
  }
  return best;
};
SoftBody.prototype.grab = function (idx, holdY) {
  var Q = this.qs, set = [], i, cx = 0, cy = 0, cz = 0;
  for (i = 0; i < this.N; i++) {
    var dx = Q[i * 3] - Q[idx * 3], dy = Q[i * 3 + 1] - Q[idx * 3 + 1];
    if (dx * dx + dy * dy < 0.022 * 0.022) { set.push(i); cx += Q[i * 3]; cy += Q[i * 3 + 1]; cz += Q[i * 3 + 2]; }
  }
  cx /= set.length; cy /= set.length; cz /= set.length;
  var P = this.p, gx = 0, gy = 0, gz = 0;
  for (i = 0; i < set.length; i++) { gx += P[set[i] * 3]; gy += P[set[i] * 3 + 1]; gz += P[set[i] * 3 + 2]; }
  this.grip = { set: set, qc: [cx, cy, cz], pos: [gx / set.length, gy / set.length, gz / set.length], quat: this.quat.slice(), goalQuat: this.quat.slice(), y: holdY, tx: gx / set.length, tz: gz / set.length, flipT: 0 };
  return set.length;
};
SoftBody.prototype.release = function () { this.grip = null; };
SoftBody.prototype.gripTarget = function (x, z, y) { if (this.grip) { this.grip.tx = x; this.grip.tz = z; if (y !== undefined) this.grip.y = y; } };
SoftBody.prototype.gripTurn = function (axis, ang) { // rotate held orientation about a world axis
  if (!this.grip) return;
  this.grip.goalQuat = qnorm(qmul(qaxis(axis[0], axis[1], axis[2], ang), this.grip.goalQuat));
};

/* ---- step ---- */
SoftBody.prototype.step = function (dt) {
  var sub = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / sub;
  var N = this.N, P = this.p, PP = this.pp, V = this.v, M = this.M, ca = this.ca, cb = this.cb, ck = this.ck, rest = this.rest;
  var i, c, s, it, iters = 6, rad = 0.0012, w = this.world;
  var gr = this.grip;
  var contacts = new Uint8Array(N);
  if (gr) { // ease the held orientation toward its goal
    var qa = gr.quat, qb = gr.goalQuat, dot = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3];
    if (dot < 0) { qb = [-qb[0], -qb[1], -qb[2], -qb[3]]; }
    var f = 1 - Math.exp(-dt * 9);
    gr.quat = qnorm([qa[0] + (qb[0] - qa[0]) * f, qa[1] + (qb[1] - qa[1]) * f, qa[2] + (qb[2] - qa[2]) * f, qa[3] + (qb[3] - qa[3]) * f]);
  }
  var gm = gr ? qmat(gr.quat, [0, 0, 0, 0, 0, 0, 0, 0, 0]) : null;
  var isGrip = null;
  if (gr) { isGrip = new Uint8Array(N); for (i = 0; i < gr.set.length; i++) isGrip[gr.set[i]] = 1; }
  var Q = this.qs;
  for (s = 0; s < sub; s++) {
    for (i = 0; i < N * 3; i++) PP[i] = P[i];
    for (i = 0; i < N; i++) {
      V[i * 3 + 1] += G * h;
      V[i * 3] *= 0.9985; V[i * 3 + 1] *= 0.9985; V[i * 3 + 2] *= 0.9985;
      P[i * 3] += V[i * 3] * h; P[i * 3 + 1] += V[i * 3 + 1] * h; P[i * 3 + 2] += V[i * 3 + 2] * h;
    }
    // tongs: drive the pinched patch toward the target pose
    if (gr) {
      var cur = gr.pos; // smooth the target in space
      var tx = gr.tx, tz = gr.tz, ty = gr.y;
      cur[0] += Math.max(-0.02, Math.min(0.02, (tx - cur[0]) * 0.25)); cur[1] += Math.max(-0.02, Math.min(0.02, (ty - cur[1]) * 0.25)); cur[2] += Math.max(-0.02, Math.min(0.02, (tz - cur[2]) * 0.25));
      for (i = 0; i < gr.set.length; i++) {
        var gi = gr.set[i], rx = Q[gi * 3] - gr.qc[0], ry = Q[gi * 3 + 1] - gr.qc[1], rz = Q[gi * 3 + 2] - gr.qc[2];
        var gxp = cur[0] + gm[0] * rx + gm[3] * ry + gm[6] * rz, gyp = cur[1] + gm[1] * rx + gm[4] * ry + gm[7] * rz, gzp = cur[2] + gm[2] * rx + gm[5] * ry + gm[8] * rz;
        P[gi * 3] += (gxp - P[gi * 3]) * 0.6; P[gi * 3 + 1] += (gyp - P[gi * 3 + 1]) * 0.6; P[gi * 3 + 2] += (gzp - P[gi * 3 + 2]) * 0.6;
      }
    }
    for (it = 0; it < iters; it++) {
      for (c = 0; c < M; c++) {
        var A = ca[c] * 3, B = cb[c] * 3;
        var dx = P[A] - P[B], dy = P[A + 1] - P[B + 1], dz = P[A + 2] - P[B + 2];
        var l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9, k = this.kDist[ck[c]];
        var corr = (l - rest[c]) / l * 0.5 * k;
        var ga = isGrip && isGrip[ca[c]], gb = isGrip && isGrip[cb[c]];
        if (ga && gb) continue;
        var wa = ga ? 0 : (gb ? 2 : 1), wb = gb ? 0 : (ga ? 2 : 1);   // a pinned side takes no correction
        P[A] -= dx * corr * wa; P[A + 1] -= dy * corr * wa; P[A + 2] -= dz * corr * wa;
        P[B] += dx * corr * wb; P[B + 1] += dy * corr * wb; P[B + 2] += dz * corr * wb;
      }
      if (it === iters - 1 || it === 1) this._shapeMatch(this.kSM / 2);
      for (i = 0; i < N; i++) { var code = this._collide(i, rad); if (code) contacts[i] = code; }
    }
    // velocities, friction
    for (i = 0; i < N; i++) {
      var vx = (P[i * 3] - PP[i * 3]) / h, vy = (P[i * 3 + 1] - PP[i * 3 + 1]) / h, vz = (P[i * 3 + 2] - PP[i * 3 + 2]) / h;
      var cc = contacts[i];
      if (cc) { // contact friction: bleed tangential speed, more on dry counter than on an oiled pan
        var fr = cc === 1 ? 0.05 : cc === 2 ? 0.08 : 0.16, keep = Math.exp(-fr * 60 * h * (cc === 1 ? 1 : 1.5));
        vx *= keep; vz *= keep; if (vy > 0 && cc !== 2) vy *= 0.9;
      }
      V[i * 3] = vx; V[i * 3 + 1] = vy; V[i * 3 + 2] = vz;
    }
  }
  // measurements
  var pan = 0, cnt = 0, counter = 0, floor = 0, sp = 0, minY = 1e9, maxY = -1e9;
  for (i = 0; i < N; i++) {
    var cd = contacts[i];
    if (this.layer[i] === 0 || this.layer[i] === this.nzL - 1) { cnt++; if (cd === 1) pan++; else if (cd === 3) counter++; else if (cd === 4) floor++; }
    sp += Math.abs(V[i * 3]) + Math.abs(V[i * 3 + 1]) + Math.abs(V[i * 3 + 2]);
    if (P[i * 3 + 1] < minY) minY = P[i * 3 + 1]; if (P[i * 3 + 1] > maxY) maxY = P[i * 3 + 1];
  }
  this.contact = { pan: pan, counter: counter, floor: floor, panFrac: cnt ? pan / cnt * 2 : 0, counterFrac: cnt ? counter / cnt * 2 : 0, floorFrac: cnt ? floor / cnt * 2 : 0, minY: minY, maxY: maxY };
  this.speed = sp / (N * 3);
};

// world-space facts the game needs: centre, which face is down, yaw of the long axis (radians, about +Y)
SoftBody.prototype.pose = function () {
  var R = this.R, c = this.center || [0, 0, 0];
  // local axes in world: columns of R
  var ex = [R[0], R[1], R[2]], ey = [R[3], R[4], R[5]], ez = [R[6], R[7], R[8]];
  var flipped = ez[1] < 0;
  // map world (x, z) to sim plane coords (x, y): world -z is sim +y (matches reset())
  var yaw = Math.atan2(-ex[2], ex[0]);
  return { center: c, ex: ex, ey: ey, ez: ez, flipped: flipped, yaw: yaw, tilt: Math.abs(ez[1]) };
};

module.exports = { SoftBody: SoftBody, qmul: qmul, qaxis: qaxis, qmat: qmat, qrot: qrot, qnorm: qnorm };
