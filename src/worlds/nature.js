import * as THREE from 'three';
import {
  GLSL_NOISE,
  awayFromCenter,
  envScene,
  fbm,
  makeClouds,
  makeDome,
  makeParticles,
  makeSky,
  makeTerrain,
  makeTrees,
  noise2,
  rng,
  smoothstep,
} from './common.js';

const sunPosition = (dir, dist = 15) => [dir.x * dist, dir.y * dist, dir.z * dist];

// ================================================================ 草原と青空

export const meadow = {
  id: 'meadow',
  label: '草原と青空',
  icon: '🌳',
  preview: 'linear-gradient(180deg, #5b9be0 0%, #a9d0f5 55%, #7cb35a 56%, #4f8a3a 100%)',
  create() {
    const group = new THREE.Group();
    const { sky, sunDir } = makeSky({ elevation: 42, azimuth: 150, turbidity: 5, rayleigh: 1.2 });

    // 遠くほどなだらかな丘になる草原
    const hill = (x, z) => awayFromCenter(x, z, 18, 90) * (fbm(x * 0.012, z * 0.012) * 18 - 5);
    const ground = makeTerrain({
      height: hill,
      color: (x, z) => {
        const n = fbm(x * 0.08, z * 0.08);
        const m = fbm(x * 0.01 + 7, z * 0.01);
        return [0.28 + n * 0.12 + m * 0.08, 0.5 + n * 0.14, 0.2 + n * 0.06];
      },
    });
    group.add(ground);
    group.add(makeTrees({ count: 140, rMin: 22, rMax: 150, shape: 'round', leaf: '#4c8f3d', heightAt: hill, scale: [1, 2.2] }));

    // 足元の花
    const r = rng(33);
    const flowerColors = ['#ffffff', '#ffd43b', '#ff8fab', '#b197fc'];
    const flowers = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.06, 6, 4),
      new THREE.MeshStandardMaterial({ roughness: 0.6 }),
      500,
    );
    const m = new THREE.Matrix4();
    for (let i = 0; i < 500; i++) {
      const a = r() * Math.PI * 2;
      const d = 3 + Math.sqrt(r()) * 30;
      m.makeTranslation(Math.cos(a) * d, 0.04, Math.sin(a) * d);
      flowers.setMatrixAt(i, m);
      flowers.setColorAt(i, new THREE.Color(flowerColors[i % flowerColors.length]));
    }
    group.add(flowers);
    group.add(makeClouds({ count: 22, yMin: 45, yMax: 80, speed: 2 }));

    return {
      group,
      followers: [sky],
      background: null,
      fog: new THREE.Fog('#c3dcf1', 70, 260),
      lights: { hemi: ['#cfe6ff', '#5f7f3c', 1.25], sun: ['#fff4dc', 2.6, sunPosition(sunDir)] },
      exposure: 0.75,
      shadowOpacity: 0.3,
      grid: false,
      env: envScene('#5e9be0', '#dcebf7', '#5f7f3c'),
      envIntensity: 0.6,
    };
  },
};

// ================================================================ 夕焼けの海辺

