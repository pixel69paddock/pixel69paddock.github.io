// Daily Derby: the 3D shed. A voxel barn aisle of the 10,000-stall stable, one stall per follower.
// Same stack as sponsor3d.js (three 0.170 + OrbitControls). Only a window of stalls around the camera
// exists at any time (a pool of slots that relabel as you move), so stall #9,999 costs the same as #1.
//
// mount(el, opts) -> { focus(k), view(name), refresh(k), refreshAll(), setInset({right,bottom}), dispose() }
//   opts.total        number of stalls (10,000)
//   opts.getStall(k)  -> null (empty) | { handle, name, look:"2413", saddle:0-3, acc:[...], original, next }
//   opts.looks        data/looks.json parts (colours)
//   opts.onPick(k)    a stall was tapped
//   opts.reel         { k, look, saddle, acc, plate:"@YOU", freeze, overlay(ctx,T,W,H), comp:canvas } -> 1080x1920 move-in film
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const PX = '"Press Start 2P", ui-monospace, monospace';
export const W = 7;                 // stall width (x); stalls run along +x, open to the aisle at z = 0
const DEPTH = 6.6;                  // stall depth (z from 0 to -DEPTH)
const TIER = { g: "#f5c242", s: "#cfd6e3", b: "#d08a4e" };
export const tierOf = (k, gold = 800, silver = 5000) => k <= gold ? "g" : k <= silver ? "s" : "b";
export const ACC = [
  { id: "blinkers", name: "Blinkers" },
  { id: "bonnet", name: "Ear bonnet" },
  { id: "wraps", name: "Leg wraps" },
  { id: "rosette", name: "Rosette" }
];
export const SADDLES = ["None", "Leather", "Racing black", "Royal gold"];
// Premium items (paid, limited, cosmetic only: they never change speed). Prices and stock live in derby.json "shop".
// kind: coat (replaces the coat; one at a time), effect (adds on), stall (decorates the stall)
export const PREMIUM = [
  { id: "neon-gold", kind: "coat", name: "Neon Gold", icon: "✨" },
  { id: "galaxy", kind: "coat", name: "Galaxy", icon: "🌌" },
  { id: "zebra", kind: "coat", name: "Zebra", icon: "🦓" },
  { id: "flame-mane", kind: "effect", name: "Flame mane", icon: "🔥" },
  { id: "glow-hooves", kind: "effect", name: "Glow hooves", icon: "💠" },
  { id: "neon-sign", kind: "stall", name: "Neon name sign", icon: "🪧" }
];

// ---------- pixel textures (nearest-neighbour, generated, cached) ----------
function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
const TEX = new Map();
function pixTex(key, w, h, draw, repeat = true) {
  if (TEX.has(key)) return TEX.get(key);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d"); x.imageSmoothingEnabled = false; draw(x, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4; TEX.set(key, t); return t;
}
const shade = (hex, f) => { const c = new THREE.Color(hex); c.multiplyScalar(f); return "#" + c.getHexString(); };
function planks(key, base, vertical, seed) {
  return pixTex(key, 32, 32, (x, w, h) => {
    const R = rng(seed);
    for (let p = 0; p < 4; p++) {
      const tone = shade(base, 0.86 + R() * 0.28);
      for (let i = 0; i < 8; i++) for (let j = 0; j < 32; j++) {
        const g = R(); x.fillStyle = g < 0.12 ? shade(tone, 0.85) : g > 0.94 ? shade(tone, 1.1) : tone;
        vertical ? x.fillRect(p * 8 + i, j, 1, 1) : x.fillRect(j, p * 8 + i, 1, 1);
      }
      x.fillStyle = shade(base, 0.45);
      vertical ? x.fillRect(p * 8, 0, 1, 32) : x.fillRect(0, p * 8, 32, 1);
      // knot + nail heads
      x.fillStyle = shade(base, 0.6);
      const kx = 2 + Math.floor(R() * 4), ky = Math.floor(R() * 28);
      vertical ? x.fillRect(p * 8 + kx, ky, 2, 2) : x.fillRect(ky, p * 8 + kx, 2, 2);
      x.fillStyle = "#2a1c12";
      vertical ? (x.fillRect(p * 8 + 3, 2, 1, 1), x.fillRect(p * 8 + 3, 29, 1, 1)) : (x.fillRect(2, p * 8 + 3, 1, 1), x.fillRect(29, p * 8 + 3, 1, 1));
    }
  });
}
const strawTex = () => pixTex("straw", 32, 32, (x) => {
  const R = rng(11); x.fillStyle = "#b8893a"; x.fillRect(0, 0, 32, 32);
  for (let i = 0; i < 150; i++) {
    const c = ["#e2b85a", "#c99a44", "#8f6526", "#f0cf7a", "#a87a33"][Math.floor(R() * 5)];
    x.fillStyle = c; const px = Math.floor(R() * 32), py = Math.floor(R() * 32), len = 2 + Math.floor(R() * 4);
    R() > 0.5 ? x.fillRect(px, py, len, 1) : x.fillRect(px, py, 1, len);
  }
});
const cobbleTex = () => pixTex("cobble", 32, 32, (x) => {
  const R = rng(5); x.fillStyle = "#2a1d15"; x.fillRect(0, 0, 32, 32);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
    const ox = (r % 2) * 5 + c * 11, oy = r * 8;
    x.fillStyle = shade("#6e5643", 0.8 + R() * 0.35);
    for (const dx of [0, 32]) x.fillRect(ox + 1 - dx, oy + 1, 9, 6);
    x.fillStyle = "rgba(255,230,190,.10)"; x.fillRect(ox + 1, oy + 1, 9, 1);
  }
});
function coatTex(i, rgb) {
  return pixTex("coat" + i, 16, 16, (x) => {
    const R = rng(31 + i), [hi, mid, lo] = rgb.map(c => `rgb(${c})`);
    x.fillStyle = mid; x.fillRect(0, 0, 16, 16);
    for (let p = 0; p < 34; p++) { x.fillStyle = R() > 0.5 ? hi : lo; x.globalAlpha = 0.35; x.fillRect(Math.floor(R() * 16), Math.floor(R() * 16), 1, 1); }
    x.globalAlpha = 1;
  });
}
function premiumCoatTex(id) {
  return pixTex("pcoat-" + id, 16, 16, (x) => {
    const R = rng(id.length * 97);
    if (id === "neon-gold") {
      x.fillStyle = "#e0a822"; x.fillRect(0, 0, 16, 16);
      for (let p = 0; p < 40; p++) { x.fillStyle = R() > 0.5 ? "#fff2a8" : "#b67a10"; x.fillRect(Math.floor(R() * 16), Math.floor(R() * 16), 1, 1); }
    } else if (id === "galaxy") {
      x.fillStyle = "#1c1240"; x.fillRect(0, 0, 16, 16);
      for (let p = 0; p < 26; p++) { x.fillStyle = ["#3a2a7a", "#5a2a6e", "#22306e"][Math.floor(R() * 3)]; x.fillRect(Math.floor(R() * 16), Math.floor(R() * 16), 2, 1); }
      for (let p = 0; p < 9; p++) { x.fillStyle = R() > 0.3 ? "#ffffff" : "#ffd6f0"; x.fillRect(Math.floor(R() * 16), Math.floor(R() * 16), 1, 1); }
    } else if (id === "zebra") {
      x.fillStyle = "#f4f1ea"; x.fillRect(0, 0, 16, 16);
      x.fillStyle = "#16141a";
      for (let col = 0; col < 16; col++) for (let row = 0; row < 16; row++) if (((col + Math.round(Math.sin(row * 0.7) * 1.5)) % 5) < 2) x.fillRect(col, row, 1, 1);
    }
  });
}
function silkTex(si, pat, rgb) {
  return pixTex(`silk${si}${pat}`, 16, 16, (x) => {
    const base = `rgb(${rgb})`, dark = shade(base, 0.62), cream = "#faf4e4";
    x.fillStyle = base; x.fillRect(0, 0, 16, 16);
    if (pat === 1) { x.fillStyle = cream; x.fillRect(0, 6, 16, 3); }
    if (pat === 2) { x.fillStyle = cream; x.fillRect(7, 4, 2, 8); x.fillRect(4, 7, 8, 2); x.fillRect(6, 6, 4, 4); }
    if (pat === 3) { x.fillStyle = dark; for (let a = 0; a < 16; a += 2) for (let b = 0; b < 16; b += 2) if ((a + b) % 4 === 0) x.fillRect(a, b, 2, 2); }
    x.fillStyle = "#f5c242"; x.fillRect(0, 15, 16, 1); x.fillRect(0, 0, 16, 1);   // gold piping
  }, false);
}

