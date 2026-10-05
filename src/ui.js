import * as THREE from 'three';
import { CATEGORIES, PRIMITIVES } from './primitives.js';
import { WORLD_GROUPS, getWorld } from './worlds/index.js';
import { ROLE_LABELS, ROLE_OPTIONS, guessRole, resolveRole } from './play.js';
import { readMaterialProps } from './serializer.js';
import { assetInfo, isAssetMissing } from './assets.js';

const SWATCHES = [
  '#f5f5f5', '#9aa0aa', '#3a3d45', '#ff5d5d', '#ff9f43',
  '#ffd43b', '#51cf66', '#22b8cf', '#4f8cff', '#b197fc',
  '#f783ac', '#c08457', '#7a4b2a', '#2f9e44', '#1c3d7a',
  '#ffe8cc', '#ffc9c9', '#d3f9d8', '#d0ebff', '#e5dbff',
];

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) node.append(c);
  return node;
}

const fmt = (n, digits = 3) => {
  const v = Number(n.toFixed(digits));
  return Object.is(v, -0) ? '0' : String(v);
};

// ================================================================ パレット

/**
 * @param extraTabs 部品以外のタブ（取り込みなど）：{ id, label, render(grid) }
 */
export function initPalette(container, editor, extraTabs = []) {
  const tabs = el('div', { class: 'palette-tabs', role: 'tablist' });
  const grid = el('div', { class: 'palette' });
  container.replaceChildren(tabs, grid);

  const show = (categoryId) => {
    for (const t of tabs.children) t.classList.toggle('active', t.dataset.category === categoryId);
    const extra = extraTabs.find((t) => t.id === categoryId);
    grid.classList.toggle('palette-extra', !!extra);
    if (extra) extra.render(grid);
    else grid.replaceChildren(
      ...CATEGORIES.find((c) => c.id === categoryId).types.map((type) => {
        const def = PRIMITIVES[type];
        return el(
          'button',
          { title: `${def.label}を追加`, onclick: () => editor.addPrimitive(type) },
          el('span', { class: 'icon' }, def.icon),
          el('span', {}, def.label),
        );
      }),
    );
    try {
      localStorage.setItem('three-model-studio:palette-tab', categoryId);
    } catch {
      // 覚えられなくても表示には困らない
    }
  };

  for (const c of CATEGORIES) {
    tabs.append(el('button', { role: 'tab', dataset: { category: c.id }, onclick: () => show(c.id) }, `${c.label}`, el('small', {}, c.types.length)));
  }
  for (const t of extraTabs) {
    tabs.append(el('button', { role: 'tab', class: 'tab-extra', dataset: { category: t.id }, onclick: () => show(t.id) }, t.label));
  }
  let initial = CATEGORIES[0].id;
  try {
    const saved = localStorage.getItem('three-model-studio:palette-tab');
    if (CATEGORIES.some((c) => c.id === saved) || extraTabs.some((t) => t.id === saved)) initial = saved;
  } catch {
    // 最初のタブのまま
  }
  show(initial);
  return { show };
}

// ================================================================ アウトライナー

