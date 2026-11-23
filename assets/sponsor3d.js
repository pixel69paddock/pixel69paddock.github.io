// Daily Derby: 3D sponsor viewer. A walk-around model of the course with every sponsor spot on it.
// mount(el, spots, opts) -> { select(id), preview({ text, logo }), view(name), dispose() }
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const PX = '"Press Start 2P", ui-monospace, monospace';
const COL = { neon: "#ff3d6e", gold: "#f5c242", night: "#170f26", ink: "#f4ecdf", cyan: "#3ad6ff" };

// Course: stadium-shaped oval, long axis along z (+z is the front, nearest the camera)
const HL = 34;            // half length of the straights
const OUT = 38, IN = 16;  // outer and inner radius of the track

// Where each spot lives in 3D, and the camera view that shows it best
const LAYOUT = {
  "blimp":        { cam: [70, 120, 70], look: [0, 100, -40] },
  "big-screen":   { cam: [0, 70, 40], look: [0, 64, -124] },
  "infield":      { cam: [0, 70, 40], look: [0, 0, -6] },
  "starting-gate":{ cam: [40, 22, 18], look: [27, 6, -28] },
  "front-left":   { cam: [-30, 20, 140], look: [-28, 5, 86] },
  "front-right":  { cam: [30, 20, 140], look: [28, 5, 86] },
  "side-1":       { cam: [-20, 25, 0], look: [-50, 6, -40] },
  "side-2":       { cam: [-15, 25, 35], look: [-54, 6, -8] },
  "side-3":       { cam: [20, 25, -5], look: [50, 6, -45] },
  "side-4":       { cam: [15, 25, 30], look: [54, 6, -12] }
};
const VIEWS = {
  race: { cam: [0, 92, 190], look: [0, 30, -30] },
  low: { cam: [0, 14, 122], look: [0, 10, 0] },
  side: { cam: [120, 55, 70], look: [0, 10, -10] }
};

