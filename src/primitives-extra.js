import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TeapotGeometry } from 'three/addons/geometries/TeapotGeometry.js';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

/*
 * 追加の部品。primitives.js の PRIMITIVES に合流する。
 * どれも中心が原点、だいたい 1 x 1 x 1 に収まる大きさで作る。
 */

// ---------------------------------------------------------------- 形づくりの道具

/** 角ばった形の面を平らに見せる（円柱を 3〜6 角で作ったときなど） */
function flat(geometry) {
  const g = geometry.toNonIndexed();
  g.computeVertexNormals();
  geometry.dispose();
  return g;
}

/** 曲面はなめらかに、角はくっきり見えるよう法線を整える */
function creased(geometry, angle = Math.PI / 5) {
  const g = toCreasedNormals(geometry, angle);
  if (g !== geometry) geometry.dispose();
  return g;
}

/**
 * 平面の形（Shape）に厚みを付けて立体にし、中心を原点にそろえる。
 * bevel > 0 なら角を少し丸める（記号や飾りをやわらかく見せる）
 */
function extrude(shape, depth, { bevel = 0, curveSegments = 32 } = {}) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    curveSegments,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
  });
  g.center();
  return creased(g);
}

/** 横から見た形（x = 奥行き、y = 高さ）を、幅の方向（x 軸）に押し出す */
function extrudeProfile(shape, width) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 32 });
  g.rotateY(-Math.PI / 2);
  g.center();
  return creased(g);
}

const polygon = (points) => new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));

/** 回転体（ろくろで作る形）。points は [半径, 高さ] の列 */
function lathe(points, segments = 48) {
  const g = new THREE.LatheGeometry(
    points.map(([x, y]) => new THREE.Vector2(Math.max(0, x), y)),
    segments,
  );
  g.center();
  return g;
}

// ---------------------------------------------------------------- 部品

