/* ============================================================
   SCENE: a bare concrete room with one gas cooktop. Everything is procedural
   (no image files): concrete, brushed steel and cast iron are generated at start-up.
   ============================================================ */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const U = Sim.util;

// World layout (metres). Y up. The cooktop surface is y = 0.
export const WORLD = {
  counterHX: 0.5, counterHZ: 0.32, counterY: 0, floorY: -0.9, roomHX: 2.3, roomHZ: 2.3,
  spawn: [0.30, 0, -0.02, 0.35],
  pan: { x: -0.10, z: 0.0, rIn: 0.125, rOut: 0.133, floorY: 0.036, rimY: 0.087 },
  knob: { x: 0.37, z: 0.235 }
};

function tex(w, h, fn, opts = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'), img = ctx.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = fn(x, y, w, h), o = (y * w + x) * 4;
    if (Array.isArray(v)) { d[o] = v[0]; d[o + 1] = v[1]; d[o + 2] = v[2]; } else { d[o] = d[o + 1] = d[o + 2] = v; }
    d[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  t.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}
const clamp = U.clamp, fbm = U.fbm, vn = U.vnoise;

// Tileable concrete: cloudy tonal variation, fine pores, a few blow-holes.
function concreteMaps(size, seed) {
  const pores = (x, y) => { const p = vn(x * 0.9, y * 0.9, seed + 5); return p > 0.86 ? (p - 0.86) * 7 : 0; };
  const holes = [];
  for (let i = 0; i < 90; i++) holes.push([vn(i, 1, seed) * size, vn(i, 2, seed + 1) * size, 1.2 + vn(i, 3, seed + 2) * 3]);
  const hole = (x, y) => { let m = 0; for (const h of holes) { const dx = x - h[0], dy = y - h[1], d = Math.sqrt(dx * dx + dy * dy); if (d < h[2]) m = Math.max(m, 1 - d / h[2]); } return m; };
  const base = (x, y) => {
    // tile by blending noise with its shifted self so edges match
    const u = x / size, v = y / size;
    const f = (a, b) => fbm(a * 6, b * 6, seed) * 0.5 + fbm(a * 24, b * 24, seed + 3) * 0.35 + fbm(a * 90, b * 90, seed + 9) * 0.15;
    const w = (1 - u) * (1 - v), w2 = u * (1 - v), w3 = (1 - u) * v, w4 = u * v;
    return f(u, v) * w + f(u - 1, v) * w2 + f(u, v - 1) * w3 + f(u - 1, v - 1) * w4;
  };
  const cache = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) cache[y * size + x] = base(x, y) - pores(x, y) * 0.35 - hole(x, y) * 0.5;
  const at = (x, y) => cache[y * size + x];
  const map = tex(size, size, (x, y) => { const t = at(x, y); const g = clamp(104 + (t - 0.5) * 120, 40, 190); return [g * 1.0, g * 1.0, g * 0.97]; }, { srgb: true });
  const rough = tex(size, size, (x, y) => clamp(0.78 + (at(x, y) - 0.5) * 0.3, 0.4, 1) * 255);
  const bump = tex(size, size, (x, y) => clamp(128 + (at(x, y) - 0.5) * 230, 0, 255));
  return { map, rough, bump };
}

