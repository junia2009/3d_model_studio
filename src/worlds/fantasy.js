import * as THREE from 'three';
import {
  GLSL_NOISE,
  awayFromCenter,
  envScene,
  fbm,
  glowTexture,
  makeClouds,
  makeDome,
  makeParticles,
  makeSky,
  makeStars,
  makeTerrain,
  makeTrees,
  pixelTexture,
  rng,
} from './common.js';

const glowSprite = (color, scale, opacity = 1) => {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture(color), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
  );
  sprite.scale.setScalar(scale);
  return sprite;
};

// ================================================================ 星空の夜

export const night = {
  id: 'night',
  label: '星空の夜',
  icon: '✨',
  preview: 'radial-gradient(circle at 75% 25%, #fdf6d8 0 4%, transparent 5%), linear-gradient(180deg, #03040c 0%, #16244d 60%, #1b2536 61%, #0c1119 100%)',
  create() {
    const group = new THREE.Group();
    const fogColor = '#101a30';
    group.add(makeDome({ top: '#02030a', horizon: '#1a2b58', bottom: '#05070d', exponent: 0.45 }));
    group.add(makeStars({ count: 3500, radius: 250, minY: -0.05 }));

    // 月と光のにじみ
    // よく使う視点（手前斜め上から）で見えるよう、正面奥のやや上に置く
    const moonDir = new THREE.Vector3(-0.6, 0.22, -0.77).normalize();
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(7, 32, 16),
      new THREE.MeshBasicMaterial({ color: '#fdf6dc', fog: false }),
    );
    moon.position.copy(moonDir).multiplyScalar(220);
    const halo = glowSprite('rgba(200,215,255,0.55)', 70);
    halo.position.copy(moon.position);
    group.add(moon, halo);

    const hill = (x, z) => awayFromCenter(x, z, 20, 90) * fbm(x * 0.015, z * 0.015) * 16;
    group.add(
      makeTerrain({
        height: hill,
        color: (x, z) => {
          const n = fbm(x * 0.1, z * 0.1);
          return [0.1 + n * 0.05, 0.16 + n * 0.07, 0.14 + n * 0.05];
        },
      }),
    );
    group.add(makeTrees({ count: 90, rMin: 22, rMax: 140, shape: 'cone', leaf: '#1d3326', trunk: '#241a14', heightAt: hill, scale: [1.2, 2.4], variation: 0.05 }));
    // ほたる
    group.add(makeParticles({ count: 90, area: [40, 3, 40], baseY: 0.3, color: '#ffe98a', size: 0.14, speed: 0.15, direction: 1, sway: 0.8, additive: true }));

    return {
      group,
      // 遊ぶモードで歩く地面の高さ
      groundAt: hill,
      background: new THREE.Color('#05070d'),
      fog: new THREE.Fog(fogColor, 60, 250),
      lights: { hemi: ['#8ea3e6', '#1a2236', 1.1], sun: ['#c9d5ff', 1.8, [moonDir.x * 15, 0.5 * 15, moonDir.z * 15]] },
      exposure: 1.3,
      shadowOpacity: 0.35,
      grid: false,
      env: envScene('#050814', '#1a2b58', '#05070d'),
      envIntensity: 0.6,
    };
  },
};

// ================================================================ 宇宙

