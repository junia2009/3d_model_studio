import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

/**
 * 世界（背景）づくりの共通部品。画像ファイルは使わず、すべてコードで生成する
 * （PWA のオフライン動作とアプリの軽さを保つため）。
 */

// ---------------------------------------------------------------- 乱数・ノイズ

/** シード付き乱数（同じ世界はいつ開いても同じ配置になる） */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y) {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

export function noise2(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x, y, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, y * freq);
    freq *= 2;
    amp *= 0.5;
  }
  return sum;
}

export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 原点からの距離に応じて 0→1 になる係数。中心の作業エリアを平らに保つのに使う */
export const awayFromCenter = (x, z, r0, r1) => smoothstep(r0, r1, Math.hypot(x, z));

// GLSL 用のノイズ
export const GLSL_NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float s = 0.0; float a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.0; a *= 0.5; }
    return s;
  }
`;

// ---------------------------------------------------------------- テクスチャ

export function canvasTexture(width, height, draw, { srgb = true } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** ふんわりした丸（パーティクル・光の粒用） */
export function softDotTexture() {
  return canvasTexture(64, 64, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
}

/** もくもくした雲 */
export function cloudTexture(seed = 3) {
  const r = rng(seed);
  return canvasTexture(256, 128, (ctx, w, h) => {
    for (let i = 0; i < 26; i++) {
      const x = w * (0.18 + r() * 0.64);
      const y = h * (0.42 + r() * 0.3);
      const rad = h * (0.14 + r() * 0.24);
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  });
}

/** 色付きのふんわりした光（星雲・大気の輝き用） */
export function glowTexture(color, { inner = 0 } = {}) {
  return canvasTexture(128, 128, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, w * inner * 0.5, w / 2, w / 2, w / 2);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
}

/** 1 ピクセルずつ色を決めてテクスチャを作る（惑星の模様など） */
export function pixelTexture(width, height, fn) {
  return canvasTexture(width, height, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [r, g, b, a = 255] = fn(x / w, y / h);
        const i = (y * w + x) * 4;
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = a;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

// ---------------------------------------------------------------- 空

/** 物理ベースの空（three.js の Sky）。elevation / azimuth は度 */
export function makeSky({ elevation = 40, azimuth = 150, turbidity = 6, rayleigh = 1.5, mie = 0.005, mieG = 0.8 } = {}) {
  const sky = new Sky();
  sky.scale.setScalar(400);
  sky.frustumCulled = false;
  const u = sky.material.uniforms;
  u.turbidity.value = turbidity;
  u.rayleigh.value = rayleigh;
  u.mieCoefficient.value = mie;
  u.mieDirectionalG.value = mieG;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90 - elevation),
    THREE.MathUtils.degToRad(azimuth),
  );
  u.sunPosition.value.copy(sunDir);
  return { sky, sunDir };
}

/** 上・地平線・下の 3 色グラデーションの空 */
export function makeDome({ top, horizon, bottom, radius = 300, exponent = 0.6 }) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(top) },
      uHorizon: { value: new THREE.Color(horizon) },
      uBottom: { value: new THREE.Color(bottom ?? horizon) },
      uExp: { value: exponent },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom; uniform float uExp;
      varying vec3 vDir;
      void main() {
        float h = normalize(vDir).y;
        vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(h, uExp)) : mix(uHorizon, uBottom, pow(-h, 0.5));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), material);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  return dome;
}

/** 環境マップ（金属や光沢のある部品に映り込む景色）用の簡易シーン */
export function envScene(top, horizon, bottom) {
  const scene = new THREE.Scene();
  scene.add(makeDome({ top, horizon, bottom, radius: 10 }));
  return scene;
}

// ---------------------------------------------------------------- 星・パーティクル

/** またたく星 */
export function makeStars({ count = 3000, radius = 250, minY = -1, size = 2.2, seed = 7, color = '#ffffff' } = {}) {
  const r = rng(seed);
  const pos = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  let i = 0;
  while (i < count) {
    const v = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1);
    const len = v.length();
    if (len > 1 || len < 0.1) continue;
    v.divideScalar(len);
    if (v.y < minY) continue;
    v.multiplyScalar(radius);
    pos.set([v.x, v.y, v.z], i * 3);
    sizes[i] = size * (0.4 + Math.pow(r(), 3) * 1.8);
    phases[i] = r() * Math.PI * 2;
    i += 1;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
    vertexShader: /* glsl */ `
      attribute float aSize; attribute float aPhase;
      uniform float uTime; uniform float uPixelRatio;
      varying float vTwinkle;
      void main() {
        vTwinkle = 0.65 + 0.35 * sin(uTime * 1.7 + aPhase);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_Position.z = gl_Position.w * 0.999;
        gl_PointSize = aSize * uPixelRatio * (0.8 + 0.4 * vTwinkle);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; varying float vTwinkle;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(uColor * vTwinkle, a);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const stars = new THREE.Points(geometry, material);
  stars.frustumCulled = false;
  stars.renderOrder = -9;
  stars.userData.update = (dt, t) => {
    material.uniforms.uTime.value = t;
  };
  return stars;
}

/**
 * 降る / 昇るパーティクル（雪・泡・ほたる など）。
 * direction: -1 で下へ、+1 で上へ。area は [幅, 高さ, 奥行き]
 */
