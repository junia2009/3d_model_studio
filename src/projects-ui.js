import { FORMAT, FORMAT_VERSION } from './serializer.js';
import { MAX_PROJECTS, ProjectFullError, ProjectStore, StorageError } from './projects.js';
import { getWorld } from './worlds/index.js';

const emptyScene = () => ({ format: FORMAT, version: FORMAT_VERSION, objects: [] });

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) node.append(c);
  return node;
}

function timeAgo(ms) {
  const sec = (Date.now() - ms) / 1000;
  if (sec < 60) return 'たった今';
  if (sec < 3600) return `${Math.floor(sec / 60)} 分前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} 時間前`;
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 作品（最大 5 件）の切り替え・新規・複製・名前変更・削除と、今の作品の自動保存。
 * lists: 一覧を描く要素、menus: 開いた後に閉じる <details>
 */
export function initProjects(editor, { lists, menus, nameLabels, toast }) {
  const store = new ProjectStore();
  let switching = false;
  let saveTimer = null;
  let thumbTimer = null;

  const fail = (err) => {
    console.error(err);
    toast(err instanceof ProjectFullError || err instanceof StorageError ? err.message : `保存できませんでした: ${err.message}`, {
      error: true,
      duration: 4000,
    });
  };

  // ---------------------------------------------------------------- 自動保存

  const saveNow = ({ thumb = false } = {}) => {
    clearTimeout(saveTimer);
    const cur = store.current;
    if (!cur || switching) return;
    try {
      store.save(cur.id, editor.getSceneData(), thumb ? { thumb: editor.captureThumbnail() } : {});
    } catch (err) {
      fail(err);
    }
  };

  const scheduleSave = () => {
    if (switching) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveNow();
      render();
    }, 400);
    // 見本画像は操作が落ち着いてから撮る
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(() => {
      const cur = store.current;
      if (!cur || switching) return;
      try {
        store.setThumb(cur.id, editor.captureThumbnail());
        render();
      } catch (err) {
        fail(err);
      }
    }, 1500);
  };

  editor.addEventListener('change', scheduleSave);
  editor.addEventListener('world', scheduleSave);
  // タブを閉じる・アプリを切り替えるときは、待たずに保存する
  const flush = () => {
    if (saveTimer || thumbTimer) {
      clearTimeout(thumbTimer);
      saveNow({ thumb: true });
    }
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });

  // ---------------------------------------------------------------- 切り替え

  const closeMenus = () => menus.forEach((m) => (m.open = false));

  /** 作品の中身をエディタに読み込む（読み込み中の変更は保存しない） */
  const loadIntoEditor = (item) => {
    switching = true;
    try {
      editor.loadScene(store.load(item.id) ?? emptyScene());
    } finally {
      switching = false;
    }
    // 中身があれば全体が見えるように、空なら最初の視点に
    if (editor.modelRoot.children.length) editor.focusSelected();
    else editor.resetView();
    render();
  };

  const open = (id) => {
    if (id === store.current?.id) {
      closeMenus();
      return;
    }
    saveNow({ thumb: true });
    try {
      store.setCurrent(id);
    } catch (err) {
      fail(err);
      return;
    }
    loadIntoEditor(store.get(id));
    closeMenus();
    toast(`「${store.get(id).name}」を開きました`);
  };

  /**
   * 新しい作品を作って開く。data を渡すとその内容で作る（サンプル・ファイル読み込み用）。
   * 5 件あって作れないときは false を返す。
   */
  const create = ({ data = null, name } = {}) => {
    if (store.isFull) {
      toast(`作品は ${MAX_PROJECTS} 件までです。どれかを削除してください`, { error: true, duration: 4000 });
      menus[0]?.setAttribute('open', '');
      return false;
    }
    saveNow({ thumb: true });
    try {
      // 新しい作品は今の世界を引き継ぐ
      const item = store.create(name ?? store.nextName(), data ?? { ...emptyScene(), world: editor.worldId });
      store.setCurrent(item.id);
      loadIntoEditor(item);
      // 読み込み後の見た目で見本画像を作る
      requestAnimationFrame(() => scheduleSave());
      closeMenus();
      toast(`「${item.name}」を作りました`);
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  };

  const rename = (id) => {
    const item = store.get(id);
    const name = prompt('作品の名前', item.name)?.trim();
    if (!name || name === item.name) return;
    try {
      store.rename(id, name);
    } catch (err) {
      fail(err);
    }
    render();
  };

  const duplicate = (id) => {
    if (store.isFull) {
      toast(`作品は ${MAX_PROJECTS} 件までです。どれかを削除してください`, { error: true, duration: 4000 });
      return;
    }
    if (id === store.current?.id) saveNow({ thumb: true });
    try {
      const copy = store.duplicate(id);
      toast(`「${copy.name}」を作りました`);
    } catch (err) {
      fail(err);
    }
    render();
  };

  const removeProject = (id) => {
    const item = store.get(id);
    if (!confirm(`「${item.name}」を削除しますか？\n元に戻せません。`)) return;
    const wasCurrent = id === store.current?.id;
    store.remove(id);
    if (wasCurrent) {
      // 残りの作品を開く。1 つもなければ空の作品を作る
      const next = store.items[0] ?? store.create(store.nextName(), { ...emptyScene(), world: editor.worldId });
      store.setCurrent(next.id);
      loadIntoEditor(next);
    }
    toast(`「${item.name}」を削除しました`);
    render();
  };

  // ---------------------------------------------------------------- 一覧の表示

  const render = () => {
    const cur = store.current;
    for (const label of nameLabels) label.textContent = cur?.name ?? '作品';
    for (const list of lists) {
      list.replaceChildren(
        el('div', { class: 'projects-head' }, el('h2', {}, '作品'), el('span', { class: 'badge' }, `${store.items.length} / ${MAX_PROJECTS}`)),
        ...store.items.map((item) => {
          const isCurrent = item.id === cur?.id;
          return el(
            'div',
            { class: `project-item${isCurrent ? ' current' : ''}` },
            el(
              'button',
              { class: 'project-open', title: isCurrent ? '編集中の作品' : 'この作品を開く', onclick: () => open(item.id) },
              item.thumb
                ? el('img', { class: 'project-thumb', src: item.thumb, alt: '' })
                : el('span', { class: 'project-thumb empty' }, '🧊'),
              el(
                'span',
                { class: 'project-meta' },
                el('span', { class: 'project-name' }, item.name),
                el(
                  'small',
                  {},
                  `部品 ${item.parts} 個・${timeAgo(item.updatedAt)}`,
                  item.world ? `・${getWorld(item.world)?.icon ?? ''}` : '',
                ),
                isCurrent ? el('span', { class: 'badge current-badge' }, '編集中') : null,
              ),
            ),
            el(
              'span',
              { class: 'project-actions' },
              el('button', { title: '名前を変更', 'aria-label': '名前を変更', onclick: () => rename(item.id) }, '✎'),
              el('button', { title: '複製', 'aria-label': '複製', onclick: () => duplicate(item.id), disabled: store.isFull }, '⧉'),
              el('button', { class: 'danger', title: '削除', 'aria-label': '削除', onclick: () => removeProject(item.id) }, '🗑'),
            ),
          );
        }),
        el(
          'button',
          { class: 'primary project-new', onclick: () => create(), disabled: store.isFull },
          '＋ 新しい作品',
        ),
        el(
          'p',
          { class: 'note' },
          store.isFull
            ? `${MAX_PROJECTS} 件まで保存できます。新しく作るには、不要な作品を削除してください（先に「保存」や「書き出し」でファイルに残せます）。`
            : `このブラウザに ${MAX_PROJECTS} 件まで自動で保存されます。`,
        ),
      );
    }
  };

  // 開くたびに「〇分前」を新しくする
  for (const m of menus) m.addEventListener('toggle', () => m.open && render());

  // ---------------------------------------------------------------- 起動

  /** 今の作品を開く（初回は空の作品を作る）。中身があれば true */
  const boot = () => {
    let item = store.current ?? store.items[0];
    if (!item) {
      try {
        item = store.create(store.nextName(), emptyScene());
      } catch (err) {
        fail(err);
      }
    }
    if (item) {
      try {
        store.setCurrent(item.id);
      } catch (err) {
        fail(err);
      }
      loadIntoEditor(item);
    }
    render();
    return editor.modelRoot.children.length > 0;
  };

  return {
    boot,
    create,
    open,
    get store() {
      return store;
    },
    get current() {
      return store.current;
    },
    /** 今の作品の中身を data で置き換える（5 件あって新しく作れないとき用） */
    replaceCurrent(data) {
      editor.loadScene(data);
      editor.focusSelected();
    },
  };
}
