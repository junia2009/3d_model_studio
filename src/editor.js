import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';

import { PRIMITIVES, buildGeometry } from './primitives.js';
import { DEFAULT_WORLD, getWorld } from './worlds/index.js';
import { disposeTree } from './worlds/common.js';
import { History } from './history.js';
import {
  applyMaterialProps,
  createGroup,
  createPrimitive,
  deserializeObject,
  disposeObject,
  isStudioObject,
  reassignIds,
  serializeScene,
  validateSceneData,
} from './serializer.js';


/** 「作業用ライト」：世界の光に関係なく、部品の色がそのまま見える明かり */
const WORK_LIGHTS = { hemi: ['#ffffff', '#445066', 1.4], sun: ['#ffffff', 2.2, [5, 10, 6]], exposure: 1 };

export const SNAP = {
  translate: 0.25,
  rotate: THREE.MathUtils.degToRad(15),
  scale: 0.1,
};

/**
 * 3D ビューポートとシーン編集操作をまとめたクラス。
 * UI には EventTarget のイベントで状態変化を通知する。
 *   - 'selection'    : 選択が変わった
 *   - 'change'       : シーン構成やプロパティが変わった（アウトライナー・パネル再描画用）
 *   - 'transform'    : ギズモでドラッグ中（数値表示の更新用）
 *   - 'history'      : Undo / Redo の可否が変わった
 *   - 'mode'         : 変形モード・座標系・スナップが変わった
 */
export class Editor extends EventTarget {
  constructor(container) {
    super();
    this.container = container;
    this.selected = [];
    this.history = new History();
    this.snapEnabled = false;
    this.multiSelect = false;
    this.playing = false;
    /** 遊ぶモードの設定（作品ごとに保存）。facing: モデルの正面の向き（0 = 手前 +Z） */
    this.playSettings = { facing: 0 };
    this._frameCallbacks = [];
    this._multiStart = null;

    this._initRenderer();
    this._initScene();
    this.workLight = false;
    this.setWorld(DEFAULT_WORLD);
    this._initControls();
    this._initPicking();
    this._initObjectDrag();

    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(container);
    this._resize();

    this.renderer.setAnimationLoop(() => this._render());
  }

  // ---------------------------------------------------------------- 初期化

  _initRenderer() {
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.container.appendChild(renderer.domElement);
    this.renderer = renderer;
  }