export function initOutliner(container, editor) {
  const collapsed = new Set();

  const render = () => {
    container.replaceChildren();
    const roots = editor.modelRoot.children.filter((o) => o.userData.kind);
    if (!roots.length) {
      container.append(el('div', { class: 'empty' }, 'まだ部品がありません'));
    }
    for (const o of roots) addRow(o, 0);
    // 一番下の余白：ここにドロップするとトップレベルの末尾へ移動
    container.append(el('div', { class: 'root-drop' }));
    updateSelection();
  };

  const addRow = (obj, depth) => {
    const isGroup = obj.userData.kind === 'group';
    const hasChildren = obj.children.some((c) => c.userData.kind);
    const isCollapsed = collapsed.has(obj.userData.id);

    const name = el('span', { class: 'name', title: 'ダブルクリックで名前を変更' }, obj.name || '(名前なし)');
    const handle = el('span', { class: 'handle', title: 'ドラッグで移動', 'aria-hidden': 'true' }, '⠿');
    const row = el(
      'div',
      {
        class: `tree-row${obj.visible ? '' : ' hidden-obj'}`,
        dataset: { id: obj.userData.id },
        style: `padding-left:${4 + depth * 16}px`,
      },
      handle,
      el(
        'span',
        {
          class: 'twisty',
          onclick: (e) => {
            e.stopPropagation();
            if (!hasChildren) return;
            if (isCollapsed) collapsed.delete(obj.userData.id);
            else collapsed.add(obj.userData.id);
            render();
          },
        },
        hasChildren ? (isCollapsed ? '▸' : '▾') : '',
      ),
      el('span', { class: 'kind' }, isGroup ? '📁' : obj.userData.kind === 'model' ? '📦' : PRIMITIVES[obj.userData.type]?.icon ?? '?'),
      name,
      el(
        'button',
        {
          class: 'eye',
          title: obj.visible ? '非表示にする' : '表示する',
          'aria-label': obj.visible ? '非表示にする' : '表示する',
          onclick: (e) => {
            e.stopPropagation();
            editor.setVisible(obj, !obj.visible);
          },
        },
        obj.visible ? '👁' : '◌',
      ),
    );

    // 長押しで選択に追加（タッチ端末向け）。長押し直後の click は無視する
    let pressTimer = null;
    let longPressed = false;
    let pressStart = null;
    const cancelPress = () => {
      clearTimeout(pressTimer);
      pressTimer = null;
    };
    row.addEventListener('pointerdown', (e) => {
      longPressed = false;
      if (e.pointerType === 'mouse' || e.target.closest('.handle, .eye, .twisty')) return;
      pressStart = { x: e.clientX, y: e.clientY };
      pressTimer = setTimeout(() => {
        pressTimer = null;
        longPressed = true;
        navigator.vibrate?.(15);
        editor.addToSelection(obj);
      }, 500);
    });
    row.addEventListener('pointermove', (e) => {
      if (pressTimer && Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > 10) cancelPress();
    });
    row.addEventListener('pointerup', cancelPress);
    row.addEventListener('pointercancel', cancelPress);
    row.addEventListener('contextmenu', (e) => e.preventDefault());
    row.addEventListener('click', (e) => {
      if (longPressed) {
        longPressed = false;
        return;
      }
      editor.select([obj], { toggle: e.shiftKey || e.ctrlKey || e.metaKey || editor.multiSelect });
    });
    name.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startRename(name, obj);
    });
    enableDrag(handle, row, obj);

    container.append(row);
    if (hasChildren && !isCollapsed) {
      for (const c of obj.children) if (c.userData.kind) addRow(c, depth + 1);
    }
  };

  /**
   * ⠿ ハンドルからのドラッグ＆ドロップ。
   * HTML5 の Drag and Drop は iPhone / iPad のタッチで動かないため、Pointer Events で自前実装する。
   */
  const enableDrag = (handle, row, obj) => {
    handle.addEventListener('click', (e) => e.stopPropagation());
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      const start = { x: e.clientX, y: e.clientY };
      let ghost = null;
      let drop = null;
      let scrollTimer = null;

      const move = (ev) => {
        if (!ghost) {
          if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
          ghost = el('div', { class: 'drag-ghost' }, obj.name);
          document.body.append(ghost);
          row.classList.add('dragging');
        }
        ghost.style.left = `${ev.clientX}px`;
        ghost.style.top = `${ev.clientY}px`;
        drop = findDrop(ev.clientX, ev.clientY, obj);
        clearDropMarks();
        drop?.el.classList.add(drop.zone === 'into' ? 'drop-into' : 'drop-before');

        // 端に来たら自動スクロール
        clearInterval(scrollTimer);
        const rect = container.getBoundingClientRect();
        const dir = ev.clientY < rect.top + 28 ? -1 : ev.clientY > rect.bottom - 28 ? 1 : 0;
        if (dir) scrollTimer = setInterval(() => (container.scrollTop += dir * 8), 16);
      };
      const end = (ev) => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', end);
        clearInterval(scrollTimer);
        ghost?.remove();
        row.classList.remove('dragging');
        clearDropMarks();
        if (!ghost || ev.type === 'pointercancel' || !drop) return;
        if (drop.zone === 'root') editor.reparent(obj, editor.modelRoot);
        else if (drop.zone === 'into') editor.reparent(obj, drop.target);
        else editor.reparent(obj, drop.target.parent, drop.target);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    });
  };

  /** 指 / マウスの位置からドロップ先を求める。グループ行の下 2/3 なら「中へ」、それ以外は「前へ」 */
  const findDrop = (x, y, dragged) => {
    const target = document.elementFromPoint(x, y)?.closest('.tree-row, .root-drop');
    if (!target || !container.contains(target)) return null;
    if (target.classList.contains('root-drop')) return { el: target, zone: 'root' };
    const obj = editor.findById(target.dataset.id);
    if (!obj || obj === dragged) return null;
    // 自分の子孫の中には入れられない
    for (let p = obj; p; p = p.parent) if (p === dragged) return null;
    const rect = target.getBoundingClientRect();
    const into = obj.userData.kind === 'group' && y - rect.top > rect.height / 3;
    return { el: target, target: obj, zone: into ? 'into' : 'before' };
  };

  const clearDropMarks = () => {
    container.querySelectorAll('.drop-into, .drop-before').forEach((r) => r.classList.remove('drop-into', 'drop-before'));
  };

  const startRename = (span, obj) => {
    const input = el('input', { type: 'text', value: obj.name });
    span.replaceChildren(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      if (save && input.value.trim() && input.value !== obj.name) editor.rename(obj, input.value.trim());
      else render();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (e) => e.stopPropagation());
  };

  const updateSelection = () => {
    const ids = new Set(editor.selected.map((o) => o.userData.id));
    const primaryId = editor.primary?.userData.id;
    for (const row of container.querySelectorAll('.tree-row')) {
      row.classList.toggle('selected', ids.has(row.dataset.id));
      row.classList.toggle('primary', row.dataset.id === primaryId);
    }
    // 選択した行が折りたたまれたグループの中にある場合は開く
    let reopened = false;
    for (const o of editor.selected) {
      for (let p = o.parent; p && p !== editor.modelRoot; p = p.parent) {
        if (collapsed.delete(p.userData.id)) reopened = true;
      }
    }
    if (reopened) render();
  };

  editor.addEventListener('change', render);
  editor.addEventListener('selection', updateSelection);
  render();
}