// a box whose UVs tile the texture at a constant density, so pixels stay the same size on every face
function vbox(w, h, d, s = 1.2) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  if (s) for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const j = f * 4 + i; uv.setXY(j, uv.getX(j) * dims[f][0] / s, uv.getY(j) * dims[f][1] / s); }
  return g;
}
// collects boxes per material, merges them into one mesh per material (few draw calls)
function builder() {
  const parts = new Map(), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
  return {
    box(mat, w, h, d, x, y, z, rz = 0, s = 1.2, ry = 0, rx = 0) {
      const g = vbox(w, h, d, s);
      M.compose(new THREE.Vector3(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
      g.applyMatrix4(M);
      if (!parts.has(mat)) parts.set(mat, []);
      parts.get(mat).push(g); return this;
    },
    build(group, { cast = true, receive = true } = {}) {
      for (const [mat, gs] of parts) {
        const m = new THREE.Mesh(gs.length > 1 ? mergeGeometries(gs) : gs[0], mat);
        m.castShadow = cast; m.receiveShadow = receive; group.add(m);
      }
      parts.clear(); return group;
    }
  };
}
const lam = (o) => new THREE.MeshLambertMaterial(o);

// ---------- the voxel horse (original art; faces +x, hooves on y = 0) ----------
const NECK0 = -0.72, HEAD0 = -0.2;
const FIXED_BASE = {
  hoof: lam({ color: "#2a2018" }), eye: lam({ color: "#0d0907" }), glint: new THREE.MeshBasicMaterial({ color: "#ffffff" }),
  white: lam({ color: "#f4efe4" }), strap: lam({ color: "#3a2214" }), iron: lam({ color: "#c9cbd4" }),
  gold: lam({ color: "#f5c242", emissive: "#5a3c00" }), pink: lam({ color: "#ff3d6e" }), nose: lam({ color: "#3a2a24" })
};
function makeHorse() {
  // per-horse copies of the fixed materials, so one horse can fade without fading the others
  const FIXED = Object.fromEntries(Object.entries(FIXED_BASE).map(([k, m]) => [k, m.clone()]));
  const mats = {
    coat: lam({ color: "#ffffff" }), coatDark: lam({ color: "#d8d8d8" }), mane: lam({ color: "#2a1a10" }),
    silk: lam({ color: "#ffffff" }), silkSolid: lam({ color: "#ff3d6e" }),
    saddle: lam({ color: "#7a4a24" }), saddle2: lam({ color: "#5a3418" })
  };
  const B = builder(), root = new THREE.Group(), body = new THREE.Group();
  root.add(body); body.scale.setScalar(0.86);
  // torso
  B.box(mats.coat, 3.9, 1.65, 1.45, 0, 3.2, 0)
    .box(mats.coat, 0.7, 1.45, 1.3, 2.05, 3.15, 0)          // chest
    .box(mats.coat, 1.4, 0.35, 1.38, -1.35, 4.12, 0)        // croup
    .box(mats.coatDark, 3.3, 0.28, 1.32, 0, 2.3, 0)         // belly shade
    .box(mats.coat, 0.6, 1.35, 1.32, -2.1, 3.35, 0)         // rump
    .box(mats.silk, 1.7, 1.05, 1.56, 0.25, 3.62, 0, 0, 0)   // saddle cloth (pattern)
    .build(body);
  // neck + head (head bobs on its own pivot)
  const neck = new THREE.Group(); neck.position.set(1.7, 3.55, 0); neck.rotation.z = NECK0; body.add(neck);
  B.box(mats.coat, 1.1, 1.95, 0.95, 0, 0.85, 0).box(mats.coat, 0.9, 0.5, 0.9, 0.12, 1.75, 0);
  for (let i = 0; i < 5; i++) B.box(mats.mane, 0.36, 0.46, 0.36, -0.6, 0.3 + i * 0.37, 0, 0, 0.6);
  B.build(neck);
  const head = new THREE.Group(); head.position.set(0.05, 1.95, 0); head.rotation.z = HEAD0; neck.add(head);
  B.box(mats.coat, 1.0, 0.95, 0.86, 0.15, 0.05, 0)         // crown
    .box(mats.coat, 1.2, 0.72, 0.72, 0.98, -0.16, 0)        // face
    .box(FIXED.nose, 0.34, 0.68, 0.7, 1.7, -0.18, 0)        // muzzle
    .box(mats.coat, 0.2, 0.46, 0.18, -0.12, 0.66, 0.25, 0.5) // ears
    .box(mats.coat, 0.2, 0.46, 0.18, -0.12, 0.66, -0.25, 0.5)
    .box(mats.mane, 0.32, 0.3, 0.42, 0.32, 0.52, 0, 0, 0.6) // forelock
    .box(FIXED.eye, 0.16, 0.16, 0.86, 0.38, 0.14, 0)
    .box(FIXED.glint, 0.06, 0.06, 0.88, 0.42, 0.18, 0)
    .box(FIXED.eye, 0.08, 0.1, 0.68, 1.74, -0.05, 0)        // nostril
    .box(FIXED.strap, 0.12, 0.66, 0.7, 1.12, -0.18, 0)      // noseband
    .box(FIXED.strap, 0.12, 0.12, 0.86, 0.55, 0.4, 0)       // browband
    .build(head);
  // accessories on the head
  const acc = {};
  acc.blinkers = new THREE.Group(); head.add(acc.blinkers);
  B.box(mats.silkSolid, 0.62, 0.55, 0.9, 0.2, 0.18, 0, 0, 0).box(mats.silkSolid, 0.22, 0.3, 0.12, 0.5, 0.1, 0.48, 0, 0).box(mats.silkSolid, 0.22, 0.3, 0.12, 0.5, 0.1, -0.48, 0, 0).build(acc.blinkers);
  acc.bonnet = new THREE.Group(); head.add(acc.bonnet);
  B.box(mats.silkSolid, 0.26, 0.5, 0.22, -0.1, 0.68, 0.24, 0, 0).box(mats.silkSolid, 0.26, 0.5, 0.22, -0.1, 0.68, -0.24, 0, 0).box(FIXED.white, 0.2, 0.2, 0.2, 0.15, 0.6, 0, 0, 0).build(acc.bonnet);
  acc.rosette = new THREE.Group(); head.add(acc.rosette);
  B.box(FIXED.gold, 0.34, 0.34, 0.06, 0.58, 0.32, 0.44, 0.785, 0).box(FIXED.pink, 0.2, 0.2, 0.08, 0.58, 0.32, 0.45, 0, 0)
    .box(FIXED.pink, 0.08, 0.32, 0.04, 0.52, 0.06, 0.45, 0, 0).box(FIXED.gold, 0.08, 0.28, 0.04, 0.64, 0.08, 0.45, 0, 0).build(acc.rosette);
  // saddles (one shown)
  const saddles = [null];
  const sad = (seat, trim, small) => {
    const g = new THREE.Group(); body.add(g);
    const sw = small ? 0.8 : 1.15;
    B.box(seat, sw, 0.2, 1.05, 0.2, 4.24, 0, 0, 0).box(seat, 0.24, 0.32, 0.82, 0.2 + sw / 2, 4.36, 0, 0, 0).box(seat, 0.24, 0.38, 0.92, 0.2 - sw / 2, 4.4, 0, 0, 0)
      .box(trim, sw + 0.04, 0.06, 1.09, 0.2, 4.36, 0, 0, 0)
      .box(FIXED.strap, 0.06, 0.95, 0.05, 0.3, 3.75, 0.8, 0, 0).box(FIXED.strap, 0.06, 0.95, 0.05, 0.3, 3.75, -0.8, 0, 0)
      .box(FIXED.iron, 0.28, 0.1, 0.14, 0.3, 3.24, 0.82, 0, 0).box(FIXED.iron, 0.28, 0.1, 0.14, 0.3, 3.24, -0.82, 0, 0)
      .box(FIXED.strap, 0.18, 1.2, 0.04, 0.55, 3.0, 0.77, 0, 0).box(FIXED.strap, 0.18, 1.2, 0.04, 0.55, 3.0, -0.77, 0, 0) // girth
      .build(g);
    saddles.push(g);
  };
  sad(mats.saddle, mats.saddle2, false);
  sad(lam({ color: "#1b1616" }), lam({ color: "#ff3d6e" }), true);
  sad(lam({ color: "#5a1420" }), FIXED.gold, false);
  // legs (pivot at the hip so they can walk)
  const legs = [];
  acc.wraps = [];
  [[1.5, 0.48], [1.5, -0.48], [-1.5, 0.48], [-1.5, -0.48]].forEach(([lx, lz], i) => {
    const p = new THREE.Group(); p.position.set(lx, 2.55, lz); body.add(p);
    B.box(i < 2 ? mats.coat : mats.coat, 0.46, 1.3, 0.44, 0, -0.6, 0)
      .box(mats.coatDark, 0.34, 1.05, 0.34, 0, -1.7, 0)
      .box(FIXED.hoof, 0.46, 0.32, 0.48, 0.04, -2.38, 0).build(p);
    const w = new THREE.Group(); p.add(w); B.box(FIXED.white, 0.42, 0.72, 0.42, 0, -1.8, 0, 0, 0).build(w);
    acc.wraps.push(w); legs.push(p);
  });
  // tail
  const tail = new THREE.Group(); tail.position.set(-2.35, 3.95, 0); body.add(tail);
  B.box(mats.mane, 0.36, 0.5, 0.34, -0.15, -0.05, 0, 0.5, 0.6).box(mats.mane, 0.44, 1.7, 0.4, -0.38, -1.05, 0, 0.12, 0.6).box(mats.mane, 0.34, 0.5, 0.3, -0.45, -2.0, 0, 0, 0.6).build(tail);

  const H = { fixed: FIXED, root, body, neck, head, tail, legs, mats, acc, saddles, toss: 0, phase: Math.random() * 10, walk: 0, rear: 0, pose: "idle", yaw: null, yawVel: 0, fade: 1 };
  const all = new Set(); root.traverse(o => { if (o.material) all.add(o.material); }); H.allMats = [...all];
  H.setLook = (look, parts) => setHorseLook(H, look, parts);
  return H;
}
function setHorseLook(H, st, parts) {
  const d = [...(st.look || "1111")].map(n => Math.max(0, Math.min(3, +n - 1)));
  const P = i => parts && parts[i] && parts[i].options[d[i]];
  const coat = P(0) ? P(0).rgb : [[150, 106, 72], [120, 82, 54], [78, 52, 34]];
  const mane = P(1) ? P(1).rgb[0] : [38, 26, 20];
  const silk = P(2) ? P(2).rgb[0] : [255, 77, 109];
  const m = H.mats;
  m.coat.map = coatTex(d[0], coat); m.coat.color.set("#ffffff"); m.coat.needsUpdate = true;
  m.coatDark.map = m.coat.map; m.coatDark.color.set("#b9b0a8"); m.coatDark.needsUpdate = true;
  m.mane.color.setRGB(...mane.map(v => v / 255), THREE.SRGBColorSpace);
  m.silk.map = silkTex(d[2], d[3], silk); m.silk.needsUpdate = true;
  m.silkSolid.color.setRGB(...silk.map(v => v / 255), THREE.SRGBColorSpace);
  const sd = st.saddle ?? 1;
  H.saddles.forEach((g, i) => g && (g.visible = i === sd));
  const acc = new Set(st.acc || []);
  H.acc.blinkers.visible = acc.has("blinkers");
  H.acc.bonnet.visible = acc.has("bonnet");
  H.acc.rosette.visible = acc.has("rosette");
  H.acc.wraps.forEach(w => w.visible = acc.has("wraps"));
  // premium (owned or being tried on): reset every time, because stall slots are reused for other horses
  const pr = new Set(st.premium || []);
  const coatId = ["neon-gold", "galaxy", "zebra"].find(id => pr.has(id));
  m.coat.emissive.set("#000000"); m.coatDark.emissive.set("#000000");
  if (coatId) {
    m.coat.map = premiumCoatTex(coatId); m.coat.needsUpdate = true;
    m.coatDark.map = m.coat.map; m.coatDark.color.set(coatId === "zebra" ? "#cfcac2" : "#c9c0d8"); m.coatDark.needsUpdate = true;
    if (coatId === "neon-gold") { m.coat.emissive.set("#7a5200"); m.coatDark.emissive.set("#4a3200"); m.mane.color.set("#fff2a8"); }
    if (coatId === "galaxy") { m.coat.emissive.set("#1a0e3a"); m.mane.color.set("#b07cff"); }
    if (coatId === "zebra") m.mane.color.set("#16141a");
  }
  H.flame = pr.has("flame-mane");
  m.mane.emissive.set(H.flame ? "#ff5a00" : "#000000");
  if (H.flame) m.mane.color.set("#ff8a2a");
  const hoof = H.fixed.hoof;
  hoof.emissive.set(pr.has("glow-hooves") ? "#1ab8ff" : "#000000");
  hoof.color.set(pr.has("glow-hooves") ? "#7fe0ff" : "#2a2018");
}
// poses: idle (default), graze, walk (on the spot), rear, prance (walk + head toss). Yaw turns the horse on its spot.
export const POSES = [
  { id: "idle", name: "Stand" }, { id: "graze", name: "Graze" }, { id: "walk", name: "Walk" },
  { id: "prance", name: "Prance" }, { id: "rear", name: "Rear up" }
];
const HIP = -1.29;   // hind-hoof pivot (body x, after the 0.86 scale) for rearing
function animateHorse(H, t, dt, walking) {
  const p = t + H.phase, pose = H.pose || "idle";
  // turning: held buttons spin, taps ease to the target yaw
  if (H.yawVel) H.yaw += H.yawVel * dt;
  if (H.yaw != null) H.root.rotation.y += (H.yaw - H.root.rotation.y) * Math.min(1, dt * 7);
  const turning = H.yaw != null && Math.abs(H.yaw - H.root.rotation.y) > 0.05;
  walking = walking || pose === "walk" || pose === "prance" || turning;
  H.walk += dt * (walking ? (pose === "prance" ? 9.5 : 7.5) : 0);
  // rear-up cycle: rise, hold with front legs tucked, come down, pause
  let ra = 0;
  if (pose === "rear") { const c = (p * 0.42) % 1; ra = c < 0.18 ? Math.sin(c / 0.18 * Math.PI / 2) : c < 0.45 ? 1 : c < 0.6 ? Math.cos((c - 0.45) / 0.15 * Math.PI / 2) : 0; }
  H.rear += (ra - H.rear) * Math.min(1, dt * 10);
  const a = H.rear * 0.62;
  H.body.rotation.z = a;
  H.body.position.x = HIP - HIP * Math.cos(a);
  const lift = -HIP * Math.sin(a);
  if (walking && H.rear < 0.05) {
    const s = Math.sin(H.walk), c = Math.cos(H.walk), amp = pose === "prance" ? 0.7 : 0.5;
    H.legs[0].rotation.z = s * amp; H.legs[3].rotation.z = s * 0.5;
    H.legs[1].rotation.z = -s * amp; H.legs[2].rotation.z = -s * 0.5;
    H.body.position.y = Math.abs(c) * (pose === "prance" ? 0.2 : 0.1);
    H.neck.rotation.z = NECK0 + Math.sin(H.walk * 2) * 0.05 + (pose === "prance" ? 0.18 + Math.max(0, Math.sin(H.walk * 0.5)) * 0.2 : 0);
    H.head.rotation.z = HEAD0;
    H.tail.rotation.x = Math.sin(H.walk) * 0.18;
    H.tail.rotation.z = pose === "prance" ? 0.5 : 0;
  } else if (H.rear >= 0.05) {
    H.legs[0].rotation.z = H.legs[1].rotation.z = 1.25 * H.rear + Math.sin(p * 9) * 0.25 * H.rear;  // front legs paw the air
    H.legs[2].rotation.z = H.legs[3].rotation.z = -a;                                              // hind legs stay planted
    H.body.position.y = lift;
    H.neck.rotation.z = NECK0 + 0.25 * H.rear; H.head.rotation.z = HEAD0 - 0.1;
    H.tail.rotation.x = Math.sin(p * 3) * 0.3; H.tail.rotation.z = -0.3 * H.rear;
  } else {
    H.legs.forEach(l => l.rotation.z *= 0.85);
    H.body.position.y *= 0.85;
    H.tail.rotation.z *= 0.9;
    const graze = pose === "graze" ? 1 : Math.max(0, Math.sin(p * 0.21) - 0.75) * 2.2;  // now and then the head drops
    H.graze = (H.graze || 0) + (graze - (H.graze || 0)) * Math.min(1, dt * 3);
    const g = H.graze, chew = pose === "graze" ? Math.sin(p * 5) * 0.04 : 0;
    H.toss = Math.max(0, H.toss - dt * 1.6);
    const tossA = Math.sin(H.toss * Math.PI * 2) * H.toss * 0.5;
    H.neck.rotation.z = NECK0 + Math.sin(p * 0.9) * 0.035 - g * 1.0 + tossA;
    H.head.rotation.z = HEAD0 + Math.sin(p * 0.9 + 1) * 0.04 - g * 0.45 + chew;
    H.tail.rotation.x = Math.sin(p * 1.7) * (0.1 + Math.max(0, Math.sin(p * 0.37)) * 0.35);
  }
  H.body.scale.y = 0.86 * (1 + Math.sin(p * 1.3) * 0.008);
  if (H.flame) H.mats.mane.emissiveIntensity = 0.75 + Math.sin(p * 11) * 0.18 + Math.sin(p * 23) * 0.1;
}


// ---------- stall decor (free): wall paint, nameplate style, stickers ----------
export const PAINTS = [
  { name: "Natural", base: null }, { name: "Barn red", base: "#a8342c" }, { name: "Sage", base: "#7a9a6e" },
  { name: "Navy", base: "#34507e" }, { name: "Cream", base: "#d8c69a" }, { name: "Plum", base: "#6a4a86" }
];
export const PLATES = [
  { name: "Classic", bg: "#1c120b", in: "#2c1d12", ink: "#fff6e0", sub: "#ffcf7a" },
  { name: "Gold", bg: "#8a6510", in: "#f5c242", ink: "#2a1d05", sub: "#5a3c00" },
  { name: "Neon", bg: "#0d0818", in: "#1d1430", ink: "#ff3d6e", sub: "#3ad6ff" },
  { name: "Ice", bg: "#7d8597", in: "#eef2f8", ink: "#1d2b4a", sub: "#4a5a7a" }
];
const ST_MAPS = {
  horseshoe: ["............", "..gg....gg..", ".gddg..gddg.", ".gkg....gkg.", ".gdg....gdg.", ".gkg....gkg.", ".gdg....gdg.", ".gddg..gddg.", "..gddggddg..", "...gdkkdg...", "....gggg....", "............"],
  trophy: ["............", ".yyyyyyyyyy.", "y.yyyyyyyy.y", "y.yoyyyyyy.y", ".yyoyyyyyyy.", "..yyyyyyyy..", "...yyyyyy...", ".....yy.....", ".....yy.....", "....oooo....", "...oooooo...", "............"],
  flowers: ["............", ".pp......ww.", "pyyp....wyyw", ".pp..rr..ww.", "..g.ryyr.g..", "..g..rr..g..", "..g...g..g..", "...g..g.g...", "...g..g.g...", "....gggg....", "....gggg....", "............"],
  flag: ["............", "bkwkwkwkw...", "bwkwkwkwk...", "bkwkwkwkw...", "bwkwkwkwk...", "bkwkwkwkw...", "b...........", "b...........", "b...........", "b...........", "b...........", "bb.........."],
  star: [".....y......", ".....yy.....", "....yyy.....", "yyyyyyyyyyy.", ".yyyyoyyyy..", "..yyyyyyy...", "..yyyyyyy...", ".yyyy.yyyy..", ".yyy...yyy..", "yy.......yy.", "............", "............"],
  heart: ["............", ".rrr...rrr..", "rllrr.rrrrr.", "rlrrrrrrrrr.", "rrrrrrrrrrr.", ".rrrrrrrrr..", "..rrrrrrr...", "...rrrrr....", "....rrr.....", ".....r......", "............", "............"],
  carrot: [".......g.g..", "........gg.g", ".......ggg..", "......oog...", ".....oooo...", "....odoo....", "...oooo.....", "..oodo......", "..ooo.......", ".oo.........", ".o..........", "............"],
  bolt: ["......yyyy..", ".....yyyy...", "....yyyy....", "...yyyy.....", "..yyyyyyyy..", ".....yyyy...", "....yyyy....", "...yyy......", "..yyy.......", ".yy.........", "y...........", "............"]
};
const ST_PAL = {
  horseshoe: { g: "#c9ccd6", d: "#8a8e9c", k: "#3a3a44" }, trophy: { y: "#f5c242", o: "#b8860b" },
  flowers: { p: "#ff6fa0", w: "#ffffff", y: "#f5c242", r: "#b07cff", g: "#4f9a46" }, flag: { b: "#6b4a2a", k: "#16121e", w: "#ffffff" },
  star: { y: "#f5c242", o: "#fff3b0" }, heart: { r: "#ff3d6e", l: "#ffb3c6" }, carrot: { o: "#ff8a3d", d: "#c25a12", g: "#4f9a46" },
  bolt: { y: "#ffe14a", o: "#ff9a1a" }
};
export const STICKERS = [
  { id: "horseshoe", name: "Horseshoe" }, { id: "trophy", name: "Trophy" }, { id: "flowers", name: "Flowers" }, { id: "flag", name: "Race flag" },
  { id: "star", name: "Star" }, { id: "heart", name: "Heart" }, { id: "carrot", name: "Carrot" }, { id: "bolt", name: "Lightning" }
];
function stickerCanvas(id) {
  const c = document.createElement("canvas"); c.width = c.height = 16;
  const x = c.getContext("2d"), map = ST_MAPS[id], pal = ST_PAL[id], on = new Set();
  map.forEach((row, y) => [...row].forEach((ch, i) => { if (pal[ch]) { x.fillStyle = pal[ch]; x.fillRect(i + 2, y + 2, 1, 1); on.add((i + 2) + "," + (y + 2)); } }));
  // white sticker border
  x.fillStyle = "#fff6e0";
  for (let yy = 0; yy < 16; yy++) for (let xx = 0; xx < 16; xx++) {
    if (on.has(xx + "," + yy)) continue;
    let near = false; for (let a = -1; a <= 1 && !near; a++) for (let b = -1; b <= 1; b++) if (on.has((xx + a) + "," + (yy + b))) { near = true; break; }
    if (near) x.fillRect(xx, yy, 1, 1);
  }
  return c;
}
export const stickerIcon = id => stickerCanvas(id).toDataURL();
const stickerTex = id => pixTex("st-" + id, 16, 16, (x) => x.drawImage(stickerCanvas(id), 0, 0), false);
const paintTex = i => i ? planks("paint" + i, PAINTS[i].base, true, 20 + i) : planks("pv", "#7a5434", true, 3);
// where each sticker goes: back wall (above the horse) or the outside of the half door (seen from the aisle)
const ST_SPOT = {
  horseshoe: ["back", -1.0, 6.5], trophy: ["back", 2.6, 6.4], flowers: ["back", -2.7, 5.9], star: ["back", 0.3, 5.6],
  heart: ["back", 2.0, 5.2], flag: ["door", 1.3, 2.05], carrot: ["door", 3.15, 1.7], bolt: ["door", 5.0, 2.1]
};
// ---------- one stall (static structure merged per material) ----------
let MAT = null;
function barnMats() {
  if (MAT) return MAT;
  MAT = {
    plankV: lam({ map: planks("pv", "#7a5434", true, 3) }),
    plankH: lam({ map: planks("ph", "#8a603a", false, 4) }),
    dark: lam({ map: planks("pd", "#4b3020", true, 7) }),
    beam: lam({ map: planks("pb", "#3a2416", false, 9) }),
    straw: lam({ map: strawTex() }),
    cobble: lam({ map: cobbleTex() }),
    iron: lam({ color: "#3b3a40" }),
    bucket: lam({ color: "#5b7a8f" }),
    lamp: new THREE.MeshBasicMaterial({ color: "#ffcf7a", toneMapped: false }),
    window: new THREE.MeshBasicMaterial({ color: "#ffb36b", toneMapped: false, fog: false }),
    hit: new THREE.MeshBasicMaterial({ visible: false })
  };
  // the ceiling has its own (shared) materials so it can fade when the camera looks down from above
  MAT.ceilBeam = MAT.beam.clone(); MAT.ceilDark = MAT.dark.clone();
  return MAT;
}
function makeSlot() {
  const M = barnMats(), B = builder(), g = new THREE.Group();
  const s = { g, k: null };
  // back wall with a high window (sunset outside)
  s.backMat = M.plankV.clone();   // own material: the wall paint
  B.box(s.backMat, W, 10, 0.4, 0, 5, -DEPTH - 0.2)
    .box(M.beam, 1.9, 1.6, 0.3, 0.9, 8.1, -DEPTH, 0, 1.2)
    .box(M.window, 1.5, 1.2, 0.3, 0.9, 8.1, -DEPTH + 0.03, 0, 0)
    .box(M.beam, 1.5, 0.12, 0.34, 0.9, 8.1, -DEPTH + 0.06, 0, 1.2).box(M.beam, 0.12, 1.2, 0.34, 0.9, 8.1, -DEPTH + 0.06, 0, 1.2);
  // divider on the left (planks low, iron bars above) + front post: own materials, so it can fade when it blocks the view
  B.build(g);
  s.divMats = [M.plankH, M.beam, M.iron, M.dark].map(m => m.clone());
  const [dP, dB, dI, dD] = s.divMats;
  s.div = new THREE.Group(); g.add(s.div);
  B.box(dP, 0.36, 4.0, DEPTH, -W / 2, 2.0, -DEPTH / 2)
    .box(dB, 0.5, 0.28, DEPTH, -W / 2, 4.1, -DEPTH / 2)
    .box(dB, 0.4, 0.22, DEPTH, -W / 2, 6.6, -DEPTH / 2);
  for (let i = 1; i < 9; i++) B.box(dI, 0.09, 2.4, 0.09, -W / 2, 5.35, -i * DEPTH / 9, 0, 0);
  B.box(dD, 0.6, 10.2, 0.6, -W / 2, 5.1, 0).build(s.div);
  s.divFade = 1;
  // header beam (the nameplate hangs on it): own material, fades with the plate when it hides the horse from above
  s.headMat = M.beam.clone(); s.headFade = 1;
  B.box(s.headMat, W, 1.0, 0.6, 0, 7.55, 0)
    .box(M.ceilBeam, 0.55, 0.7, 26, -W / 2, 10.1, 5)
    .box(M.ceilDark, W, 0.3, 26, 0, 10.6, 5)
    .box(M.beam, W, 0.4, 0.5, 0, 9.9, -DEPTH + 0.3);
  // floors: straw in the stall, cobbles in the aisle
  B.box(M.straw, W, 0.1, DEPTH, 0, 0.0, -DEPTH / 2)
    .box(M.cobble, W, 0.1, 20, 0, -0.02, 10);
  // hay rack + bucket
  B.box(M.beam, 1.8, 0.8, 0.8, -W / 2 + 1.4, 3.6, -DEPTH + 0.6).box(M.straw, 1.6, 0.6, 0.7, -W / 2 + 1.4, 4.2, -DEPTH + 0.6)
    .box(M.straw, 0.9, 0.35, 0.5, -W / 2 + 1.1, 0.2, -DEPTH + 0.8)
    .box(M.bucket, 0.7, 0.8, 0.7, W / 2 - 0.9, 0.45, -DEPTH + 0.8, 0, 0).box(M.iron, 0.78, 0.1, 0.78, W / 2 - 0.9, 0.85, -DEPTH + 0.8, 0, 0);
  // lantern hanging over the aisle
  B.box(M.iron, 0.05, 1.3, 0.05, -W / 2, 9.2, 2.4, 0, 0)
    .box(M.iron, 0.5, 0.12, 0.5, -W / 2, 8.5, 2.4, 0, 0).box(M.iron, 0.5, 0.1, 0.5, -W / 2, 7.75, 2.4, 0, 0)
    .box(M.lamp, 0.34, 0.6, 0.34, -W / 2, 8.12, 2.4, 0, 0);
  B.build(g);
  // half door, hinged on the left post; swings in against the left divider when open
  s.door = new THREE.Group(); s.door.position.set(-W / 2 + 0.32, 0, 0.18); g.add(s.door);
  const dw = W - 0.64;   // own fading materials: a closed door in front of a neighbour can block the view too
  s.doorMats = [M.plankH, M.beam, M.iron].map(m => m.clone()); s.doorFade = 1;
  const [oP, oB, oI] = s.doorMats;
  B.box(oP, dw, 3.0, 0.2, dw / 2, 1.65, 0)
    .box(oB, dw, 0.22, 0.26, dw / 2, 3.2, 0)
    .box(oB, 0.22, 3.6, 0.24, dw / 2, 1.65, 0.03, Math.atan2(2.6, dw) - Math.PI / 2, 0)
    .box(oI, 0.5, 0.14, 0.26, 0.3, 2.6, 0, 0, 0).box(oI, 0.5, 0.14, 0.26, 0.3, 0.8, 0, 0, 0)
    .build(s.door);
  s.doorTo = 0;
  // stickers (hidden until chosen)
  s.stickers = {}; s.stickerDoorMats = [];
  STICKERS.forEach(({ id }) => {
    const [where, sx, sy] = ST_SPOT[id];
    const m = new THREE.MeshBasicMaterial({ map: stickerTex(id), alphaTest: 0.5, toneMapped: false, color: "#e8dccb" });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 1.05), m); mesh.visible = false;
    if (where === "door") { mesh.position.set(sx, sy, 0.115); s.door.add(mesh); s.stickerDoorMats.push(m); }
    else { mesh.position.set(sx, sy, -DEPTH + 0.02); mesh.rotation.z = ((sx * 7) % 3 - 1) * 0.08; g.add(mesh); }
    s.stickers[id] = mesh;
  });
  // premium stall item: neon name sign on the back wall (hidden unless owned)
  s.neonC = document.createElement("canvas"); s.neonC.width = 256; s.neonC.height = 64;
  s.neonT = new THREE.CanvasTexture(s.neonC); s.neonT.colorSpace = THREE.SRGBColorSpace;
  s.neon = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.75), new THREE.MeshBasicMaterial({ map: s.neonT, transparent: true, toneMapped: false }));
  s.neon.position.set(-1.75, 8.15, -DEPTH + 0.03); s.neon.visible = false; g.add(s.neon);
  // nameplate: tier rim + painted board (canvas)
  s.rimMat = lam({ color: "#666", emissive: "#000" });
  const rim = new THREE.Mesh(vbox(4.1, 1.05, 0.14, 0), s.rimMat); rim.position.set(0, 7.6, 0.36); g.add(rim);
  s.plateC = document.createElement("canvas"); s.plateC.width = 256; s.plateC.height = 64;
  s.plateT = new THREE.CanvasTexture(s.plateC); s.plateT.colorSpace = THREE.SRGBColorSpace;
  s.plateT.magFilter = THREE.NearestFilter; s.plateT.minFilter = THREE.LinearMipmapLinearFilter; s.plateT.anisotropy = 8;
  s.plateM = new THREE.MeshBasicMaterial({ map: s.plateT, toneMapped: false });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(3.84, 0.96), s.plateM); plate.position.set(0, 7.6, 0.44); g.add(plate);
  // the horse
  s.horse = makeHorse(); s.horse.root.position.set(-0.45, 0, -3.3); g.add(s.horse.root);
  // tap target
  s.hit = new THREE.Mesh(new THREE.BoxGeometry(W, 9, DEPTH + 1), M.hit); s.hit.position.set(0, 4.5, -DEPTH / 2 + 0.5); s.hit.userData.slot = s; g.add(s.hit);
  return s;
}

