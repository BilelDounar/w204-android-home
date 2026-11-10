// Home-screen 3D scene: turntable (contact) -> road (engine running). Driven by the vehicle state from signals.js.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

// wheels pulled in: the model's tyres stood 3 cm proud of the arches ("4x4" look) -> 1.5 cm inside
const WHEEL_IN = 0.045;
const KEY_DIR = new THREE.Vector3(3, 7, 4).normalize();      // single light: above, front-right of the showroom view
const ENV = {
  night: { zenith: '#9aa3b0', horizon: '#3c434e', ground: '#0d0f12', box: '#ffffff' },
  day:   { zenith: '#f4f6f9', horizon: '#b9bfc8', ground: '#3e434b', box: '#ffffff' },   // dark ground band = contrast on black paint
};
const PLATE_H = 0.09, ROAD_LEN = 40, TILE = 8, ROAD_W = 12, TYRE_R = 0.322;
const ease = { inOut: t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2, out: t => 1 - Math.pow(1 - t, 3) };
const lerp = THREE.MathUtils.lerp, clamp = THREE.MathUtils.clamp;
const THEMES = {
  night: { bg: 0x0b0d10, line: 0x5d6670, plate: 0x262a31, side: 0x101215, shadow: .8, key: 1.1, glow: .7, exp: 1.25 },
  day:   { bg: 0xeef0f3, line: 0x8e959e, plate: 0xe2e5e9, side: 0xc4c9cf, shadow: .45, key: 1.1, glow: .5, exp: 0.9 },
};
const POSE = {
  showroom: { pos: new THREE.Vector3(-4.1, 1.30, 5.3), tgt: new THREE.Vector3(0, 0.55, 0) },   // front ¾, nose to the right
  drive:    { pos: new THREE.Vector3(0.0, 3.3, 8.4), tgt: new THREE.Vector3(0, 0.6, -3.0) },     // ≈14° chase view (was 42°), closer, rear of the car visible
};
const OFF_LIGHTS = () => ({ running: 0, lowbeam: 0, highbeam: 0, lowhighbeam: 0, fog: 0, brakelights: 0, signal_L: 0, signal_R: 0, reverse: 0 });

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export class CarScene {
  constructor(canvas, { assetBase = 'assets/', maxFps = 60, pixelRatio = 1.5, antialias = true, autoQuality = true, dequantize = false, onLog = () => {} } = {}) {
    this.dequantize = dequantize;
    this.assetBase = assetBase; this.minFrame = 1000 / maxFps;
    this.logs = []; this.log = msg => { this.logs.push(msg); onLog(msg); }; this.autoQuality = autoQuality; this.prCap = Math.min(devicePixelRatio, pixelRatio);
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias, powerPreference: 'high-performance' });
    r.setPixelRatio(this.prCap); r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.9;   // natural, not over-exposed
    const sc = this.scene = new THREE.Scene();
    sc.background = new THREE.Color(THEMES.night.bg); sc.fog = new THREE.Fog(sc.background.clone(), 14, 70);
    // ONE light source: a soft sky dome whose single "softbox" sits where the key light comes from (no multi-panel studio
    // reflections), horizon = background colour so the car blends into the scene. One env per theme.
    this.pmrem = new THREE.PMREMGenerator(r);
    this.envs = { night: this._makeEnv(ENV.night), day: this._makeEnv(ENV.day) };
    sc.environment = this.envs.night; this.envTheme = 'night';
    // some old GPUs (e.g. Adreno 305) cannot filter the half-float environment map -> everything metallic turns black
    this.envOk = this._envCheck();
    if (!this.envOk) {
      // 1st fallback: same environment map, point-sampled (no float filtering needed) -> coarser but real reflections
      const env = sc.environment; env.minFilter = env.magFilter = THREE.NearestFilter; env.generateMipmaps = false; env.needsUpdate = true;
      this.envOk = this._envCheck();
      this.log(this.envOk ? 'env-nearest' : 'env-nearest-failed');
    }
    if (!this.envOk) {
      // 2nd fallback (old Adreno 3xx drivers render every lit shader black under WebGL2): matcap materials, no light uniforms
      sc.environment = null;
      sc.add(new THREE.HemisphereLight(0xffffff, 0x4a4f57, 2.0));
      const fill = new THREE.DirectionalLight(0xffffff, 1.0); fill.position.set(-5, 4, -3); sc.add(fill);
      const back = new THREE.DirectionalLight(0xffffff, 0.8); back.position.set(0, 6, -8); sc.add(back);
    }
    this.key = new THREE.DirectionalLight(0xfff4e8, 1.0); this.key.position.copy(KEY_DIR).multiplyScalar(10); sc.add(this.key);   // same direction as the softbox
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
    this._buildPlate(); this._buildRoad(); this._buildRig();
    if (!this.envOk) {                                          // plate materials too (built after the env check)
      this.plateMat = this._toMatcap(this.plateMat); this.plateSide = this._toMatcap(this.plateSide);
      this.plate.children[0].material = [this.plateSide, this.plateMat, this.plateSide];
    }

    this.v = null;                 // last vehicle state
    this.S = { state: 'off', yaw: 0, road: 0, camK: 0, speed: 0, shake: 0, flash: 0, wake: false, ring: 0,
               lights: OFF_LIGHTS(), doorK: { FL: 0, FR: 0, RL: 0, RR: 0, trunk: 0, hood: 0 } };
    this.anim = null; this.queue = null;
    this.themeK = 0; this.themeTarget = 0;
    this.zoneCenter = 0.5;         // horizontal centre of the car area (0..1 of the screen width)
    this.listeners = [];
    this.t = 0; this.last = performance.now(); this.running = false; this.dirty = true; this.lastDraw = 0;
    this.manual = false; this.camOverride = null;
    this.cars = {}; this.car = null; this._lampCol = new THREE.Color();
  }

  /* ---------------------------------------------------------------- build */
  _buildPlate() {
    const top = canvasTex(1024, 1024, (g, w) => {
      const r = w / 2; g.fillStyle = '#fff'; g.fillRect(0, 0, w, w);
      const grd = g.createRadialGradient(r, r, 0, r, r, r); grd.addColorStop(0, '#fff'); grd.addColorStop(1, '#c9c9c9');
      g.fillStyle = grd; g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.10)'; g.lineWidth = 2;
      for (let i = 0; i < 72; i++) { const a = i / 72 * Math.PI * 2; g.beginPath(); g.moveTo(r + Math.cos(a) * r * .55, r + Math.sin(a) * r * .55); g.lineTo(r + Math.cos(a) * r * .97, r + Math.sin(a) * r * .97); g.stroke(); }
      for (const k of [.55, .8, .97]) { g.beginPath(); g.arc(r, r, r * k, 0, Math.PI * 2); g.stroke(); }
    });
    this.plateMat = new THREE.MeshStandardMaterial({ map: top, metalness: .55, roughness: .38, transparent: true });
    this.plateSide = new THREE.MeshStandardMaterial({ color: 0x0f1115, metalness: .7, roughness: .3, transparent: true });
    const plate = this.plate = new THREE.Group();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(2.75, 2.85, PLATE_H, 128, 1), [this.plateSide, this.plateMat, this.plateSide]);
    m.position.y = PLATE_H / 2; plate.add(m);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0x5ac8fa, transparent: true, opacity: 0 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.8, 0.012, 8, 160), this.ringMat); ring.rotation.x = Math.PI / 2; ring.position.y = PLATE_H * .55; plate.add(ring);
    this.glow = new THREE.Mesh(new THREE.CircleGeometry(4.5, 64), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false,
      map: canvasTex(256, 256, (g, w) => { const r = w / 2, grd = g.createRadialGradient(r, r, r * .55, r, r, r); grd.addColorStop(0, 'rgba(90,200,250,.10)'); grd.addColorStop(1, 'rgba(90,200,250,0)'); g.fillStyle = grd; g.fillRect(0, 0, w, w); }) }));
    this.glow.rotation.x = -Math.PI / 2; this.glow.position.y = 0.001; plate.add(this.glow);
    this.scene.add(plate);
  }
  _buildRoad() {
    const tex = this.roadTex = canvasTex(1024, 512, (g, w, h) => {
      const px = w / ROAD_W, lw = Math.max(2, 0.15 * px), at = x => w / 2 + x * px - lw / 2;
      g.clearRect(0, 0, w, h); g.fillStyle = '#fff';
      g.fillRect(at(-1.85), 0, lw, h * 0.375); g.fillRect(at(1.85), 0, lw, h * 0.375);     // centre lane: dashed lines only
    });
    tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1, ROAD_LEN / TILE); tex.anisotropy = 8;
    this.roadMat = new THREE.MeshBasicMaterial({ map: tex, color: THEMES.night.line, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    const road = this.road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, ROAD_LEN), this.roadMat);
    // short road: lines fade out over the far half (alpha gradient, own UV transform -> not repeated)
    const fadeC = document.createElement('canvas'); fadeC.width = 4; fadeC.height = 256; const fg = fadeC.getContext('2d');
    const gr = fg.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#000'); gr.addColorStop(.55, '#fff'); gr.addColorStop(.85, '#fff'); gr.addColorStop(1, '#000');
    fg.fillStyle = gr; fg.fillRect(0, 0, 4, 256); this.roadMat.alphaMap = new THREE.CanvasTexture(fadeC);
    road.rotation.x = -Math.PI / 2; road.position.set(0, 0.0005, -ROAD_LEN / 2 + 7); this.scene.add(road);
  }
  _buildRig() {
    this.rig = new THREE.Group(); this.scene.add(this.rig);
    const c = document.createElement('canvas'); c.width = 128; c.height = 256; const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, 128, 256); g.filter = 'blur(14px)'; g.fillStyle = '#fff'; g.beginPath(); g.ellipse(64, 128, 38, 98, 0, 0, Math.PI * 2); g.fill();
    const sh = this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 5.6),
      new THREE.MeshBasicMaterial({ color: 0, alphaMap: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    sh.rotation.x = -Math.PI / 2; sh.position.y = 0.012; sh.renderOrder = 1; this.rig.add(sh);
    // under-glow ("neon" under the car), tinted with the interior LED colour
    const c2 = document.createElement('canvas'); c2.width = 128; c2.height = 256; const g2 = c2.getContext('2d');
    const gr = g2.createRadialGradient(64, 128, 10, 64, 128, 64); gr.addColorStop(0, '#e0e0e0'); gr.addColorStop(.4, '#6a6a6a'); gr.addColorStop(.75, '#151515'); gr.addColorStop(1, '#000');
    g2.fillStyle = '#000'; g2.fillRect(0, 0, 128, 256); g2.setTransform(1, 0, 0, 2, 0, -128); g2.fillStyle = gr; g2.fillRect(0, 0, 128, 256);   // alphaMap reads luminance
    const ug = this.under = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 5.7),
      new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: new THREE.CanvasTexture(c2), transparent: true, depthWrite: false, toneMapped: false,
        blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    ug.rotation.x = -Math.PI / 2; ug.position.y = 0.014; ug.renderOrder = 2; ug.visible = false; this.rig.add(ug);
    this.glowK = THEMES.night.glow;
  }
  /** rgb = [r,g,b] 0-255 (current LED output) or null to hide */
  setUnderglow(rgb) {
    const on = !!rgb && rgb.some(x => x > 4);
    this.under.visible = on;
    if (on) this.under.material.color.setRGB(rgb[0] / 255 * this.glowK, rgb[1] / 255 * this.glowK, rgb[2] / 255 * this.glowK);
    this.requestRender();
  }

  _makeEnv(e) {
    const W = 1024, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, e.zenith); sky.addColorStop(0.47, e.horizon); sky.addColorStop(0.53, e.horizon); sky.addColorStop(0.62, e.ground); sky.addColorStop(1, e.ground);
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    // softbox in the key-light direction (equirect: u from azimuth, v from elevation)
    const d = KEY_DIR, u = (Math.atan2(d.z, d.x) / (2 * Math.PI) + 0.5) * W, v = (0.5 - Math.asin(d.y) / Math.PI) * H;
    for (const du of [-W, 0, W]) {
      const gr = g.createRadialGradient(u + du, v, 0, u + du, v, H * 0.32);
      gr.addColorStop(0, e.box); gr.addColorStop(0.35, e.box + '99'); gr.addColorStop(1, e.box + '00');
      g.save(); g.translate(u + du, v); g.scale(1.6, 1); g.translate(-(u + du), -v); g.fillStyle = gr; g.fillRect(0, 0, W, H); g.restore();
    }
    const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
    const env = this.pmrem.fromEquirectangular(t).texture; t.dispose(); return env;
  }

  _envCheck() {
    try {
      const r = this.renderer, rt = new THREE.WebGLRenderTarget(8, 8);
      const sc = new THREE.Scene(); sc.environment = this.scene.environment;
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.4 }));
      sc.add(m); const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 10); cam.position.z = 2.2;
      r.setRenderTarget(rt); r.render(sc, cam); const px = new Uint8Array(8 * 8 * 4); r.readRenderTargetPixels(rt, 0, 0, 8, 8, px); r.setRenderTarget(null);
      rt.dispose(); m.geometry.dispose(); m.material.dispose();
      let sum = 0; for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
      return sum / (64 * 3) > 12;                       // a lit metal sphere is clearly not black
    } catch (e) { return true; }
  }
  _matcap() {
    // studio-like lighting sphere (soft key top-left, rim, dark floor) drawn once: lighting without any light uniform
    return this._mc ??= canvasTex(256, 256, (g, w) => {
      const r = w / 2; g.fillStyle = '#000'; g.fillRect(0, 0, w, w);
      let gr = g.createRadialGradient(r * .7, r * .55, 4, r, r, r);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(.3, '#d7dbe1'); gr.addColorStop(.75, '#737a84'); gr.addColorStop(1, '#2a2d33');
      g.fillStyle = gr; g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();
      gr = g.createLinearGradient(0, w * .62, 0, w); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.55)');
      g.fillStyle = gr; g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 6; g.beginPath(); g.arc(r, r, r - 4, Math.PI * 1.05, Math.PI * 1.6); g.stroke();
    });
  }
  _toMatcap(m) {
    if (!m || !(m.isMeshStandardMaterial || m.isMeshPhongMaterial)) return m;
    const lamp = !!m.userData?.light;
    const black = m.metalness > 0.5 && m.color.getHSL({ h: 0, s: 0, l: 0 }).l < 0.05;
    const p = new THREE.MeshMatcapMaterial({ name: m.name, matcap: this._matcap(), color: black ? new THREE.Color(0x4a4f58) : m.color.clone(), map: m.map,
      alphaMap: m.alphaMap, transparent: m.transparent, opacity: m.opacity, alphaTest: m.alphaTest, side: m.side, depthWrite: m.depthWrite });
    p.userData = { ...m.userData, baseColor: p.color.clone(), emissiveMap: m.emissiveMap, lamp };
    return p;
  }
  _toPhong(m) {
    if (!m || !m.isMeshStandardMaterial) return m;
    const p = new THREE.MeshPhongMaterial({
      name: m.name, color: m.color, map: m.map, emissive: m.emissive, emissiveMap: m.emissiveMap, emissiveIntensity: m.emissiveIntensity,
      alphaMap: m.alphaMap, transparent: m.transparent, opacity: m.opacity, alphaTest: m.alphaTest, side: m.side, depthWrite: m.depthWrite,
      shininess: 8 + (1 - m.roughness) * 120, specular: new THREE.Color().setScalar(0.12 + m.metalness * 0.5),
    });
    if (m.color && m.metalness > 0.5 && m.color.getHSL({ h: 0, s: 0, l: 0 }).l < 0.05) p.color = new THREE.Color(0x1d1f23);   // black metallic paint: no env -> lift to dark grey
    p.userData = m.userData;
    return p;
  }
  _refine() {
    // still image: render the canvas itself at 2× resolution; the compositor scales it down smoothly (supersampling).
    // Same pipeline as normal frames (tone mapping, colours) -> identical look, just sharper edges.
    try {
      const r = this.renderer, base = r.getPixelRatio(), maxTex = r.capabilities.maxTextureSize;
      const pr = Math.min(base * 2, 2.5, maxTex / Math.max(this.w, this.h));
      if (pr <= base * 1.05) return;
      this.basePr = base; r.setPixelRatio(pr); r.setSize(this.w, this.h, false);
      this._draw();
      this.ss = true;
    } catch (e) { this.log('refine ' + e.message); }
  }
  _unrefine() { if (this.ss) { this.ss = false; this.renderer.setPixelRatio(this.basePr); this.renderer.setSize(this.w, this.h, false); } }
  _draw() { this.renderer.render(this.scene, this.camera); }
  _quality(dtMs) {
    // auto quality: while animating, if the average frame rate stays low, lower the render resolution
    if (!this.autoQuality || !this.car) return;                    // not during loading (stalls would fake a low fps)
    const q = this.q ??= { n: 0, sum: 0 };
    q.n++; q.sum += dtMs;
    if (q.n < 45) return;
    const fps = 1000 / (q.sum / q.n); q.n = 0; q.sum = 0;
    if (this.ss) return;
    const pr = this.renderer.getPixelRatio();
    const floor = Math.min(1, devicePixelRatio);                 // never below the screen's native resolution (was too pixelated)
    if (fps < 26 && pr > floor + 0.01) { this.renderer.setPixelRatio(Math.max(floor, pr - 0.1)); this.resize(this.w, this.h); this.log(`quality pr=${this.renderer.getPixelRatio().toFixed(2)} fps=${fps.toFixed(1)}`); }
    else if (fps > 50 && pr < this.prCap) { this.renderer.setPixelRatio(Math.min(this.prCap, pr + 0.1)); this.resize(this.w, this.h); }
    this.fps = fps;
  }

  /* ---------------------------------------------------------------- assets */
  async load(paint = 'black') {
    if (!this.cars[paint]) {
      const g = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${this.assetBase}w204_facelift_${paint}.glb`);
      const info = { root: g.scene, wheels: [], lamps: [], parts: {} };
      g.scene.traverse(o => {
        const ex = o.userData || {};
        if (ex.type === 'wheel') { o.position.x -= Math.sign(o.position.x) * WHEEL_IN; info.wheels.push({ o, q0: o.quaternion.clone(), a: 0 }); }
        if (['door', 'trunk', 'hood'].includes(ex.type)) info.parts[o.name.replace('door_', '')] = { o, ex, q0: o.quaternion.clone() };
        if (o.isMesh && o.material.userData.light) info.lamps.push(o.material);
        if (o.isMesh && this.envOk) for (const m of [].concat(o.material)) {   // tame reflections: less "plastic", more satin paint
          if (!m.isMeshStandardMaterial || m.userData.light) continue;
          m.envMapIntensity = 1.0;                                            // the env IS the light now (single softbox)
          if (m.metalness > 0.5) m.roughness = Math.max(m.roughness, 0.3);        // paint / chrome
          else if (!m.transparent) m.roughness = Math.max(m.roughness, 0.5);      // plastics, tyres, trims
        }
        if (o.isMesh && !this.envOk) o.material = Array.isArray(o.material) ? o.material.map(x => this._toMatcap(x)) : this._toMatcap(o.material);
        if (o.isMesh && this.dequantize) {                     // old drivers: normalized byte/short attributes -> float
          for (const k of ['normal', 'position', 'uv', 'uv1']) {
            const at = o.geometry.attributes[k]; if (!at || !at.normalized) continue;
            const n = at.count, sz = at.itemSize, f = new Float32Array(n * sz);
            for (let i = 0; i < n; i++) { f[i * sz] = at.getX(i); if (sz > 1) f[i * sz + 1] = at.getY(i); if (sz > 2) f[i * sz + 2] = at.getZ(i); if (sz > 3) f[i * sz + 3] = at.getW(i); }
            o.geometry.setAttribute(k, new THREE.BufferAttribute(f, sz));
          }
        }
      });
      info.lamps = []; g.scene.traverse(o => { if (o.isMesh && o.material.userData.light) info.lamps.push(o.material); });
      const b = new THREE.Box3().setFromObject(g.scene);                  // turn around the footprint centre
      g.scene.position.x -= (b.min.x + b.max.x) / 2; g.scene.position.z -= (b.min.z + b.max.z) / 2;
      this.cars[paint] = info;
    }
    if (this.car) this.rig.remove(this.car.root);
    this.car = this.cars[paint]; this.rig.add(this.car.root);
    // compile every shader up front (all materials made visible for the compile), so the first shown frame doesn't freeze
    const hidden = []; this.scene.traverse(o => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    try { await this.renderer.compileAsync(this.scene, this.camera); } catch (e) { this.log('compile ' + e.message); }
    hidden.forEach(o => { o.visible = false; });
    this._frame(performance.now());                              // first frame drawn before the poster goes away
    this.requestRender();
  }

  /* ---------------------------------------------------------------- inputs */
  onFrame(fn) { this.listeners.push(fn); }
  setZoneCenter(x, y = 0.5, hFrac = 1, zoom = 1) { this.zoneCenter = x; this.zoneY = y; this.zoneH = hFrac; this.zoneZoom = zoom; this._resizeCamera(); this.requestRender(); }
  setNight(night) {
    const t = night == null ? (matchMedia('(prefers-color-scheme: dark)').matches ? 0 : 1) : (night ? 0 : 1);
    if (t !== this.themeTarget) { this.themeTarget = t; this.requestRender(); }
  }

  setVehicle(v) {
    this.v = v;                                                            // live object (mutated by signals.js)
    const was = this.flags || { acc: false, engine: false };
    this.flags = { acc: v.acc, engine: v.engine };                         // edges are detected on a copy
    if (v.acc && !was.acc) this._toAcc();
    if (v.engine && !was.engine) this._toStart();
    if (!v.acc && was.acc) this._toOff();
    else if (v.acc && was.engine && !v.engine) this._toShowroom();         // engine stopped, contact still on
    // redraw only if something visible changed (signals.update() runs every 200 ms even without new data)
    const sig = JSON.stringify([v.acc, v.engine, v.speed, v.reverse, v.handbrake, v.brake, v.doors, v.lights, v.signal_L, v.signal_R, v.hazard]);
    if (sig !== this.sig) { this.sig = sig; this.requestRender(); }
  }

  /* ---------------------------------------------------------------- sequences */
  _play(dur, update, done) { this.anim = { t: 0, dur, update, done }; this.requestRender(); }
  _toAcc() {
    const S = this.S; if (S.state !== 'off') return;
    S.state = 'acc'; const y0 = S.yaw, D = 3.9;
    // wake-up: one hazard flash, headlights on, one turntable turn
    this._play(D, k => {
      const tt = k * D; S.flash = (tt > 0.05 && tt < 0.55) ? 1 : 0; if (tt > 0.75) S.wake = true;
      const kk = clamp((tt - 0.8) / (D - 0.8), 0, 1); S.yaw = y0 + ease.inOut(kk) * Math.PI * 2;
      S.ring = tt < 0.8 ? tt / 0.8 * .6 : Math.sin(kk * Math.PI) * .6 + .25;
    }, () => { S.yaw = y0 + Math.PI * 2; S.flash = 0; const q = this.queue; this.queue = null; q && q(); });
  }
  _toStart() {
    const S = this.S;
    if (S.state === 'off') { this.queue = () => this._toStart(); this._toAcc(); return; }
    if (S.state === 'acc' && this.anim) { this.queue = () => this._toStart(); return; }
    if (S.state !== 'acc') return;
    S.state = 'starting'; S.shake = 1; S.wake = true;
    const y0 = S.yaw, y1 = Math.ceil((y0 - 0.01) / (Math.PI * 2)) * Math.PI * 2 + Math.PI;
    this._play(0.45, () => {}, () => this._play(3.0, k => {
      const e = ease.inOut(k); S.yaw = lerp(y0, y1, e); S.road = ease.out(Math.max(0, (k - .25) / .75)); S.camK = e; S.ring = .25 * (1 - k);
    }, () => { S.state = 'drive'; }));
  }
  _toShowroom(thenOff = false) {
    const S = this.S; if (S.state === 'off' || S.state === 'acc') return;
    this.queue = null; S.state = 'stopping';
    const y0 = S.yaw, y1 = y0 + Math.PI, c0 = S.camK, r0 = S.road;
    this._play(2.8, k => { const e = ease.inOut(k); S.yaw = lerp(y0, y1, e); S.camK = lerp(c0, 0, e); S.road = lerp(r0, 0, e); },
      () => { S.state = thenOff ? 'off' : 'acc'; if (thenOff) S.wake = false; });
  }
  _toOff() {
    const S = this.S;
    if (S.state === 'acc' || S.state === 'off') { this.anim = null; this.queue = null; S.state = 'off'; S.wake = false; S.ring = 0; return; }
    this._toShowroom(true);
  }

  /* ---------------------------------------------------------------- loop (render on demand) */
  requestRender() { this.dirty = true; if (!this.running && !this.manual) { this.running = true; this.last = performance.now(); requestAnimationFrame(n => this._loop(n)); } }
  _active() {
    const S = this.S, v = this.v || {};
    const doorsMoving = Object.entries(S.doorK).some(([k, x]) => Math.abs(x - (v.doors?.[k] ? 1 : 0)) > 0.002);
    const blinking = S.flash > 0 || v.hazard || v.signal_L || v.signal_R;
    return !!this.anim || doorsMoving || blinking || S.shake > 0 || Math.abs(this.themeK - this.themeTarget) > 0.002
      || S.speed > 0.05 || (S.state === 'drive' && Math.abs(S.speed - (v.speed || 0)) > 0.05) || (S.state === 'off' && S.ring > 0.01);
  }
  _loop(now) {
    if (this.manual) { this.running = false; return; }
    const active = this._active();
    if (active || this.dirty) {
      if (now - this.lastDraw >= this.minFrame - 1) { if (active && this.lastDraw) this._quality(now - this.lastDraw); this._frame(now); this.lastDraw = now; this.dirty = false; this.refined = false; }
      requestAnimationFrame(n => this._loop(n));
    } else {
      if (!this.refined) { this._refine(); this.refined = true; }   // one supersampled + MSAA frame when the scene comes to rest
      this.running = false;                                         // idle: no GPU work until the next change
    }
  }

  _frame(now) {
    this._unrefine();
    const S = this.S, v = this.v || { doors: {}, lights: {} };
    const rdt = Math.min((now - this.last) / 1000, 0.25); this.last = now; const dt = Math.min(rdt, 0.05); this.t += rdt;
    if (this.anim) { const a = this.anim; a.t += rdt; const k = Math.min(1, a.t / a.dur); a.update(k); if (k >= 1) { this.anim = null; a.done && a.done(); } }

    // speed: smoothed (decoder updates a few times per second)
    const prev = S.speed, target = S.state === 'drive' ? (v.speed || 0) : 0;
    S.speed += (target - S.speed) * Math.min(1, dt * 1.6);
    const decel = (prev - S.speed) / Math.max(dt, 1e-3);

    // lights: real inputs when the decoder provides them, otherwise "awake" defaults
    const L = S.lights, lit = v.lights || {}, awake = S.wake && v.acc !== false;
    L.running = awake ? 1 : 0;
    L.lowbeam = (lit.lowbeam ?? awake) ? 1 : 0;
    L.lowhighbeam = (lit.position ?? lit.lowbeam ?? awake) ? 1 : 0;
    L.highbeam = lit.highbeam ? 1 : 0; L.fog = lit.fog ? 1 : 0;
    L.reverse = v.reverse ? 1 : 0;
    L.brakelights = (v.brake ?? (S.state === 'drive' && decel > 1.5)) ? 1 : 0;
    const blink = (this.t % 0.75) < 0.4;
    L.signal_L = (S.flash || ((v.hazard || v.signal_L) && blink)) ? 1 : 0;
    L.signal_R = (S.flash || ((v.hazard || v.signal_R) && blink)) ? 1 : 0;

    // rig / plate / road
    S.shake = Math.max(0, S.shake - dt * 2.2);
    this.rig.rotation.y = S.yaw;
    const plateY = -PLATE_H * 1.05 * S.road;
    this.rig.position.y = Math.max(0, PLATE_H + plateY);
    if (this.car) { this.car.root.position.y = Math.abs(Math.sin(this.t * 90)) * 0.004 * S.shake; this.car.root.rotation.z = Math.sin(this.t * 70) * 0.003 * S.shake; }
    this.plate.rotation.y = S.yaw; this.plate.position.y = plateY;
    this.plateMat.opacity = this.plateSide.opacity = 1 - S.road; this.glow.material.opacity = 1 - S.road; this.plate.visible = S.road < .999;
    this.roadMat.opacity = S.road; this.road.visible = S.road > .001;
    this.roadTex.offset.y += (v.reverse ? -1 : 1) * (S.speed / 3.6) * dt / TILE;   // forward: lines come down the screen
    if (S.state === 'off') S.ring *= 0.9;
    this.ringMat.opacity = S.ring;

    // theme
    this.themeK += (this.themeTarget - this.themeK) * Math.min(1, rdt * 3);
    this._applyTheme(this.themeK);

    // camera
    const pos = new THREE.Vector3().lerpVectors(POSE.showroom.pos, POSE.drive.pos, S.camK);
    const tgt = new THREE.Vector3().lerpVectors(POSE.showroom.tgt, POSE.drive.tgt, S.camK);
    const fit = Math.max(1, 1.75 / this.zoneAspect) * (this.zoneZoom || 1);
    this.camera.position.copy(tgt).addScaledVector(pos.sub(tgt), fit); this.camera.lookAt(tgt);
    if (this.camOverride) { this.camera.position.fromArray(this.camOverride.pos); this.camera.lookAt(...this.camOverride.tgt); }

    if (this.car) {
      for (const w of this.car.wheels) { w.a += (v.reverse ? -1 : 1) * (S.speed / 3.6) / TYRE_R * dt; w.o.quaternion.copy(w.q0).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), w.a)); }
      for (const [k, p] of Object.entries(this.car.parts)) {
        S.doorK[k] += ((v.doors?.[k] ? 1 : 0) - S.doorK[k]) * Math.min(1, dt * 4);
        p.o.quaternion.copy(p.q0).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3().fromArray(p.ex.hingeAxis), THREE.MathUtils.degToRad(p.ex.openAngleDeg * p.ex.openSign * S.doorK[k])));
      }
      for (const m of this.car.lamps) {
        const e = m.userData.electrics || {}; let k = 0;
        for (const key in e) k = Math.max(k, (L[key] || 0) * e[key]);
        if (m.emissive) { m.emissive.fromArray(m.userData.emissiveOn || [1, 1, 1]); m.emissiveIntensity = k * Math.min(m.userData.emissiveStrength || 3, 6); }
        else if (m.userData.baseColor) m.color.copy(m.userData.baseColor).lerp(this._lampCol.fromArray(m.userData.emissiveOn || [1, 1, 1]).multiplyScalar(2.2), Math.min(1, k));
      }
    }
    this.renderer.render(this.scene, this.camera);
    for (const fn of this.listeners) fn(this);
  }

  _applyTheme(k) {
    const N = THEMES.night, D = THEMES.day, a = new THREE.Color(), b = new THREE.Color();
    const mix = (x, y, out) => out.copy(a.setHex(x)).lerp(b.setHex(y), k);
    mix(N.bg, D.bg, this.scene.background); this.scene.fog.color.copy(this.scene.background);
    mix(N.line, D.line, this.roadMat.color); mix(N.plate, D.plate, this.plateMat.color); mix(N.side, D.side, this.plateSide.color);
    this.glow.visible = k < .99; this.shadow.material.opacity = lerp(N.shadow, D.shadow, k); this.key.intensity = lerp(N.key, D.key, k); this.renderer.toneMappingExposure = lerp(N.exp, D.exp, k);
    const et = k > .5 ? 'day' : 'night';
    if (this.envOk && this.envs && et !== this.envTheme) { this.envTheme = et; this.scene.environment = this.envs[et]; } this.glowK = lerp(N.glow, D.glow, k);
  }

  /* ---------------------------------------------------------------- size */
  resize(w, h) {
    this._unrefine(); this.refined = false;
    this.w = w; this.h = h; this.renderer.setSize(w, h, false); this._resizeCamera(); this.requestRender();
  }
  _resizeCamera() {
    if (!this.w) return;
    const { w, h } = this;
    // the car is framed in a zone centred at zoneCenter·width; its width = 2·min(zc, 1-zc)·width
    const zoneW = 2 * Math.min(this.zoneCenter, 1 - this.zoneCenter) * w;
    this.zoneAspect = zoneW / (h * (this.zoneH || 1));
    this.camera.aspect = w / h;
    this.camera.setViewOffset(w, h, (0.5 - this.zoneCenter) * w, (0.5 - (this.zoneY ?? 0.5)) * h, w, h);
    this.camera.updateProjectionMatrix();
  }

  /* ---------------------------------------------------------------- test hooks */
  step(sec, fps = 30) { this.manual = true; const n = Math.round(sec * fps); for (let i = 0; i < n; i++) this._frame(this.last + 1000 / fps); this.manual = false; }
  snapshot(type = 'image/jpeg') { return this.renderer.domElement.toDataURL(type, .8); }
}