function stadium(r) {
  const s = new THREE.Shape();
  s.moveTo(r, -HL); s.lineTo(r, HL);
  s.absarc(0, HL, r, 0, Math.PI, false);
  s.lineTo(-r, -HL);
  s.absarc(0, -HL, r, Math.PI, Math.PI * 2, false);
  return s;
}
const holeOf = r => { const s = stadium(r); return new THREE.Path(s.getPoints(64).reverse()); };
function ring(r1, r2) { const s = stadium(r1); s.holes.push(holeOf(r2)); return s; }
// flat shape in the xz plane (shape y -> world z)
// (the course is symmetric front-to-back, so the y -> -z flip doesn't matter)
function flat(shape, mat, y) {
  const m = new THREE.Mesh(new THREE.ShapeGeometry(shape, 48), mat);
  m.rotation.x = -Math.PI / 2; m.position.y = y; return m;
}
function canvasTex(c, nearest = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (nearest) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearMipmapLinearFilter; }
  t.anisotropy = 4;
  return t;
}
function stripes(a, b, n = 2) {
  const c = document.createElement("canvas"); c.width = 4; c.height = n * 2;
  const x = c.getContext("2d");
  for (let i = 0; i < n * 2; i++) { x.fillStyle = i % 2 ? a : b; x.fillRect(0, i, 4, 1); }
  const t = canvasTex(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function rand(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }
function fitFont(x, text, maxW, size, family, weight = "") {
  for (; size > 8; size -= 2) { x.font = `${weight} ${size}px ${family}`.trim(); if (x.measureText(text).width <= maxW) break; }
  return size;
}

// The art on each sponsor surface: preview brand > booked sponsor > "your brand here"
function paint(c, spot, prev, isSel, opts) {
  const x = c.getContext("2d"), W = c.width, H = c.height;
  const paintOnGrass = spot.id === "infield";
  x.clearRect(0, 0, W, H);
  const brand = prev && (prev.text || prev.logo) ? prev : spot.status === "taken" ? { text: spot.sponsor } : null;
  if (!paintOnGrass) { x.fillStyle = brand ? "#fff8ec" : COL.night; x.fillRect(0, 0, W, H); }
  if (brand) {
    const pad = H * 0.12;
    let tx = pad;
    if (brand.logo) {
      const L = brand.logo, s = Math.min((H - pad * 2) / L.height, (brand.text ? W * 0.35 : W - pad * 2) / L.width);
      const lw = L.width * s, lh = L.height * s;
      const lx = brand.text ? pad : (W - lw) / 2;
      x.drawImage(L, lx, (H - lh) / 2, lw, lh); tx = lx + lw + pad;
    }
    if (brand.text) {
      const avail = W - tx - pad;
      x.fillStyle = paintOnGrass ? "rgba(255,255,255,.88)" : "#1b1230";
      x.textBaseline = "middle"; x.textAlign = brand.logo ? "left" : "center";
      fitFont(x, brand.text, avail, Math.round(H * 0.5), "'Space Grotesk', system-ui, sans-serif", "700");
      x.fillText(brand.text, brand.logo ? tx : W / 2, H / 2 + 2, avail);
    }
  } else {
    const lw = Math.max(4, H * 0.05);
    x.setLineDash([lw * 2.4, lw * 1.6]); x.lineWidth = lw;
    x.strokeStyle = isSel ? COL.neon : COL.gold;
    x.strokeRect(lw, lw, W - lw * 2, H - lw * 2);
    x.setLineDash([]);
    x.fillStyle = isSel ? COL.neon : COL.gold; x.textAlign = "center"; x.textBaseline = "middle";
    const big = W / H > 2.5 ? 0.3 : 0.17;
    fitFont(x, "YOUR BRAND HERE", W * 0.86, Math.round(H * big), PX);
    x.fillText("YOUR BRAND HERE", W / 2, H * (spot.price ? 0.42 : 0.5));
    if (spot.price) {
      x.fillStyle = paintOnGrass ? "rgba(255,255,255,.85)" : COL.ink;
      fitFont(x, `${opts.cur}${spot.price}/WEEK`, W * 0.7, Math.round(H * big * 0.55), PX);
      x.fillText(`${opts.cur}${spot.price}/WEEK`, W / 2, H * 0.72);
    }
  }
}

export function mount(el, spots, opts = {}) {
  const byId = Object.fromEntries(spots.map(s => [s.id, s]));
  const cur = opts.currency || "$";
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#1d1430");
  scene.fog = new THREE.Fog("#2a1a3a", 260, 560);
  const camera = new THREE.PerspectiveCamera(40, 1, 1, 2000);

  scene.add(new THREE.HemisphereLight("#ffe6cc", "#1d2b1d", 1.6));
  const sun = new THREE.DirectionalLight("#ffd9b0", 1.6); sun.position.set(-80, 140, 90); scene.add(sun);
  const L = c => new THREE.MeshLambertMaterial({ color: c, flatShading: true });

  // ground + course
  const grass = stripes("#2f6b3f", "#2b6339"); grass.repeat.set(1, 60);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.MeshLambertMaterial({ map: grass }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  scene.add(flat(ring(OUT, IN), L("#c9a26a"), 0.06));
  const inf = stripes("#2c6a3b", "#245a32"); inf.repeat.set(1, 0.18); inf.wrapS = THREE.RepeatWrapping;
  scene.add(flat(stadium(IN), new THREE.MeshLambertMaterial({ map: inf }), 0.08));
  const rail = (r1, r2) => { const g = new THREE.ExtrudeGeometry(ring(r1, r2), { depth: 1.1, bevelEnabled: false, curveSegments: 48 }); const m = new THREE.Mesh(g, L("#efe3c8")); m.rotation.x = -Math.PI / 2; scene.add(m); };
  rail(OUT + 0.7, OUT); rail(IN, IN - 0.7);
  const pond = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshLambertMaterial({ color: "#3d7bb0" }));
  pond.rotation.x = -Math.PI / 2; pond.scale.set(7, 3.2, 1); pond.position.set(0, 0.12, -40); scene.add(pond);

  // grandstand, crowd and skyline from the race art
  const stand = new THREE.Mesh(new THREE.BoxGeometry(230, 34, 10), L("#1d1530"));
  stand.position.set(0, 17, -93); scene.add(stand);
  const pickMeshes = [], surf = {};
  const addPick = (m, id) => { m.userData.spot = id; pickMeshes.push(m); };
  const art = new Image();
  art.onload = () => {
    const crop = (sx, sy, sw, sh) => { const c = document.createElement("canvas"); c.width = sw; c.height = sh; c.getContext("2d").drawImage(art, sx, sy, sw, sh, 0, 0, sw, sh); return canvasTex(c); };
    const crowd = new THREE.Mesh(new THREE.PlaneGeometry(210, 32), new THREE.MeshLambertMaterial({ map: crop(40, 570, 1000, 210) }));
    crowd.position.set(0, 17, -87.9); crowd.rotation.x = -0.12; scene.add(crowd);
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(260, 134.8), new THREE.MeshBasicMaterial({ map: crop(0, 0, 1080, 560), fog: false }));
    sky.position.set(0, 34 + 67.4, -125); scene.add(sky);
    // stretch the art's sky colour sideways so wide views don't show the card edges
    const side = new THREE.Mesh(new THREE.PlaneGeometry(900, 300), new THREE.MeshBasicMaterial({ color: "#1d1430", fog: false }));
    side.position.set(0, 120, -126); scene.add(side);
  };
  art.src = opts.art || "assets/k2_track.png";

  // trees
  const R = rand(7), treeG = new THREE.IcosahedronGeometry(3.6, 0), trunkG = new THREE.CylinderGeometry(0.5, 0.6, 3, 5);
  const leaf = L("#2f7a3e"), leaf2 = L("#276a35"), bark = L("#5a3a22");
  const avoid = [[-50, -40], [-54, -8], [50, -45], [54, -12]];
  for (let i = 0; i < 46; i++) {
    const sideX = i % 2 ? 1 : -1, x = sideX * (47 + R() * 55), z = -80 + R() * 150;
    if (avoid.some(([ax, az]) => Math.hypot(ax - x, az - z) < 11)) continue;
    const t = new THREE.Group();
    const top = new THREE.Mesh(treeG, R() > .5 ? leaf : leaf2); top.position.y = 5.5; top.scale.setScalar(0.8 + R() * 0.5);
    const tr = new THREE.Mesh(trunkG, bark); tr.position.y = 1.5;
    t.add(top, tr); t.position.set(x, 0, z); scene.add(t);
  }

  // sponsor surfaces
  function surface(id, w, h, pxW, mesh) {
    const s = byId[id]; if (!s) return null;
    const c = document.createElement("canvas"); c.width = pxW; c.height = Math.round(pxW * h / w);
    const tex = canvasTex(c, false);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: id === "infield", toneMapped: false, side: THREE.DoubleSide });
    const list = [];
    const make = () => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); addPick(m, id); list.push(m); return m; };
    surf[id] = { s, c, tex, list };
    return make;
  }
  const post = (h, x, z, g) => { const p = new THREE.Mesh(new THREE.BoxGeometry(0.8, h, 0.8), L("#3b2b4f")); p.position.set(x, h / 2, z); g.add(p); };
  function board(id, w, h, x, z, lift, faceTo) {
    const mk = surface(id, w, h, 512); if (!mk) return;
    const g = new THREE.Group();
    const back = new THREE.Mesh(new THREE.BoxGeometry(w + 1, h + 1, 0.6), L("#241a38")); back.position.y = lift + h / 2; back.position.z = -0.35; g.add(back); addPick(back, id);
    const face = mk(); face.position.y = lift + h / 2; g.add(face);
    post(lift + 0.5, -w / 2 + 1.5, -0.4, g); post(lift + 0.5, w / 2 - 1.5, -0.4, g);
    g.position.set(x, 0, z);
    if (faceTo) g.lookAt(faceTo[0], 0, faceTo[1]);
    scene.add(g); surf[id].anchor = new THREE.Vector3(x, lift + h + 4, z);
  }
  board("front-left", 44, 7, -28, 86, 2.5);
  board("front-right", 44, 7, 28, 86, 2.5);
  board("side-1", 16, 7, -50, -40, 2, [0, 80]);
  board("side-2", 16, 7, -54, -8, 2, [0, 90]);
  board("side-3", 16, 7, 50, -45, 2, [0, 80]);
  board("side-4", 16, 7, 54, -12, 2, [0, 90]);

  // big screen: lies over the neon board in the skyline art
  { const mk = surface("big-screen", 122.8, 26.5, 1024); if (mk) { const m = mk(); m.position.set(0, 34 + (560 - 420) * 0.2407, -124.6); scene.add(m); surf["big-screen"].anchor = new THREE.Vector3(0, 84, -120); } }

  // infield logo painted on the grass
  { const mk = surface("infield", 28, 16, 512); if (mk) { const m = mk(); m.rotation.x = -Math.PI / 2; m.position.set(0, 0.16, -4); scene.add(m); surf.infield.anchor = new THREE.Vector3(0, 8, -4); } }

  // starting gate across the right straight
  if (byId["starting-gate"]) {
    const g = new THREE.Group(), gm = L("#efe3c8");
    for (let i = 0; i <= 6; i++) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7, 3), gm); p.position.set(IN + i * (OUT - IN) / 6, 3.5, 0); g.add(p); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(OUT - IN + 1.2, 1.2, 3.2), L("#3b2b4f")); beam.position.set((IN + OUT) / 2, 7.4, 0); g.add(beam);
    const mk = surface("starting-gate", OUT - IN, 4.2, 512);
    const f = mk(); f.position.set((IN + OUT) / 2, 10, 1.65); g.add(f);
    const b = mk(); b.position.set((IN + OUT) / 2, 10, -1.65); b.rotation.y = Math.PI; g.add(b);
    const back = new THREE.Mesh(new THREE.BoxGeometry(OUT - IN + 0.6, 4.8, 3), L("#241a38")); back.position.set((IN + OUT) / 2, 10, 0); g.add(back); addPick(back, "starting-gate");
    g.position.z = -28; scene.add(g); surf["starting-gate"].anchor = new THREE.Vector3(27, 16, -28);
  }

  // the blimp
  const blimp = new THREE.Group();
  if (byId.blimp) {
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), L("#d9d3e6")); body.scale.set(26, 8.5, 8.5); blimp.add(body); addPick(body, "blimp");
    const finM = L("#ff3d6e");
    [[0, 6], [0, -6], [6, 0], [-6, 0]].forEach(([y, z]) => { const f = new THREE.Mesh(new THREE.BoxGeometry(6, y ? 5 : 0.6, z ? 5 : 0.6), finM); f.position.set(-23, y * 0.9, z * 0.9); blimp.add(f); });
    const gon = new THREE.Mesh(new THREE.BoxGeometry(7, 2.4, 3), L("#3b2b4f")); gon.position.y = -9; blimp.add(gon);
    const mk = surface("blimp", 30, 6.4, 1024);
    const a = mk(); a.position.set(1, 0, 8.6); blimp.add(a);
    const b = mk(); b.position.set(1, 0, -8.6); b.rotation.y = Math.PI; blimp.add(b);
    blimp.position.set(0, 100, -40); scene.add(blimp);
    surf.blimp.anchor = new THREE.Vector3();
  }

  // horses running laps
  const horses = [], hb = new THREE.BoxGeometry(3.2, 1.7, 1.2), hh = new THREE.BoxGeometry(1.3, 1.5, 0.9), hl = new THREE.BoxGeometry(0.4, 1.6, 0.4), jk = new THREE.BoxGeometry(1.1, 1.5, 1);
  const coats = ["#8b5a2b", "#5a3a22", "#2b1d14", "#c9b8a0", "#a0522d", "#6b4a33"], silks = ["#ff3d6e", "#3ad6ff", "#f5c242", "#7dff9c", "#b07cff", "#ff8a3d", "#ffffff"];
  for (let i = 0; i < 14; i++) {
    const g = new THREE.Group(), cm = L(coats[i % coats.length]);
    const b = new THREE.Mesh(hb, cm); b.position.y = 2.4; g.add(b);
    const h = new THREE.Mesh(hh, cm); h.position.set(1.9, 3.4, 0); g.add(h);
    [[-1.1, .4], [-1.1, -.4], [1.1, .4], [1.1, -.4]].forEach(([x, z]) => { const l = new THREE.Mesh(hl, cm); l.position.set(x, 0.8, z); g.add(l); });
    const j = new THREE.Mesh(jk, L(silks[i % silks.length])); j.position.set(0.2, 3.9, 0); g.add(j);
    scene.add(g);
    horses.push({ g, lane: IN + 3 + (i % 5) * 3.6, s: i * 9 + (i % 3) * 3, v: 15 + R() * 4 });
  }
  function lapPos(s, r) {
    const P = 4 * HL + 2 * Math.PI * r; s = ((s % P) + P) % P;
    if (s < 2 * HL) return [r, -HL + s, 0];                      // right straight, heading +z
    s -= 2 * HL; let a = s / r;
    if (a < Math.PI) return [Math.cos(a) * r, HL + Math.sin(a) * r, a]; // front turn
    s -= Math.PI * r;
    if (s < 2 * HL) return [-r, HL - s, Math.PI];               // left straight, heading -z
    s -= 2 * HL; a = s / r;
    return [-Math.cos(a) * r, -HL - Math.sin(a) * r, Math.PI + a];   // back turn
  }

  // selection marker
  const marker = new THREE.Mesh(new THREE.ConeGeometry(2.2, 4.5, 4), new THREE.MeshBasicMaterial({ color: COL.neon }));
  marker.rotation.x = Math.PI; scene.add(marker);

  let selected = null, preview = null;
  function repaint() {
    Object.values(surf).forEach(o => { paint(o.c, o.s, o.s.id === selected ? preview : null, o.s.id === selected, { cur }); o.tex.needsUpdate = true; });
  }

  // camera + controls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enablePan = false;
  controls.minDistance = 25; controls.maxDistance = 340; controls.maxPolarAngle = 1.42;
  controls.minAzimuthAngle = -1.25; controls.maxAzimuthAngle = 1.25;
  camera.position.set(...VIEWS.race.cam); controls.target.set(...VIEWS.race.look); controls.update();
  let fly = null;
  function flyTo(v) {
    if (!v) return;
    const tgt = v.track ? v.track() : null;
    fly = { t: 0, p0: camera.position.clone(), q0: controls.target.clone(), p1: new THREE.Vector3(...v.cam), q1: tgt || new THREE.Vector3(...v.look) };
  }
  const coarse = matchMedia("(pointer:coarse)").matches;
  if (coarse) { controls.enabled = false; renderer.domElement.style.touchAction = "pan-y"; }

  // picking (a tap, not a drag)
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null, hover = null;
  const hit = e => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const h = ray.intersectObjects(pickMeshes, false)[0];
    return h ? h.object.userData.spot : null;
  };
  renderer.domElement.addEventListener("pointerdown", e => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener("pointerup", e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    const id = hit(e); if (id && opts.onPick) opts.onPick(id);
  });
  renderer.domElement.addEventListener("pointermove", e => {
    if (e.pointerType !== "mouse") return;
    const id = hit(e);
    if (id !== hover) { hover = id; renderer.domElement.style.cursor = id ? "pointer" : "grab"; if (opts.onHover) opts.onHover(id ? byId[id] : null, e); }
    else if (id && opts.onHover) opts.onHover(byId[id], e);
  });
  renderer.domElement.addEventListener("pointerleave", () => { hover = null; if (opts.onHover) opts.onHover(null); });
  controls.addEventListener("start", () => { fly = null; autoSpin = false; });

  // size + loop (only while on screen)
  function resize() { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  const ro = new ResizeObserver(resize); ro.observe(el); resize();
  let visible = true;
  const io = new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) loop(); }); io.observe(el);
  const reduce = matchMedia("(prefers-reduced-motion:reduce)").matches;
  let autoSpin = false, raf = 0, last = performance.now(), T = 0;
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  function loop() {
    cancelAnimationFrame(raf);
    if (!visible) return;
    raf = requestAnimationFrame(loop);
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!reduce) T += dt;
    // blimp drifts slowly side to side
    if (byId.blimp) { blimp.position.set(Math.sin(T * 0.08) * 45, 100 + Math.sin(T * 0.5) * 1.5, -40); blimp.rotation.y = Math.cos(T * 0.08) * 0.12; surf.blimp.anchor.set(blimp.position.x, blimp.position.y + 15, blimp.position.z); }
    horses.forEach(h => { if (!reduce) h.s += h.v * dt; const [x, z, a] = lapPos(h.s, h.lane); h.g.position.set(x, Math.abs(Math.sin(h.s * 0.9)) * 0.5, z); h.g.rotation.y = -Math.PI / 2 - a; });
    if (fly) {
      fly.t = Math.min(1, fly.t + dt / 1.3); const k = ease(fly.t);
      camera.position.lerpVectors(fly.p0, fly.p1, k); controls.target.lerpVectors(fly.q0, fly.q1, k);
      if (fly.t >= 1) fly = null;
    }
    if (autoSpin && !fly) { const off = camera.position.clone().sub(controls.target); off.applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.12); camera.position.copy(controls.target).add(off); }
    const a = selected && surf[selected] && surf[selected].anchor;
    marker.visible = !!a;
    if (a) { marker.position.set(a.x, a.y + Math.sin(now / 250) * 0.8, a.z); marker.rotation.y += dt * 2; }
    controls.update();
    renderer.render(scene, camera);
  }
  const fontReady = document.fonts ? document.fonts.load(`20px ${PX}`).catch(() => {}) : Promise.resolve();
  fontReady.then(repaint); repaint(); loop();

  return {
    select(id, move = true) {
      selected = id; repaint();
      const lay = LAYOUT[id];
      if (move && lay) flyTo(id === "blimp" ? { cam: [blimp.position.x + 55, 112, 40], look: [blimp.position.x, 100, -40] } : lay);
    },
    preview(p) { preview = p; repaint(); },
    view(name) { if (name === "spin") { autoSpin = !autoSpin; return autoSpin; } autoSpin = false; flyTo(VIEWS[name]); return false; },
    interact(on) { controls.enabled = on; renderer.domElement.style.touchAction = on ? "none" : "pan-y"; },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); renderer.dispose(); }
  };
}