// nameplate art: dark board, tier number, @handle in crisp pixel type (alpha-snapped so edges stay hard)
const snap = c => { const x = c.getContext("2d"), d = x.getImageData(0, 0, c.width, c.height), a = d.data; for (let i = 3; i < a.length; i += 4) a[i] = a[i] > 110 ? 255 : 0; x.putImageData(d, 0, 0); };
const textLayer = document.createElement("canvas"); textLayer.width = 256; textLayer.height = 64;
function pxText(x, str, cx, cy, size, color, maxW) {
  const t = textLayer.getContext("2d"); t.clearRect(0, 0, 256, 64);
  for (; size > 8; size -= 8) { t.font = `${size}px ${PX}`; if (t.measureText(str).width <= maxW) break; }
  t.font = `${size}px ${PX}`;
  if (t.measureText(str).width > maxW) { while (str.length > 4 && t.measureText(str + "…").width > maxW) str = str.slice(0, -1); str += "…"; }
  t.fillStyle = color; t.textAlign = "center"; t.textBaseline = "middle";
  t.fillText(str, Math.round(cx), Math.round(cy)); snap(textLayer);
  x.drawImage(textLayer, 0, 0);
}
export function paintPlate(c, k, st, tier, extra = {}) {
  const x = c.getContext("2d"); x.imageSmoothingEnabled = false;
  const PS = PLATES[(st && st.plate) || 0] || PLATES[0];
  x.fillStyle = PS.bg; x.fillRect(0, 0, 256, 64);
  x.fillStyle = PS.in; x.fillRect(4, 4, 248, 56);
  x.fillStyle = "#120b06"; x.fillRect(4, 4, 248, 2); x.fillRect(4, 58, 248, 2);
  const tc = TIER[tier];
  // tiny corner nails
  x.fillStyle = shade(tc, 0.8); [[8, 8], [246, 8], [8, 54], [246, 54]].forEach(([a, b]) => x.fillRect(a, b, 3, 3));
  pxText(x, "#" + k.toLocaleString("en-US") + (tier === "g" ? " ★" : ""), 128, 16, 8, PS.name === "Gold" || PS.name === "Ice" ? PS.sub : tc, 220);
  if (extra.painted != null) {               // move-in film: letters painted one by one
    const s = extra.painted;
    if (s) pxText(x, s, 128, 40, 24, "#fff6e0", 236);
    if (extra.cursor) { x.fillStyle = "#ff3d6e"; x.fillRect(128 + extra.cursor - 4, 30, 8, 20); }
  } else if (st) {
    pxText(x, "@" + st.handle, 128, st.name ? 34 : 40, 16, PS.ink, 236);
    if (st.name) pxText(x, st.name.toUpperCase(), 128, 51, 8, PS.sub, 236);
  } else if (extra.next) {
    pxText(x, "NEXT: YOU?", 128, 40, 16, "#ff3d6e", 236);
  } else {
    pxText(x, "EMPTY", 128, 40, 16, "#6b5848", 236);
  }
}

