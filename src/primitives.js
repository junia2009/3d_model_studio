import * as THREE from 'three';

/**
 * 部品（プリミティブ）の定義。
 * どれも「だいたい 1 x 1 x 1」に収まる大きさで作り、サイズはスケールで調整する。
 * params には形そのものを変えるパラメータ（上面の半径、分割数など）を定義する。
 */
export const PRIMITIVES = {
  box: {
    label: '立方体',
    icon: '■',
    params: [
      { key: 'width', label: '幅', min: 0.05, max: 10, step: 0.05, default: 1 },
      { key: 'height', label: '高さ', min: 0.05, max: 10, step: 0.05, default: 1 },
      { key: 'depth', label: '奥行き', min: 0.05, max: 10, step: 0.05, default: 1 },
    ],
    build: (p) => new THREE.BoxGeometry(p.width, p.height, p.depth),
  },
  sphere: {
    label: '球',
    icon: '●',
    params: [
      { key: 'radius', label: '半径', min: 0.05, max: 5, step: 0.05, default: 0.5 },
      { key: 'segments', label: '分割数', min: 3, max: 64, step: 1, default: 32 },
    ],
    build: (p) => new THREE.SphereGeometry(p.radius, p.segments, Math.max(2, Math.round(p.segments / 2))),
  },
  hemisphere: {
    label: '半球',
    icon: '◓',
    params: [
      { key: 'radius', label: '半径', min: 0.05, max: 5, step: 0.05, default: 0.5 },
      { key: 'segments', label: '分割数', min: 3, max: 64, step: 1, default: 32 },
    ],
    build: (p) => {
      const g = new THREE.SphereGeometry(p.radius, p.segments, Math.max(2, Math.round(p.segments / 4)), 0, Math.PI * 2, 0, Math.PI / 2);
      // 底面をふさぐ
      const cap = new THREE.CircleGeometry(p.radius, p.segments);
      cap.rotateX(Math.PI / 2);
      return mergeSimple([g, cap]);
    },
  },
  cylinder: {
    label: '円柱',
    icon: '▮',
    params: [
      { key: 'radiusTop', label: '上の半径', min: 0, max: 5, step: 0.05, default: 0.5 },
      { key: 'radiusBottom', label: '下の半径', min: 0, max: 5, step: 0.05, default: 0.5 },
      { key: 'height', label: '高さ', min: 0.05, max: 10, step: 0.05, default: 1 },
      { key: 'segments', label: '分割数', min: 3, max: 64, step: 1, default: 32 },
    ],
    build: (p) => new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, p.segments),
  },
  cone: {
    label: '円錐',
    icon: '▲',
    params: [
      { key: 'radius', label: '半径', min: 0.05, max: 5, step: 0.05, default: 0.5 },
      { key: 'height', label: '高さ', min: 0.05, max: 10, step: 0.05, default: 1 },
      { key: 'segments', label: '分割数', min: 3, max: 64, step: 1, default: 32 },
    ],
    build: (p) => new THREE.ConeGeometry(p.radius, p.height, p.segments),
  },
  pyramid: {
    label: '四角錐',
    icon: '△',
    params: [
      { key: 'size', label: '底辺', min: 0.05, max: 10, step: 0.05, default: 1 },
      { key: 'height', label: '高さ', min: 0.05, max: 10, step: 0.05, default: 1 },
    ],
    build: (p) => {
      // ConeGeometry の 4 分割を 45 度回して、辺が軸に揃った四角錐にする
      const g = new THREE.ConeGeometry(p.size / Math.SQRT2, p.height, 4, 1);
      g.rotateY(Math.PI / 4);
      return g;
    },
  },
  torus: {
    label: 'ドーナツ',
    icon: '◯',
    params: [
      { key: 'radius', label: '半径', min: 0.05, max: 5, step: 0.05, default: 0.4 },
      { key: 'tube', label: '太さ', min: 0.01, max: 2, step: 0.01, default: 0.15 },
      { key: 'arc', label: '角度(°)', min: 1, max: 360, step: 1, default: 360 },
      { key: 'segments', label: '分割数', min: 3, max: 128, step: 1, default: 48 },
    ],
    build: (p) => new THREE.TorusGeometry(p.radius, p.tube, 16, p.segments, THREE.MathUtils.degToRad(p.arc)),
  },
  capsule: {
    label: 'カプセル',
    icon: '⬭',
    params: [
      { key: 'radius', label: '半径', min: 0.05, max: 5, step: 0.05, default: 0.3 },
      { key: 'length', label: '長さ', min: 0, max: 10, step: 0.05, default: 0.6 },
    ],
    build: (p) => new THREE.CapsuleGeometry(p.radius, p.length, 8, 24),
  },
  plane: {
    label: '板',
    icon: '▭',
    params: [
      { key: 'width', label: '幅', min: 0.05, max: 20, step: 0.05, default: 1 },
      { key: 'depth', label: '奥行き', min: 0.05, max: 20, step: 0.05, default: 1 },
    ],
    build: (p) => {
      const g = new THREE.PlaneGeometry(p.width, p.depth);
      g.rotateX(-Math.PI / 2);
      return g;
    },
  },
  tetrahedron: {
    label: '四面体',
    icon: '◭',
    params: [{ key: 'radius', label: '半径', min: 0.05, max: 5, step: 0.05, default: 0.6 }],
    build: (p) => new THREE.TetrahedronGeometry(p.radius),
  },
  octahedron: {
    label: '八面体',
    icon: '◆',
    params: [{ key: 'radius', label: '半径', min: 0.05, max: 5, step: 0.05, default: 0.6 }],
    build: (p) => new THREE.OctahedronGeometry(p.radius),
  },
  icosahedron: {
    label: '多面体',
    icon: '⬢',
    params: [
      { key: 'radius', label: '半径', min: 0.05, max: 5, step: 0.05, default: 0.55 },
      { key: 'detail', label: '細かさ', min: 0, max: 5, step: 1, default: 0 },
    ],
    build: (p) => new THREE.IcosahedronGeometry(p.radius, p.detail),
  },
  torusKnot: {
    label: '結び目',
    icon: '∞',
    params: [
      { key: 'radius', label: '半径', min: 0.05, max: 5, step: 0.05, default: 0.35 },
      { key: 'tube', label: '太さ', min: 0.01, max: 2, step: 0.01, default: 0.1 },
      { key: 'p', label: 'P', min: 1, max: 10, step: 1, default: 2 },
      { key: 'q', label: 'Q', min: 1, max: 10, step: 1, default: 3 },
    ],
    build: (p) => new THREE.TorusKnotGeometry(p.radius, p.tube, 128, 16, p.p, p.q),
  },
};

export function defaultParams(type) {
  const params = {};
  for (const def of PRIMITIVES[type].params) params[def.key] = def.default;
  return params;
}

export function buildGeometry(type, params) {
  const def = PRIMITIVES[type];
  const merged = { ...defaultParams(type), ...params };
  return def.build(merged);
}

/** 同じ属性構成（position / normal / uv）のジオメトリを 1 つにまとめる簡易マージ */
function mergeSimple(geometries) {
  const attrs = ['position', 'normal', 'uv'];
  const out = new THREE.BufferGeometry();
  const nonIndexed = geometries.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const name of attrs) {
    const itemSize = nonIndexed[0].getAttribute(name).itemSize;
    const total = nonIndexed.reduce((n, g) => n + g.getAttribute(name).array.length, 0);
    const array = new Float32Array(total);
    let offset = 0;
    for (const g of nonIndexed) {
      array.set(g.getAttribute(name).array, offset);
      offset += g.getAttribute(name).array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(array, itemSize));
  }
  geometries.forEach((g) => g.dispose());
  return out;
}