export function makeParticles({
  count = 1500,
  area = [60, 30, 60],
  baseY = 0,
  color = '#ffffff',
  size = 0.15,
  speed = 1,
  direction = -1,
  sway = 0.5,
  opacity = 0.9,
  additive = false,
  seed = 11,
}) {
  const r = rng(seed);
  const [w, h, d] = area;
  const pos = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  const speeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (r() - 0.5) * w;
    pos[i * 3 + 1] = baseY + r() * h;
    pos[i * 3 + 2] = (r() - 0.5) * d;
    phase[i] = r() * Math.PI * 2;
    speeds[i] = speed * (0.6 + r() * 0.8);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const material = new THREE.PointsMaterial({
    color,
    size,
    map: softDotTexture(),
    transparent: true,
    opacity,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.userData.update = (dt, t) => {
    const p = geometry.attributes.position.array;
    for (let i = 0; i < count; i++) {
      const k = i * 3;
      p[k + 1] += direction * speeds[i] * dt;
      p[k] += Math.sin(t * 0.8 + phase[i]) * sway * dt;
      p[k + 2] += Math.cos(t * 0.6 + phase[i]) * sway * dt;
      if (direction < 0 && p[k + 1] < baseY) p[k + 1] += h;
      if (direction > 0 && p[k + 1] > baseY + h) p[k + 1] -= h;
    }
    geometry.attributes.position.needsUpdate = true;
  };
  return points;
}

/** 流れる雲（スプライト） */
export function makeClouds({
  count = 24,
  area = 400,
  yMin = 40,
  yMax = 80,
  scaleMin = 30,
  scaleMax = 70,
  color = '#ffffff',
  opacity = 0.9,
  speed = 1.5,
  minRadius = 60,
  seed = 5,
}) {
  const r = rng(seed);
  const group = new THREE.Group();
  const textures = [cloudTexture(seed), cloudTexture(seed + 1), cloudTexture(seed + 2)];
  for (let i = 0; i < count; i++) {
    const material = new THREE.SpriteMaterial({
      map: textures[i % textures.length],
      color,
      transparent: true,
      opacity: opacity * (0.6 + r() * 0.4),
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    let x;
    let z;
    do {
      x = (r() - 0.5) * area;
      z = (r() - 0.5) * area;
    } while (Math.hypot(x, z) < minRadius);
    const s = scaleMin + r() * (scaleMax - scaleMin);
    sprite.position.set(x, yMin + r() * (yMax - yMin), z);
    sprite.scale.set(s, s * 0.5, 1);
    group.add(sprite);
  }
  group.userData.update = (dt) => {
    for (const c of group.children) {
      c.position.x += speed * dt;
      if (c.position.x > area / 2) c.position.x -= area;
    }
  };
  return group;
}

// ---------------------------------------------------------------- 地面・植物

/**
 * 起伏と色を関数で決める地面。
 * height(x, z) → y、color(x, z, y) → [r, g, b]（0〜1, sRGB）
 */
export function makeTerrain({ size = 400, segments = 160, height = () => 0, color, roughness = 1, metalness = 0, flatShading = false }) {
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = height(x, z);
    pos.setY(i, y);
    if (color) {
      const [r, g, b] = color(x, z, y);
      c.setRGB(r, g, b, THREE.SRGBColorSpace);
      colors.set([c.r, c.g, c.b], i * 3);
    }
  }
  if (color) geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ vertexColors: !!color, roughness, metalness, flatShading });
  const mesh = new THREE.Mesh(geometry, material);
  // 部品の底（y = 0）とちらつかないよう、ほんの少し下げる
  mesh.position.y = -0.01;
  return mesh;
}

/** 色を少しずつ揺らした配列を作る */
export const jitter = (hex, amount, r) => {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  return new THREE.Color().setHSL(hsl.h + (r() - 0.5) * amount * 0.2, hsl.s, THREE.MathUtils.clamp(hsl.l + (r() - 0.5) * amount, 0, 1));
};

/**
 * たくさんの木（InstancedMesh で軽く描く）。
 * shape: 'cone'（針葉樹）/ 'round'（広葉樹）
 */
export function makeTrees({
  count = 120,
  rMin = 20,
  rMax = 90,
  shape = 'cone',
  leaf = '#3f7f3a',
  trunk = '#6b4a2f',
  scale = [0.8, 1.6],
  heightAt = () => 0,
  seed = 21,
  variation = 0.15,
}) {
  const r = rng(seed);
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 1.6, 7);
  trunkGeo.translate(0, 0.8, 0);
  let leafGeo;
  if (shape === 'cone') {
    leafGeo = new THREE.ConeGeometry(1.2, 3.2, 8);
    leafGeo.translate(0, 3.0, 0);
  } else {
    leafGeo = new THREE.IcosahedronGeometry(1.5, 1);
    leafGeo.translate(0, 2.9, 0);
  }
  const trunkMat = new THREE.MeshStandardMaterial({ color: trunk, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2;
    const d = rMin + Math.sqrt(r()) * (rMax - rMin);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const k = scale[0] + r() * (scale[1] - scale[0]);
    p.set(x, heightAt(x, z) - 0.05, z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI * 2);
    s.set(k, k * (0.85 + r() * 0.3), k);
    m.compose(p, q, s);
    trunks.setMatrixAt(i, m);
    leaves.setMatrixAt(i, m);
    leaves.setColorAt(i, jitter(leaf, variation, r));
  }
  trunks.castShadow = leaves.castShadow = false;
  const group = new THREE.Group();
  group.add(trunks, leaves);
  return group;
}

// ---------------------------------------------------------------- 後片付け

export function disposeTree(root) {
  root.traverse((o) => {
    o.geometry?.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
      for (const u of Object.values(m.uniforms ?? {})) if (u.value?.isTexture) u.value.dispose();
      m.dispose();
    }
  });
}