export const space = {
  id: 'space',
  label: '宇宙',
  icon: '🪐',
  preview:
    'radial-gradient(circle at 30% 35%, #e0a86b 0 12%, transparent 13%), radial-gradient(circle at 70% 60%, #6a3fa033 0 30%, transparent 45%), #02020a',
  create() {
    const group = new THREE.Group();
    group.add(makeStars({ count: 5000, radius: 260, minY: -1, size: 2 }));

    // 星雲
    const r = rng(90);
    const nebulaColors = ['rgba(140,70,220,0.55)', 'rgba(60,110,230,0.5)', 'rgba(230,80,160,0.4)'];
    for (let i = 0; i < 7; i++) {
      const s = glowSprite(nebulaColors[i % 3], 120 + r() * 120, 0.55);
      s.position.setFromSphericalCoords(240, 0.6 + r() * 1.9, r() * Math.PI * 2);
      group.add(s);
    }

    // 輪のある惑星
    const bands = ['#e8c89a', '#c98e5a', '#f1dcb8', '#a8683e', '#dcb07c'];
    const planetTex = pixelTexture(256, 128, (u, v) => {
      const t = v * 9 + fbm(u * 6, v * 20) * 1.6;
      const c = new THREE.Color(bands[Math.floor(Math.abs(t)) % bands.length]).lerp(
        new THREE.Color(bands[(Math.floor(Math.abs(t)) + 1) % bands.length]),
        t % 1,
      );
      return [c.r * 255, c.g * 255, c.b * 255];
    });
    const planet = new THREE.Mesh(new THREE.SphereGeometry(30, 48, 24), new THREE.MeshStandardMaterial({ map: planetTex, roughness: 1 }));
    planet.position.set(-110, 45, -190);
    planet.rotation.z = 0.35;
    const ringTex = pixelTexture(256, 1, (u) => {
      const a = (Math.sin(u * 80) * 0.3 + 0.6) * (u > 0.1 && u < 0.95 ? 1 : 0) * (u > 0.55 && u < 0.6 ? 0.2 : 1);
      return [230, 205, 170, a * 255];
    });
    const ringGeo = new THREE.RingGeometry(38, 62, 96, 1);
    // RingGeometry の UV を半径方向に貼り直す
    const pos = ringGeo.attributes.position;
    const uv = ringGeo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const d = Math.hypot(pos.getX(i), pos.getY(i));
      uv.setXY(i, (d - 38) / 24, 0.5);
    }
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshStandardMaterial({ map: ringTex, transparent: true, side: THREE.DoubleSide, roughness: 1, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2 + 0.35;
    ring.position.copy(planet.position);
    planet.userData.update = (dt) => {
      planet.rotation.y += dt * 0.03;
    };
    group.add(planet, ring);

    // 遠くの小さな月と、太陽の輝き
    const moonlet = new THREE.Mesh(new THREE.SphereGeometry(5, 24, 12), new THREE.MeshStandardMaterial({ color: '#9aa4b8', roughness: 1 }));
    moonlet.position.set(90, -30, -160);
    group.add(moonlet);
    const sunGlow = glowSprite('rgba(255,236,200,0.9)', 90);
    sunGlow.position.set(160, 90, 140);
    group.add(sunGlow);

    // 宇宙空間でゆっくり漂うチリ
    group.add(makeParticles({ count: 400, area: [60, 40, 60], baseY: -20, color: '#aab8ff', size: 0.06, speed: 0.05, direction: 1, sway: 0.2, additive: true, opacity: 0.6 }));

    return {
      group,
      // 見えない床の上を歩き、重力は弱い
      gravity: 0.35,
      background: new THREE.Color('#02020a'),
      fog: null,
      lights: { hemi: ['#6a74a8', '#05050c', 0.45], sun: ['#fff3e0', 3.2, [10, 6, 9]] },
      exposure: 1,
      shadowOpacity: 0,
      grid: false,
      env: envScene('#0a0a20', '#1a1440', '#02020a'),
      envIntensity: 0.5,
    };
  },
};

// ================================================================ 月面

export const moon = {
  id: 'moon',
  label: '月面',
  icon: '🌕',
  preview: 'radial-gradient(circle at 70% 25%, #4f8fd8 0 9%, transparent 10%), linear-gradient(180deg, #000 0%, #05050a 55%, #8a8a8f 56%, #5c5c62 100%)',
  create() {
    const group = new THREE.Group();
    group.add(makeStars({ count: 3000, radius: 250, minY: -0.05, size: 1.8 }));

    // クレーターだらけの地面（中央の作業エリアは平ら）
    const r = rng(61);
    const craters = [];
    for (let i = 0; i < 70; i++) {
      const a = r() * Math.PI * 2;
      const d = 9 + Math.sqrt(r()) * 140;
      craters.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, rad: 1.5 + Math.pow(r(), 2) * 14 });
    }
    const height = (x, z) => {
      let h = fbm(x * 0.05, z * 0.05) * 1.5;
      for (const c of craters) {
        const d = Math.hypot(x - c.x, z - c.z) / c.rad;
        if (d < 1.4) {
          // くぼみと縁の盛り上がり
          h += d < 1 ? -(1 - d * d) * c.rad * 0.25 : Math.sin(((d - 1) / 0.4) * Math.PI) * c.rad * 0.06;
        }
      }
      return h * awayFromCenter(x, z, 7, 16);
    };
    group.add(
      makeTerrain({
        height,
        segments: 200,
        color: (x, z, y) => {
          const n = fbm(x * 0.3, z * 0.3);
          const g = 0.5 + n * 0.12 + y * 0.01;
          return [g, g, g * 1.02];
        },
      }),
    );

    // 空に浮かぶ地球
    const earthTex = pixelTexture(256, 128, (u, v) => {
      const lat = Math.abs(v - 0.5) * 2;
      const land = fbm(u * 8, v * 5, 5) + (lat > 0.85 ? 0.3 : 0);
      const cloud = fbm(u * 10 + 30, v * 7, 4);
      let c = land > 0.55 ? (lat > 0.8 ? [235, 240, 245] : land > 0.62 ? [140, 120, 80] : [70, 130, 60]) : [30, 80, 170];
      if (cloud > 0.6) c = c.map((x) => x + (255 - x) * Math.min(1, (cloud - 0.6) * 4));
      return c;
    });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(14, 48, 24), new THREE.MeshStandardMaterial({ map: earthTex, roughness: 0.8 }));
    earth.position.set(-110, 50, -150);
    earth.userData.update = (dt) => {
      earth.rotation.y += dt * 0.05;
    };
    const atmosphere = glowSprite('rgba(110,170,255,0.6)', 44, 0.8);
    atmosphere.position.copy(earth.position);
    group.add(atmosphere, earth);

    return {
      group,
      // 遊ぶモードで歩く地面の高さ
      groundAt: height,
      // 月の重力は地球の約 1/6
      gravity: 0.25,
      background: new THREE.Color('#000000'),
      fog: null,
      lights: { hemi: ['#5c6070', '#101014', 0.3], sun: ['#ffffff', 3.4, [9, 6, 5]] },
      exposure: 1,
      shadowOpacity: 0.6,
      grid: false,
      env: envScene('#050508', '#202028', '#6a6a70'),
      envIntensity: 0.4,
    };
  },
};

