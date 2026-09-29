import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/*
 * 世界の定義の形（各 create() が返すもの）
 * {
 *   group:         世界に置く物（エディタが worldRoot に入れる）
 *   background:    scene.background（空のメッシュで描く世界は null）
 *   fog:           scene.fog
 *   lights:        { hemi: [空の色, 地面の色, 強さ], sun: [色, 強さ, [x, y, z]（向き）] }
 *   exposure:      明るさ（トーンマッピングの露出）
 *   shadowOpacity: 影の濃さ（0 で影の受け皿を出さない）
 *   grid:          最初に作業用グリッドを出すか
 *   env:           環境マップ用のシーン（金属の映り込み）
 *   envIntensity:  環境マップの強さ
 *   followers:     カメラと一緒に動かす物（空・星など、近づけない遠景）
 * }
 * group 内で userData.update(dt, t, camera) を持つ物は毎フレーム呼ばれる。
 */

export const studio = {
  id: 'studio',
  label: '夜のスタジオ',
  icon: '🌙',
  preview: 'linear-gradient(180deg, #1e2027 0%, #2a2e38 60%, #3a4050 100%)',
  create() {
    return {
      group: new THREE.Group(),
      background: new THREE.Color('#1e2027'),
      fog: null,
      lights: { hemi: ['#ffffff', '#445066', 1.4], sun: ['#ffffff', 2.2, [5, 10, 6]] },
      exposure: 1,
      shadowOpacity: 0.25,
      grid: true,
      env: null,
    };
  },
};

export const booth = {
  id: 'booth',
  label: '撮影ブース',
  icon: '📷',
  preview: 'radial-gradient(circle at 50% 70%, #ffffff 0%, #e6e9ee 55%, #cfd4db 100%)',
  create() {
    const bg = '#e7eaee';
    const group = new THREE.Group();
    // 床が霧で背景色に溶け込み、継ぎ目のない白いホリゾントに見える
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(200, 64),
      new THREE.MeshStandardMaterial({ color: '#f3f4f6', roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    group.add(floor);
    const env = new RoomEnvironment();
    return {
      group,
      background: new THREE.Color(bg),
      fog: new THREE.Fog(bg, 14, 55),
      lights: { hemi: ['#ffffff', '#d5dae2', 1.5], sun: ['#ffffff', 1.7, [4, 10, 6]] },
      exposure: 1,
      shadowOpacity: 0.2,
      grid: false,
      env,
      envIntensity: 0.55,
    };
  },
};

export const blueprint = {
  id: 'blueprint',
  label: '設計図',
  icon: '📐',
  preview:
    'linear-gradient(#ffffff22 1px, transparent 1px) 0 0 / 12px 12px, linear-gradient(90deg, #ffffff22 1px, transparent 1px) 0 0 / 12px 12px, #1b4a8c',
  create() {
    const bg = '#1b4a8c';
    const group = new THREE.Group();
    // 方眼はシェーダーで描く（線の描画より遠近で途切れにくく、どの端末でもなめらか）
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600),
      new THREE.ShaderMaterial({
        uniforms: {
          uBase: { value: new THREE.Color(bg) },
          uMinor: { value: new THREE.Color('#5a8bd1') },
          uMajor: { value: new THREE.Color('#b6d2f7') },
          uAxis: { value: new THREE.Color('#ffffff') },
        },
        vertexShader: /* glsl */ `
          varying vec3 vWorld; varying float vDepth;
          void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uBase; uniform vec3 uMinor; uniform vec3 uMajor; uniform vec3 uAxis;
          varying vec3 vWorld; varying float vDepth;
          float lines(vec2 p, float width) {
            vec2 g = abs(fract(p - 0.5) - 0.5) / (fwidth(p) * width);
            return 1.0 - min(min(g.x, g.y), 1.0);
          }
          void main() {
            vec2 p = vWorld.xz;
            float fade = 1.0 - smoothstep(25.0, 80.0, vDepth);
            vec3 col = uBase;
            col = mix(col, uMinor, lines(p * 4.0, 1.0) * 0.45 * fade);
            col = mix(col, uMajor, lines(p, 1.3) * 0.75 * fade);
            vec2 a = abs(p) / (fwidth(p) * 1.8);
            col = mix(col, uAxis, (1.0 - min(min(a.x, a.y), 1.0)) * fade);
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }
        `,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    group.add(floor);
    return {
      group,
      background: new THREE.Color(bg),
      fog: new THREE.Fog(bg, 30, 90),
      lights: { hemi: ['#ffffff', '#6d8fc4', 1.5], sun: ['#ffffff', 1.8, [5, 10, 6]] },
      exposure: 1,
      shadowOpacity: 0.3,
      grid: false,
      env: new RoomEnvironment(),
      envIntensity: 0.3,
    };
  },
};