// neon sign: pink tube lettering with a soft glow
function paintNeon(c, text) {
  const x = c.getContext("2d"); x.clearRect(0, 0, 256, 64);
  x.fillStyle = "rgba(20,8,30,.85)"; x.fillRect(4, 6, 248, 52);
  x.strokeStyle = "#3ad6ff"; x.lineWidth = 3; x.shadowColor = "#3ad6ff"; x.shadowBlur = 10; x.strokeRect(6, 8, 244, 48);
  let size = 22; for (; size > 8; size -= 2) { x.font = `${size}px ${PX}`; if (x.measureText(text).width <= 228) break; }
  x.font = `${size}px ${PX}`; x.textAlign = "center"; x.textBaseline = "middle";
  x.shadowColor = "#ff3d6e"; x.shadowBlur = 14; x.fillStyle = "#ff7aa0"; x.fillText(text, 128, 33);
  x.shadowBlur = 0; x.fillStyle = "#ffe0ea"; x.fillText(text, 128, 33);
}

// ---------- mount ----------
export function mount(el, opts = {}) {
  const TOTAL = opts.total || 10000, GOLD = opts.gold || 800, SILVER = opts.silver || 5000;
  const reel = opts.reel || null;
  const coarse = matchMedia("(pointer:coarse)").matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: !!reel });
  renderer.setPixelRatio(reel ? 1 : Math.min(window.devicePixelRatio || 1, opts.lite ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.35;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (!reel) el.appendChild(renderer.domElement);
  renderer.domElement.style.touchAction = "none";

  const scene = new THREE.Scene();
  const FOG = new THREE.Color("#1a0f09");
  scene.background = FOG; scene.fog = new THREE.Fog(FOG, 26, 70);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.3, 300);

  scene.add(new THREE.HemisphereLight("#ffd7a0", "#3b2414", 1.15));
  const sunset = new THREE.DirectionalLight("#ff9a55", 1.1); sunset.position.set(-30, 40, -60); scene.add(sunset); scene.add(sunset.target);
  const fillL = new THREE.DirectionalLight("#ffe2b8", 0.55); fillL.position.set(10, 20, 40); scene.add(fillL); scene.add(fillL.target);
  const spot = new THREE.SpotLight("#ffd49a", 170, 30, 0.62, 0.75, 1.3);
  spot.castShadow = true; spot.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048); spot.shadow.bias = -0.0004; spot.shadow.normalBias = 0.02;
  spot.shadow.camera.near = 2; spot.shadow.camera.far = 30;
  scene.add(spot); scene.add(spot.target);
  const lamps = [0, 1, 2, 3].map(() => { const l = new THREE.PointLight("#ffb45e", 22, 16, 1.6); scene.add(l); return l; });

  // dust motes drifting in the light (square points = pixels)
  const DN = 260, dpos = new Float32Array(DN * 3), dseed = new Float32Array(DN);
  for (let i = 0; i < DN; i++) { dpos[i * 3] = (Math.random() - 0.5) * 24; dpos[i * 3 + 1] = Math.random() * 9.5; dpos[i * 3 + 2] = -6 + Math.random() * 16; dseed[i] = Math.random() * 100; }
  const dgeo = new THREE.BufferGeometry(); dgeo.setAttribute("position", new THREE.BufferAttribute(dpos, 3));
  const dust = new THREE.Points(dgeo, new THREE.PointsMaterial({ color: "#ffd9a0", size: 0.07, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(dust);
  // light shafts from the windows
  const shaftTex = pixTex("shaft", 4, 64, (x) => { const g = x.createLinearGradient(0, 0, 0, 64); g.addColorStop(0, "rgba(255,190,120,1)"); g.addColorStop(1, "rgba(255,190,120,0)"); x.fillStyle = g; x.fillRect(0, 0, 4, 64); }, false);
  shaftTex.magFilter = THREE.LinearFilter; shaftTex.minFilter = THREE.LinearFilter;
  const shaftMat = new THREE.MeshBasicMaterial({ map: shaftTex, transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  // barn end wall left of stall 1
  const endMat = barnMats().plankV.clone(); let endFade = 1, ceilFade = 1;
  { const B = builder(), g = new THREE.Group(); B.box(endMat, 0.5, 11, 30, 0, 5.5, 5).build(g); g.position.x = W / 2; scene.add(g); }
  // see-through walls: a wall fades when it sits between the camera and the horse
  const rectBlocks = (x0, x1, z0, z1, pts) => {
    const cx = camera.position.x, cz = camera.position.z;
    return pts.some(([px, pz]) => {
      let t0 = 0, t1 = 1; const dx = px - cx, dz = pz - cz;
      for (const [p, q] of [[-dx, cx - x0], [dx, x1 - cx], [-dz, cz - z0], [dz, z1 - cz]]) {
        if (p === 0) { if (q < 0) return false; continue; }
        const r = q / p; if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
      }
      return t1 > t0 && t0 < 0.97;
    });
  };
  const blocks = (wx, z0, z1, pts) => {
    const cx = camera.position.x, cz = camera.position.z;
    return pts.some(([px, pz]) => {
      if (Math.abs(cx - wx) < 0.35) return cz > z0 && cz < z1;
      if ((cx - wx) * (px - wx) > 0) return false;           // same side: no crossing
      const t = (wx - cx) / (px - cx), z = cz + (pz - cz) * t;
      return z > z0 && z < z1;
    });
  };
  const fadeTo = (mats, cur, want, dt) => {
    const o = cur + (want - cur) * Math.min(1, dt * 8);
    mats.forEach(m => { const tr = o < 0.98; if (m.transparent !== tr) { m.transparent = tr; m.depthWrite = !tr; m.needsUpdate = true; } m.opacity = tr ? o : 1; });
    return o;
  };

  // slot pool
  const N = reel ? (reel.kind === "launch" ? 23 : 9) : coarse ? 13 : 17, HALF = (N - 1) >> 1;
  const slots = [];
  for (let i = 0; i < N; i++) {
    const s = makeSlot();
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 13), shaftMat);
    sh.position.set(0.9, 4.2, -1.5); sh.rotation.set(-0.75, 0, 0.12); s.g.add(sh);
    scene.add(s.g); slots.push(s);
  }
  const plateBusy = new Set(), poseOf = new Map();   // per stall: { pose, yaw } (this visit only)
  function stallData(k) {
    if (reel && k === reel.k) return reel.kind === "launch" ? { handle: (reel.plate || "@YOU").replace(/^@/, ""), look: "1111", saddle: 1, acc: [] } : null;
    return opts.getStall ? opts.getStall(k) : null;
  }
  function fill(s, k, paint = true) {
    s.k = k; s.lookIdx = null; s.g.visible = k >= 1 && k <= TOTAL; if (!s.g.visible) return;
    s.g.position.x = k * W;
    const st = stallData(k), tier = tierOf(k, GOLD, SILVER);
    s.st = st;
    s.rimMat.color.set(TIER[tier]); s.rimMat.emissive.set(tier === "g" ? "#4a3200" : "#000");
    s.horse.root.visible = !!st;
    const ps = poseOf.get(k) || {}; s.horse.pose = ps.pose || "idle"; s.horse.yawVel = 0;
    if (s.lastK !== k) { s.horse.yaw = ps.yaw || 0; s.horse.root.rotation.y = s.horse.yaw; s.lastK = k; }
    if (st) s.horse.setLook(st, opts.looks);
    // decor: paint, stickers (plate style is painted below)
    const wallI = (st && st.wall) || 0;
    if (s.paint !== wallI) { s.backMat.map = paintTex(wallI); s.backMat.needsUpdate = true; s.paint = wallI; }
    const stk = new Set((st && st.stickers) || []);
    STICKERS.forEach(({ id }) => s.stickers[id].visible = stk.has(id));
    const sign = !!(st && (st.premium || []).includes("neon-sign"));
    s.neon.visible = sign;
    if (sign && s.neonFor !== st.handle) { paintNeon(s.neonC, "@" + st.handle); s.neonT.needsUpdate = true; s.neonFor = st.handle; }
    s.next = !st && opts.getStall && opts.getStall(k - 1) && !opts.getStall(k);
    if (paint) { paintPlate(s.plateC, k, st, tier, { next: s.next }); s.plateT.needsUpdate = true; plateBusy.delete(s); }
    else plateBusy.add(s);
  }

  // camera
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.085; controls.enablePan = false;
  controls.minDistance = 5; controls.maxDistance = 34;
  controls.minPolarAngle = 0.95; controls.maxPolarAngle = 1.56;
  controls.minAzimuthAngle = -1.05; controls.maxAzimuthAngle = 1.05;
  controls.rotateSpeed = coarse ? 0.7 : 0.55; controls.zoomSpeed = 0.8;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
  if (reel) controls.enabled = false;
  const VIEWS = {
    aisle: { az: 0.2, pol: 1.36, w: W * 2.1, h: 10, t: [0, 4.4, -2.4] },
    close: { az: 0.2, pol: 1.4, w: 8.6, h: 6.2, t: [0.1, 3.3, -3.0] },
    side: { az: -0.62, pol: 1.32, w: 8.0, h: 6.4, t: [0.3, 3.4, -3.0] }
  };
  let viewName = opts.view || "close", focusK = 1, inset = { right: 0, bottom: 0 }, fov0 = 42;
  const vis = () => ({ w: Math.max(1, el.clientWidth - inset.right), h: Math.max(1, el.clientHeight - inset.bottom) });
  function fitDist(v) {
    const { w, h } = vis(), tv = Math.tan(THREE.MathUtils.degToRad(fov0) / 2), th = tv * w / h;
    return Math.max(v.h / 2 / tv, v.w / 2 / th) * 1.05 + 1.2;
  }
  const sph = (az, pol, d) => new THREE.Vector3(d * Math.sin(pol) * Math.sin(az), d * Math.cos(pol), d * Math.sin(pol) * Math.cos(az));
  let fly = null, autoSpin = false, spinDir = 1;
  function flyTo(k, name = viewName, instant = false) {
    let v = VIEWS[name]; viewName = name;
    if (name === "side" && k <= 1) v = { ...v, az: -v.az, t: [-v.t[0], v.t[1], v.t[2]] };   // stall #1: the barn ends on the left, look from the right
    const from = controls.target.clone(), off = camera.position.clone().sub(controls.target);
    const s0 = new THREE.Spherical().setFromVector3(off);
    const to = new THREE.Vector3(k * W + v.t[0], v.t[1], v.t[2]);
    const d1 = fitDist(v);
    const dk = Math.abs(to.x - from.x) / W;
    if (instant) { controls.target.copy(to); camera.position.copy(to).add(sph(v.az, v.pol, d1)); controls.update(); fly = null; return; }
    fly = { t: 0, dur: 0.85 + Math.min(1.5, Math.log2(1 + dk) * 0.17), from, to, az0: s0.theta, pol0: s0.phi, d0: s0.radius, az1: v.az, pol1: v.pol, d1, bump: Math.min(0.9, Math.log10(1 + dk) * 0.33) };
  }
  controls.addEventListener("start", () => { fly = null; autoSpin = false; if (opts.onSpin) opts.onSpin(false); });

  // the fov is raised by the inset so the visible part keeps its framing, then the projection is shifted onto it
  function applyProjection() {
    const w = el.clientWidth || 1, h = el.clientHeight || 1;
    if (reel) { camera.aspect = 1080 / 1920; camera.fov = 50; camera.clearViewOffset(); camera.updateProjectionMatrix(); return; }
    const r = inset.right, b = inset.bottom;
    fov0 = w / h < 0.8 ? 50 : 42;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov0) / 2) * (h + b) / Math.max(1, h - b)));
    camera.aspect = (w + r) / (h + b);
    if (r || b) camera.setViewOffset(w + r, h + b, r, b, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  function resize() {
    if (reel) { renderer.setSize(1080, 1920, false); applyProjection(); return; }
    renderer.setSize(el.clientWidth, el.clientHeight, false); applyProjection();
  }
  const ro = new ResizeObserver(() => { resize(); if (!fly) flyTo(focusK, viewName, true); });
  ro.observe(el); resize();

  // picking: a tap, not a drag
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const hits = slots.map(s => s.hit);
  let down = null;
  renderer.domElement.addEventListener("pointerdown", e => { down = [e.clientX, e.clientY, performance.now()]; });
  renderer.domElement.addEventListener("pointerup", e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 7 || performance.now() - down[2] > 600) return;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const h = ray.intersectObjects(hits, false).find(h => h.object.parent.visible);
    if (h && opts.onPick) opts.onPick(h.object.userData.slot.k);
  });

  // reel film timeline (seconds). Horse walks down the aisle, turns into the empty stall, plate paints the name.
  const RH = reel ? makeHorse() : null;
  if (RH && reel.kind === "launch") RH.root.visible = false;
  if (RH) { RH.setLook({ look: reel.look || "4211", saddle: reel.saddle ?? 1, acc: reel.acc || [] }, opts.looks); scene.add(RH.root); }
  const sm = (a, b, t) => { const x = Math.max(0, Math.min(1, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const CAMK = [ // t, cam xyz (relative to stall), look xyz
    [0, [12, 6.2, 20], [3, 3.6, 0]], [4.2, [5, 5.0, 14], [1.4, 3.2, -0.8]], [7.6, [1.6, 4.8, 11.5], [0, 3.6, -2.6]],
    [8.6, [1.6, 4.8, 11.5], [0, 3.6, -2.6]], [10.0, [0.2, 7.3, 6.4], [0, 7.45, 0]], [12.4, [0.2, 7.3, 6.4], [0, 7.45, 0]],
    [13.6, [0.8, 5.6, 14.5], [0, 4.6, -1.5]], [16, [1.6, 5.4, 13.6], [0, 4.6, -1.5]]
  ];
  function reelAt(T) {
    const x0 = reel.k * W;
    let i = 0; while (i < CAMK.length - 2 && T > CAMK[i + 1][0]) i++;
    const [ta, ca, la] = CAMK[i], [tb, cb, lb] = CAMK[i + 1], u = sm(ta, tb, T);
    camera.position.set(x0 + lerp(ca[0], cb[0], u), lerp(ca[1], cb[1], u), lerp(ca[2], cb[2], u));
    camera.lookAt(x0 + lerp(la[0], lb[0], u), lerp(la[1], lb[1], u), lerp(la[2], lb[2], u));
    // horse path
    let px, pz, ry, walking = true;
    if (T < 0.6) { px = x0 + 17; pz = 3.6; ry = Math.PI; walking = false; }
    else if (T < 5.0) { const u2 = (T - 0.6) / 4.4; px = lerp(x0 + 17, x0 + 0.4, u2); pz = 3.6; ry = Math.PI; }
    else if (T < 5.7) { const u2 = sm(5.0, 5.7, T); px = lerp(x0 + 0.4, x0 + 0.1, u2); pz = lerp(3.6, 3.0, u2); ry = lerp(Math.PI, Math.PI / 2, u2); }
    else if (T < 7.3) { const u2 = (T - 5.7) / 1.6; px = x0 + 0.1; pz = lerp(3.0, -3.0, u2); ry = Math.PI / 2; }
    else if (T < 8.1) { const u2 = sm(7.3, 8.1, T); px = lerp(x0 + 0.1, x0 - 0.45, u2); pz = lerp(-3.0, -3.3, u2); ry = lerp(Math.PI / 2, 0, u2); }
    else { px = x0 - 0.45; pz = -3.3; ry = 0; walking = false; }
    RH.root.position.set(px, 0, pz); RH.root.rotation.y = ry;
    // plate painting
    const S = reel.plate || "@YOU", s = slots.find(q => q.k === reel.k);
    if (s) {
      const n = T < 9.9 ? 0 : Math.min(S.length, Math.floor((T - 9.9) / 0.38) + 1);
      const key = n + (T < 9.9 && Math.floor(T * 2.5) % 2 ? "f" : "");
      if (s.reelKey !== key) {
        s.reelKey = key;
        if (n === 0) paintPlate(s.plateC, reel.k, null, tierOf(reel.k, GOLD, SILVER), { next: false });
        else {
          const tmp = document.createElement("canvas").getContext("2d"); tmp.font = `24px ${PX}`;
          const sub = S.slice(0, n), wFull = Math.min(236, tmp.measureText(S).width);
          paintPlate(s.plateC, reel.k, null, tierOf(reel.k, GOLD, SILVER), { painted: sub, cursor: n < S.length ? Math.round(-wFull / 2 + tmp.measureText(sub).width + 6) : 0 });
        }
        s.plateT.needsUpdate = true;
      }
      const glow = sm(11.6, 12.2, T) * (1 - sm(12.6, 14, T) * 0.6);
      s.rimMat.emissive.setRGB(glow * 0.9, glow * 0.7, glow * 0.25);
    }
    return walking;
  }
  // sparkles when the name lands
  const SP = 60, spos = new Float32Array(SP * 3), svel = [];
  const sgeo = new THREE.BufferGeometry(); sgeo.setAttribute("position", new THREE.BufferAttribute(spos, 3));
  const spark = new THREE.Points(sgeo, new THREE.PointsMaterial({ color: "#ffe08a", size: 0.13, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  scene.add(spark);
  for (let i = 0; i < SP; i++) svel.push([(Math.random() - 0.5) * 5, Math.random() * 3 + 0.5, Math.random() * 2]);
  function sparkAt(T, x0) {
    const t = T - 11.6; spark.visible = t > 0 && t < 2.2; if (!spark.visible) return;
    for (let i = 0; i < SP; i++) { spos[i * 3] = x0 + svel[i][0] * t * 0.7; spos[i * 3 + 1] = 7.6 + svel[i][1] * t - 2.2 * t * t; spos[i * 3 + 2] = 0.6 + svel[i][2] * t * 0.6; }
    sgeo.attributes.position.needsUpdate = true; spark.material.opacity = Math.max(0, 1 - t / 2.2);
  }

  // loop
  const reduce = matchMedia("(prefers-reduced-motion:reduce)").matches;
  let raf = 0, last = performance.now(), T = 0, lastC = null, visible = true;
  const io = new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) { last = performance.now(); loop(); } }); io.observe(el);
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const comp = reel && reel.comp ? reel.comp.getContext("2d") : null;

  // ---- launch film (reel.kind === "launch", 24 s): fly down 10,000 stalls, drone over the empty ones,
  // then the shed: a horse restyled every half second, turned, reared; end on the aisle with "@YOU".
  const LAUNCH_LOOKS = [
    { look: "1111", saddle: 1, acc: [] }, { look: "4211", saddle: 1, acc: ["rosette"] }, { look: "3324", saddle: 2, acc: ["blinkers"] },
    { look: "2443", saddle: 3, acc: ["bonnet", "wraps"] }, { look: "1132", saddle: 1, acc: ["wraps"] }, { look: "3412", saddle: 2, acc: ["bonnet"] },
    { look: "4343", saddle: 3, acc: ["blinkers", "rosette"] }, { look: "2224", saddle: 0, acc: ["wraps"] }, { look: "4243", saddle: 3, acc: ["rosette", "wraps"] }
  ];
  const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const UP = v3(0, 1, 0), UPX = v3(1, 0, 0);
  function launchAt(T) {
    const K = reel.k, KX = K * W, info = reel.info || (reel.info = {});
    let cam, look, up = UP.clone(), sx;
    if (T < 4.6) {                                    // A: down the aisle from stall #1 to past the last filled one
      const u = ease(Math.min(1, T / 4.6)); sx = 1 + (K + 12 - 1) * u;
      const x = sx * W; cam = v3(x - 9, 6.2, 9.5); look = v3(x + 4, 3.6, -2.2);
    } else if (T < 9.0) {                             // B: rise into a drone shot, roll so the row runs down the screen
      const r = sm(4.6, 6.2, T), d = sm(5.0, 9.0, T); sx = (K + 12) - 16 * d;   // the filled/empty border drifts through the frame
      const x = sx * W;
      cam = v3(x - 9 * (1 - r), lerp(6.2, 44, r), lerp(9.5, 9, r)); look = v3(x + 4 * (1 - r), lerp(3.6, 0, r), lerp(-2.2, -3.4, r));
      up = UP.clone().lerp(UPX, r).normalize();
    } else if (T < 15.0) {                            // C: drop into the stall, close-up while the looks change
      const r = sm(9.0, 10.4, T), x0 = (K - 4) * W;
      sx = lerp(K - 4, K, r);
      cam = v3(lerp(x0, KX + 3, r), lerp(44, 5.2, r), lerp(9, lerp(11.5, 10.2, sm(10.4, 15, T)), r)); look = v3(lerp(x0, KX + 0.2, r), lerp(0, 3.4, r), lerp(-3.4, -3, r));
      up = UPX.clone().lerp(UP, sm(9.0, 9.9, T)).normalize();
    } else if (T < 19.8) {                            // D: orbit while it turns and rears
      const az = lerp(0.25, -0.55, sm(15, 19.8, T)), d = 11; sx = K;
      look = v3(KX + 0.1, 3.5, -3); cam = look.clone().add(v3(d * Math.sin(1.33) * Math.sin(az), d * Math.cos(1.33), d * Math.sin(1.33) * Math.cos(az)));
    } else {                                          // E: pull back to the aisle: plate + horse
      const r = sm(19.8, 21.6, T), az = -0.55 * (1 - r), d = 11; sx = K;
      const c0 = v3(KX + 0.1, 3.5, -3).add(v3(d * Math.sin(1.33) * Math.sin(az), d * Math.cos(1.33), d * Math.sin(1.33) * Math.cos(az)));
      cam = c0.lerp(v3(KX + 1.2, 6.4, 19.5), r); look = v3(KX + 0.1, lerp(3.5, 4.9, r), lerp(-3, -1.2, r));
    }
    camera.up.copy(up); camera.position.copy(cam); camera.lookAt(look);
    const fogN = Math.max(26, camera.position.y - 6); scene.fog.near = fogN; scene.fog.far = fogN + 50;
    info.stall = Math.max(1, Math.round(sx));
    // the showcase horse in stall K
    const s = slots.find(q => q.k === K);
    if (s && s.st) {
      const idx = T < 10.0 ? 0 : T < 14.6 ? 1 + Math.floor((T - 10.0) / 0.55) % (LAUNCH_LOOKS.length - 1) : LAUNCH_LOOKS.length - 1;
      if (s.lookIdx !== idx) { s.lookIdx = idx; s.horse.setLook(LAUNCH_LOOKS[idx], opts.looks); if (idx) s.horse.toss = 1; }
      s.horse.pose = T > 17.4 && T < 19.9 ? "rear" : "idle";
      const yw = T < 15.2 ? 0 : T < 17.2 ? ease((T - 15.2) / 2) * Math.PI * 2 : Math.PI * 2;
      s.horse.yaw = yw; s.horse.root.rotation.y = yw;
    }
    return sx * W;
  }
  const LAUNCH = reel && reel.kind === "launch";
  const REEL_LEN = LAUNCH ? 24 : 16;
  let reelT0 = performance.now();
  function frame(dt) {
    let walking = false, tx;
    if (reel) {
      const RT = reel.freeze != null ? reel.freeze : ((performance.now() - reelT0) / 1000) % REEL_LEN;
      T = RT; tx = reel.k * W;
      if (LAUNCH) {
        tx = launchAt(RT);
        const c = Math.round(tx / W), fast = lastC != null && Math.abs(c - lastC) > 1 && reel.freeze == null;
        ensurePool(c, !fast); lastC = c;
        if (!fast) { let n = 0; for (const s of plateBusy) { if (n++ > 6) break; fill(s, s.k, true); } }
      } else {
        ensurePool(reel.k, true);
        walking = reelAt(RT);
        sparkAt(RT, tx);
        animateHorse(RH, RT, reel.freeze != null ? 0 : dt, walking);
        if (reel.freeze != null && walking) { RH.walk = RT * 7.5; animateHorse(RH, RT, 0, true); }
      }
    } else {
      if (!reduce) T += dt;
      if (fly) {
        fly.t = Math.min(1, fly.t + dt / fly.dur); const k = ease(fly.t);
        controls.target.lerpVectors(fly.from, fly.to, k);
        const d = lerp(fly.d0, fly.d1, k) * (1 + fly.bump * Math.sin(Math.PI * fly.t));
        camera.position.copy(controls.target).add(sph(lerp(fly.az0, fly.az1, k), lerp(fly.pol0, fly.pol1, k), d));
        if (fly.t >= 1) fly = null;
      } else if (autoSpin) {
        const off = camera.position.clone().sub(controls.target), s = new THREE.Spherical().setFromVector3(off);
        s.theta += dt * 0.22 * spinDir; if (s.theta > 0.95) spinDir = -1; if (s.theta < -0.95) spinDir = 1;
        camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s));
      }
      controls.update();
      tx = controls.target.x;
      const c = Math.round(tx / W);
      const fast = lastC != null && Math.abs(c - lastC) > 1;
      ensurePool(c, !fast); lastC = c;
      if (!fast) { let n = 0; for (const s of plateBusy) { if (n++ > 3) break; fill(s, s.k, true); } }
    }
    // doors: focused stall (or the film's stall) stands open
    const openK = reel ? reel.k : focusK;
    slots.forEach(s => {
      if (!s.g.visible) return;
      const want = s.k === openK ? 1.56 : 0;
      s.door.rotation.y += (want - s.door.rotation.y) * Math.min(1, dt * 4);
      if (s.st) animateHorse(s.horse, T, dt, false);
      if (s.next) s.plateM.color.setScalar(0.75 + 0.25 * Math.sin(T * 4));
      else s.plateM.color.setScalar(1);
    });
    // fade whatever blocks the view of the focused horse
    { const hx = (reel ? reel.k : focusK) * W - 0.45, pts = [];   // a grid over the horse's footprint (any yaw)
      if (!LAUNCH || T > 9.6) for (const dx of [-2.6, -1.3, 0, 1.3, 2.6]) for (const z of [-5.2, -3.3, -1.4]) pts.push([hx + dx, z]);   // (launch film: only once we're at the stall)
      const oK = reel ? reel.k : focusK;
      slots.forEach(s => {
        if (!s.g.visible) return;
        const divB = blocks(s.k * W - W / 2, -DEPTH - 0.2, 0.4, pts);
        s.divFade = fadeTo(s.divMats, s.divFade, divB ? 0.16 : 1, dt);
        // open door folds against the left divider; a closed one spans the stall front
        const doorB = s.k === oK ? divB : rectBlocks(s.k * W - W / 2, s.k * W + W / 2, -0.1, 0.45, pts);
        s.doorFade = fadeTo(s.doorMats.concat(s.stickerDoorMats), s.doorFade, doorB ? 0.16 : 1, dt);
      });
      endFade = fadeTo([endMat], endFade, blocks(W / 2, -10, 20, pts) ? 0.12 : 1, dt);
      // header beam + nameplate: 3D test, the line of sight crosses the stall front at plate height
      const cp = camera.position, h3 = [];
      for (const [px, pz] of pts) for (const py of [1.2, 3.0, 4.8]) h3.push([px, py, pz]);
      slots.forEach(s => {
        if (!s.g.visible) return;
        const x0 = s.k * W - W / 2 - 0.3, x1 = s.k * W + W / 2 + 0.3;
        const hit = h3.some(([px, py, pz]) => { const t = (0.15 - cp.z) / (pz - cp.z); if (!(t > 0 && t < 1)) return false; const y = cp.y + (py - cp.y) * t, x = cp.x + (px - cp.x) * t; return y > 6.9 && y < 8.3 && x > x0 && x < x1; });
        s.headFade = fadeTo([s.headMat, s.rimMat, s.plateM], s.headFade, hit ? 0.2 : 1, dt);
      });
      ceilFade = fadeTo([barnMats().ceilBeam, barnMats().ceilDark], ceilFade, camera.position.y > 9.4 ? 0.1 : 1, dt);
      // neighbouring horses that stand between the camera and the focused horse
      const fk = reel ? reel.k : focusK;
      slots.forEach(s => { if (!s.g.visible || !s.st || s.k === fk) { if (s.horse.fade < 1) s.horse.fade = fadeTo(s.horse.allMats, s.horse.fade, 1, 1); return; }
        const x = s.k * W - 0.45; s.horse.fade = fadeTo(s.horse.allMats, s.horse.fade, rectBlocks(x - 2.9, x + 2.9, -6, -0.6, pts) ? 0.18 : 1, dt); }); }
    // lights follow the action
    const fx = reel && !LAUNCH ? reel.k * W : Math.round(tx / W) * W;
    spot.position.set(fx + 1.2, 9.6, 5.2); spot.target.position.set(fx, 2.2, -3.0);
    sunset.target.position.set(fx, 0, 0); sunset.position.set(fx - 30, 40, -60);
    fillL.target.position.set(fx, 0, 0); fillL.position.set(fx + 10, 20, 40);
    const near = slots.filter(s => s.g.visible).sort((a, b) => Math.abs(a.k * W - tx) - Math.abs(b.k * W - tx));
    lamps.forEach((l, i) => { const s = near[i]; if (s) l.position.set(s.k * W - W / 2, 8.0, 2.4); l.intensity = 22 * (0.94 + Math.sin(T * 7 + i * 2.1) * 0.04 + Math.sin(T * 13 + i) * 0.02); });
    for (let i = 0; i < DN; i++) {
      const q = dseed[i];
      dpos[i * 3] = fx + ((q * 7.3 + Math.sin(T * 0.13 + q) * 1.5) % 24) - 12;
      dpos[i * 3 + 1] = (q * 3.1 + T * 0.18 + Math.sin(T * 0.4 + q) * 0.3) % 9.5;
    }
    dgeo.attributes.position.needsUpdate = true;
    renderer.render(scene, camera);
    if (comp) { comp.drawImage(renderer.domElement, 0, 0, 1080, 1920); if (reel.overlay) reel.overlay(comp, T, 1080, 1920); }
  }
  function ensurePool(c, paint) {
    const lo = c - HALF;
    slots.forEach((s, i) => {
      const k = lo + ((((i - lo) % N) + N) % N);
      if (s.k !== k) fill(s, k, paint);
    });
  }
  function loop() {
    cancelAnimationFrame(raf);
    if (!visible) return;
    raf = requestAnimationFrame(loop);
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    frame(dt);
  }
  const fontReady = document.fonts ? document.fonts.load(`16px ${PX}`).catch(() => {}) : Promise.resolve();
  fontReady.then(() => { slots.forEach(s => { if (s.k != null) { s.reelKey = null; fill(s, s.k, true); } }); });
  if (reel) { focusK = reel.k; ensurePool(reel.k, true); }
  else flyTo(opts.start || 1, viewName, true);
  if (!reel) focusK = opts.start || 1;
  loop();

  return {
    focus(k, { instant = false, view } = {}) { focusK = k; autoSpin = false; flyTo(k, view || viewName, instant); },
    view(name) { if (name === "spin") { autoSpin = !autoSpin; fly = null; return autoSpin; } autoSpin = false; flyTo(focusK, name); return false; },
    get viewName() { return viewName; },
    _dbg() { return { cam: camera.position.toArray().map(v => +v.toFixed(2)), focusK, slots: slots.filter(s => s.g.visible).map(s => [s.k, +s.divFade.toFixed(2), +s.horse.fade.toFixed(2)]) }; },
    angle(az, pol, dist) { autoSpin = false; fly = null; const d = dist || camera.position.distanceTo(controls.target); camera.position.copy(controls.target).add(sph(az, pol ?? 1.35, d)); controls.update(); },
    pose(k, name) { const ps = poseOf.get(k) || {}; ps.pose = name; poseOf.set(k, ps); const s = slots.find(q => q.k === k); if (s) s.horse.pose = name; },
    poseOf(k) { return (poseOf.get(k) || {}).pose || "idle"; },
    // dir: -1 / +1 starts a held spin, 0 stops; step: turn by that many radians
    turn(k, { dir = 0, step = 0, face = false } = {}) {
      const s = slots.find(q => q.k === k); if (!s || !s.st) return; const H = s.horse;
      if (face) { H.yaw = -Math.PI / 2 + Math.round((H.root.rotation.y + Math.PI / 2) / (2 * Math.PI)) * 2 * Math.PI; H.yawVel = 0; }
      else if (step) H.yaw = (H.yaw ?? 0) + step;
      else { H.yawVel = dir * 2.4; if (!dir) H.yaw = H.root.rotation.y; }
      const ps = poseOf.get(k) || {}; ps.yaw = H.yaw; poseOf.set(k, ps);
    },
    refresh(k, happy) { const s = slots.find(q => q.k === k); if (s) { fill(s, k, true); if (happy && s.st) s.horse.toss = 1; } },
    refreshAll() { slots.forEach(s => s.k != null && fill(s, s.k, true)); },
    setInset(i) { inset = { right: i.right || 0, bottom: i.bottom || 0 }; applyProjection(); if (!fly) flyTo(focusK, viewName); },
    restartReel() { reelT0 = performance.now(); },
    get reelLength() { return REEL_LEN; },
    canvas: renderer.domElement,
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); renderer.dispose(); }
  };
}
