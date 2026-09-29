import { Editor } from './editor.js';
import { initOutliner, initPalette, initProperties } from './ui.js';
import { sampleScene } from './sample.js';
import { initPWA } from './pwa.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const editor = new Editor($('#viewport'));
initPalette($('#palette'), editor);
initOutliner($('#outliner'), editor);
initProperties($('#properties'), editor);

// ---------------------------------------------------------------- 通知

let toastTimer;
function toast(message, { error = false } = {}) {
  const t = $('#toast');
  t.textContent = message;
  t.classList.toggle('error', error);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------- 操作

const actions = {
  new: () => {
    if (editor.modelRoot.children.length && !confirm('今のモデルを消して新規作成しますか？')) return;
    editor.newScene();
    toast('新規作成しました');
  },
  open: () => $('#file-input').click(),
  save: () => {
    const json = JSON.stringify(editor.getSceneData(), null, 2);
    download(new Blob([json], { type: 'application/json' }), 'model.studio.json');
    toast('保存しました（model.studio.json）');
  },
  sample: () => {
    if (editor.modelRoot.children.length && !confirm('今のモデルを消してサンプルを開きますか？')) return;
    editor.loadScene(sampleScene());
    editor.focusSelected();
    toast('サンプルを読み込みました');
  },
  undo: () => editor.undo(),
  redo: () => editor.redo(),
  space: () => editor.toggleSpace(),
  snap: () => editor.setSnap(!editor.snapEnabled),
  duplicate: () => editor.duplicateSelected(),
  mirror: () => editor.mirrorDuplicate('x'),
  group: () => editor.groupSelected(),
  ungroup: () => editor.ungroupSelected(),
  ground: () => editor.dropToGround(),
  delete: () => editor.deleteSelected(),
  focus: () => editor.focusSelected(),
  grid: () => {
    editor.setHelpersVisible(!editor.helpers.visible);
    $('[data-action="grid"]').classList.toggle('active', editor.helpers.visible);
  },
};

for (const btn of $$('[data-action]')) btn.addEventListener('click', () => actions[btn.dataset.action]());
for (const btn of $$('[data-mode]')) btn.addEventListener('click', () => editor.setMode(btn.dataset.mode));
for (const btn of $$('[data-view]')) btn.addEventListener('click', () => editor.setView(btn.dataset.view));

for (const btn of $$('[data-export]')) {
  btn.addEventListener('click', async () => {
    btn.closest('details').open = false;
    const format = btn.dataset.export;
    try {
      if (format === 'png') {
        download(await editor.screenshot(), 'model.png');
      } else {
        if (!editor.modelRoot.children.length) {
          toast('書き出す部品がありません', { error: true });
          return;
        }
        download(await editor.exportModel(format), `model.${format}`);
      }
      toast(`${format.toUpperCase()} で書き出しました`);
    } catch (err) {
      console.error(err);
      toast(`書き出しに失敗しました: ${err.message}`, { error: true });
    }
  });
}

// メニューの外をクリックしたら閉じる
document.addEventListener('pointerdown', (e) => {
  for (const d of $$('details.menu[open]')) if (!d.contains(e.target)) d.open = false;
});

$('#file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    editor.loadScene(JSON.parse(await file.text()));
    editor.focusSelected();
    toast(`${file.name} を開きました`);
  } catch (err) {
    console.error(err);
    toast(`開けませんでした: ${err.message}`, { error: true });
  }
});

// ---------------------------------------------------------------- ボタンの状態

function updateButtons() {
  const hasSel = editor.selected.length > 0;
  const hasGroup = editor.selected.some((o) => o.userData.kind === 'group');
  $('[data-action="undo"]').disabled = !editor.history.canUndo;
  $('[data-action="redo"]').disabled = !editor.history.canRedo;
  for (const a of ['duplicate', 'mirror', 'group', 'ground', 'delete']) $(`[data-action="${a}"]`).disabled = !hasSel;
  $('[data-action="ungroup"]').disabled = !hasGroup;

  for (const btn of $$('[data-mode]')) btn.classList.toggle('active', btn.dataset.mode === editor.transform.mode);
  $('[data-action="space"]').textContent = editor.transform.space === 'local' ? 'ローカル' : 'ワールド';
  $('[data-action="snap"]').classList.toggle('active', editor.snapEnabled);
  $('[data-action="grid"]').classList.toggle('active', editor.helpers.visible);

  $('#empty-hint').classList.toggle('hidden', editor.modelRoot.children.length > 0);

  const n = editor.selected.length;
  let parts = 0;
  editor.modelRoot.traverse((o) => {
    if (o.userData.kind === 'primitive') parts += 1;
  });
  $('#status').textContent = `部品 ${parts} 個` + (n ? ` ／ ${n} 個選択中${n === 1 ? `：${editor.primary.name}` : ''}` : '');
}

for (const ev of ['selection', 'change', 'history', 'mode']) editor.addEventListener(ev, updateButtons);

// ---------------------------------------------------------------- ショートカット

window.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  const run = (fn) => {
    e.preventDefault();
    fn();
  };

  if (mod) {
    if (key === 'z' && e.shiftKey) return run(actions.redo);
    if (key === 'z') return run(actions.undo);
    if (key === 'y') return run(actions.redo);
    if (key === 'd') return run(actions.duplicate);
    if (key === 'g' && e.shiftKey) return run(actions.ungroup);
    if (key === 'g') return run(actions.group);
    if (key === 's') return run(actions.save);
    if (key === 'o') return run(actions.open);
    if (key === 'a') return run(() => editor.selectAll());
    return;
  }

  switch (key) {
    case 'w':
      return run(() => editor.setMode('translate'));
    case 'e':
      return run(() => editor.setMode('rotate'));
    case 'r':
      return run(() => editor.setMode('scale'));
    case 'q':
      return run(actions.space);
    case 'x':
      return run(actions.snap);
    case 'f':
      return run(actions.focus);
    case 'g':
      return run(actions.ground);
    case 'm':
      return run(actions.mirror);
    case 'delete':
    case 'backspace':
      return run(actions.delete);
    case 'escape':
      return run(() => editor.select([]));
    default:
  }
});

// ---------------------------------------------------------------- 起動

if (editor.restoreAutosave()) {
  editor.focusSelected();
  toast('前回の作業を復元しました');
}
updateButtons();
initPWA();

// デバッグ・自動テスト用
window.studio = editor;
