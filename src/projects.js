/**
 * 作品（プロジェクト）の保存場所。ブラウザの localStorage に最大 MAX_PROJECTS 件まで持つ。
 *
 *   three-model-studio:projects        一覧 { currentId, items: [{ id, name, createdAt, updatedAt, parts, world, thumb }] }
 *   three-model-studio:project:<id>    その作品のシーンデータ（JSON 文字列）
 *
 * 一覧とデータを分けているのは、一覧を表示するだけで全作品のデータを読まずに済ませるため。
 */

export const MAX_PROJECTS = 5;

const INDEX_KEY = 'three-model-studio:projects';
const DATA_PREFIX = 'three-model-studio:project:';
// 作品機能より前の、1 つだけの自動保存
const LEGACY_AUTOSAVE_KEY = 'three-model-studio:autosave';
const LEGACY_WORLD_KEY = 'three-model-studio:world';

export class ProjectFullError extends Error {
  constructor() {
    super(`作品は ${MAX_PROJECTS} 件までです。どれかを削除してください`);
  }
}

export class StorageError extends Error {
  constructor(cause) {
    super('ブラウザの保存容量が足りないか、保存が許可されていません');
    this.cause = cause;
  }
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    throw new StorageError(err);
  }
}

function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // 消せなくても一覧から外れていれば実害はない
  }
}

export class ProjectStore {
  constructor() {
    this.index = this._loadIndex();
    this._migrateLegacy();
  }

  _loadIndex() {
    try {
      const idx = JSON.parse(read(INDEX_KEY));
      if (idx && Array.isArray(idx.items)) return idx;
    } catch {
      // 壊れていれば作り直す
    }
    return { currentId: null, items: [] };
  }

  _saveIndex() {
    write(INDEX_KEY, JSON.stringify(this.index));
  }

  /** 以前の「1 つだけの自動保存」を、最初の作品として引き継ぐ */
  _migrateLegacy() {
    const legacy = read(LEGACY_AUTOSAVE_KEY);
    if (!legacy || this.index.items.length) return;
    try {
      const data = JSON.parse(legacy);
      const world = read(LEGACY_WORLD_KEY);
      if (world) data.world = world;
      const item = this.create('作品 1', data);
      this.index.currentId = item.id;
      this._saveIndex();
      remove(LEGACY_AUTOSAVE_KEY);
      remove(LEGACY_WORLD_KEY);
    } catch (err) {
      console.warn('以前の自動保存を引き継げませんでした', err);
    }
  }

  get items() {
    return this.index.items;
  }

  get isFull() {
    return this.items.length >= MAX_PROJECTS;
  }

  get current() {
    return this.items.find((p) => p.id === this.index.currentId) ?? null;
  }

  get(id) {
    return this.items.find((p) => p.id === id) ?? null;
  }

  /** 使われていない「作品 N」の名前 */
  nextName() {
    const used = new Set(this.items.map((p) => p.name));
    for (let n = 1; ; n++) if (!used.has(`作品 ${n}`)) return `作品 ${n}`;
  }

  /** 新しい作品を作る（まだ「今の作品」にはしない） */
  create(name = this.nextName(), data = null, { thumb = null } = {}) {
    if (this.isFull) throw new ProjectFullError();
    const now = Date.now();
    const item = {
      id: newId(),
      name,
      createdAt: now,
      updatedAt: now,
      parts: countParts(data),
      world: data?.world ?? null,
      thumb,
    };
    if (data) write(DATA_PREFIX + item.id, JSON.stringify(data));
    this.index.items.push(item);
    this._saveIndex();
    return item;
  }

  load(id) {
    const raw = read(DATA_PREFIX + id);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /** シーンデータ（と見本画像）を保存する */
  save(id, data, { thumb } = {}) {
    const item = this.get(id);
    if (!item) return;
    write(DATA_PREFIX + id, JSON.stringify(data));
    item.updatedAt = Date.now();
    item.parts = countParts(data);
    item.world = data.world ?? item.world;
    if (thumb !== undefined) item.thumb = thumb;
    this._saveIndex();
  }

  setThumb(id, thumb) {
    const item = this.get(id);
    if (!item) return;
    item.thumb = thumb;
    this._saveIndex();
  }

  setCurrent(id) {
    this.index.currentId = id;
    this._saveIndex();
  }

  rename(id, name) {
    const item = this.get(id);
    if (!item) return;
    item.name = name;
    this._saveIndex();
  }

  duplicate(id) {
    const src = this.get(id);
    if (!src) return null;
    const copy = this.create(`${src.name} のコピー`, this.load(id), { thumb: src.thumb });
    // 一覧で元の作品のすぐ後ろに並べる
    const items = this.index.items;
    items.splice(items.indexOf(copy), 1);
    items.splice(items.indexOf(src) + 1, 0, copy);
    this._saveIndex();
    return copy;
  }

  remove(id) {
    this.index.items = this.items.filter((p) => p.id !== id);
    if (this.index.currentId === id) this.index.currentId = null;
    remove(DATA_PREFIX + id);
    this._saveIndex();
  }
}

function countParts(data) {
  let n = 0;
  const walk = (nodes) => {
    for (const node of nodes ?? []) {
      if (node.kind === 'primitive') n += 1;
      walk(node.children);
    }
  };
  walk(data?.objects);
  return n;
}
