import * as THREE from 'three';
import { clone as cloneWithBones } from 'three/addons/utils/SkeletonUtils.js';

/**
 * 取り込んだモデル（GLB / glTF）の保管庫。
 *
 * - 元のファイルはそのまま IndexedDB に保存する（localStorage では容量が足りないため）。
 *   作品のデータには「どのモデルか」を表す ID だけを書くので、作品の保存は軽いまま。
 * - ID はファイル内容のハッシュ。同じファイルを何度取り込んでも 1 つ分しか場所を取らない。
 * - 読み込んだモデルはメモリに置いておき、同じモデルを置くときは複製するだけにする。
 *   読み込み（IndexedDB からの取り出し・解析）は非同期なので、間に合わないときは仮の箱を置いておき、
 *   読み込めたら中身を差し替える（ready イベント）。
 * - 「保存」したファイル（.studio.json）には元のファイルを埋め込み、ほかの端末でも開けるようにする。
 */

const DB_NAME = 'three-model-studio';
const STORE = 'assets';
/** 取り込めるファイルの大きさの上限 */
export const MAX_ASSET_BYTES = 60 * 1024 * 1024;
export const MODEL_FILE_PATTERN = /\.(glb|gltf)$/i;

/** 読み込み済みのモデル id → { template, animations, info } */
const cache = new Map();
/** 読み込み中 id → Promise */
const pending = new Map();
/** 読み込めなかった id（何度も試さない） */
const failed = new Set();

export const assetEvents = new EventTarget();

// ---------------------------------------------------------------- IndexedDB

let dbPromise = null;
function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in globalThis)) {
        reject(new Error('このブラウザでは取り込んだモデルを保存できません'));
        return;
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('保存場所を開けませんでした'));
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result);
    t.onerror = () => reject(t.error ?? new Error('保存場所の読み書きに失敗しました'));
    t.onabort = () => reject(t.error ?? new Error('保存場所の容量が足りません'));
  });
}

const dbGet = (id) => tx('readonly', (s) => s.get(id));
const dbPut = (record) => tx('readwrite', (s) => s.put(record));
const dbDelete = (id) => tx('readwrite', (s) => s.delete(id));
const dbAll = () => tx('readonly', (s) => s.getAll());

// ---------------------------------------------------------------- 解析

let loaderPromise = null;
/** GLTFLoader などは取り込むときだけ読み込む（最初の表示を軽くするため） */
function getLoader() {
  if (!loaderPromise) {
    loaderPromise = Promise.all([
      import('three/examples/jsm/loaders/GLTFLoader.js'),
      import('three/examples/jsm/loaders/DRACOLoader.js'),
      import('three/examples/jsm/libs/meshopt_decoder.module.js'),
    ]).then(([{ GLTFLoader }, { DRACOLoader, DRACO_GLTF_CONFIG }, { MeshoptDecoder }]) => {
      const loader = new GLTFLoader();
      loader.setDRACOLoader(new DRACOLoader().setDecoderPath(DRACO_GLTF_CONFIG));
      loader.setMeshoptDecoder(MeshoptDecoder);
      return loader;
    });
  }
  return loaderPromise;
}

/** GLB / glTF のデータを解析して、置きやすい形（底面の中心が原点）に整える */
async function parseModel(data) {
  const loader = await getLoader();
  let gltf;
  try {
    gltf = await loader.parseAsync(data, '');
  } catch (err) {
    const msg = err?.message ?? (typeof err === 'string' ? err : '形式が正しくないか、壊れています');
    if (/KHR_texture_basisu|ktx2/i.test(msg)) throw new Error('KTX2 圧縮テクスチャを使ったファイルにはまだ対応していません');
    if (/Failed to load buffer|external|\.bin/i.test(msg)) {
      throw new Error('別ファイル（.bin や画像）を参照する glTF は読み込めません。GLB に変換してから取り込んでください');
    }
    throw new Error(`モデルを読み込めませんでした（${msg}）`);
  }
  const scene = gltf.scene ?? gltf.scenes?.[0];
  if (!scene) throw new Error('ファイルにモデルが入っていません');

  let meshes = 0;
  let triangles = 0;
  let skinned = false;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    meshes += 1;
    if (o.isSkinnedMesh) skinned = true;
    o.castShadow = true;
    o.receiveShadow = true;
    const g = o.geometry;
    triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  if (!meshes) throw new Error('ファイルに形（メッシュ）が入っていません');

  // 底面の中心を原点に。スタジオの部品と同じく「床に置ける」形にする
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const center = box.getCenter(new THREE.Vector3());
  const template = new THREE.Group();
  template.name = 'ModelContent';
  template.add(scene);
  scene.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
  template.updateMatrixWorld(true);

  return {
    template,
    animations: gltf.animations ?? [],
    info: {
      meshes,
      triangles: Math.round(triangles),
      skinned,
      size: box.getSize(new THREE.Vector3()).toArray(),
      animations: (gltf.animations ?? []).map((a) => a.name || 'アニメーション'),
    },
  };
}