// ================================================================ プロパティ

export function initProperties(container, editor) {
  let structureKey = '';
  let syncers = [];

  const render = () => {
    // 選択や中身の部品構成が変わったときだけ作り直し、それ以外は値の更新だけにする（入力中のフォーカスを保つため）
    const key = [
      editor.selected.map((o) => `${o.userData.id}:${o.userData.type ?? 'g'}`).join('|'),
      editor.selectedMeshes().map((m) => m.userData.id).join(','),
    ].join('#');
    if (key === structureKey) {
      sync();
      return;
    }
    structureKey = key;
    syncers = [];
    container.replaceChildren();

    const obj = editor.primary;
    if (!obj) {
      container.append(
        el(
          'div',
          { class: 'props-empty' },
          '何も選択されていません。',
          el('br'),
          '3D 画面か一覧で部品をクリック（タップ）すると、ここで位置・大きさ・色などを編集できます。',
        ),
      );
      return;
    }

    const isGroup = obj.userData.kind === 'group';
    const isModel = obj.userData.kind === 'model';
    const typeLabel = isGroup ? 'グループ' : isModel ? '取り込んだモデル' : PRIMITIVES[obj.userData.type].label;

    if (editor.selected.length > 1) {
      container.append(
        el(
          'p',
          { class: 'note' },
          `${editor.selected.length} 個を選択中。ギズモでまとめて動かせます。下の値は最後に選んだ「${obj.name}」のもの、色は全部に適用されます。`,
        ),
      );
    }

    // ---- 基本
    container.append(
      field('名前', textInput(() => obj.name, (v) => editor.rename(obj, v))),
      field('種類', el('span', {}, el('span', { class: 'badge' }, typeLabel))),
      field('動きの役割', roleSelect(obj)),
    );

    // ---- トランスフォーム
    container.append(el('h3', {}, 'トランスフォーム'));
    container.append(
      vecField('位置', 0.05, () => obj.position.toArray(), (v) => editor.updateTransform(obj, { position: v })),
      vecField(
        '回転 (°)',
        1,
        () => [obj.rotation.x, obj.rotation.y, obj.rotation.z].map((r) => THREE.MathUtils.radToDeg(r)),
        (v) => editor.updateTransform(obj, { rotation: v }),
        1,
      ),
      vecField('スケール', 0.05, () => obj.scale.toArray(), (v) => editor.updateTransform(obj, { scale: v })),
      field(
        '一律スケール',
        numberInput({
          step: 0.05,
          get: () => (obj.scale.x + obj.scale.y + obj.scale.z) / 3,
          set: (v) => {
            const avg = (obj.scale.x + obj.scale.y + obj.scale.z) / 3 || 1;
            const k = v / avg;
            editor.updateTransform(obj, { scale: obj.scale.toArray().map((s) => s * k) });
          },
        }),
        true,
      ),
    );

    // ---- 取り込んだモデルの情報
    if (isModel) {
      const info = assetInfo(obj.userData.asset);
      container.append(el('h3', {}, 'モデルの情報'));
      if (!info) {
        container.append(
          el('p', { class: 'note' }, isAssetMissing(obj.userData.asset)
            ? 'このモデルのデータが見つかりません。元のファイルを「取り込み」からもう一度読み込むか、モデルを埋め込んだ保存ファイルを開いてください。'
            : '読み込み中…'),
        );
      } else {
        const [w, h, d] = info.size.map((v) => fmt(v * 1, 2));
        container.append(
          field('三角形', el('span', {}, info.triangles.toLocaleString())),
          field('元の大きさ', el('span', {}, `${w} × ${h} × ${d}`)),
        );
        if (info.animations.length) {
          container.append(field('アニメ', el('span', { class: 'model-anims' }, info.animations.join('、'))));
          container.append(el('p', { class: 'note' }, '「▶ 遊ぶ」で、歩く・走る・待機などの名前のアニメーションを自動で使います。'));
        }
        container.append(el('p', { class: 'note' }, '取り込んだモデルは形や色を変えられません。位置・回転・大きさを変えたり、部品と組み合わせたりできます。'));
      }
    }

    // ---- 形状パラメータ
    if (!isGroup && !isModel) {
      const def = PRIMITIVES[obj.userData.type];
      container.append(el('h3', {}, '形状'));
      for (const p of def.params) {
        container.append(
          field(
            p.label,
            rangeInput({
              min: p.min,
              max: p.max,
              step: p.step,
              get: () => obj.userData.params[p.key],
              set: (v) => editor.updateParams(obj, { [p.key]: v }),
            }),
          ),
        );
      }
    }

    // ---- マテリアル
    const meshes = editor.selectedMeshes();
    if (meshes.length) {
      const mat = () => readMaterialProps(meshes[0].material);
      container.append(el('h3', {}, meshes.length > 1 ? `マテリアル（${meshes.length} 個の部品に適用）` : 'マテリアル'));
      container.append(field('色', colorInput(() => mat().color, (v) => editor.updateMaterial({ color: v }))));
      container.append(
        el(
          'div',
          { class: 'swatches' },
          SWATCHES.map((c) =>
            el('button', {
              title: c,
              style: `background:${c}`,
              onclick: () => {
                editor.updateMaterial({ color: c });
                editor.commit();
              },
            }),
          ),
        ),
      );
      container.append(
        field('金属っぽさ', rangeInput({ min: 0, max: 1, step: 0.01, get: () => mat().metalness, set: (v) => editor.updateMaterial({ metalness: v }) })),
        field('ざらつき', rangeInput({ min: 0, max: 1, step: 0.01, get: () => mat().roughness, set: (v) => editor.updateMaterial({ roughness: v }) })),
        field('不透明度', rangeInput({ min: 0, max: 1, step: 0.01, get: () => mat().opacity, set: (v) => editor.updateMaterial({ opacity: v }) })),
        field('', checkbox('ワイヤーフレーム', () => mat().wireframe, (v) => editor.updateMaterial({ wireframe: v }))),
        field('', checkbox('カクカク表示', () => mat().flatShading, (v) => editor.updateMaterial({ flatShading: v }))),
      );
    }
  };

  const sync = () => {
    for (const s of syncers) s();
  };

  // ---------------- フィールド部品

  function field(label, control, scrubbable = false) {
    const lab = el('label', {}, label);
    if (scrubbable && control._scrub) makeScrub(lab, control._scrub);
    return el('div', { class: 'field' }, lab, control);
  }

  function vecField(label, step, get, set, digits = 3) {
    const inputs = ['X', 'Y', 'Z'].map((axis, i) =>
      numberInput({
        step,
        digits,
        get: () => get()[i],
        set: (v) => {
          const values = get();
          values[i] = v;
          set(values);
        },
      }),
    );
    const lab = el('label', { class: 'vec-label' }, label);
    return el(
      'div',
      { class: 'field vec-field' },
      lab,
      el(
        'div',
        { class: 'vec' },
        inputs.map((inp, i) => {
          // 軸ラベル（X/Y/Z）を左右ドラッグしても値を変えられる
          const axisLabel = el('span', { class: 'axis-label' }, 'XYZ'[i]);
          makeScrub(axisLabel, inp._scrub);
          return el('div', { class: 'axis', dataset: { axis: 'XYZ'[i] } }, axisLabel, inp);
        }),
      ),
    );
  }

  /** 数値入力。入力中はライブ反映し、確定（change）で履歴に積む。ラベルの左右ドラッグでも値を変えられる */
  function numberInput({ step, digits = 3, get, set }) {
    const input = el('input', { type: 'number', step });
    const refresh = () => {
      if (document.activeElement !== input) input.value = fmt(get(), digits);
    };
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      if (Number.isFinite(v)) set(v);
    });
    input.addEventListener('change', () => {
      editor.commit();
      input.value = fmt(get(), digits);
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') input.blur();
    });
    input._scrub = { step, get, set };
    syncers.push(refresh);
    refresh();
    return input;
  }

  function makeScrub(labelEl, { step, get, set }) {
    labelEl.classList.add('scrub');
    labelEl.title = '左右にドラッグして値を変更';
    labelEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const start = get();
      labelEl.setPointerCapture(e.pointerId);
      const move = (ev) => {
        set(start + Math.round((ev.clientX - startX) / 2) * step);
        sync();
      };
      const up = () => {
        labelEl.removeEventListener('pointermove', move);
        labelEl.removeEventListener('pointerup', up);
        editor.commit();
      };
      labelEl.addEventListener('pointermove', move);
      labelEl.addEventListener('pointerup', up);
    });
  }

  function rangeInput({ min, max, step, get, set }) {
    const range = el('input', { type: 'range', min, max, step });
    const number = el('input', { type: 'number', min, max, step });
    const refresh = () => {
      const v = get();
      range.value = v;
      if (document.activeElement !== number) number.value = fmt(v);
    };
    const apply = (raw) => {
      const v = parseFloat(raw);
      if (!Number.isFinite(v)) return;
      set(Math.min(max, Math.max(min, v)));
    };
    range.addEventListener('input', () => {
      apply(range.value);
      number.value = fmt(get());
    });
    range.addEventListener('change', () => editor.commit());
    number.addEventListener('input', () => {
      apply(number.value);
      range.value = get();
    });
    number.addEventListener('change', () => {
      editor.commit();
      refresh();
    });
    number.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') number.blur();
    });
    syncers.push(refresh);
    refresh();
    return el('div', { class: 'range-row' }, range, number);
  }

  /** 遊ぶモードでの役割。「自動」は名前（なければ親）から推測した役割を表示する */
  function roleSelect(obj) {
    const select = el('select', { class: 'role-select', title: '遊ぶモードでこの部品をどう動かすか' });
    const autoLabel = () => {
      const guessed = guessRole(obj.name) ?? (obj.parent === editor.modelRoot ? 'body' : resolveRole(obj.parent, editor.modelRoot));
      return `自動（${guessed === 'body' ? '体' : (ROLE_LABELS[guessed] ?? '体')}）`;
    };
    for (const [value, label] of ROLE_OPTIONS) select.append(el('option', { value }, value ? label : autoLabel()));
    const refresh = () => {
      select.options[0].textContent = autoLabel();
      if (document.activeElement !== select) select.value = obj.userData.role ?? '';
    };
    select.addEventListener('change', () => {
      if (select.value) obj.userData.role = select.value;
      else delete obj.userData.role;
      editor.commit();
    });
    syncers.push(refresh);
    refresh();
    return select;
  }

  function textInput(get, set) {
    const input = el('input', { type: 'text' });
    const refresh = () => {
      if (document.activeElement !== input) input.value = get();
    };
    input.addEventListener('change', () => {
      if (input.value.trim()) set(input.value.trim());
      else refresh();
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') input.blur();
    });
    syncers.push(refresh);
    refresh();
    return input;
  }

  function colorInput(get, set) {
    const input = el('input', { type: 'color' });
    const refresh = () => {
      input.value = get();
    };
    input.addEventListener('input', () => set(input.value));
    input.addEventListener('change', () => editor.commit());
    syncers.push(refresh);
    refresh();
    return input;
  }

  function checkbox(label, get, set) {
    const input = el('input', { type: 'checkbox' });
    const refresh = () => {
      input.checked = get();
    };
    input.addEventListener('change', () => {
      set(input.checked);
      editor.commit();
    });
    syncers.push(refresh);
    refresh();
    return el('label', { class: 'checkbox' }, input, label);
  }

  editor.addEventListener('selection', render);
  editor.addEventListener('change', render);
  editor.addEventListener('transform', sync);
  // 取り込んだモデルが読み込めたら情報を出し直す
  editor.addEventListener('assets', () => {
    structureKey = '';
    render();
  });
  render();
}

