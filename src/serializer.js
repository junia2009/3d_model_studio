import * as THREE from 'three';
import { PRIMITIVES, buildGeometry, defaultParams } from './primitives.js';
import { createPlaceholder, instantiateAsset, isAssetMissing, loadAsset } from './assets.js';

export const FORMAT = 'three-model-studio';
export const FORMAT_VERSION = 1;

let idCounter = 0;
export function newId() {
  idCounter += 1;
  return `${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export const DEFAULT_MATERIAL = {
  color: '#4f8cff',
  metalness: 0.1,
  roughness: 0.5,
  opacity: 1,
  wireframe: false,
  flatShading: false,
};

export function createMaterial(props = {}) {
  const material = new THREE.MeshStandardMaterial();
  applyMaterialProps(material, { ...DEFAULT_MATERIAL, ...props });
  return material;
}

export function applyMaterialProps(material, props) {
  if ('color' in props) material.color.set(props.color);
  if ('metalness' in props) material.metalness = props.metalness;
  if ('roughness' in props) material.roughness = props.roughness;
  if ('opacity' in props) {
    material.opacity = props.opacity;
    material.transparent = props.opacity < 1;
    material.depthWrite = props.opacity >= 1;
  }
  if ('wireframe' in props) material.wireframe = props.wireframe;
  if ('flatShading' in props) material.flatShading = props.flatShading;
  material.needsUpdate = true;
}

export function readMaterialProps(material) {
  return {
    color: `#${material.color.getHexString()}`,
    metalness: material.metalness,
    roughness: material.roughness,
    opacity: material.opacity,
    wireframe: material.wireframe,
    flatShading: material.flatShading,
  };
}

/** プリミティブのメッシュを作る */
export function createPrimitive(type, { params, material, name } = {}) {
  const p = { ...defaultParams(type), ...params };
  const mesh = new THREE.Mesh(buildGeometry(type, p), createMaterial(material));
  mesh.name = name ?? PRIMITIVES[type].label;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { id: newId(), kind: 'primitive', type, params: p };
  return mesh;
}

export function createGroup(name = 'グループ') {
  const group = new THREE.Group();
  group.name = name;
  group.userData = { id: newId(), kind: 'group' };
  return group;
}

/**
 * 取り込んだモデル（GLB など）。中身はスタジオの部品ではない（編集できない）ひとかたまりとして扱う。
 * 中身がまだ読み込まれていなければ仮の箱を置き、読み込めたら差し替える。
 */
export function createModel(asset, name = 'モデル') {
  const group = new THREE.Group();
  group.name = name;
  group.userData = { id: newId(), kind: 'model', asset };
  fillModel(group);
  return group;
}

/** モデルの中身（または仮の箱）を入れ直す。中身が入ったら true */
export function fillModel(group) {
  const content = instantiateAsset(group.userData.asset);
  for (const c of [...group.children]) {
    if (c.userData.assetContent || c.userData.assetPlaceholder) {
      group.remove(c);
      if (c.userData.assetPlaceholder) disposeObject(c);
    }
  }
  if (content) {
    group.add(content);
    return true;
  }
  group.add(createPlaceholder(isAssetMissing(group.userData.asset)));
  if (!isAssetMissing(group.userData.asset)) loadAsset(group.userData.asset);
  return false;
}

export function isStudioObject(obj) {
  const kind = obj?.userData?.kind;
  return kind === 'primitive' || kind === 'group' || kind === 'model';
}

/** 3D 画面で当たった物から、それを含むスタジオの部品（取り込みモデルの中身ならモデル）を探す */
export function studioOwner(obj) {
  let found = null;
  for (let o = obj; o; o = o.parent) {
    if (o.userData?.kind === 'model') return o;
    if (!found && isStudioObject(o)) found = o;
  }
  return found;
}

// ---- シリアライズ ----

const r = (n) => Math.round(n * 1e5) / 1e5;

export function serializeObject(obj) {
  const node = {
    id: obj.userData.id,
    kind: obj.userData.kind,
    name: obj.name,
    visible: obj.visible,
    position: obj.position.toArray().map(r),
    rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z].map(r),
    scale: obj.scale.toArray().map(r),
  };
  if (obj.userData.kind === 'primitive') {
    node.type = obj.userData.type;
    node.params = { ...obj.userData.params };
    node.material = readMaterialProps(obj.material);
  }
  if (obj.userData.kind === 'model') node.asset = obj.userData.asset;
  // 遊ぶモードでの役割（足・腕など）。自動のときは保存しない
  if (obj.userData.role) node.role = obj.userData.role;
  const children = obj.children.filter(isStudioObject);
  if (children.length) node.children = children.map(serializeObject);
  return node;
}

export function deserializeObject(node) {
  let obj;
  if (node.kind === 'group') {
    obj = createGroup(node.name);
  } else if (node.kind === 'model') {
    obj = createModel(node.asset, node.name);
  } else {
    if (!PRIMITIVES[node.type]) throw new Error(`未知の部品タイプです: ${node.type}`);
    obj = createPrimitive(node.type, { params: node.params, material: node.material, name: node.name });
  }
  if (node.id) obj.userData.id = node.id;
  if (node.role) obj.userData.role = node.role;
  obj.visible = node.visible ?? true;
  if (node.position) obj.position.fromArray(node.position);
  if (node.rotation) obj.rotation.set(node.rotation[0], node.rotation[1], node.rotation[2]);
  if (node.scale) obj.scale.fromArray(node.scale);
  for (const child of node.children ?? []) obj.add(deserializeObject(child));
  return obj;
}

export function serializeScene(root) {
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    objects: root.children.filter(isStudioObject).map(serializeObject),
  };
}

export function validateSceneData(data) {
  if (!data || data.format !== FORMAT || !Array.isArray(data.objects)) {
    throw new Error('3D Model Studio のファイルではありません');
  }
  return data;
}

/** オブジェクト（と子孫）が持つ GPU リソースを解放する */
export function disposeObject(obj) {
  obj.traverse((o) => {
    // 取り込んだモデルの形・色は、ほかの複製と共有しているので解放しない
    if (o.isMesh && !isSharedAsset(o)) {
      o.geometry.dispose();
      o.material.dispose();
    }
  });
}

function isSharedAsset(obj) {
  for (let o = obj; o; o = o.parent) if (o.userData?.assetContent) return true;
  return false;
}

/** 複製時に新しい ID を振り直す */
export function reassignIds(obj) {
  obj.traverse((o) => {
    if (isStudioObject(o)) o.userData.id = newId();
  });
}