// ================================================================ ネオン街

export const neon = {
  id: 'neon',
  label: 'ネオン街',
  icon: '🌆',
  preview:
    'radial-gradient(circle at 50% 52%, #ffd35c 0 10%, #ff4fa3 13%, transparent 14%), linear-gradient(180deg, #0b0321 0%, #5a1a7a 45%, #ff3d8b 52%, #140a2a 53%, #140a2a 100%)',
  create() {
    const group = new THREE.Group();
    const fogColor = new THREE.Color('#2a0b4a');
    group.add(makeDome({ top: '#07021a', horizon: '#ff3d8b', bottom: '#12062a', exponent: 0.35 }));
    group.add(makeStars({ count: 800, radius: 250, minY: 0.2, size: 1.6, color: '#ffd6f5' }));

    // 光る方眼の地面（手前に流れる）
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600),
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uBase: { value: new THREE.Color('#12052a') },
          uLineA: { value: new THREE.Color('#29e7ff') },
          uLineB: { value: new THREE.Color('#ff3dd4') },
          uFog: { value: fogColor },
        },
        vertexShader: /* glsl */ `
          varying vec3 vWorld; varying float vDepth;
          void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform vec3 uBase; uniform vec3 uLineA; uniform vec3 uLineB; uniform vec3 uFog;
          varying vec3 vWorld; varying float vDepth;
          float grid(vec2 p) {
            vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
            return 1.0 - min(min(g.x, g.y), 1.0);
          }
          void main() {
            vec2 p = vWorld.xz / 2.0;
            p.y += uTime * 0.6;
            float line = grid(p);
            float d = length(vWorld.xz);
            vec3 lineCol = mix(uLineA, uLineB, smoothstep(10.0, 90.0, d));
            vec3 col = uBase + lineCol * line * 1.4;
            col = mix(col, uFog, smoothstep(40.0, 240.0, vDepth));
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.userData.update = (dt, t) => {
      ground.material.uniforms.uTime.value = t;
    };
    group.add(ground);

    // しま模様の沈む太陽
    const sun = new THREE.Mesh(
      new THREE.CircleGeometry(55, 64),
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uTime; varying vec2 vUv;
          void main() {
            vec3 col = mix(vec3(1.0, 0.25, 0.6), vec3(1.0, 0.85, 0.3), vUv.y);
            float band = fract(vUv.y * 11.0 + uTime * 0.15);
            float cut = vUv.y < 0.5 ? step(band, (0.5 - vUv.y) * 1.3) : 0.0;
            if (cut > 0.5) discard;
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }
        `,
        fog: false,
      }),
    );
    sun.position.set(-170, 55, -220);
    sun.lookAt(0, 30, 0);
    sun.userData.update = (dt, t) => {
      sun.material.uniforms.uTime.value = t;
    };
    group.add(sun);

    // ワイヤーフレームの山並み
    const ridgeGeo = new THREE.PlaneGeometry(700, 90, 70, 9);
    const rp = ridgeGeo.attributes.position;
    for (let i = 0; i < rp.count; i++) {
      const x = rp.getX(i);
      const y = rp.getY(i);
      const t = (y + 45) / 90;
      rp.setZ(i, t * (fbm(x * 0.02, 3) * 55 + 5) * (Math.abs(x) > 40 ? 1 : Math.abs(x) / 40));
    }
    const ridge = new THREE.Mesh(ridgeGeo, new THREE.MeshBasicMaterial({ color: '#ff3dd4', wireframe: true, transparent: true, opacity: 0.55 }));
    ridge.rotation.x = -Math.PI / 2;
    ridge.position.set(-60, -0.5, -200);
    ridge.rotation.z = 0.5;
    group.add(ridge);

    // 光る窓のビル群（左右）
    const r = rng(8);
    const winTex = pixelTexture(16, 32, (u, v) => {
      const on = (Math.floor(u * 16) % 3 !== 0) && (Math.floor(v * 32) % 3 !== 0) && Math.sin(u * 91 + v * 37) > 0.1;
      return on ? [255, 120 + Math.floor(u * 120), 230] : [20, 8, 40];
    });
    winTex.magFilter = THREE.NearestFilter;
    const buildingMat = new THREE.MeshBasicMaterial({ map: winTex, color: '#8f7ad6' });
    // 地平線ぐるりのスカイライン（近すぎて壁にならないよう遠くに低めに並べる）
    const count = 90;
    const buildings = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), buildingMat, count);
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + r() * 0.05;
      const d = 120 + r() * 70;
      const w = 6 + r() * 12;
      const h = 8 + Math.pow(r(), 2) * 38;
      m.compose(
        new THREE.Vector3(Math.cos(a) * d, h / 2, Math.sin(a) * d),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a),
        new THREE.Vector3(w, h, 6 + r() * 8),
      );
      buildings.setMatrixAt(i, m);
    }
    group.add(buildings);

    return {
      group,
      background: new THREE.Color('#07021a'),
      fog: new THREE.Fog(fogColor, 50, 260),
      lights: { hemi: ['#ff6ad5', '#1a0a3a', 0.9], sun: ['#7ae8ff', 1.6, [-6, 8, 6]] },
      exposure: 1.1,
      shadowOpacity: 0.35,
      grid: false,
      env: envScene('#07021a', '#ff3d8b', '#12062a'),
      envIntensity: 0.8,
    };
  },
};