// ================================================================ 世界の選択

/** 世界の一覧（見本付きのカード）と「作業用ライト」を、PC のメニューとタブレット・スマホのパネルの両方に作る */
export function initWorldPicker(containers, editor) {
  for (const container of containers) {
    for (const group of WORLD_GROUPS) {
      container.append(el('div', { class: 'world-group-label' }, group.label));
      container.append(
        el(
          'div',
          { class: 'world-grid' },
          group.worlds.map((w) =>
            el(
              'button',
              { class: 'world-card', dataset: { worldId: w.id }, title: w.label, onclick: () => editor.setWorld(w.id) },
              el('span', { class: 'world-preview', style: `background:${w.preview}` }, el('span', { class: 'world-icon' }, w.icon)),
              el('span', { class: 'world-name' }, w.label),
            ),
          ),
        ),
      );
    }
    const workLight = el('input', { type: 'checkbox', onchange: (e) => editor.setWorkLight(e.target.checked) });
    container.append(
      el(
        'div',
        { class: 'world-options' },
        el('label', { class: 'checkbox' }, workLight, '作業用ライト'),
        el('p', { class: 'note' }, 'ON にすると、世界の光（夕焼けの色など）に関係なく部品の色がそのまま見えます。'),
      ),
    );
    container._workLight = workLight;
  }

  const sync = () => {
    for (const card of document.querySelectorAll('.world-card')) {
      card.classList.toggle('active', card.dataset.worldId === editor.worldId);
    }
    for (const c of containers) c._workLight.checked = editor.workLight;
    for (const n of document.querySelectorAll('[data-world-name]')) n.textContent = getWorld(editor.worldId)?.label ?? '世界';
  };
  editor.addEventListener('world', sync);
  sync();
}
