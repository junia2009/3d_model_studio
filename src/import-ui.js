import {
  MODEL_FILE_PATTERN,
  assetEvents,
  deleteAsset,
  formatBytes,
  importModelFile,
  listAssets,
  loadAsset,
  touchAsset,
} from './assets.js';

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

/**
 * 「取り込み」タブ：GLB / glTF ファイルを選んでモデルとして置く。
 * 一度取り込んだモデルはこのブラウザに保存され、一覧からいつでもまた置ける。
 */
export function initModelImport(editor, { toast, onPlaced }) {
  // iPhone では accept に拡張子を書くと .glb が選べなくなることがあるため、何でも選べるようにして中身で判定する
  const input = el('input', { type: 'file', multiple: true, hidden: true });
  document.body.append(input);
  input.addEventListener('change', () => {
    const files = [...input.files];
    input.value = '';
    importFiles(files);
  });

  let grid = null;
  let busy = false;

  /** モデルのファイルを取り込んで置く。取り込めた数を返す */
  async function importFiles(files) {
    const models = files.filter((f) => MODEL_FILE_PATTERN.test(f.name));
    if (!models.length) {
      toast('GLB（.glb）か glTF（.gltf）のファイルを選んでください', { error: true });
      return 0;
    }
    busy = true;
    render();
    let placed = 0;
    for (const file of models) {
      toast(`「${file.name}」を読み込んでいます…`, { duration: 60000 });
      try {
        const { id, name, info, stored } = await importModelFile(file);
        const { fitted } = editor.addModel(id, name, info);
        placed += 1;
        const notes = [];
        if (fitted) notes.push('大きさを合わせました');
        if (info.animations.length) notes.push(`アニメーション ${info.animations.length} 個`);
        toast(`「${name}」を置きました${notes.length ? `（${notes.join('・')}）` : ''}`, { duration: 3000 });
        if (!stored) {
          toast('このブラウザにはモデルを保存できませんでした。画面を閉じると消えるので、「保存」でファイルに残してください', {
            error: true,
            duration: 6000,
          });
        }
      } catch (err) {
        console.error(err);
        toast(`「${file.name}」を取り込めませんでした: ${err.message}`, { error: true, duration: 6000 });
      }
    }
    busy = false;
    render();
    if (placed) onPlaced?.();
    return placed;
  }

  async function placeFromLibrary(item) {
    const ok = await loadAsset(item.id);
    if (!ok) {
      toast(`「${item.name}」を読み込めませんでした`, { error: true });
      return;
    }
    const { fitted } = editor.addModel(item.id, item.name, item.info);
    touchAsset(item.id);
    toast(`「${item.name}」を置きました${fitted ? '（大きさを合わせました）' : ''}`);
    onPlaced?.();
  }

  async function removeFromLibrary(item) {
    if (!confirm(`「${item.name}」をこのブラウザから削除しますか？\nこのモデルを使っている作品では、モデルが赤い枠だけになります。`)) return;
    try {
      await deleteAsset(item.id);
      toast(`「${item.name}」を削除しました`);
    } catch (err) {
      toast(`削除できませんでした: ${err.message}`, { error: true });
    }
  }

  async function render() {
    if (!grid || !grid.isConnected) return;
    const target = grid;
    const items = await listAssets();
    if (target !== grid) return;
    target.replaceChildren(
      el(
        'div',
        { class: 'import-panel' },
        el(
          'button',
          { class: 'import-button', disabled: busy, onclick: () => input.click() },
          el('span', { class: 'icon' }, '📦'),
          el('span', { class: 'import-label' }, busy ? '読み込み中…' : 'ファイルを選ぶ', el('small', {}, 'GLB / glTF')),
        ),
        el(
          'p',
          { class: 'note' },
          'ほかのアプリで作ったモデルを置けます。',
          matchMedia('(pointer:fine)').matches ? '3D 画面にファイルをドラッグ＆ドロップしても取り込めます。' : '',
        ),
        items.length ? el('h4', {}, 'このブラウザに取り込んだモデル') : null,
        el(
          'ul',
          { class: 'asset-list' },
          items.map((item) =>
            el(
              'li',
              {},
              el(
                'button',
                { class: 'asset-add', title: `「${item.name}」を置く`, onclick: () => placeFromLibrary(item) },
                el('span', { class: 'asset-name' }, item.name),
                el(
                  'small',
                  {},
                  [
                    formatBytes(item.bytes ?? 0),
                    item.info ? `${item.info.triangles.toLocaleString()} 三角形` : '',
                    item.info?.animations?.length ? `アニメ ${item.info.animations.length}` : '',
                  ]
                    .filter(Boolean)
                    .join(' · '),
                ),
              ),
              el('button', { class: 'asset-delete', title: '削除', 'aria-label': `「${item.name}」を削除`, onclick: () => removeFromLibrary(item) }, '✕'),
            ),
          ),
        ),
      ),
    );
  }

  assetEvents.addEventListener('library', render);

  // ---- PC：3D 画面へのドラッグ＆ドロップ
  const viewport = editor.container;
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  viewport.addEventListener('dragover', (e) => {
    if (!hasFiles(e) || editor.playing) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    viewport.classList.add('drop-target');
  });
  viewport.addEventListener('dragleave', (e) => {
    if (!viewport.contains(e.relatedTarget)) viewport.classList.remove('drop-target');
  });
  viewport.addEventListener('drop', (e) => {
    if (!hasFiles(e) || editor.playing) return;
    e.preventDefault();
    viewport.classList.remove('drop-target');
    importFiles([...e.dataTransfer.files]);
  });

  return {
    importFiles,
    pick: () => input.click(),
    /** パレットのタブとして表示する */
    tab: {
      id: 'import',
      label: '📦 取り込み',
      render: (container) => {
        grid = container;
        container.replaceChildren();
        render();
      },
    },
  };
}