// ================================================================ 雲の上の浮島

export const skyIsland = {
  id: 'skyIsland',
  label: '雲の上の浮島',
  icon: '☁️',
  preview: 'radial-gradient(ellipse at 50% 58%, #6fbf5a 0 14%, #7a5a3a 15% 20%, transparent 21%), linear-gradient(180deg, #4f94e0 0%, #b8d8f5 50%, #ffffff 70%, #dfe9f5 100%)',
  create() {
    const group = new THREE.Group();
    const { sky, sunDir } = makeSky({ elevation: 30, azimuth: 200, turbidity: 3, rayleigh: 1 });

    // 島（平らな上面が作業エリア、下は岩）
    const top = new THREE.Mesh(new THREE.CylinderGeometry(9, 8.6, 0.6, 48), new THREE.MeshStandardMaterial({ color: '#5fa04a', roughness: 1 }));
    top.position.y = -0.31;
    const rockGeo = new THREE.ConeGeometry(8.6, 11, 14, 4);
    const rp = rockGeo.attributes.position;
    const rr = rng(4);
    for (let i = 0; i < rp.count; i++) {
      if (rp.getY(i) < 5.4) {
        rp.setX(i, rp.getX(i) * (0.85 + rr() * 0.3));
        rp.setZ(i, rp.getZ(i) * (0.85 + rr() * 0.3));
      }
    }
    rockGeo.computeVertexNormals();
    const rock = new THREE.Mesh(rockGeo, new THREE.MeshStandardMaterial({ color: '#7a5a3e', roughness: 1, flatShading: true }));
    rock.rotation.x = Math.PI;
    rock.position.y = -6.1;
    const island = new THREE.Group();
    island.add(top, rock);
    group.add(island);
    // 木は作業エリアの奥側（-x, -z 寄り）にだけ置き、手前の視界をふさがない
    const trees = makeTrees({ count: 10, rMin: 6.2, rMax: 8.2, shape: 'round', leaf: '#4f9a42', scale: [0.45, 0.75], seed: 3 });
    const tm = new THREE.Matrix4();
    for (const mesh of trees.children) {
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, tm);
        const p = new THREE.Vector3().setFromMatrixPosition(tm);
        const a = Math.PI * (1.05 + (i / mesh.count) * 0.75);
        const d = Math.hypot(p.x, p.z);
        tm.setPosition(Math.cos(a) * d, p.y, Math.sin(a) * d);
        mesh.setMatrixAt(i, tm);
      }
    }
    group.add(trees);

    // 周りに浮かぶ小島
    const minis = new THREE.Group();
    const r = rng(19);
    for (let i = 0; i < 5; i++) {
      const mini = island.clone();
      const k = 0.15 + r() * 0.2;
      mini.scale.setScalar(k);
      const a = r() * Math.PI * 2;
      const d = 22 + r() * 25;
      mini.position.set(Math.cos(a) * d, -2 + r() * 10, Math.sin(a) * d);
      mini.userData.baseY = mini.position.y;
      mini.userData.phase = r() * 6;
      minis.add(mini);
    }
    minis.userData.update = (dt, t) => {
      for (const mi of minis.children) mi.position.y = mi.userData.baseY + Math.sin(t * 0.5 + mi.userData.phase) * 0.6;
    };
    group.add(minis);

    // 眼下に広がる雲海（流れるノイズのシェーダー）
    const fogColor = new THREE.Color('#dbe8f6');
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 900),
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uFog: { value: fogColor } },
        vertexShader: /* glsl */ `
          varying vec3 vWorld; varying float vDepth;
          void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform vec3 uFog; varying vec3 vWorld; varying float vDepth;
          ${GLSL_NOISE}
          void main() {
            vec2 p = vWorld.xz * 0.025 + vec2(uTime * 0.01, uTime * 0.004);
            float n = fbm(p + fbm(p * 1.7 + uTime * 0.005));
            vec3 col = mix(vec3(0.58, 0.68, 0.84), vec3(1.0), smoothstep(0.38, 0.62, n));
            col = mix(col, uFog, smoothstep(120.0, 420.0, vDepth));
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
      }),
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -9;
    sea.userData.update = (dt, t) => {
      sea.material.uniforms.uTime.value = t;
    };
    group.add(sea);
    group.add(makeClouds({ count: 30, area: 360, yMin: -8, yMax: -3, scaleMin: 25, scaleMax: 60, speed: 1.5, minRadius: 25 }));
    group.add(makeClouds({ count: 10, area: 400, yMin: 30, yMax: 60, speed: 2, seed: 9 }));

    return {
      group,
      // 島の外は足場がなく、雲の海へ落ちる
      groundAt: (x, z) => (Math.hypot(x, z) < 8.8 ? 0 : null),
      followers: [sky],
      background: null,
      fog: new THREE.Fog(fogColor, 90, 380),
      lights: { hemi: ['#e2f1ff', '#8aa0b8', 1.25], sun: ['#fff3dc', 2.5, [sunDir.x * 15, Math.max(sunDir.y, 0.4) * 15, sunDir.z * 15]] },
      exposure: 0.75,
      shadowOpacity: 0.3,
      grid: false,
      env: envScene('#4f94e0', '#dbe8f6', '#ffffff'),
      envIntensity: 0.6,
    };
  },
};