export const EXTRA_PRIMITIVES = {
  // ======== 基本
  roundedBox: {
    label: '角丸立方体',
    icon: '▢',
    params: [
      { key: 'width', label: '幅', min: 0.05, max: 10, step: 0.05, default: 1 },
      { key: 'height', label: '高さ', min: 0.05, max: 10, step: 0.05, default: 1 },
      { key: 'depth', label: '奥行き', min: 0.05, max: 10, step: 0.05, default: 1 },
      { key: 'radius', label: '角の丸み', min: 0, max: 1, step: 0.01, default: 0.15 },
    ],
    build: (p) => {
      const r = Math.min(p.radius, Math.min(p.width, p.height, p.depth) / 2 - 0.001);
      return new RoundedBoxGeometry(p.width, p.height, p.depth, 4, Math.max(0, r));
    },
  },

  // ======== ブロック
  triPrism: {
    label: '三角柱',
    icon: '◮',
    params: [
      { key: 'radius', label: '大きさ', min: 0.05, max: 5, step: 0.05, default: 0.6 },
      { key: 'height', label: '高さ', min: 0.05, max: 10, step: 0.05, default: 1 },
    ],
    build: (p) => flat(new THREE.CylinderGeometry(p.radius, p.radius, p.height, 3)),
  },
  hexPrism: {
    label: '六角柱',
    icon: '⬣',
    params: [
      { key: 'radius', label: '半径', min: 0.05, max: 5, step: 0.05, default: 0.5 },
      { key: 'height', label: '高さ', min: 0.05, max: 10, step: 0.05, default: 1 },
    ],
    build: (p) => flat(new THREE.CylinderGeometry(p.radius, p.radius, p.height, 6)),
  },
  halfCylinder: {
    label: 'かまぼこ',
    icon: '◠',
    params: [
      { key: 'radius', label: '半径', min: 0.05, max: 5, step: 0.05, default: 0.5 },
      { key: 'length', label: '長さ', min: 0.05, max: 10, step: 0.05, default: 1 },
    ],
    build: (p) => {
      const s = new THREE.Shape();
      s.moveTo(p.radius, 0);
      s.absarc(0, 0, p.radius, 0, Math.PI, false);
      s.lineTo(p.radius, 0);
      return extrude(s, p.length);
    },
  },
  wedge: {
    label: 'スロープ',
    icon: '◺',
    params: [
      { key: 'width', label: '幅', min: 0.05, max: 10, step: 0.05, default: 1 },
      { key: 'height', label: '高さ', min: 0.05, max: 10, step: 0.05, default: 0.6 },
      { key: 'depth', label: '奥行き', min: 0.05, max: 10, step: 0.05, default: 1 },
    ],
    build: (p) =>
      extrudeProfile(
        polygon([
          [0, 0],
          [p.depth, 0],
          [0, p.height],
        ]),
        p.width,
      ),
  },
  pipe: {
    label: 'パイプ',
    icon: '◎',
    params: [
      { key: 'radius', label: '外の半径', min: 0.05, max: 5, step: 0.05, default: 0.5 },
      { key: 'thickness', label: '厚み', min: 0.01, max: 5, step: 0.01, default: 0.1 },
      { key: 'height', label: '高さ', min: 0.02, max: 10, step: 0.05, default: 1 },
      { key: 'segments', label: '分割数', min: 3, max: 64, step: 1, default: 40 },
    ],
    build: (p) => {
      const inner = Math.max(0.005, p.radius - p.thickness);
      const s = new THREE.Shape();
      s.absarc(0, 0, p.radius, 0, Math.PI * 2, false);
      const hole = new THREE.Path();
      hole.absarc(0, 0, Math.min(inner, p.radius - 0.005), 0, Math.PI * 2, true);
      s.holes.push(hole);
      const g = new THREE.ExtrudeGeometry(s, { depth: p.height, bevelEnabled: false, curveSegments: Math.round(p.segments / 2) });
      g.rotateX(-Math.PI / 2);
      g.center();
      return creased(g);
    },
  },
  stairs: {
    label: '階段',
    icon: '▟',
    params: [
      { key: 'steps', label: '段数', min: 2, max: 20, step: 1, default: 4 },
      { key: 'width', label: '幅', min: 0.05, max: 10, step: 0.05, default: 1 },
      { key: 'height', label: '高さ', min: 0.05, max: 10, step: 0.05, default: 1 },
      { key: 'depth', label: '奥行き', min: 0.05, max: 10, step: 0.05, default: 1 },
    ],
    build: (p) => {
      const n = Math.round(p.steps);
      const pts = [
        [0, 0],
        [p.depth, 0],
      ];
      for (let i = 0; i < n; i++) {
        const x = p.depth - (p.depth / n) * i;
        const y = (p.height / n) * (i + 1);
        pts.push([x, y], [x - p.depth / n, y]);
      }
      pts.pop();
      pts.push([0, p.height]);
      return extrudeProfile(polygon(pts), p.width);
    },
  },
  arch: {
    label: 'アーチ',
    icon: '∩',
    params: [
      { key: 'width', label: '幅', min: 0.1, max: 10, step: 0.05, default: 1.2 },
      { key: 'height', label: '高さ', min: 0.1, max: 10, step: 0.05, default: 1.2 },
      { key: 'opening', label: '穴の幅', min: 0.05, max: 10, step: 0.05, default: 0.7 },
      { key: 'thickness', label: '厚み', min: 0.02, max: 5, step: 0.02, default: 0.3 },
    ],
    build: (p) => {
      const w = p.width / 2;
      // 穴は幅と高さからはみ出さないようにする（上に 15% の梁を残す）
      const o = Math.min(p.opening / 2, w - 0.02, p.height * 0.85);
      const archY = Math.max(0, p.height * 0.85 - o);
      const s = polygon([
        [-w, 0],
        [-o, 0],
      ]);
      s.lineTo(-o, archY);
      s.absarc(0, archY, o, Math.PI, 0, true);
      s.lineTo(o, 0);
      s.lineTo(w, 0);
      s.lineTo(w, p.height);
      s.lineTo(-w, p.height);
      s.lineTo(-w, 0);
      return extrude(s, p.thickness);
    },
  },
  lBlock: {
    label: 'L字',
    icon: '⌞',
    params: [
      { key: 'size', label: '長さ', min: 0.1, max: 10, step: 0.05, default: 1 },
      { key: 'thickness', label: '太さ', min: 0.02, max: 5, step: 0.02, default: 0.3 },
      { key: 'depth', label: '奥行き', min: 0.02, max: 10, step: 0.05, default: 0.3 },
    ],
    build: (p) => {
      const s = p.size;
      const t = Math.min(p.thickness, s - 0.01);
      return extrude(
        polygon([
          [0, 0],
          [s, 0],
          [s, t],
          [t, t],
          [t, s],
          [0, s],
        ]),
        p.depth,
      );
    },
  },

  // ======== 曲線
  spring: {
    label: 'ばね',
    icon: '〰',
    params: [
      { key: 'radius', label: '半径', min: 0.05, max: 5, step: 0.05, default: 0.35 },
      { key: 'tube', label: '太さ', min: 0.01, max: 1, step: 0.01, default: 0.05 },
      { key: 'turns', label: '巻き数', min: 1, max: 20, step: 0.5, default: 5 },
      { key: 'height', label: '高さ', min: 0.05, max: 10, step: 0.05, default: 1 },
    ],
    build: (p) => {
      class Helix extends THREE.Curve {
        getPoint(t, target = new THREE.Vector3()) {
          const a = t * p.turns * Math.PI * 2;
          return target.set(Math.cos(a) * p.radius, (t - 0.5) * p.height, Math.sin(a) * p.radius);
        }
      }
      return new THREE.TubeGeometry(new Helix(), Math.ceil(p.turns * 48), p.tube, 12, false);
    },
  },
  vase: {
    label: '花びん',
    icon: '⚱',
    params: [
      { key: 'radius', label: '胴の半径', min: 0.05, max: 5, step: 0.05, default: 0.4 },
      { key: 'height', label: '高さ', min: 0.1, max: 10, step: 0.05, default: 1 },
      { key: 'neck', label: '口のすぼまり', min: 0.2, max: 1.5, step: 0.05, default: 0.5 },
    ],
    build: (p) => {
      const r = p.radius;
      const h = p.height;
      const t = Math.min(0.04, r * 0.15);
      const outer = new THREE.SplineCurve([
        new THREE.Vector2(r * 0.55, 0),
        new THREE.Vector2(r, h * 0.35),
        new THREE.Vector2(r * p.neck, h * 0.82),
        new THREE.Vector2(r * p.neck * 1.25, h),
      ]).getPoints(28);
      // 外側を上り、口で折り返して内側を下る（厚みのある器にする）
      const pts = [[0, 0], ...outer.map((v) => [v.x, v.y])];
      for (let i = outer.length - 1; i >= 0; i--) {
        if (outer[i].y < t) break;
        pts.push([outer[i].x - t, outer[i].y]);
      }
      pts.push([0, t]);
      return lathe(pts);
    },
  },
  egg: {
    label: 'たまご',
    icon: '🥚',
    params: [
      { key: 'radius', label: '半径', min: 0.05, max: 5, step: 0.05, default: 0.4 },
      { key: 'height', label: '高さ', min: 0.1, max: 10, step: 0.05, default: 1 },
    ],
    build: (p) => {
      const pts = [];
      for (let i = 0; i <= 32; i++) {
        const t = (i / 32) * Math.PI;
        pts.push([Math.sin(t) * p.radius * (1 + 0.16 * Math.cos(t)), (-Math.cos(t) * p.height) / 2]);
      }
      return lathe(pts);
    },
  },
  drop: {
    label: 'しずく',
    icon: '💧',
    params: [
      { key: 'radius', label: '半径', min: 0.05, max: 5, step: 0.05, default: 0.4 },
      { key: 'height', label: '高さ', min: 0.1, max: 10, step: 0.05, default: 1 },
    ],
    build: (p) => {
      const pts = [];
      for (let i = 0; i <= 40; i++) {
        const u = i / 40;
        pts.push([p.radius * Math.sin(Math.PI * Math.pow(u, 0.62)), u * p.height]);
      }
      return lathe(pts);
    },
  },
  teapot: {
    label: 'ティーポット',
    icon: '🫖',
    params: [
      { key: 'size', label: '大きさ', min: 0.05, max: 5, step: 0.05, default: 0.35 },
      { key: 'segments', label: 'なめらかさ', min: 2, max: 15, step: 1, default: 8 },
    ],
    build: (p) => {
      const g = new TeapotGeometry(p.size, Math.round(p.segments));
      g.center();
      return g;
    },
  },

  // ======== 多面体
  dodecahedron: {
    label: '十二面体',
    icon: '⬟',
    params: [
      { key: 'radius', label: '半径', min: 0.05, max: 5, step: 0.05, default: 0.55 },
      { key: 'detail', label: '細かさ', min: 0, max: 5, step: 1, default: 0 },
    ],
    build: (p) => new THREE.DodecahedronGeometry(p.radius, p.detail),
  },

  // ======== 飾り
  star: {
    label: '星',
    icon: '★',
    params: [
      { key: 'points', label: '角の数', min: 3, max: 16, step: 1, default: 5 },
      { key: 'radius', label: '半径', min: 0.05, max: 5, step: 0.05, default: 0.5 },
      { key: 'inner', label: 'へこみ', min: 0.1, max: 0.95, step: 0.05, default: 0.45 },
      { key: 'thickness', label: '厚み', min: 0.01, max: 5, step: 0.01, default: 0.2 },
    ],
    build: (p) => {
      const n = Math.round(p.points);
      const pts = [];
      for (let i = 0; i < n * 2; i++) {
        const r = i % 2 ? p.radius * p.inner : p.radius;
        const a = Math.PI / 2 + (i * Math.PI) / n;
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      return extrude(polygon(pts), p.thickness, { bevel: Math.min(0.03, p.thickness / 3) });
    },
  },
  heart: {
    label: 'ハート',
    icon: '♥',
    params: [
      { key: 'size', label: '大きさ', min: 0.05, max: 5, step: 0.05, default: 1 },
      { key: 'thickness', label: '厚み', min: 0.01, max: 5, step: 0.01, default: 0.25 },
    ],
    build: (p) => {
      const k = p.size / 22;
      const s = new THREE.Shape();
      // three.js の例でおなじみのハート（上下逆なので最後に回す）
      s.moveTo(5 * k, 5 * k);
      s.bezierCurveTo(5 * k, 5 * k, 4 * k, 0, 0, 0);
      s.bezierCurveTo(-6 * k, 0, -6 * k, 7 * k, -6 * k, 7 * k);
      s.bezierCurveTo(-6 * k, 11 * k, -3 * k, 15.4 * k, 5 * k, 19 * k);
      s.bezierCurveTo(12 * k, 15.4 * k, 16 * k, 11 * k, 16 * k, 7 * k);
      s.bezierCurveTo(16 * k, 7 * k, 16 * k, 0, 10 * k, 0);
      s.bezierCurveTo(7 * k, 0, 5 * k, 5 * k, 5 * k, 5 * k);
      const g = extrude(s, p.thickness, { bevel: Math.min(0.04, p.thickness / 3) });
      g.rotateZ(Math.PI);
      return g;
    },
  },
  arrow: {
    label: '矢印',
    icon: '➜',
    params: [
      { key: 'length', label: '長さ', min: 0.1, max: 10, step: 0.05, default: 1.2 },
      { key: 'width', label: '軸の太さ', min: 0.02, max: 5, step: 0.02, default: 0.24 },
      { key: 'head', label: '頭の大きさ', min: 0.05, max: 5, step: 0.05, default: 0.5 },
      { key: 'thickness', label: '厚み', min: 0.01, max: 5, step: 0.01, default: 0.15 },
    ],
    build: (p) => {
      const L = p.length / 2;
      const hl = Math.min(p.head, p.length * 0.9);
      const w = p.width / 2;
      const hw = Math.max(w * 1.2, p.head * 0.55);
      return extrude(
        polygon([
          [-L, -w],
          [L - hl, -w],
          [L - hl, -hw],
          [L, 0],
          [L - hl, hw],
          [L - hl, w],
          [-L, w],
        ]),
        p.thickness,
        { bevel: Math.min(0.02, p.thickness / 3) },
      );
    },
  },
  crescent: {
    label: '三日月',
    icon: '☾',
    params: [
      { key: 'radius', label: '半径', min: 0.05, max: 5, step: 0.05, default: 0.5 },
      { key: 'cut', label: '細さ', min: 0.1, max: 0.9, step: 0.05, default: 0.45 },
      { key: 'thickness', label: '厚み', min: 0.01, max: 5, step: 0.01, default: 0.2 },
    ],
    build: (p) => {
      // 大きな円から、少しずらした円を切り取った形
      const r = p.radius;
      const r2 = r * 0.9;
      const d = r * p.cut;
      const x = (d * d + r * r - r2 * r2) / (2 * d);
      const y = Math.sqrt(Math.max(0, r * r - x * x));
      const a = Math.atan2(y, x);
      const b = Math.atan2(y, x - d);
      const s = new THREE.Shape();
      s.absarc(0, 0, r, a, Math.PI * 2 - a, false);
      s.absarc(d, 0, r2, -b, b, true);
      return extrude(s, p.thickness, { bevel: Math.min(0.03, p.thickness / 3) });
    },
  },
  cross: {
    label: '十字',
    icon: '✚',
    params: [
      { key: 'size', label: '大きさ', min: 0.1, max: 10, step: 0.05, default: 1 },
      { key: 'width', label: '太さ', min: 0.02, max: 5, step: 0.02, default: 0.32 },
      { key: 'thickness', label: '厚み', min: 0.01, max: 5, step: 0.01, default: 0.2 },
    ],
    build: (p) => {
      const a = p.size / 2;
      const w = Math.min(p.width, p.size) / 2;
      return extrude(
        polygon([
          [-w, -a],
          [w, -a],
          [w, -w],
          [a, -w],
          [a, w],
          [w, w],
          [w, a],
          [-w, a],
          [-w, w],
          [-a, w],
          [-a, -w],
          [-w, -w],
        ]),
        p.thickness,
        { bevel: Math.min(0.02, p.thickness / 3) },
      );
    },
  },
  leaf: {
    label: '葉っぱ',
    icon: '🍃',
    params: [
      { key: 'length', label: '長さ', min: 0.1, max: 10, step: 0.05, default: 1 },
      { key: 'width', label: '幅', min: 0.05, max: 5, step: 0.05, default: 0.5 },
      { key: 'thickness', label: '厚み', min: 0.01, max: 1, step: 0.01, default: 0.04 },
    ],
    build: (p) => {
      const L = p.length / 2;
      const s = new THREE.Shape();
      s.moveTo(0, -L);
      s.quadraticCurveTo(p.width, 0, 0, L);
      s.quadraticCurveTo(-p.width, 0, 0, -L);
      return extrude(s, p.thickness, { bevel: Math.min(0.02, p.thickness / 2) });
    },
  },
  cloud: {
    label: '雲',
    icon: '☁',
    params: [
      { key: 'size', label: '大きさ', min: 0.1, max: 10, step: 0.05, default: 1 },
      { key: 'puffs', label: 'もこもこ', min: 3, max: 9, step: 1, default: 5 },
    ],
    build: (p) => {
      const n = Math.round(p.puffs);
      const parts = [];
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0.5 : i / (n - 1);
        // 真ん中ほど大きく高い、ふんわりした並び
        const bulge = Math.sin(t * Math.PI);
        const r = p.size * (0.2 + bulge * 0.14 + 0.03 * Math.sin(i * 2.3));
        const g = new THREE.SphereGeometry(r, 24, 16);
        g.translate((t - 0.5) * p.size * 0.9, bulge * p.size * 0.12, Math.sin(i * 1.7) * p.size * 0.08);
        parts.push(g);
      }
      const merged = mergeGeometries(parts);
      parts.forEach((g) => g.dispose());
      merged.center();
      return merged;
    },
  },
  gear: {
    label: '歯車',
    icon: '⚙',
    params: [
      { key: 'teeth', label: '歯の数', min: 4, max: 48, step: 1, default: 12 },
      { key: 'radius', label: '半径', min: 0.1, max: 5, step: 0.05, default: 0.5 },
      { key: 'tooth', label: '歯の高さ', min: 0.01, max: 1, step: 0.01, default: 0.1 },
      { key: 'hole', label: '穴の半径', min: 0, max: 5, step: 0.01, default: 0.12 },
      { key: 'thickness', label: '厚み', min: 0.01, max: 5, step: 0.01, default: 0.2 },
    ],
    build: (p) => {
      const n = Math.round(p.teeth);
      // 歯が高すぎても、根元の円が半径の 3 割より小さくならないようにする
      const root = Math.max(p.radius * 0.3, p.radius - p.tooth);
      const step = (Math.PI * 2) / n;
      const pts = [];
      for (let i = 0; i < n; i++) {
        const a = i * step;
        for (const [r, f] of [
          [root, 0],
          [p.radius, 0.2],
          [p.radius, 0.5],
          [root, 0.7],
        ]) {
          pts.push([Math.cos(a + f * step) * r, Math.sin(a + f * step) * r]);
        }
      }
      const s = polygon(pts);
      const holeR = Math.min(p.hole, root * 0.8);
      if (holeR > 0.005) {
        const hole = new THREE.Path();
        hole.absarc(0, 0, holeR, 0, Math.PI * 2, true);
        s.holes.push(hole);
      }
      return extrude(s, p.thickness, { bevel: Math.min(0.015, p.thickness / 4) });
    },
  },
};
