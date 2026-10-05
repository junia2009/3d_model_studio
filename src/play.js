import * as THREE from 'three';
import { clone as cloneWithBones } from 'three/addons/utils/SkeletonUtils.js';
import { assetAnimations } from './assets.js';

/**
 * 遊ぶモード：作ったモデルを操作して世界を歩き回る。
 *
 * 作ったモデルには骨がないので、部品ごとの「役割」（足・腕・頭…）から簡易的な関節を自動で作る。
 * - 役割は部品に付けたもの（userData.role）→ 名前からの推測 → 親の役割 の順で決まる
 * - 同じ役割で触れ合っている部品はひとかたまり（例：太もも＋足先）として一緒に動く
 * - 左右・前後は位置から判定し、関節の位置は役割ごとに決める（足・腕は上端、頭は下端など）
 * 元のモデルは変えず、複製（アバター）を動かす。
 *
 * 取り込んだモデル（GLB など）はひとかたまりとして扱う。中にアニメーションがあれば、
 * 名前（Idle / Walk / Run / Jump など）から選んで、速さに合わせて切り替えながら再生する。
 */

export const ROLE_OPTIONS = [
  ['', '自動'],
  ['body', '体（動かさない）'],
  ['leg', '足'],
  ['arm', '腕'],
  ['head', '頭'],
  ['tail', 'しっぽ'],
  ['wing', '羽'],
  ['wheel', '車輪'],
];

export const ROLE_LABELS = Object.fromEntries(ROLE_OPTIONS);

const ROLE_PATTERNS = [
  ['wheel', /(タイヤ|車輪|ホイール|wheel|tire|tyre)/i],
  ['wing', /(羽|翼|はね|つばさ|wing)/i],
  ['tail', /(しっぽ|尻尾|尾|tail)/i],
  ['head', /(頭|あたま|head)/i],
  ['arm', /(腕|手|うで|arm|hand)/i],
  ['leg', /(足|脚|あし|leg|foot|feet)/i],
];

/** 名前から役割を推測する（当てはまらなければ null） */
export function guessRole(name = '') {
  for (const [role, re] of ROLE_PATTERNS) if (re.test(name)) return role;
  return null;
}

/** その部品の役割：自分に付けた役割 → 名前からの推測 → 親の役割 → 体 */
export function resolveRole(obj, stopAt = null) {
  for (let o = obj; o && o !== stopAt; o = o.parent) {
    // 取り込んだモデルの中身（スタジオの部品ではない）の名前は見ない
    if (!o.userData?.kind) continue;
    const role = o.userData?.role || guessRole(o.name);
    if (role) return role;
  }
  return 'body';
}

const UP = new THREE.Vector3(0, 1, 0);

const CLIP_PATTERNS = {
  idle: /(idle|stand|breath|wait|rest|survey|look|待機|立)/i,
  walk: /(walk|歩)/i,
  run: /(run|sprint|jog|gallop|走)/i,
  jump: /(jump|leap|hop|跳|ジャンプ)/i,
};

/** アニメーションの名前から、待機・歩く・走る・跳ぶ に使うものを選ぶ */
export function pickClips(clips) {
  const found = {};
  for (const [key, re] of Object.entries(CLIP_PATTERNS)) found[key] = clips.find((c) => re.test(c.name)) ?? null;
  // 名前で分からないときは、最初のアニメーションを「歩く」に使う
  if (!found.walk && !found.run) found.walk = clips.find((c) => c !== found.idle && c !== found.jump) ?? null;
  return found;
}
const damp = (current, target, lambda, dt) => THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));