  _initScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#1e2027');
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 500);
    this.camera.position.set(4, 3.5, 5);

    // ライト（色や向きは世界ごとに setWorld で変わる）
    this.hemi = new THREE.HemisphereLight('#ffffff', '#445066', 1.4);
    scene.add(this.hemi);
    const sun = new THREE.DirectionalLight('#ffffff', 2.2);
    this.sun = sun;
    sun.position.set(5, 10, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -10;
    sun.shadow.camera.right = 10;
    sun.shadow.camera.top = 10;
    sun.shadow.camera.bottom = -10;
    sun.shadow.bias = -0.0005;
    scene.add(sun);

    // 床（グリッドと影受け）
    this.helpers = new THREE.Group();
    this.helpers.name = '__helpers';
    const grid = new THREE.GridHelper(20, 80, '#5a6275', '#343946');
    grid.material.transparent = true;
    grid.material.opacity = 0.8;
    this.helpers.add(grid);
    const axes = new THREE.AxesHelper(1.2);
    axes.position.y = 0.001;
    this.helpers.add(axes);
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      // 奥の地面やグリッドを隠さないよう、深度は書き込まない
      new THREE.ShadowMaterial({ opacity: 0.25, depthWrite: false }),
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = 0.003;
    shadowPlane.receiveShadow = true;
    this.shadowPlane = shadowPlane;
    scene.add(shadowPlane);
    scene.add(this.helpers);

    // 世界（背景・地面・空など）。モデルとは別に持ち、書き出しや選択の対象にしない
    this.worldRoot = new THREE.Group();
    this.worldRoot.name = '__world';
    scene.add(this.worldRoot);
    this.timer = new THREE.Timer();

    // ユーザーが作るモデルはすべてここにぶら下げる
    this.modelRoot = new THREE.Group();
    this.modelRoot.name = 'Model';
    scene.add(this.modelRoot);

    // 選択枠
    this.selectionBoxes = new THREE.Group();
    scene.add(this.selectionBoxes);

    // 複数選択をまとめて動かすための支点
    this.pivot = new THREE.Object3D();
    scene.add(this.pivot);
  }

  _initControls() {
    // タッチ端末では指で掴みやすいようにギズモを大きくする
    this.isTouch = window.matchMedia('(pointer: coarse)').matches;

    // TransformControls を先に作り、ポインターイベントを OrbitControls より先に受け取らせる。
    // ギズモを掴んだ瞬間に視点操作が無効になり、指でのドラッグで視点が一緒に動かない。
    const transform = new TransformControls(this.camera, this.renderer.domElement);
    transform.setSize(this.isTouch ? 1.15 : 0.9);
    this.transform = transform;
    this.scene.add(transform.getHelper());
    this._simplifyTranslateGizmo(transform);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.12;
    this.orbit.target.set(0, 0.5, 0);
    // 世界の遠景（空・山など）の外に出ないよう、離れすぎないようにする
    this.orbit.maxDistance = 90;
    this.orbit.update();

    transform.addEventListener('dragging-changed', (e) => {
      this.orbit.enabled = !e.value;
    });

    // TransformControls はどの指の動きも区別せずに受け取るため、ギズモを掴んでいる最中に
    // 別の指が触れると 2 本の指の位置を行き来して部品が飛んでしまう。掴んだ指以外は捨てる。
    let lastPointerDown = null;
    let gizmoPointer = null;
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
      this.container.addEventListener(
        type,
        (e) => {
          if (type === 'pointerdown' && !transform.dragging) lastPointerDown = e.pointerId;
          if (transform.dragging && gizmoPointer !== null && e.pointerId !== gizmoPointer) e.stopPropagation();
        },
        true,
      );
    }

    transform.addEventListener('mouseDown', () => {
      gizmoPointer = lastPointerDown;
      this._dragMoved = false;
      const target = transform.object;
      this._gizmoStart = target ? { position: target.position.clone(), limit: this._dragLimit() } : null;
      if (this.selected.length > 1) this._beginMultiTransform();
    });
    transform.addEventListener('objectChange', () => {
      this._dragMoved = true;
      // 斜めから矢印や面を掴むと、わずかな指の動きがとても遠くへの移動になるので 1 回の移動量を制限する
      if (transform.mode === 'translate' && this._gizmoStart) {
        const { position: start, limit } = this._gizmoStart;
        const offset = transform.object.position.clone().sub(start);
        if (offset.length() > limit) transform.object.position.copy(start).add(offset.setLength(limit));
      }
      if (this.selected.length > 1) this._applyMultiTransform();
      this.dispatchEvent(new Event('transform'));
    });
    transform.addEventListener('mouseUp', () => {
      gizmoPointer = null;
      this._gizmoStart = null;
      this._multiStart = null;
      if (this._dragMoved) this.commit();
    });
  }

  /**
   * 移動ギズモから「面」の四角と中心の持ち手を取り除き、X / Y / Z の矢印だけにする。
   * これらは斜めから掴むと遠くへ飛びやすく、指では意図せず掴みがち。
   * 床と平行な移動は部品そのものを掴んでドラッグすれば行える（_initObjectDrag）。
   */
  _simplifyTranslateGizmo(transform) {
    const gizmo = transform._gizmo;
    for (const group of [gizmo?.gizmo?.translate, gizmo?.picker?.translate]) {
      if (!group) continue;
      for (const handle of [...group.children]) {
        if (['XYZ', 'XY', 'YZ', 'XZ'].includes(handle.name)) group.remove(handle);
      }
    }
  }

  /** 1 回のドラッグで動かせる距離の上限（今の視点の距離に合わせる） */
  _dragLimit() {
    return Math.max(3, this.camera.position.distanceTo(this.orbit.target) * 1.5);
  }

  /**
   * 選択中の部品を直接掴んでドラッグすると、床と平行にすべらせて動かせる（移動モードのとき）。
   * 上下の移動はギズモの緑の矢印で行う。選択していない部品の上でドラッグしたときは視点が回る。
   */
  _initObjectDrag() {
    const el = this.renderer.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const plane = new THREE.Plane();
    const point = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    let drag = null;

    const setRay = (e) => {
      const rect = el.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, this.camera);
    };

    // OrbitControls より先に判定して、部品を掴んだときは視点が回らないようにする
    this.container.addEventListener(
      'pointerdown',
      (e) => {
        if (this.playing || e.target !== el || drag || this.transform.dragging) return;
        if (this.transform.mode !== 'translate' || !this.selected.length || e.button > 0) return;
        setRay(e);
        // ギズモの上ならギズモに任せる
        this.transform.pointerHover({ x: ndc.x, y: ndc.y, button: e.button });
        if (this.transform.axis !== null) return;

        const hit = raycaster
          .intersectObject(this.modelRoot, true)
          .find((h) => isStudioObject(h.object) && this._isVisibleInTree(h.object));
        if (!hit) return;
        const targets = this._topMostSelected();
        const grabbed = targets.some((t) => {
          for (let o = hit.object; o; o = o.parent) if (o === t) return true;
          return false;
        });
        if (!grabbed) return;

        plane.setFromNormalAndCoplanarPoint(up, hit.point);
        drag = {
          id: e.pointerId,
          start: hit.point.clone(),
          x: e.clientX,
          y: e.clientY,
          moved: false,
          limit: this._dragLimit(),
          items: targets.map((obj) => ({ obj, world: obj.getWorldPosition(new THREE.Vector3()) })),
        };
        this.orbit.enabled = false;
      },
      true,
    );

    el.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < (e.pointerType === 'mouse' ? 4 : 10)) return;
        drag.moved = true;
      }
      this._dragMoved = true;
      setRay(e);
      if (!raycaster.ray.intersectPlane(plane, point)) return;
      const delta = point.sub(drag.start);
      delta.y = 0;
      // 床と平行に近い角度で見ているときに遠くへ飛ばないよう制限する
      if (delta.length() > drag.limit) delta.setLength(drag.limit);
      for (const { obj, world } of drag.items) {
        const p = world.clone().add(delta);
        if (this.snapEnabled) {
          p.x = Math.round(p.x / SNAP.translate) * SNAP.translate;
          p.z = Math.round(p.z / SNAP.translate) * SNAP.translate;
        }
        obj.parent.updateMatrixWorld(true);
        obj.position.copy(obj.parent.worldToLocal(p));
      }
      if (this.selected.length > 1) this._placePivot();
      this.dispatchEvent(new Event('transform'));
    });

    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const { moved } = drag;
      drag = null;
      this.orbit.enabled = true;
      if (moved) this.commit();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  /**
   * クリック / タップでの選択。
   * - 指やマウスがほとんど動いていないときだけ選択（視点操作と区別）
   * - 2 本指以上で触れたジェスチャーでは選択しない
   * - ダブルクリック / ダブルタップでグループの中の部品を直接選ぶ
   */
  _initPicking() {
    const el = this.renderer.domElement;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const active = new Map();
    let multiTouch = false;
    let lastTap = null;

    let longPressTimer = null;
    const cancelLongPress = () => {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    };

    el.addEventListener('pointerdown', (e) => {
      if (this.playing) return;
      // TransformControls のリスナーが先に走るので、ギズモ上かどうかは axis で分かる
      const down = { x: e.clientX, y: e.clientY, onGizmo: this.transform.axis !== null, longPressed: false };
      active.set(e.pointerId, down);
      cancelLongPress();
      if (active.size > 1) {
        multiTouch = true;
        return;
      }
      // 長押し（指を動かさずに 0.5 秒）で選択に追加する。タッチ端末で Shift+クリックの代わり
      if (e.pointerType !== 'mouse' && !down.onGizmo) {
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          if (multiTouch || active.get(e.pointerId) !== down) return;
          const hit = this._pick({ clientX: down.x, clientY: down.y }, raycaster, pointer);
          // 選択中の部品を押さえているときは、掴んで動かそうとしている途中なので何もしない
          if (!hit || this.selected.includes(this._topLevel(hit))) return;
          down.longPressed = true;
          navigator.vibrate?.(15);
          this.addToSelection(this._topLevel(hit));
        }, 500);
      }
    });
    el.addEventListener('pointermove', (e) => {
      const down = active.get(e.pointerId);
      if (down && longPressTimer && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) cancelLongPress();
    });
    const release = (e) => {
      cancelLongPress();
      const down = active.get(e.pointerId);
      active.delete(e.pointerId);
      const wasMulti = multiTouch;
      if (active.size === 0) multiTouch = false;
      return wasMulti ? null : down;
    };
    el.addEventListener('pointercancel', release);
    el.addEventListener('pointerup', (e) => {
      const down = release(e);
      if (!down || e.button > 0 || down.longPressed) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const tolerance = e.pointerType === 'mouse' ? 4 : 12;
      // ドラッグ（視点移動）やギズモ操作のときは選択しない
      if (moved > tolerance || this._dragMoved) {
        this._dragMoved = false;
        return;
      }

      const hit = this._pick(e, raycaster, pointer);
      // ギズモ（矢印）の上を動かさずにタップした場合は、その下の部品を選ぶ。
      // スマホではギズモが大きく部品に重なるため。何もなければ選択はそのまま。
      if (down.onGizmo && !hit) return;
      const additive = e.shiftKey || e.ctrlKey || e.metaKey || this.multiSelect;
      // 処理時間ではなく入力が起きた時刻で比べる（1 回目の選択処理が重くても判定がずれないように）
      const now = e.timeStamp;
      const isDouble =
        lastTap && now - lastTap.time < 400 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30;
      lastTap = { time: now, x: e.clientX, y: e.clientY };

      if (!hit) {
        if (!additive) this.select([]);
        return;
      }
      // 通常はグループ全体を選ぶ。Alt+クリックやダブルクリック / ダブルタップなら中の部品を直接選ぶ
      if (e.altKey || (isDouble && hit !== this._topLevel(hit))) {
        lastTap = null;
        this.select([hit]);
        return;
      }
      this.select([this._topLevel(hit)], { toggle: additive });
    });
  }

  /**
   * 長押しで選択に加える。複数選択モードに切り替えるので、続けてタップで追加・解除できる。
   * すでに選択中なら外す（ただし唯一の選択はそのまま残す）。
   */
  addToSelection(obj) {
    const already = this.selected.includes(obj);
    this.setMultiSelect(true);
    if (already && this.selected.length === 1) return;
    this.select([obj], { toggle: true });
  }

  /** タップで選択を追加・解除するモード（タッチ端末で Shift キーの代わり） */
  setMultiSelect(enabled) {
    this.multiSelect = enabled;
    this.dispatchEvent(new Event('mode'));
  }

  _pick(e, raycaster, pointer) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, this.camera);
    const hits = raycaster.intersectObject(this.modelRoot, true);
    const hit = hits.find((h) => isStudioObject(h.object) && this._isVisibleInTree(h.object));
    return hit?.object ?? null;
  }

  _isVisibleInTree(obj) {
    for (let o = obj; o && o !== this.modelRoot; o = o.parent) if (!o.visible) return false;
    return true;
  }

  _topLevel(obj) {
    let o = obj;
    while (o.parent && o.parent !== this.modelRoot) o = o.parent;
    return o;
  }

  _resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _render() {
    this.orbit.update();
    for (const box of this.selectionBoxes.children) box.update();
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    const t = this.timer.getElapsed();
    for (const f of this._worldFollowers) f.position.copy(this.camera.position);
    for (const o of this._worldAnimated) o.userData.update(dt, t, this.camera);
    for (const cb of this._frameCallbacks) cb(dt, t);
    this.renderer.render(this.scene, this.camera);
  }

  /** 毎フレーム呼ばれる処理を登録する（遊ぶモードなど） */
  addFrameCallback(cb) {
    this._frameCallbacks.push(cb);
  }

  removeFrameCallback(cb) {
    this._frameCallbacks = this._frameCallbacks.filter((f) => f !== cb);
  }

  // ---------------------------------------------------------------- 世界（背景）

  /** 世界を切り替える */
  setWorld(id) {
    const def = getWorld(id) ?? getWorld(DEFAULT_WORLD);
    if (this.world) {
      for (const child of [...this.worldRoot.children]) {
        this.worldRoot.remove(child);
        disposeTree(child);
      }
    }
    const world = def.create({ renderer: this.renderer, camera: this.camera });
    this.world = world;
    this.worldId = def.id;
    this.worldRoot.add(world.group);
    this._worldFollowers = world.followers ?? [];
    for (const f of this._worldFollowers) this.worldRoot.add(f);
    this._worldAnimated = [];
    this.worldRoot.traverse((o) => {
      if (typeof o.userData.update === 'function') this._worldAnimated.push(o);
    });

    this.scene.background = world.background ?? null;
    this.scene.fog = world.fog ?? null;
    this.helpers.visible = world.grid ?? false;
    const shadow = world.shadowOpacity ?? 0.25;
    this.shadowPlane.visible = shadow > 0;
    this.shadowPlane.material.opacity = shadow;

    // 金属や光沢のある部品に映り込む景色
    this._worldEnv?.dispose();
    this._worldEnv = null;
    if (world.env) {
      this._pmrem ??= new THREE.PMREMGenerator(this.renderer);
      this._worldEnv = this._pmrem.fromScene(world.env, 0.04);
      world.env.traverse?.((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
    }
    this._applyWorldLights();
    this.dispatchEvent(new Event('world'));
  }

  setWorkLight(enabled) {
    this.workLight = enabled;
    this._applyWorldLights();
    this.dispatchEvent(new Event('world'));
  }

  _applyWorldLights() {
    const w = this.world;
    const L = this.workLight ? WORK_LIGHTS : w.lights;
    const [sky, ground, hemiIntensity] = L.hemi;
    const [sunColor, sunIntensity, [x, y, z]] = L.sun;
    this.hemi.color.set(sky);
    this.hemi.groundColor.set(ground);
    this.hemi.intensity = hemiIntensity;
    this.sun.color.set(sunColor);
    this.sun.intensity = sunIntensity;
    // 影が作業エリアに落ちるよう、光の向きだけを使って距離はそろえる
    this.sun.position.set(x, y, z).normalize().multiplyScalar(15);
    this.renderer.toneMappingExposure = this.workLight ? WORK_LIGHTS.exposure : (w.exposure ?? 1);
    this.scene.environment = this.workLight ? null : (this._worldEnv?.texture ?? null);
    this.scene.environmentIntensity = w.envIntensity ?? 0.5;
  }

  // ---------------------------------------------------------------- 選択

  /**
   * @param {THREE.Object3D[]} objects
   * @param {{toggle?: boolean}} options toggle: 既存の選択に追加 / 解除する
   */
  select(objects, { toggle = false } = {}) {
    let next;
    if (toggle) {
      next = [...this.selected];
      for (const o of objects) {
        const i = next.indexOf(o);
        if (i >= 0) next.splice(i, 1);
        else next.push(o);
      }
    } else {
      next = [...new Set(objects)];
    }
    this.selected = next.filter((o) => isStudioObject(o));
    this._refreshSelectionVisuals();
    this.dispatchEvent(new Event('selection'));
  }

  selectAll() {
    this.select(this.modelRoot.children.filter(isStudioObject));
  }

  get primary() {
    return this.selected[this.selected.length - 1] ?? null;
  }

  _refreshSelectionVisuals() {
    for (const box of [...this.selectionBoxes.children]) {
      box.geometry.dispose();
      box.material.dispose();
      this.selectionBoxes.remove(box);
    }
    this.selected.forEach((obj) => {
      const color = obj === this.primary ? '#ffb020' : '#ffd88a';
      this.selectionBoxes.add(new THREE.BoxHelper(obj, color));
    });

    this.transform.detach();
    if (this.selected.length === 1) {
      this.transform.attach(this.selected[0]);
    } else if (this.selected.length > 1) {
      this._placePivot();
      this.transform.attach(this.pivot);
    }
  }

  _placePivot() {
    const box = new THREE.Box3();
    for (const o of this.selected) box.expandByObject(o);
    box.getCenter(this.pivot.position);
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.scale.set(1, 1, 1);
    this.pivot.updateMatrixWorld(true);
  }

  _beginMultiTransform() {
    this.pivot.updateMatrixWorld(true);
    this._multiStart = {
      pivotInverse: this.pivot.matrixWorld.clone().invert(),
      objects: this._topMostSelected().map((o) => {
        o.updateMatrixWorld(true);
        return { obj: o, world: o.matrixWorld.clone() };
      }),
    };
  }

  _applyMultiTransform() {
    if (!this._multiStart) return;
    this.pivot.updateMatrixWorld(true);
    const delta = new THREE.Matrix4().multiplyMatrices(this.pivot.matrixWorld, this._multiStart.pivotInverse);
    const world = new THREE.Matrix4();
    const parentInverse = new THREE.Matrix4();
    for (const { obj, world: start } of this._multiStart.objects) {
      world.multiplyMatrices(delta, start);
      obj.parent.updateMatrixWorld(true);
      parentInverse.copy(obj.parent.matrixWorld).invert();
      world.premultiply(parentInverse);
      world.decompose(obj.position, obj.quaternion, obj.scale);
    }
  }

  /** 選択のうち、他の選択オブジェクトの子孫ではないものだけを返す */
  _topMostSelected() {
    const set = new Set(this.selected);
    return this.selected.filter((o) => {
      for (let p = o.parent; p; p = p.parent) if (set.has(p)) return false;
      return true;
    });
  }

  findById(id) {
    let found = null;
    this.modelRoot.traverse((o) => {
      if (!found && o.userData.id === id) found = o;
    });
    return found;
  }

  // ---------------------------------------------------------------- 編集操作

  addPrimitive(type) {
    const count = this._countByType(type) + 1;
    const mesh = createPrimitive(type, { name: `${PRIMITIVES[type].label} ${count}` });
    this.modelRoot.add(mesh);

    // 視点の注視点付近の床の上に置く
    const t = this.orbit.target;
    const step = SNAP.translate;
    mesh.position.set(Math.round(t.x / step) * step, 0, Math.round(t.z / step) * step);
    this._placeOnGround(mesh);

    this.select([mesh]);
    this.commit();
    return mesh;
  }

  _countByType(type) {
    let n = 0;
    this.modelRoot.traverse((o) => {
      if (o.userData.type === type) n += 1;
    });
    return n;
  }

  _placeOnGround(obj) {
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;
    // ワールド座標で Y を動かし、親のローカル座標に戻す
    const world = obj.getWorldPosition(new THREE.Vector3());
    world.y -= box.min.y;
    obj.parent.worldToLocal(world);
    obj.position.copy(world);
  }

  dropToGround() {
    const targets = this._topMostSelected();
    if (!targets.length) return;
    targets.forEach((o) => this._placeOnGround(o));
    this._refreshSelectionVisuals();
    this.commit();
  }

  deleteSelected() {
    const targets = this._topMostSelected();
    if (!targets.length) return;
    this.select([]);
    for (const o of targets) {
      o.removeFromParent();
      disposeObject(o);
    }
    this.commit();
  }

  duplicateSelected({ offset = true } = {}) {
    const targets = this._topMostSelected();
    if (!targets.length) return;
    const copies = targets.map((o) => {
      const copy = this._cloneObject(o);
      o.parent.add(copy);
      if (offset) copy.position.x += SNAP.translate * 2;
      return copy;
    });
    this.select(copies);
    this.commit();
  }

  /** ワールドの軸（YZ / XZ / XY 平面）で反転したコピーを作る。左右対称のモデル作りに便利 */
  mirrorDuplicate(axis = 'x') {
    const targets = this._topMostSelected();
    if (!targets.length) return;
    const s = { x: [-1, 1, 1], y: [1, -1, 1], z: [1, 1, -1] }[axis];
    const mirror = new THREE.Matrix4().makeScale(...s);
    const copies = targets.map((o) => {
      const copy = this._cloneObject(o);
      o.parent.add(copy);
      o.updateMatrixWorld(true);
      const world = o.matrixWorld.clone().premultiply(mirror);
      world.premultiply(o.parent.matrixWorld.clone().invert());
      world.decompose(copy.position, copy.quaternion, copy.scale);
      copy.name = `${o.name} (反転)`;
      return copy;
    });
    this.select(copies);
    this.commit();
  }

  _cloneObject(obj) {
    const copy = obj.clone(true);
    // clone はジオメトリ・マテリアルを共有するので、編集が波及しないよう複製する
    copy.traverse((o) => {
      if (o.isMesh) {
        o.geometry = o.geometry.clone();
        o.material = o.material.clone();
      }
      if (isStudioObject(o)) o.userData = structuredClone(o.userData);
    });
    reassignIds(copy);
    return copy;
  }

  groupSelected() {
    const targets = this._topMostSelected();
    if (targets.length < 1) return;
    const parent = targets[0].parent;
    const group = createGroup(`グループ ${this._countGroups() + 1}`);

    const box = new THREE.Box3();
    targets.forEach((o) => box.expandByObject(o));
    const center = box.getCenter(new THREE.Vector3());
    center.y = box.min.y; // 支点は底面の中心にしておくと床置きしやすい
    parent.add(group);
    parent.updateMatrixWorld(true);
    group.position.copy(parent.worldToLocal(center));
    group.updateMatrixWorld(true);

    targets.forEach((o) => group.attach(o));
    this.select([group]);
    this.commit();
  }

  _countGroups() {
    let n = 0;
    this.modelRoot.traverse((o) => {
      if (o.userData.kind === 'group') n += 1;
    });
    return n;
  }

  ungroupSelected() {
    const groups = this._topMostSelected().filter((o) => o.userData.kind === 'group');
    if (!groups.length) return;
    const released = [];
    for (const g of groups) {
      const parent = g.parent;
      for (const child of [...g.children]) {
        parent.attach(child);
        released.push(child);
      }
      g.removeFromParent();
    }
    this.select(released);
    this.commit();
  }

  /** アウトライナーでのドラッグ＆ドロップによる親子付け替え */
  reparent(obj, newParent, beforeObj = null) {
    const parent = newParent ?? this.modelRoot;
    // 自分自身や子孫の中には入れられない
    for (let p = parent; p; p = p.parent) if (p === obj) return;
    parent.attach(obj);
    if (beforeObj && beforeObj.parent === parent) {
      const list = parent.children;
      list.splice(list.indexOf(obj), 1);
      list.splice(list.indexOf(beforeObj), 0, obj);
    }
    this._refreshSelectionVisuals();
    this.commit();
  }

  updateTransform(obj, { position, rotation, scale }) {
    if (position) obj.position.set(...position);
    if (rotation) obj.rotation.set(...rotation.map((d) => THREE.MathUtils.degToRad(d)));
    if (scale) obj.scale.set(...scale);
    if (this.selected.length > 1) this._placePivot();
    this.dispatchEvent(new Event('transform'));
  }

  updateParams(mesh, params) {
    const next = { ...mesh.userData.params, ...params };
    let geometry;
    try {
      geometry = buildGeometry(mesh.userData.type, next);
    } catch (err) {
      // 作れない組み合わせのときは、今の形のまま変えない
      console.warn('この値では形を作れませんでした', err);
      return false;
    }
    mesh.userData.params = next;
    mesh.geometry.dispose();
    mesh.geometry = geometry;
    return true;
  }

  /** 選択中のすべての部品（グループの中身も含む）にマテリアル設定を適用 */
  updateMaterial(props) {
    for (const mesh of this.selectedMeshes()) applyMaterialProps(mesh.material, props);
  }

  selectedMeshes() {
    const meshes = new Set();
    for (const o of this.selected) {
      o.traverse((c) => {
        if (c.isMesh && c.userData.kind === 'primitive') meshes.add(c);
      });
    }
    return [...meshes];
  }

  setVisible(obj, visible) {
    obj.visible = visible;
    this.commit();
  }

  rename(obj, name) {
    obj.name = name;
    this.commit();
  }

  // ---------------------------------------------------------------- ギズモ設定

  setMode(mode) {
    this.transform.setMode(mode);
    this.dispatchEvent(new Event('mode'));
  }

  toggleSpace() {
    this.transform.setSpace(this.transform.space === 'local' ? 'world' : 'local');
    this.dispatchEvent(new Event('mode'));
  }

  setSnap(enabled) {
    this.snapEnabled = enabled;
    this.transform.setTranslationSnap(enabled ? SNAP.translate : null);
    this.transform.setRotationSnap(enabled ? SNAP.rotate : null);
    this.transform.setScaleSnap(enabled ? SNAP.scale : null);
    this.dispatchEvent(new Event('mode'));
  }

  // ---------------------------------------------------------------- カメラ

  focusSelected() {
    const targets = this.selected.length ? this.selected : this.modelRoot.children;
    const box = new THREE.Box3();
    targets.forEach((o) => box.expandByObject(o));
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(2, 2, 2));
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.5);
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.1;
    const dir = this.camera.position.clone().sub(this.orbit.target).normalize();
    this.orbit.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, dist);
  }

  /** 最初と同じ視点に戻す（空の作品を開いたときなど） */
  resetView() {
    this.orbit.target.set(0, 0.5, 0);
    this.camera.position.set(4, 3.5, 5);
    this.camera.lookAt(this.orbit.target);
  }

  setView(view) {
    const dirs = {
      front: [0, 0, 1],
      back: [0, 0, -1],
      right: [1, 0, 0],
      left: [-1, 0, 0],
      top: [0, 1, 0.0001],
      iso: [1, 0.8, 1.2],
    };
    const dist = this.camera.position.distanceTo(this.orbit.target);
    const dir = new THREE.Vector3(...dirs[view]).normalize();
    this.camera.position.copy(this.orbit.target).addScaledVector(dir, dist);
    this.camera.lookAt(this.orbit.target);
  }

  setHelpersVisible(visible) {
    this.helpers.visible = visible;
  }

  // ---------------------------------------------------------------- 履歴・保存

  snapshot() {
    return JSON.stringify(serializeScene(this.modelRoot));
  }

  /** 変更を確定して履歴に積む */
  commit() {
    const snap = this.snapshot();
    this.history.push(snap);
    this.dispatchEvent(new Event('change'));
    this.dispatchEvent(new Event('history'));
  }

  undo() {
    const snap = this.history.undo();
    if (snap !== null) this._restore(snap);
  }

  redo() {
    const snap = this.history.redo();
    if (snap !== null) this._restore(snap);
  }

  _restore(snap) {
    const selectedIds = this.selected.map((o) => o.userData.id);
    this._loadObjects(JSON.parse(snap).objects);
    this.select(selectedIds.map((id) => this.findById(id)).filter(Boolean));
    this.dispatchEvent(new Event('change'));
    this.dispatchEvent(new Event('history'));
  }

  _loadObjects(nodes) {
    this.transform.detach();
    for (const o of [...this.modelRoot.children]) {
      o.removeFromParent();
      disposeObject(o);
    }
    for (const node of nodes) this.modelRoot.add(deserializeObject(node));
  }

  /** ファイルなどから読み込んだデータでシーンを置き換える（履歴はリセット） */
  loadScene(data) {
    validateSceneData(data);
    this.select([]);
    // 世界の情報がある保存ファイルなら、その世界に切り替える
    if (data.world && getWorld(data.world) && data.world !== this.worldId) this.setWorld(data.world);
    this._loadObjects(data.objects);
    this.playSettings = { facing: data.play?.facing ?? 0 };
    this.history.reset(this.snapshot());
    this.dispatchEvent(new Event('change'));
    this.dispatchEvent(new Event('history'));
  }

  newScene() {
    this.loadScene(serializeScene(new THREE.Group()));
  }

  getSceneData() {
    return { ...serializeScene(this.modelRoot), world: this.worldId, play: { ...this.playSettings } };
  }

  // ---------------------------------------------------------------- 書き出し

  /** 書き出し用に、選択枠などを含まない「見えている部品だけ」のコピーを作る */
  _exportRoot() {
    const root = new THREE.Group();
    root.name = 'Model';
    const copy = (src, dst) => {
      for (const child of src.children) {
        if (!isStudioObject(child) || !child.visible) continue;
        const c = child.isMesh ? new THREE.Mesh(child.geometry, child.material) : new THREE.Group();
        c.name = child.name;
        c.position.copy(child.position);
        c.quaternion.copy(child.quaternion);
        c.scale.copy(child.scale);
        dst.add(c);
        copy(child, c);
      }
    };
    copy(this.modelRoot, root);
    root.updateMatrixWorld(true);
    return root;
  }

  async exportModel(format) {
    const root = this._exportRoot();
    switch (format) {
      case 'glb': {
        const buffer = await new GLTFExporter().parseAsync(root, { binary: true });
        return new Blob([buffer], { type: 'model/gltf-binary' });
      }
      case 'gltf': {
        const json = await new GLTFExporter().parseAsync(root, { binary: false });
        return new Blob([JSON.stringify(json, null, 2)], { type: 'model/gltf+json' });
      }
      case 'obj':
        return new Blob([new OBJExporter().parse(root)], { type: 'text/plain' });
      case 'stl': {
        const data = new STLExporter().parse(root, { binary: true });
        return new Blob([data], { type: 'model/stl' });
      }
      default:
        throw new Error(`未対応の形式です: ${format}`);
    }
  }

  /** 作品一覧用の小さな見本画像（JPEG の data URL）。選択枠やギズモは写さない */
  captureThumbnail(width = 240, height = 150) {
    const prev = [this.helpers.visible, this.selectionBoxes.visible, this.transform.getHelper().visible];
    this.selectionBoxes.visible = false;
    this.transform.getHelper().visible = false;
    this.renderer.render(this.scene, this.camera);
    const src = this.renderer.domElement;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    // 縦横比を保って中央を切り抜く
    const scale = Math.max(width / src.width, height / src.height);
    const sw = width / scale;
    const sh = height / scale;
    canvas.getContext('2d').drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, width, height);
    [this.helpers.visible, this.selectionBoxes.visible, this.transform.getHelper().visible] = prev;
    return canvas.toDataURL('image/jpeg', 0.72);
  }

  async screenshot() {
    const prev = {
      helpers: this.helpers.visible,
      boxes: this.selectionBoxes.visible,
      gizmo: this.transform.getHelper().visible,
    };
    this.helpers.visible = false;
    this.selectionBoxes.visible = false;
    this.transform.getHelper().visible = false;
    this.renderer.render(this.scene, this.camera);
    const blob = await new Promise((resolve) => this.renderer.domElement.toBlob(resolve, 'image/png'));
    this.helpers.visible = prev.helpers;
    this.selectionBoxes.visible = prev.boxes;
    this.transform.getHelper().visible = prev.gizmo;
    return blob;
  }
}