export const seaside = {
  id: 'seaside',
  label: '夕焼けの海辺',
  icon: '🌅',
  preview: 'linear-gradient(180deg, #3b3a6b 0%, #f07a4a 45%, #ffcf7a 55%, #2a4a73 56%, #e5c49a 100%)',
  create() {
    const group = new THREE.Group();
    const { sky, sunDir } = makeSky({ elevation: 3, azimuth: 180, turbidity: 10, rayleigh: 3, mie: 0.006, mieG: 0.85 });

    // 砂浜（奥＝ -z に向かって海へ下っていく）
    const beach = makeTerrain({
      height: (x, z) => {
        const slope = smoothstep(-6, -22, z) * -2.2;
        const dunes = awayFromCenter(x, z, 14, 60) * (z > 0 ? fbm(x * 0.05, z * 0.05) * 2 : 0);
        return slope + dunes;
      },
      color: (x, z) => {
        const n = fbm(x * 0.2, z * 0.2);
        const wet = smoothstep(-10, -18, z);
        return [0.86 - wet * 0.3 + n * 0.06, 0.73 - wet * 0.28 + n * 0.05, 0.55 - wet * 0.18 + n * 0.04];
      },
    });
    group.add(beach);

    // 海（波打つ水面。自前のシェーダーで波・きらめき・霧を描く）
    const fogColor = new THREE.Color('#f1a26b');
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(700, 400, 160, 90),
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uSunDir: { value: sunDir.clone() },
          uDeep: { value: new THREE.Color('#1d3150') },
          uSky: { value: new THREE.Color('#f39a64') },
          uSunColor: { value: new THREE.Color('#ffd6a0') },
          uFogColor: { value: fogColor },
          uFogNear: { value: 80 },
          uFogFar: { value: 320 },
        },
        vertexShader: /* glsl */ `
          uniform float uTime; varying vec3 vWorld; varying float vDepth;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            w.y += sin(w.x * 0.35 + uTime * 1.1) * 0.08 + sin(w.z * 0.55 - uTime * 1.5) * 0.07 + sin((w.x + w.z) * 0.9 + uTime * 2.2) * 0.03;
            vWorld = w.xyz;
            vec4 mv = viewMatrix * w;
            vDepth = -mv.z;
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform vec3 uSunDir; uniform vec3 uDeep; uniform vec3 uSky; uniform vec3 uSunColor;
          uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;
          varying vec3 vWorld; varying float vDepth;
          void main() {
            vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
            if (n.y < 0.0) n = -n;
            n.xz += vec2(sin(vWorld.x * 2.7 + uTime * 2.9), cos(vWorld.z * 3.1 - uTime * 2.3)) * 0.06;
            n = normalize(n);
            vec3 view = normalize(cameraPosition - vWorld);
            float fres = pow(1.0 - max(dot(n, view), 0.0), 3.0);
            vec3 col = mix(uDeep, uSky, 0.15 + fres * 0.75);
            float spec = pow(max(dot(reflect(-uSunDir, n), view), 0.0), 90.0);
            col += uSunColor * spec * 2.0;
            col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, vDepth));
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
      }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -1.1, -212);
    water.userData.update = (dt, t) => {
      water.material.uniforms.uTime.value = t;
    };
    group.add(water);

    // ヤシの木
    const palm = (x, z, lean) => {
      const tree = new THREE.Group();
      const trunkMat = new THREE.MeshStandardMaterial({ color: '#8a6440', roughness: 1 });
      for (let i = 0; i < 7; i++) {
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.16 - i * 0.01, 0.2 - i * 0.01, 0.9, 8), trunkMat);
        seg.position.set(Math.sin(i * 0.25) * lean * i * 0.25, 0.45 + i * 0.85, 0);
        seg.rotation.z = -lean * 0.25 * i * 0.1;
        tree.add(seg);
      }
      const top = new THREE.Vector3(Math.sin(1.5) * lean * 1.5, 6.3, 0);
      const leafMat = new THREE.MeshStandardMaterial({ color: '#2f6b3a', roughness: 0.9, side: THREE.DoubleSide, flatShading: true });
      for (let i = 0; i < 7; i++) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.35, 3, 4, 1, true), leafMat);
        leaf.geometry.translate(0, 1.5, 0);
        leaf.position.copy(top);
        leaf.rotation.set(1.9, (i / 7) * Math.PI * 2, 0, 'YXZ');
        leaf.scale.set(1, 1, 0.25);
        tree.add(leaf);
      }
      tree.position.set(x, 0, z);
      return tree;
    };
    group.add(palm(-9, -2, 1), palm(11, 3, -0.8), palm(-15, 6, 0.6));
    group.add(makeClouds({ count: 16, yMin: 25, yMax: 45, color: '#ffb58a', opacity: 0.6, speed: 1, minRadius: 80 }));

    return {
      group,
      followers: [sky],
      background: null,
      fog: new THREE.Fog(fogColor, 80, 320),
      lights: { hemi: ['#ffc49a', '#4a3a55', 1.0], sun: ['#ffb77a', 2.6, sunPosition(new THREE.Vector3(0.2, 0.45, -1).normalize())] },
      exposure: 0.8,
      shadowOpacity: 0.3,
      grid: false,
      env: envScene('#443d70', '#f39a64', '#d9b88f'),
      envIntensity: 0.7,
    };
  },
};

// ================================================================ 雪原

export const snowfield = {
  id: 'snowfield',
  label: '雪原',
  icon: '❄️',
  preview: 'linear-gradient(180deg, #aebdcf 0%, #dfe6ee 55%, #f6f8fb 56%, #e6ecf3 100%)',
  create() {
    const group = new THREE.Group();
    const bg = '#d4dce6';
    group.add(makeDome({ top: '#9fb1c7', horizon: '#dde4ec', bottom: '#eef2f6' }));
    const hill = (x, z) => awayFromCenter(x, z, 16, 80) * fbm(x * 0.015, z * 0.015) * 14;
    group.add(
      makeTerrain({
        height: hill,
        color: (x, z) => {
          const n = fbm(x * 0.1, z * 0.1);
          return [0.93 + n * 0.05, 0.95 + n * 0.04, 0.98];
        },
        roughness: 0.9,
      }),
    );
    group.add(makeTrees({ count: 110, rMin: 18, rMax: 130, shape: 'cone', leaf: '#56745f', variation: 0.1, heightAt: hill, scale: [1, 2] }));
    // 木に積もった雪
    group.add(
      makeTrees({ count: 110, rMin: 18, rMax: 130, shape: 'cone', leaf: '#f4f7fb', variation: 0.02, heightAt: (x, z) => hill(x, z) + 0.9, scale: [0.6, 1.2] }),
    );
    group.add(makeParticles({ count: 2500, area: [70, 30, 70], color: '#ffffff', size: 0.12, speed: 1.2, direction: -1, sway: 0.6 }));
    return {
      group,
      background: new THREE.Color(bg),
      fog: new THREE.FogExp2(bg, 0.016),
      lights: { hemi: ['#eef4ff', '#b7c3d3', 1.5], sun: ['#ffffff', 1.3, [3, 10, 4]] },
      exposure: 1,
      shadowOpacity: 0.18,
      grid: false,
      env: envScene('#b6c4d6', '#eef2f6', '#ffffff'),
      envIntensity: 0.7,
    };
  },
};

// ================================================================ 砂漠

export const desert = {
  id: 'desert',
  label: '砂漠',
  icon: '🏜️',
  preview: 'linear-gradient(180deg, #7fb2e5 0%, #d8e6f2 50%, #e8c186 51%, #c98f4f 100%)',
  create() {
    const group = new THREE.Group();
    const { sky, sunDir } = makeSky({ elevation: 58, azimuth: 120, turbidity: 2.2, rayleigh: 0.7 });
    // 風紋のある砂丘
    const dune = (x, z) => {
      const ridges = Math.sin(x * 0.05 + fbm(x * 0.01, z * 0.01) * 6) * 0.5 + 0.5;
      return awayFromCenter(x, z, 12, 55) * (ridges * 7 + fbm(x * 0.02, z * 0.02) * 6);
    };
    group.add(
      makeTerrain({
        height: dune,
        segments: 180,
        color: (x, z, y) => {
          const ripple = Math.sin(x * 1.3 + z * 0.4 + noise2(x * 0.3, z * 0.3) * 3) * 0.02;
          const t = Math.min(1, y / 12);
          return [0.9 - t * 0.08 + ripple, 0.74 - t * 0.12 + ripple, 0.5 - t * 0.12 + ripple];
        },
      }),
    );

    // サボテンと岩
    const r = rng(44);
    const cactusMat = new THREE.MeshStandardMaterial({ color: '#4f8a4a', roughness: 0.8 });
    const rockMat = new THREE.MeshStandardMaterial({ color: '#a8744a', roughness: 1, flatShading: true });
    for (let i = 0; i < 14; i++) {
      const a = r() * Math.PI * 2;
      const d = 9 + r() * 35;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const cactus = new THREE.Group();
      const h = 1.6 + r() * 2;
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, h, 4, 10), cactusMat);
      body.position.y = h / 2 + 0.2;
      cactus.add(body);
      for (const side of [-1, 1]) {
        if (r() < 0.3) continue;
        const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.7, 4, 8), cactusMat);
        arm.position.set(side * 0.5, h * (0.45 + r() * 0.3), 0);
        const elbow = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.35, 4, 8), cactusMat);
        elbow.rotation.z = Math.PI / 2;
        elbow.position.set(side * 0.28, arm.position.y - 0.4, 0);
        cactus.add(arm, elbow);
      }
      cactus.position.set(x, dune(x, z), z);
      cactus.rotation.y = r() * Math.PI;
      group.add(cactus);
    }
    for (let i = 0; i < 18; i++) {
      const a = r() * Math.PI * 2;
      const d = 7 + r() * 40;
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4 + r() * 1.2, 0), rockMat);
      rock.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
      rock.position.y = dune(rock.position.x, rock.position.z);
      rock.scale.y = 0.5 + r() * 0.5;
      rock.rotation.set(r(), r(), r());
      group.add(rock);
    }

    return {
      group,
      followers: [sky],
      background: null,
      fog: new THREE.Fog('#ead3ae', 90, 330),
      lights: { hemi: ['#fff2da', '#c49a62', 1.1], sun: ['#fff0cf', 3.2, sunPosition(sunDir)] },
      exposure: 0.65,
      shadowOpacity: 0.4,
      grid: false,
      env: envScene('#7fb2e5', '#f0e2c8', '#c98f4f'),
      envIntensity: 0.6,
    };
  },
};

// ================================================================ 森の中

export const forest = {
  id: 'forest',
  label: '森の中',
  icon: '🌲',
  preview: 'linear-gradient(180deg, #2d4d3a 0%, #6f9a74 40%, #9ec48f 50%, #3c5a2e 51%, #24361c 100%)',
  create() {
    const group = new THREE.Group();
    const fogColor = '#7f9f86';
    group.add(makeDome({ top: '#9fc6a8', horizon: fogColor, bottom: '#3a4a32' }));
    group.add(
      makeTerrain({
        height: (x, z) => awayFromCenter(x, z, 14, 60) * fbm(x * 0.03, z * 0.03) * 5,
        color: (x, z) => {
          const n = fbm(x * 0.15, z * 0.15);
          const moss = fbm(x * 0.05 + 3, z * 0.05);
          return [0.22 + n * 0.1, 0.3 + moss * 0.18, 0.14 + n * 0.05];
        },
      }),
    );
    const height = (x, z) => awayFromCenter(x, z, 14, 60) * fbm(x * 0.03, z * 0.03) * 5;
    group.add(makeTrees({ count: 160, rMin: 9, rMax: 70, shape: 'cone', leaf: '#2f5a33', scale: [1.4, 2.8], heightAt: height, seed: 5 }));
    group.add(makeTrees({ count: 90, rMin: 12, rMax: 70, shape: 'round', leaf: '#3f7a3a', scale: [1.2, 2.2], heightAt: height, seed: 9 }));

    // 木漏れ日の光の筋
    const r = rng(12);
    const shaftMat = new THREE.MeshBasicMaterial({
      color: '#fff1b8',
      transparent: true,
      opacity: 0.07,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const shafts = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.7 + r() * 0.8, 30, 16, 1, true), shaftMat.clone());
      const a = r() * Math.PI * 2;
      const d = 5 + r() * 14;
      shaft.position.set(Math.cos(a) * d, 13, Math.sin(a) * d);
      shaft.rotation.set(0.25, 0, -0.3);
      shaft.userData.phase = r() * 6;
      shafts.add(shaft);
    }
    shafts.userData.update = (dt, t) => {
      for (const s of shafts.children) s.material.opacity = 0.035 + Math.sin(t * 0.5 + s.userData.phase) * 0.02;
    };
    group.add(shafts);
    // 漂う光の粒
    group.add(makeParticles({ count: 300, area: [30, 8, 30], color: '#fff5c0', size: 0.08, speed: 0.1, direction: 1, sway: 0.3, additive: true, opacity: 0.8 }));

    return {
      group,
      background: new THREE.Color(fogColor),
      fog: new THREE.Fog(fogColor, 14, 75),
      lights: { hemi: ['#c8ebc8', '#2e3a24', 1.0], sun: ['#ffe8ad', 2.2, [6, 14, 3]] },
      exposure: 0.95,
      shadowOpacity: 0.35,
      grid: false,
      env: envScene('#9fc6a8', '#7f9f86', '#2e3a24'),
      envIntensity: 0.6,
    };
  },
};

// ================================================================ 水中

export const underwater = {
  id: 'underwater',
  label: '水中',
  icon: '🐠',
  preview: 'linear-gradient(180deg, #5ec8e8 0%, #1a7fae 45%, #0b4a6e 75%, #c2ab80 100%)',
  create() {
    const group = new THREE.Group();
    const fogColor = '#0e5a80';
    group.add(makeDome({ top: '#5fcdec', horizon: fogColor, bottom: '#062a42', exponent: 0.8 }));
    const floor = (x, z) => awayFromCenter(x, z, 12, 50) * fbm(x * 0.04, z * 0.04) * 6;
    group.add(
      makeTerrain({
        size: 300,
        height: floor,
        color: (x, z) => {
          const n = fbm(x * 0.2, z * 0.2);
          return [0.78 + n * 0.08, 0.7 + n * 0.07, 0.52 + n * 0.05];
        },
      }),
    );

    // 床に揺らめく光（コースティクス）
    const caustics = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 90),
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime; varying vec3 vWorld;
          float caustic(vec2 uv, float t) {
            vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
            vec2 i = p; float c = 1.0; float inten = 0.005;
            for (int n = 0; n < 4; n++) {
              float tt = t * (1.0 - (3.5 / float(n + 1)));
              i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
              c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
            }
            c /= 4.0; c = 1.17 - pow(c, 1.4);
            return pow(abs(c), 8.0);
          }
          void main() {
            float c = caustic(vWorld.xz * 0.07, uTime * 0.5);
            float fade = 1.0 - smoothstep(15.0, 42.0, length(vWorld.xz));
            gl_FragColor = vec4(vec3(0.55, 0.9, 1.0) * c * 0.45 * fade, 1.0);
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    caustics.rotation.x = -Math.PI / 2;
    caustics.position.y = 0.02;
    caustics.userData.update = (dt, t) => {
      caustics.material.uniforms.uTime.value = t;
    };
    group.add(caustics);

    // 岩・海藻・サンゴ
    const r = rng(77);
    const rockMat = new THREE.MeshStandardMaterial({ color: '#5d6b73', roughness: 1, flatShading: true });
    const weedMat = new THREE.MeshStandardMaterial({ color: '#2f8a5a', roughness: 0.7, side: THREE.DoubleSide });
    const coralColors = ['#ff7b8a', '#ffb14e', '#c77dff', '#ff9f6b'];
    const weeds = new THREE.Group();
    for (let i = 0; i < 40; i++) {
      const a = r() * Math.PI * 2;
      const d = 6 + r() * 30;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const y = floor(x, z);
      if (i < 12) {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6 + r() * 1.6, 0), rockMat);
        rock.position.set(x, y + 0.2, z);
        rock.scale.y = 0.6;
        rock.rotation.set(r(), r(), r());
        group.add(rock);
      } else if (i < 30) {
        const h = 1.5 + r() * 3;
        const geo = new THREE.PlaneGeometry(0.22, h, 1, 8);
        geo.translate(0, h / 2, 0);
        // 先へいくほど細く、少しうねらせる
        const gp = geo.attributes.position;
        for (let k = 0; k < gp.count; k++) {
          const t = gp.getY(k) / h;
          gp.setX(k, gp.getX(k) * (1 - t * 0.75) + Math.sin(t * 5) * 0.08);
        }
        geo.computeVertexNormals();
        const weed = new THREE.Mesh(geo, weedMat);
        weed.position.set(x, y, z);
        weed.rotation.y = r() * Math.PI;
        weed.userData.phase = r() * 6;
        weeds.add(weed);
      } else {
        const coral = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.4 + r() * 0.5, 1),
          new THREE.MeshStandardMaterial({ color: coralColors[i % coralColors.length], roughness: 0.6, flatShading: true }),
        );
        coral.position.set(x, y + 0.3, z);
        coral.scale.set(1, 0.7 + r() * 0.8, 1);
        group.add(coral);
      }
    }
    weeds.userData.update = (dt, t) => {
      for (const w of weeds.children) w.rotation.z = Math.sin(t * 1.2 + w.userData.phase) * 0.18;
    };
    group.add(weeds);
    // 昇っていく泡
    group.add(makeParticles({ count: 350, area: [40, 20, 40], color: '#d8f6ff', size: 0.12, speed: 1.4, direction: 1, sway: 0.3, opacity: 0.7 }));

    return {
      group,
      background: new THREE.Color(fogColor),
      fog: new THREE.FogExp2(fogColor, 0.04),
      lights: { hemi: ['#86dcff', '#0a2e45', 1.2], sun: ['#c6f3ff', 1.6, [1, 20, 2]] },
      exposure: 1.05,
      shadowOpacity: 0.25,
      grid: false,
      env: envScene('#5fcdec', '#0e5a80', '#062a42'),
      envIntensity: 0.7,
    };
  },
};