function brushedMaps(w, h) {
  const rough = tex(w, h, (x, y) => clamp(0.34 + (vn(x * 0.04, y * 1.4, 4) - 0.5) * 0.18 + (vn(x * 0.3, y * 0.3, 8) - 0.5) * 0.05, 0.15, 0.7) * 255);
  const bump = tex(w, h, (x, y) => clamp(128 + (vn(x * 0.04, y * 2.5, 5) - 0.5) * 60, 0, 255));
  return { rough, bump };
}
function castIronMaps(w, h) {
  const rough = tex(w, h, (x, y) => clamp(0.62 + (fbm(x * 0.08, y * 0.08, 3) - 0.5) * 0.5 + (vn(x * 0.7, y * 0.7, 6) - 0.5) * 0.18, 0.28, 0.95) * 255);
  const bump = tex(w, h, (x, y) => clamp(128 + (fbm(x * 0.15, y * 0.15, 7) - 0.5) * 110 + (vn(x * 1.1, y * 1.1, 2) - 0.5) * 70, 0, 255));
  const map = tex(w, h, (x, y) => { const t = fbm(x * 0.05, y * 0.05, 11), g = 20 + t * 16; return [g, g * 0.98, g * 0.95]; }, { srgb: true });
  return { rough, bump, map };
}
function softSprite() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Kitchen {
  constructor(renderer) {
    this.renderer = renderer;
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050505);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.42;
    scene.fog = new THREE.FogExp2(0x090909, 0.05);
    this.buildRoom();
    this.buildCooktop();
    this.buildPan();
    this.buildLights();
    this.buildParticles();
    this.buildTongs();
    this.time = 0;
  }

  buildRoom() {
    const { map, rough, bump } = concreteMaps(512, 3);
    const mat = (rx, ry, rough0 = 1) => {
      const m = new THREE.MeshStandardMaterial({ map: map.clone(), roughnessMap: rough.clone(), bumpMap: bump.clone(), bumpScale: 2.2, roughness: rough0, metalness: 0, color: 0xd0d0cc });
      for (const k of ['map', 'roughnessMap', 'bumpMap']) { m[k].repeat.set(rx, ry); m[k].needsUpdate = true; }
      return m;
    };
    const W = 2 * WORLD.roomHX, D = 2 * WORLD.roomHZ, H = 3.3, y0 = WORLD.floorY;
    const room = new THREE.Group();
    const add = (geo, m, x, y, z, rx = 0, ry = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, 0); o.receiveShadow = true; room.add(o); return o; };
    const floorMat = mat(W / 1.2, D / 1.2, 0.8); floorMat.roughness = 0.62; floorMat.color.set(0xb4b4b0);
    add(new THREE.PlaneGeometry(W, D), floorMat, 0, y0, 0, -Math.PI / 2);
    add(new THREE.PlaneGeometry(W, D), mat(W / 1.4, D / 1.4), 0, y0 + H, 0, Math.PI / 2);
    add(new THREE.PlaneGeometry(W, H), mat(W / 1.4, H / 1.4), 0, y0 + H / 2, -D / 2, 0, 0);
    add(new THREE.PlaneGeometry(W, H), mat(W / 1.4, H / 1.4), 0, y0 + H / 2, D / 2, 0, Math.PI);
    add(new THREE.PlaneGeometry(D, H), mat(D / 1.4, H / 1.4), -W / 2, y0 + H / 2, 0, 0, Math.PI / 2);
    add(new THREE.PlaneGeometry(D, H), mat(D / 1.4, H / 1.4), W / 2, y0 + H / 2, 0, 0, -Math.PI / 2);
    // formwork tie-holes on the back wall, a quiet bit of detail
    const holeMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1b, roughness: 0.9 });
    for (let i = -3; i <= 3; i++) for (let j = 0; j < 3; j++) {
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.006, 14), holeMat);
      h.rotation.x = Math.PI / 2; h.position.set(i * 0.6, y0 + 0.6 + j * 0.6, -D / 2 + 0.003); room.add(h);
    }
    // concrete plinth the cooktop stands on
    const plinthMat = mat(1.2, 1.4, 0.9); plinthMat.color.set(0xa8a8a4);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(2 * WORLD.counterHX - 0.06, -y0 - 0.06, 2 * WORLD.counterHZ - 0.06), plinthMat);
    plinth.position.set(0, (y0 - 0.06) / 2, 0); plinth.castShadow = plinth.receiveShadow = true; room.add(plinth);
    this.scene.add(room);
  }

  buildCooktop() {
    const g = this.cooktop = new THREE.Group();
    const { rough, bump } = brushedMaps(512, 512);
    rough.repeat.set(2, 2); bump.repeat.set(2, 2);
    const steel = new THREE.MeshStandardMaterial({ color: 0x8d9095, metalness: 1, roughness: 1, roughnessMap: rough, bumpMap: bump, bumpScale: 0.25 });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(2 * WORLD.counterHX, 0.06, 2 * WORLD.counterHZ), steel);
    slab.position.y = -0.03; slab.castShadow = slab.receiveShadow = true; g.add(slab);
    // lip around the edge so spilt oil has somewhere to go
    const lip = new THREE.Mesh(new THREE.BoxGeometry(2 * WORLD.counterHX + 0.004, 0.012, 2 * WORLD.counterHZ + 0.004), steel);
    lip.position.y = -0.052; g.add(lip);
    const pan = WORLD.pan;
    // burner: enamel base, brass cap, flame ports
    const enamel = new THREE.MeshStandardMaterial({ color: 0x0d0d0e, roughness: 0.35, metalness: 0.2 });
    const brass = new THREE.MeshStandardMaterial({ color: 0x8a6a2e, roughness: 0.38, metalness: 1 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.066, 0.012, 48), enamel); base.position.set(pan.x, 0.006, pan.z); base.castShadow = true; g.add(base);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.05, 0.016, 48), brass); ring.position.set(pan.x, 0.018, pan.z); ring.castShadow = true; g.add(ring);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.012, 40), enamel); cap.position.set(pan.x, 0.03, pan.z); g.add(cap);
    // cast-iron grate (the pan sits on this)
    const { rough: cr, bump: cb, map: cm } = castIronMaps(256, 256);
    const iron = new THREE.MeshStandardMaterial({ color: 0xffffff, map: cm, roughnessMap: cr, bumpMap: cb, bumpScale: 1.2, metalness: 0.55, roughness: 1 });
    this.ironMat = iron;
    const grate = new THREE.Group();
    const barGeo = new THREE.BoxGeometry(0.30, 0.012, 0.014);
    for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(barGeo, iron); b.rotation.y = i * Math.PI / 4; b.position.y = 0.02; b.castShadow = b.receiveShadow = true; grate.add(b); }
    const gr = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.006, 8, 48), iron); gr.rotation.x = Math.PI / 2; gr.position.y = 0.022; grate.add(gr);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const f = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.011, 0.022, 10), iron); f.position.set(dx * 0.13, 0.011, dz * 0.13); f.castShadow = true; grate.add(f); }
    grate.position.set(pan.x, 0, pan.z); g.add(grate);
    // flames
    this.flames = [];
    const flameMat = new THREE.MeshBasicMaterial({ color: 0x5aa8ff, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const flameGeo = new THREE.ConeGeometry(0.0045, 0.02, 8, 1, true); flameGeo.translate(0, 0.01, 0);
    this.flameGroup = new THREE.Group();
    const NF = 32;
    for (let i = 0; i < NF; i++) {
      const a = i / NF * Math.PI * 2, f = new THREE.Mesh(flameGeo, flameMat);
      f.position.set(pan.x + Math.cos(a) * 0.049, 0.024, pan.z + Math.sin(a) * 0.049);
      f.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
      f.userData.phase = Math.random() * 6.28; this.flames.push(f); this.flameGroup.add(f);
    }
    g.add(this.flameGroup);
    // knob
    const knobMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.35, metalness: 0.4 });
    const knob = this.knob = new THREE.Group();
    const kb = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.026, 40), knobMat); kb.position.y = 0.013; kb.castShadow = true; knob.add(kb);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.03, 0.008, 40), knobMat); grip.position.y = 0.03; knob.add(grip);
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.003, 0.022), new THREE.MeshStandardMaterial({ color: 0xff7a2a, emissive: 0xff5a10, emissiveIntensity: 0.8 }));
    tick.position.set(0, 0.035, -0.012); knob.add(tick);
    knob.position.set(WORLD.knob.x, 0, WORLD.knob.z); g.add(knob);
    this.knobHit = kb;
    // scale marks around the knob
    const markMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6 });
    for (let i = 0; i <= 10; i++) {
      const a = -2.3 + i / 10 * 4.6, m = new THREE.Mesh(new THREE.BoxGeometry(0.0022, 0.0006, i % 5 === 0 ? 0.01 : 0.006), markMat);
      m.position.set(WORLD.knob.x + Math.sin(a) * 0.046, 0.0003, WORLD.knob.z - Math.cos(a) * 0.046); m.rotation.y = a; g.add(m);
    }
    this.scene.add(g);
  }

  buildPan() {
    const pan = WORLD.pan, g = this.pan = new THREE.Group();
    const { rough, bump, map } = castIronMaps(512, 512);
    const iron = new THREE.MeshPhysicalMaterial({ color: 0x6a6a6a, map, roughnessMap: rough, bumpMap: bump, bumpScale: 1.5, metalness: 0.35, roughness: 1, clearcoat: 0.12, clearcoatRoughness: 0.6 });
    this.panMat = iron;
    const baseY = 0.03, floor = pan.floorY, rim = pan.rimY;
    const prof = [];  // outer from bottom centre, around the rim, inner back to centre
    prof.push([0.0, baseY], [0.108, baseY], [0.122, baseY + 0.004], [0.13, baseY + 0.014], [pan.rOut, baseY + 0.03], [pan.rOut + 0.002, rim - 0.003], [pan.rOut - 0.0015, rim + 0.0006], [pan.rIn + 0.0015, rim + 0.0006], [pan.rIn - 0.001, rim - 0.003]);
    prof.push([pan.rIn - 0.0015, floor + 0.02], [pan.rIn - 0.006, floor + 0.004], [pan.rIn - 0.016, floor], [0.0, floor]);
    const pts = prof.map(p => new THREE.Vector2(p[0], p[1]));
    const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 96), iron);
    body.material.side = THREE.DoubleSide; body.castShadow = body.receiveShadow = true; g.add(body);
    // pouring lips and handle
    const handle = new THREE.Group();
    const h1 = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.016, 0.17, 20), iron); h1.rotation.z = Math.PI / 2; h1.position.set(-pan.rOut - 0.075, rim - 0.02, 0); h1.castShadow = true;
    const h2 = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.011, 0.07, 20), iron); h2.rotation.z = Math.PI / 2; h2.position.set(-pan.rOut - 0.205, rim - 0.01, 0); h2.castShadow = true;
    const eye = new THREE.Mesh(new THREE.TorusGeometry(0.008, 0.0035, 8, 16), iron); eye.position.set(-pan.rOut - 0.245, rim - 0.01, 0);
    handle.add(h1, h2, eye); handle.rotation.y = -0.35; g.add(handle);
    g.position.set(pan.x, 0, pan.z);
    // pool of oil
    const oilTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'); const gr = x.createRadialGradient(128, 128, 20, 128, 128, 128); gr.addColorStop(0, '#7a7a7a'); gr.addColorStop(1, '#808080'); x.fillStyle = gr; x.fillRect(0, 0, 256, 256); return new THREE.CanvasTexture(c); })();
    const oil = new THREE.Mesh(new THREE.CircleGeometry(pan.rIn - 0.012, 64), new THREE.MeshPhysicalMaterial({ color: 0x6b4a14, transparent: true, opacity: 0.10, roughness: 0.02, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, ior: 1.47, bumpMap: oilTex, bumpScale: 0.2, depthWrite: false }));
    oil.rotation.x = -Math.PI / 2; oil.position.y = floor + 0.0009; oil.receiveShadow = true; this.oil = oil; g.add(oil);
    // g sits at the pan centre: shift geometry that was built about the origin up to world Y
    g.children.forEach(c => { if (c !== body) { /* already in world Y */ } });
    this.scene.add(g);
  }

  buildLights() {
    const s = this.scene;
    // overhead strip light in the ceiling
    const ceilY = WORLD.floorY + 3.3;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.03, 0.18), new THREE.MeshBasicMaterial({ color: 0xfff3e0, toneMapped: false }));
    panel.position.set(0.15, ceilY - 0.016, 0.1); s.add(panel);
    const spot = this.key = new THREE.SpotLight(0xfff0dc, 36, 0, 0.5, 0.85, 2);
    spot.position.set(0.18, ceilY - 0.05, 0.25); spot.target.position.set(0, 0, 0);
    spot.castShadow = true; spot.shadow.mapSize.set(2048, 2048); spot.shadow.bias = -0.0002; spot.shadow.normalBias = 0.003; spot.shadow.radius = 5; spot.shadow.blurSamples = 16;
    spot.shadow.camera.near = 1; spot.shadow.camera.far = 6;
    s.add(spot, spot.target);
    const hemi = new THREE.HemisphereLight(0x9aa0aa, 0x3a3835, 0.55); s.add(hemi);
    const fill = this.fill = new THREE.PointLight(0xbcc8ff, 0.2, 0, 2); fill.position.set(-1.2, 0.9, 1.4); s.add(fill);
    const flame = this.flameLight = new THREE.PointLight(0xff8a3a, 0, 0, 2); flame.position.set(WORLD.pan.x, 0.02, WORLD.pan.z + 0.0); s.add(flame);
    const glow = this.panGlow = new THREE.PointLight(0xff7a2a, 0, 0, 2); glow.position.set(WORLD.pan.x, 0.15, WORLD.pan.z); s.add(glow);
  }

  /* ---- smoke, steam and spitting oil ---- */
  buildParticles() {
    const MAX = 700; this.pMax = MAX;
    const geo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX * 3); this.pCol = new Float32Array(MAX * 4); this.pSize = new Float32Array(MAX);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.pMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { scale: { value: 600 }, map: { value: softSprite() } },
      vertexShader: 'attribute float size; attribute vec4 color; varying vec4 vC; uniform float scale; void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=size*scale/-mv.z; gl_Position=projectionMatrix*mv; }',
      fragmentShader: 'uniform sampler2D map; varying vec4 vC; void main(){ float a=texture2D(map,gl_PointCoord).a*vC.a; if(a<0.002) discard; gl_FragColor=vec4(vC.rgb,a); }'
    });
    this.points = new THREE.Points(geo, this.pMat); this.points.frustumCulled = false; this.points.renderOrder = 10; this.scene.add(this.points);
    this.parts = []; for (let i = 0; i < MAX; i++) this.parts.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, size: 0.02, grow: 0, a: 0.2, kind: 0, c: [1, 1, 1], seed: Math.random() * 10 });
    this.pNext = 0;
  }
  emit(kind, x, y, z, o = {}) {
    const p = this.parts[this.pNext]; this.pNext = (this.pNext + 1) % this.pMax;
    p.on = true; p.kind = kind; p.x = x; p.y = y; p.z = z; p.age = 0;
    if (kind === 0) { p.vx = (Math.random() - 0.5) * 0.01; p.vy = 0.05 + Math.random() * 0.05; p.vz = (Math.random() - 0.5) * 0.01; p.life = 1.8 + Math.random() * 1.2; p.size = 0.03; p.grow = 0.05; p.a = o.a || 0.09; p.c = [0.95, 0.96, 0.98]; }   // steam
    else if (kind === 1) { p.vx = (Math.random() - 0.5) * 0.02; p.vy = 0.10 + Math.random() * 0.08; p.vz = (Math.random() - 0.5) * 0.02; p.life = 3 + Math.random() * 2; p.size = 0.04; p.grow = 0.09; p.a = o.a || 0.2; p.c = [0.62, 0.64, 0.68]; }  // smoke
    else { const a = Math.random() * 6.28, s = 0.25 + Math.random() * 0.5; p.vx = Math.cos(a) * s * 0.5; p.vz = Math.sin(a) * s * 0.5; p.vy = 0.4 + Math.random() * 0.5; p.life = 0.5 + Math.random() * 0.4; p.size = 0.0035; p.grow = 0; p.a = 0.9; p.c = [1.0, 0.82, 0.45]; }   // spit
  }
  stepParticles(dt) {
    const P = this.pPos, C = this.pCol, S = this.pSize;
    for (let i = 0; i < this.pMax; i++) {
      const p = this.parts[i];
      if (!p.on) { C[i * 4 + 3] = 0; S[i] = 0; continue; }
      p.age += dt; if (p.age >= p.life) { p.on = false; C[i * 4 + 3] = 0; S[i] = 0; continue; }
      const f = p.age / p.life;
      if (p.kind === 2) { p.vy -= 9.81 * dt; if (p.y < 0.034) { p.on = false; continue; } }
      else { // drift with a bit of swirl, buoyancy fades
        p.vx += Math.sin(p.age * 1.7 + p.seed) * 0.02 * dt; p.vz += Math.cos(p.age * 1.3 + p.seed * 1.7) * 0.02 * dt; p.vy *= (1 - 0.35 * dt);
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const fadeIn = Math.min(1, p.age / 0.25), fadeOut = 1 - f * f;
      P[i * 3] = p.x; P[i * 3 + 1] = p.y; P[i * 3 + 2] = p.z;
      S[i] = p.size + p.grow * p.age;
      C[i * 4] = p.c[0]; C[i * 4 + 1] = p.c[1]; C[i * 4 + 2] = p.c[2]; C[i * 4 + 3] = p.a * fadeIn * fadeOut;
    }
    const g = this.points.geometry; g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = g.attributes.size.needsUpdate = true;
  }

  /* ---- tongs: two steel arms that pinch the steak ---- */
  buildTongs() {
    const steel = new THREE.MeshStandardMaterial({ color: 0x8e9196, metalness: 1, roughness: 0.34 });
    const g = this.tongs = new THREE.Group(); g.visible = false;
    this.arms = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.004, 1), steel); m.castShadow = true; g.add(m); return m; });
    this.pads = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.0035, 0.02), steel); m.castShadow = true; g.add(m); return m; });
    this.hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.02, 12), steel); g.add(this.hinge);
    this.scene.add(g);
  }
  setTongs(show, center, axis, thickness, towardCam) {
    this.tongs.visible = show; if (!show) return;
    const c = new THREE.Vector3(...center), ax = new THREE.Vector3(...axis).normalize();
    const up = new THREE.Vector3(0, 1, 0), tc = new THREE.Vector3(towardCam[0], 0, towardCam[2]).normalize();
    const hinge = c.clone().addScaledVector(up, 0.13).addScaledVector(tc, 0.17);
    const tips = [c.clone().addScaledVector(ax, thickness / 2 + 0.002), c.clone().addScaledVector(ax, -thickness / 2 - 0.002)];
    this.hinge.position.copy(hinge); this.hinge.lookAt(hinge.clone().add(new THREE.Vector3().crossVectors(ax, hinge.clone().sub(c)).normalize())); this.hinge.rotateX(Math.PI / 2);
    for (let i = 0; i < 2; i++) {
      const tip = tips[i], arm = this.arms[i], len = tip.distanceTo(hinge);
      arm.position.copy(tip).lerp(hinge, 0.5); arm.scale.set(1, 1, len); arm.lookAt(hinge);
      const pad = this.pads[i]; pad.position.copy(tip).addScaledVector(ax, (i === 0 ? 1 : -1) * 0.0022); pad.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ax);
    }
  }

  /* ---- per-frame visuals driven by the sim ---- */
  update(dt, st) {
    this.time += dt;
    const t = this.time, power = st.power;
    // flames
    const lit = power > 0.01;
    for (const f of this.flames) {
      const fl = 0.75 + 0.25 * Math.sin(t * 17 + f.userData.phase) * Math.sin(t * 7.3 + f.userData.phase * 2);
      const s = lit ? (0.35 + 1.5 * power) * fl : 0; f.scale.set(1, Math.max(0.001, s), 1); f.visible = lit;
    }
    this.flameLight.intensity = lit ? 0.004 + 0.016 * power : 0;
    this.panGlow.intensity = 0;
    // knob angle
    this.knob.rotation.y = -(-2.3 + st.dialKnob * 4.6);
    // oil shimmer: faster ripple when the pan is hot
    const hot = clamp((st.panC - 120) / 120, 0, 1);
    this.oil.material.bumpScale = 0.15 + 0.5 * hot;
    this.oil.material.bumpMap.offset.set(Math.sin(t * (0.5 + 2 * hot)) * 0.02, t * 0.01 * hot); this.oil.material.bumpMap.needsUpdate = true;
    // heat tint on the iron (slightly warmer, shinier as the seasoning heats)
    this.panMat.emissive.setRGB(0.25, 0.05, 0); this.panMat.emissiveIntensity = 0.05 * Math.pow(hot, 3);
    this.pMat.uniforms.scale.value = this.renderer.domElement.height * 0.5 / Math.tan(THREE.MathUtils.degToRad(st.fov) / 2);
    this.stepParticles(dt);
  }
}