// ---------------------------------------------------------------- 取り込み

/** glTF（.gltf）が別のファイル（.bin・画像）を参照していたら、分かりやすく断る */
function checkExternalFiles(data) {
  const head = new Uint8Array(data, 0, Math.min(4, data.byteLength));
  if (String.fromCharCode(...head) === 'glTF') return; // GLB はすべて 1 つのファイルに入っている
  let json;
  try {
    json = JSON.parse(new TextDecoder().decode(data));
  } catch {
    return; // 解析のときに分かりやすいエラーになる
  }
  const external = [...(json.buffers ?? []), ...(json.images ?? [])]
    .map((b) => b.uri)
    .filter((uri) => uri && !uri.startsWith('data:'));
  if (external.length) {
    throw new Error(
      `この glTF は別のファイル（${external.slice(0, 2).join('、')}${external.length > 2 ? ' など' : ''}）を使っています。1 つにまとまった GLB に変換してから取り込んでください`,
    );
  }
}

async function hashOf(buffer) {
  try {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // 安全でない接続などで使えないとき
    return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * ファイルを取り込む。解析できたら保管庫に保存し、{ id, name, info, stored } を返す。
 * stored が false のときは保存できなかった（この画面を閉じるまでは使える）。
 */
export async function importModelFile(file) {
  if (!MODEL_FILE_PATTERN.test(file.name)) throw new Error('GLB（.glb）か glTF（.gltf）のファイルを選んでください');
  if (file.size > MAX_ASSET_BYTES) {
    throw new Error(`ファイルが大きすぎます（${formatBytes(file.size)}）。${formatBytes(MAX_ASSET_BYTES)} までにしてください`);
  }
  const data = await file.arrayBuffer();
  checkExternalFiles(data);
  const id = await hashOf(data);
  const name = file.name.replace(MODEL_FILE_PATTERN, '') || 'モデル';
  const parsed = cache.get(id) ?? (await parseModel(data));
  cache.set(id, parsed);
  failed.delete(id);

  let stored = true;
  try {
    const existing = await dbGet(id);
    await dbPut({
      id,
      name: existing?.name ?? name,
      type: file.name.toLowerCase().endsWith('.gltf') ? 'gltf' : 'glb',
      data,
      bytes: data.byteLength,
      info: parsed.info,
      createdAt: existing?.createdAt ?? Date.now(),
      usedAt: Date.now(),
    });
    // 保存した物が勝手に消されにくいようにお願いしておく（断られても使える）
    navigator.storage?.persist?.().catch(() => {});
  } catch (err) {
    console.warn(err);
    stored = false;
  }
  assetEvents.dispatchEvent(new Event('library'));
  return { id, name, info: parsed.info, stored };
}

/** 取り込んだモデルの一覧（新しく使った順） */
export async function listAssets() {
  try {
    const all = await dbAll();
    return all
      .map(({ id, name, bytes, info, createdAt, usedAt }) => ({ id, name, bytes, info, createdAt, usedAt }))
      .sort((a, b) => (b.usedAt ?? 0) - (a.usedAt ?? 0));
  } catch {
    return [];
  }
}

export async function touchAsset(id) {
  try {
    const rec = await dbGet(id);
    if (rec) await dbPut({ ...rec, usedAt: Date.now() });
  } catch {
    // 並び順が変わらないだけ
  }
}

export async function deleteAsset(id) {
  await dbDelete(id);
  assetEvents.dispatchEvent(new Event('library'));
}

export async function renameAsset(id, name) {
  const rec = await dbGet(id);
  if (!rec) return;
  await dbPut({ ...rec, name });
  assetEvents.dispatchEvent(new Event('library'));
}

// ---------------------------------------------------------------- 使う

export function isAssetReady(id) {
  return cache.has(id);
}

export function assetInfo(id) {
  return cache.get(id)?.info ?? null;
}

export function assetAnimations(id) {
  return cache.get(id)?.animations ?? [];
}

export function isAssetMissing(id) {
  return failed.has(id);
}

/** 読み込まれていなければ保管庫から読み込む。読み込めたら true */
export function loadAsset(id) {
  if (cache.has(id)) return Promise.resolve(true);
  if (failed.has(id)) return Promise.resolve(false);
  if (!pending.has(id)) {
    const p = (async () => {
      try {
        const rec = await dbGet(id);
        if (!rec) throw new Error('見つかりません');
        cache.set(id, await parseModel(rec.data));
        return true;
      } catch (err) {
        console.warn(`モデル ${id} を読み込めませんでした`, err);
        failed.add(id);
        return false;
      } finally {
        pending.delete(id);
        assetEvents.dispatchEvent(new CustomEvent('ready', { detail: { id } }));
      }
    })();
    pending.set(id, p);
  }
  return pending.get(id);
}

/**
 * モデルの複製を作る（形・色・模様は元と共有）。読み込まれていなければ null。
 * 骨のあるモデルも正しく動くよう SkeletonUtils で複製する。
 */
export function instantiateAsset(id) {
  const entry = cache.get(id);
  if (!entry) return null;
  const copy = cloneWithBones(entry.template);
  copy.userData = { assetContent: true };
  return copy;
}

/** 読み込み中・見つからないときに代わりに置く箱 */
export function createPlaceholder(missing = false) {
  const geometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const material = new THREE.MeshStandardMaterial({
    color: missing ? '#ff6b6b' : '#9aa0aa',
    wireframe: true,
    transparent: true,
    opacity: 0.8,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = missing ? '見つからないモデル' : '読み込み中のモデル';
  mesh.userData = { assetPlaceholder: true };
  return mesh;
}

// ---------------------------------------------------------------- 保存ファイルへの埋め込み

const toBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

const fromBase64 = (text) => {
  const s = atob(text);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
};

/** シーンのデータから使っているモデルの ID を集める */
export function collectAssetIds(nodes, out = new Set()) {
  for (const n of nodes ?? []) {
    if (n.kind === 'model' && n.asset) out.add(n.asset);
    collectAssetIds(n.children, out);
  }
  return out;
}

/** 保存ファイル用に、使っているモデルの元データを集める。見つからない ID は含めない */
export async function packAssets(ids) {
  const out = {};
  for (const id of ids) {
    const rec = await dbGet(id).catch(() => null);
    if (rec) out[id] = { name: rec.name, type: rec.type, data: toBase64(rec.data) };
  }
  return out;
}

/** 保存ファイルに埋め込まれたモデルを保管庫に入れる（読み込みも済ませる） */
export async function unpackAssets(assets) {
  for (const [id, a] of Object.entries(assets ?? {})) {
    if (!a?.data) continue;
    const data = fromBase64(a.data);
    if (!cache.has(id)) {
      try {
        cache.set(id, await parseModel(data));
        failed.delete(id);
      } catch (err) {
        console.warn(err);
        continue;
      }
    }
    try {
      const existing = await dbGet(id);
      if (!existing) {
        await dbPut({ id, name: a.name ?? 'モデル', type: a.type ?? 'glb', data, bytes: data.byteLength, info: cache.get(id).info, createdAt: Date.now(), usedAt: Date.now() });
      }
    } catch (err) {
      console.warn(err);
    }
  }
  assetEvents.dispatchEvent(new Event('library'));
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