function angleDelta(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class Player {
  /**
   * @param {import('./editor.js').Editor} editor
   * @param {{ onStop?: () => void, toast?: (msg: string) => void }} hooks
   */
  constructor(editor, hooks = {}) {
    this.editor = editor;
    this.hooks = hooks;
    this.active = false;
    this.keys = new Set();
    this.stick = { x: 0, y: 0 };
    this.runToggle = false;
    this.jumpQueued = false;
    this.raycaster = new THREE.Raycaster();
    this._onKeyDown = (e) => this._key(e, true);
    this._onKeyUp = (e) => this._key(e, false);
    this._onBlur = () => this.keys.clear();
    this._frame = (dt) => this.update(dt);
    // 指やマウスでカメラを回している間（と離した直後）は、カメラを自動で後ろへ回さない
    this.camHold = 0;
    this._onOrbitStart = () => (this.dragging = true);
    this._onOrbitEnd = () => {
      this.dragging = false;
      this.camHold = 1.2;
    };
  }

  // ================================================================ 開始・終了

  /** 遊び始める。動かせる物がなければ false */
  start() {
    const ed = this.editor;
    // 一番上のグループ（または部品）を 1 つだけ選んでいればそれを、そうでなければモデル全体を動かす
    const top = ed.selected.length === 1 && ed.selected[0].parent === ed.modelRoot ? ed.selected[0] : null;
    this.sources = top ? [top] : ed.modelRoot.children.filter((o) => o.visible && o.userData.kind);
    if (!this.sources.length) return false;

    ed.select([]);
    ed.setMultiSelect(false);
    ed.transform.detach();
    ed.playing = true;
    this.saved = {
      camera: ed.camera.position.clone(),
      target: ed.orbit.target.clone(),
      enablePan: ed.orbit.enablePan,
      sun: ed.sun.position.clone(),
      sunTarget: ed.sun.target.position.clone(),
      shadow: ed.shadowPlane.position.clone(),
      visible: this.sources.map((s) => s.visible),
    };

    this._buildAvatar();
    for (const s of this.sources) s.visible = false;
    // 動かさない部品は、乗ったりぶつかったりできる「置物」になる
    this.scenery = [];
    for (const o of ed.modelRoot.children) {
      if (this.sources.includes(o) || !o.visible) continue;
      o.traverse((c) => c.isMesh && this.scenery.push(c));
    }

    // 状態
    const s = this.state;
    s.spawn = s.pos.clone();
    const g = this._groundAt(s.pos.x, s.pos.z, s.pos.y + this.stepHeight);
    if (g !== null) s.pos.y = g;

    // カメラを後ろ斜め上へ
    ed.orbit.enablePan = false;
    const target = s.pos.clone().add(new THREE.Vector3(0, this.height * 0.6, 0));
    const dist = Math.max(4, this.height * 3.2);
    const back = new THREE.Vector3(Math.sin(s.heading), 0, Math.cos(s.heading)).multiplyScalar(-dist);
    ed.orbit.target.copy(target);
    ed.camera.position.copy(target).add(back).add(new THREE.Vector3(0, dist * 0.45, 0));
    if (!ed.sun.target.parent) ed.scene.add(ed.sun.target);
    this.sunDir = this.saved.sun.clone().sub(this.saved.sunTarget).normalize();

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    ed.orbit.addEventListener('start', this._onOrbitStart);
    ed.orbit.addEventListener('end', this._onOrbitEnd);
    this.dragging = false;
    this.camHold = 0;
    // 「遊ぶ」ボタンにフォーカスが残ると、スペースキーでボタンが押されてしまう
    document.activeElement?.blur?.();
    ed.addFrameCallback(this._frame);
    this.active = true;
    ed.dispatchEvent(new Event('play'));
    return true;
  }

  stop() {
    if (!this.active) return;
    const ed = this.editor;
    this.active = false;
    ed.removeFrameCallback(this._frame);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    ed.orbit.removeEventListener('start', this._onOrbitStart);
    ed.orbit.removeEventListener('end', this._onOrbitEnd);
    this.keys.clear();
    this.stick = { x: 0, y: 0 };

    // 複製は形と色を元の部品と共有しているので、外すだけで破棄しない
    ed.scene.remove(this.root);
    this.sources.forEach((s, i) => (s.visible = this.saved.visible[i]));
    ed.camera.position.copy(this.saved.camera);
    ed.orbit.target.copy(this.saved.target);
    ed.orbit.enablePan = this.saved.enablePan;
    ed.sun.position.copy(this.saved.sun);
    ed.sun.target.position.copy(this.saved.sunTarget);
    ed.shadowPlane.position.copy(this.saved.shadow);
    ed.playing = false;
    ed.dispatchEvent(new Event('play'));
    this.hooks.onStop?.();
  }

  /** モデルの正面を 90° 回す（正面が手前でないモデル用） */
  turnFacing() {
    const ed = this.editor;
    ed.playSettings.facing = (((ed.playSettings.facing ?? 0) + Math.PI / 2) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    ed.dispatchEvent(new Event('change'));
    if (!this.active) return;
    // 作り直して、今いる場所・向きで続ける
    const { pos, heading } = this.state;
    const spawn = this.state.spawn;
    this.editor.scene.remove(this.root);
    this._buildAvatar();
    this.state.pos.copy(pos);
    this.state.heading = heading;
    this.state.spawn = spawn;
  }

  // ================================================================ アバター（動かす複製）

  _buildAvatar() {
    const ed = this.editor;
    const facing = ed.playSettings.facing ?? 0;
    // モデルの座標での「前・右・左右の軸」
    const F = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
    const R = new THREE.Vector3(-Math.cos(facing), 0, Math.sin(facing));
    const A = R.clone().negate(); // 足を前後に振る回転軸
    this.axes = { F, R, A };

    ed.modelRoot.updateMatrixWorld(true);
    const content = new THREE.Group();
    for (const s of this.sources) {
      // 骨のある取り込みモデルも正しく複製できるように SkeletonUtils を使う
      const c = cloneWithBones(s);
      c.visible = true;
      content.add(c);
    }
    content.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(content);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    this.height = Math.max(size.y, 0.3);
    this.radius = Math.max(size.x, size.z) * 0.4;
    this.stepHeight = Math.max(0.2, this.height * 0.3);

    // ---- 役割ごとに部品をまとめる
    const items = [];
    const collect = (o) => {
      // 取り込んだモデルは中身をばらさず、まるごと 1 つとして動かす
      if (o.isMesh || o.userData.kind === 'model') {
        items.push({ mesh: o, role: resolveRole(o, content), box: new THREE.Box3().setFromObject(o) });
        if (o.userData.kind === 'model') return;
      }
      for (const c of o.children) collect(c);
    };
    collect(content);
    const bodyBox = new THREE.Box3();
    items.filter((i) => i.role === 'body').forEach((i) => bodyBox.union(i.box));
    if (bodyBox.isEmpty()) bodyBox.copy(box);
    const bodyCenter = bodyBox.getCenter(new THREE.Vector3());

    const units = [];
    const pad = size.length() * 0.01;
    // 左右は「同じ役割の部品たちの真ん中」から見て決める
    // （体を基準にすると、木などほかの部品も一緒に動かすときに中心がずれて左右を取り違える）
    const roleCenter = (role) => {
      const b = new THREE.Box3();
      items.filter((i) => i.role === role).forEach((i) => b.union(i.box));
      return b.isEmpty() ? bodyCenter : b.getCenter(new THREE.Vector3());
    };
    for (const role of ['leg', 'arm', 'head', 'tail', 'wing', 'wheel']) {
      const list = items.filter((i) => i.role === role);
      // 触れ合っている部品同士を 1 つのかたまりにする（union-find）
      const parent = list.map((_, i) => i);
      const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          if (list[i].box.clone().expandByScalar(pad).intersectsBox(list[j].box.clone().expandByScalar(pad))) parent[find(i)] = find(j);
        }
      }
      const clusters = new Map();
      list.forEach((item, i) => {
        const k = find(i);
        if (!clusters.has(k)) clusters.set(k, []);
        clusters.get(k).push(item);
      });
      for (const members of clusters.values()) {
        const b = new THREE.Box3();
        members.forEach((m) => b.union(m.box));
        const c = b.getCenter(new THREE.Vector3());
        const rel = c.clone().sub(bodyCenter);
        const sideRel = c.clone().sub(roleCenter(role));
        let point;
        if (role === 'leg' || role === 'arm') point = new THREE.Vector3(c.x, b.max.y, c.z);
        else if (role === 'head') point = new THREE.Vector3(c.x, b.min.y, c.z);
        else if (role === 'tail') point = b.clampPoint(bodyCenter, new THREE.Vector3());
        else if (role === 'wing') point = b.clampPoint(bodyCenter, new THREE.Vector3()).setY(c.y);
        else point = c;
        const pivot = new THREE.Object3D();
        pivot.position.copy(point);
        content.add(pivot);
        pivot.updateMatrixWorld(true);
        members.forEach((m) => pivot.attach(m.mesh));
        units.push({
          role,
          pivot,
          side: sideRel.dot(R) > 0 ? 'R' : 'L',
          forward: rel.dot(F),
          radius: Math.max(0.05, Math.min(size.y, (b.max.y - b.min.y) / 2)),
          length: b.max.y - b.min.y,
          phase: 0,
        });
      }
    }
    // 歩く調子：左右の足は逆、腕は同じ側の足と逆。4 本足なら後ろ足をずらして対角が揃うように
    const legs = units.filter((u) => u.role === 'leg');
    const median = legs.map((l) => l.forward).sort((a, b) => a - b)[Math.floor(legs.length / 2)] ?? 0;
    for (const u of units) {
      if (u.role === 'leg') u.phase = (u.side === 'L' ? 0 : Math.PI) + (legs.length >= 3 && u.forward < median ? Math.PI : 0);
      if (u.role === 'arm') u.phase = u.side === 'L' ? Math.PI : 0;
    }
    this.units = units;
    this._setupClips(content);
    this.hasLegs = legs.length > 0;
    this.hasWheels = units.some((u) => u.role === 'wheel');
    this.legLength = Math.max(this.height * 0.25, ...legs.map((l) => l.pivot.position.y - box.min.y));

    // ---- 階層：root（地面の位置と進む向き）→ inner（モデルの正面を前へ）→ pose（弾み・傾き）→ content
    const root = new THREE.Group();
    const inner = new THREE.Group();
    const pose = new THREE.Group();
    inner.rotation.y = -facing;
    content.position.set(-center.x, -box.min.y, -center.z);
    root.add(inner);
    inner.add(pose);
    pose.add(content);
    root.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    ed.scene.add(root);
    this.root = root;
    this.pose = pose;

    const pos = new THREE.Vector3(center.x, box.min.y, center.z);
    root.position.copy(pos);
    this.state = {
      pos,
      heading: facing,
      vy: 0,
      grounded: true,
      speed: 0,
      phase: 0,
      spin: 0,
      landT: 0,
      t: 0,
      air: 0,
    };
    this.walkSpeed = Math.max(1.4, this.height * 1.4);
    this.runSpeed = this.walkSpeed * 2.2;
  }

  /** 取り込んだモデルのアニメーションを準備する */
  _setupClips(content) {
    this.mixers = [];
    content.traverse((o) => {
      if (o.userData.kind !== 'model') return;
      const clips = assetAnimations(o.userData.asset);
      if (!clips.length) return;
      const mixer = new THREE.AnimationMixer(o);
      const picked = pickClips(clips);
      const actions = {};
      for (const [key, clip] of Object.entries(picked)) {
        if (!clip) continue;
        // 同じアニメーションを 2 つの役に使うときは 1 つの動きを共有する
        const action = mixer.clipAction(clip);
        action.setEffectiveWeight(0);
        action.play();
        actions[key] = action;
      }
      this.mixers.push({ mixer, actions });
    });
    this.animated = this.mixers.some((m) => m.actions.walk || m.actions.run);
  }

  _animateClips(dt, walk, runB) {
    const s = this.state;
    for (const { mixer, actions } of this.mixers) {
      const { idle, walk: walkA, run, jump } = actions;
      const air = jump ? s.air : 0;
      const ground = 1 - air;
      const weights = new Map();
      const add = (action, w) => action && weights.set(action, (weights.get(action) ?? 0) + w);
      // 待機のアニメーションがなければ、止まっているときは歩く動きをその場で止めておく（timeScale = 0）
      const move = idle ? walk : 1;
      const rb = run ? runB : 0;
      add(idle, (1 - walk) * ground);
      add(walkA ?? run, move * (1 - rb) * ground);
      add(run, move * rb * ground);
      add(jump, air);
      for (const action of Object.values(actions)) action.setEffectiveWeight(weights.get(action) ?? 0);
      // 速さに合わせて再生の速さを変える。待機がないときは、止まると歩く動きも止まる
      if (walkA) walkA.timeScale = idle ? 0.7 + 0.3 * walk + 0.5 * runB : walk + 0.5 * runB;
      if (run && run !== walkA) run.timeScale = 0.8 + 0.3 * runB;
      mixer.update(dt);
    }
  }

  // ================================================================ 入力

  _key(e, down) {
    if (!this.active) return;
    if (e.target.tagName === 'INPUT') return;
    const code = e.code;
    if (down && code === 'Escape') {
      this.stop();
      return;
    }
    const handled = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Space'];
    if (!handled.includes(code)) return;
    e.preventDefault();
    if (down) {
      if (code === 'Space' && !this.keys.has('Space')) this.jumpQueued = true;
      this.keys.add(code);
    } else {
      this.keys.delete(code);
    }
  }

  /** 画面のスティック（-1〜1） */
  setStick(x, y) {
    this.stick.x = x;
    this.stick.y = y;
  }

  jump() {
    this.jumpQueued = true;
  }

  setRun(on) {
    this.runToggle = on;
  }

  // ================================================================ 地面

  /** (x, z) の、fromY より下で一番高い足場の高さ。足場がなければ null（落ちる） */
  _groundAt(x, z, fromY) {
    const world = this.editor.world;
    let g = world?.groundAt ? world.groundAt(x, z) : 0;
    if (this.scenery.length) {
      this.raycaster.set(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0));
      this.raycaster.far = 1000;
      const hit = this.raycaster.intersectObjects(this.scenery, false)[0];
      if (hit && (g === null || hit.point.y > g)) g = hit.point.y;
    }
    return g;
  }

  /** 進む先に置物の壁があるか（すねの高さと胸の高さで確かめる） */
  _blocked(from, dir, dist) {
    if (!this.scenery.length) return false;
    for (const h of [this.stepHeight + 0.02, this.height * 0.8]) {
      this.raycaster.set(new THREE.Vector3(from.x, from.y + h, from.z), dir);
      this.raycaster.far = dist + this.radius;
      if (this.raycaster.intersectObjects(this.scenery, false).length) return true;
    }
    return false;
  }

  // ================================================================ 毎フレーム

  update(dt) {
    if (!this.active) return;
    const ed = this.editor;
    const s = this.state;
    s.t += dt;

    // ---- 入力（カメラから見た向きで動く）
    let ix = this.stick.x;
    let iy = this.stick.y;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) iy += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) iy -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) ix += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) ix -= 1;
    const mag = Math.min(1, Math.hypot(ix, iy));
    const run = this.runToggle || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const camF = ed.orbit.target.clone().sub(ed.camera.position).setY(0);
    // 真上から見下ろしているときは、今向いている方向を「前」とする
    if (camF.lengthSq() < 1e-6) camF.set(Math.sin(s.heading), 0, Math.cos(s.heading));
    camF.normalize();
    const camR = new THREE.Vector3().crossVectors(camF, UP);
    const move = camF.multiplyScalar(iy).add(camR.multiplyScalar(ix));

    const targetSpeed = mag * (run ? this.runSpeed : this.walkSpeed);
    s.speed = damp(s.speed, targetSpeed, s.grounded ? 10 : 3, dt);
    if (mag > 0.05) s.heading += angleDelta(s.heading, Math.atan2(move.x, move.z)) * (1 - Math.exp(-12 * dt));

    // ---- 水平移動（坂が急すぎる所・置物の壁は進めない）
    const dir = new THREE.Vector3(Math.sin(s.heading), 0, Math.cos(s.heading));
    const step = s.speed * dt;
    if (step > 0.0001) {
      const nx = s.pos.x + dir.x * step;
      const nz = s.pos.z + dir.z * step;
      const ahead = this._groundAt(nx, nz, s.pos.y + this.stepHeight);
      const tooHigh = ahead !== null && ahead > s.pos.y + this.stepHeight;
      if (!tooHigh && !this._blocked(s.pos, dir, step)) {
        s.pos.x = nx;
        s.pos.z = nz;
        s.spin += step;
      } else {
        s.speed *= 0.5;
      }
      // 世界の外へ出すぎないように
      const r = Math.hypot(s.pos.x, s.pos.z);
      if (r > 150) {
        s.pos.x *= 150 / r;
        s.pos.z *= 150 / r;
      }
    }

    // ---- 上下（ジャンプ・落下）
    // 跳ぶ力は地球と同じにして、重力の弱い世界（月など）ほど高く・長く跳べるようにする
    const earthGravity = 22 * Math.max(1, this.height * 0.6);
    const gravity = earthGravity * (ed.world?.gravity ?? 1);
    const ground = this._groundAt(s.pos.x, s.pos.z, s.pos.y + this.stepHeight);
    if (s.grounded) {
      if (ground === null || ground < s.pos.y - this.stepHeight) {
        s.grounded = false; // 段差や島の端から落ちる
      } else {
        s.pos.y = damp(s.pos.y, ground, 25, dt);
      }
      if (this.jumpQueued && s.grounded) {
        const jumpHeight = Math.max(0.9, this.height * 0.9);
        s.vy = Math.sqrt(2 * earthGravity * jumpHeight);
        s.grounded = false;
      }
    } else {
      s.vy -= gravity * dt;
      s.pos.y += s.vy * dt;
      if (ground !== null && s.pos.y <= ground && s.vy <= 0) {
        s.pos.y = ground;
        s.vy = 0;
        s.grounded = true;
        s.landT = 0.18;
      }
      if (s.pos.y < -40) {
        // 落ちてしまったら最初の場所へ
        s.pos.copy(s.spawn);
        s.vy = 0;
        s.grounded = true;
        this.hooks.toast?.('落ちてしまったので、最初の場所に戻りました');
      }
    }
    this.jumpQueued = false;
    s.air = damp(s.air, s.grounded ? 0 : 1, 12, dt);
    s.landT = Math.max(0, s.landT - dt);

    this._animate(dt);
    this.root.position.copy(s.pos);
    this.root.rotation.y = s.heading;

    // ---- カメラ・光・影がついてくる
    const desired = s.pos.clone().add(new THREE.Vector3(0, this.height * 0.6, 0));
    const delta = desired.sub(ed.orbit.target).multiplyScalar(1 - Math.exp(-10 * dt));
    ed.orbit.target.add(delta);
    ed.camera.position.add(delta);
    this._chaseCamera(dt);
    ed.sun.target.position.copy(s.pos);
    ed.sun.position.copy(s.pos).addScaledVector(this.sunDir, 15);
    ed.shadowPlane.position.set(s.pos.x, (ground ?? s.pos.y) + 0.003, s.pos.z);
  }

  /**
   * 歩いている間はカメラをゆっくりキャラクターの後ろへ回り込ませる。
   * 入力はカメラから見た向きなので、これで「前＋右」を押し続けると右へ曲がり続け、
   * 歩きながら自由に向きを変えられる。後ろ向きに歩くときはカメラを回さない（ぐるぐる回るのを防ぐ）。
   */
  _chaseCamera(dt) {
    const ed = this.editor;
    const s = this.state;
    this.camHold = Math.max(0, this.camHold - dt);
    if (this.dragging || this.camHold > 0) return;
    const moving = THREE.MathUtils.clamp(s.speed / this.walkSpeed, 0, 1);
    if (moving < 0.01) return;
    const offset = ed.camera.position.clone().sub(ed.orbit.target);
    if (offset.x * offset.x + offset.z * offset.z < 1e-6) return;
    const camYaw = Math.atan2(-offset.x, -offset.z); // カメラが向いている方向
    const diff = angleDelta(camYaw, s.heading);
    // 前〜横向きのときだけ追いかける（真後ろへ歩くときは 0）
    const follow = THREE.MathUtils.smoothstep(Math.cos(diff), -0.5, 0.3);
    const rot = diff * (1 - Math.exp(-2.2 * dt)) * moving * follow;
    if (Math.abs(rot) < 1e-6) return;
    offset.applyAxisAngle(UP, rot);
    ed.camera.position.copy(ed.orbit.target).add(offset);
  }

  // ================================================================ 動き

  _animate(dt) {
    const s = this.state;
    const { A, F } = this.axes;
    const walk = THREE.MathUtils.clamp(s.speed / this.walkSpeed, 0, 1);
    const runB = THREE.MathUtils.clamp((s.speed - this.walkSpeed) / (this.runSpeed - this.walkSpeed), 0, 1);
    const moving = s.grounded ? walk : 0;
    s.phase += (s.speed * dt) / (this.legLength * 1.1);
    const air = s.air;
    this._animateClips(dt, walk, runB);
    const q = new THREE.Quaternion();
    const q2 = new THREE.Quaternion();

    for (const u of this.units) {
      const sign = u.side === 'R' ? 1 : -1;
      if (u.role === 'leg') {
        const amp = 0.55 * walk + 0.35 * runB;
        const groundSwing = amp * Math.sin(s.phase + u.phase) * (1 - air);
        const airSwing = (u.side === 'L' ? 0.5 : -0.35) * air;
        u.swing = damp(u.swing ?? 0, groundSwing + airSwing, 20, dt);
        q.setFromAxisAngle(A, -u.swing);
      } else if (u.role === 'arm') {
        const amp = 0.45 * walk + 0.55 * runB;
        const idle = Math.sin(s.t * 1.6 + u.phase) * 0.05 * (1 - walk);
        const groundSwing = amp * Math.sin(s.phase + u.phase) + idle;
        u.swing = damp(u.swing ?? 0, groundSwing * (1 - air) + 2.3 * air, 14, dt);
        q.setFromAxisAngle(A, -u.swing);
      } else if (u.role === 'head') {
        const nod = Math.sin(s.phase * 2) * 0.06 * moving + Math.sin(s.t * 1.3) * 0.03 * (1 - walk);
        const look = Math.sin(s.t * 0.55) * 0.3 * (1 - walk) * (1 - air);
        q.setFromAxisAngle(A, nod);
        q2.setFromAxisAngle(UP, look);
        q.premultiply(q2);
      } else if (u.role === 'tail') {
        q.setFromAxisAngle(UP, Math.sin(s.t * (4 + 8 * runB)) * (0.35 + 0.2 * runB));
      } else if (u.role === 'wing') {
        const flap = air > 0.2 || runB > 0.3 ? Math.sin(s.t * 16) * 0.8 : Math.sin(s.t * (2 + 8 * walk)) * (0.08 + 0.25 * walk);
        q.setFromAxisAngle(F, flap * sign);
      } else if (u.role === 'wheel') {
        q.setFromAxisAngle(A, s.spin / u.radius);
      }
      u.pivot.quaternion.copy(q);
    }

    // ---- 体：弾み・前傾・着地のつぶれ
    const h = this.height;
    let bob;
    let squash = 1;
    if (this.animated) {
      // 歩くアニメーションのあるモデルは、体の弾みもアニメーションに任せる
      bob = 0;
    } else if (this.hasLegs || this.hasWheels) {
      bob = this.hasLegs ? Math.abs(Math.sin(s.phase)) * (0.035 * walk + 0.05 * runB) * h * (1 - air) : 0;
      bob += Math.sin(s.t * 2) * 0.006 * h * (1 - walk);
    } else {
      // 足のないモデルは、ぴょこぴょこ跳ねて進む
      const hop = Math.abs(Math.sin(s.phase * 0.8));
      bob = hop * h * 0.18 * moving;
      squash = 1 - (1 - hop) * 0.14 * moving;
    }
    if (s.landT > 0) squash *= 1 - Math.sin((s.landT / 0.18) * Math.PI) * 0.16;
    if (!s.grounded) squash *= 1 + 0.06 * Math.min(1, Math.abs(s.vy) / 10);
    const lean = (runB * 0.16 + walk * 0.04) * (this.animated ? 0.3 : 1);
    this.pose.position.y = bob;
    this.pose.quaternion.setFromAxisAngle(A, lean);
    this.pose.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
  }
}
