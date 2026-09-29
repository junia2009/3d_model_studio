# 3D Model Studio

**Three.js だけ**で作った、ブラウザ上で 3D モデルを作れるスタジオアプリです。
立方体・球・円柱などの部品（プリミティブ）を置いて、動かして、組み合わせてモデルを作ります。

UI フレームワークは使わず、実行時の依存は `three` のみ（Vite は開発サーバーとビルドだけに使用）。

## 起動方法

```bash
npm install
npm run dev      # http://localhost:5173 で開く
```

静的ファイルとしてビルドする場合:

```bash
npm run build    # dist/ に出力（相対パスなので GitHub Pages 等にそのまま置ける）
npm run preview
```

## GitHub Pages で公開する

`.github/workflows/deploy.yml` により、`main` ブランチに push されるたびに自動でビルドして GitHub Pages に公開されます。

最初の 1 回だけ、リポジトリの設定が必要です。

1. GitHub のリポジトリページで **Settings → Pages** を開く
2. **Build and deployment → Source** を **GitHub Actions** にする
3. `main` に push（または **Actions** タブから「Deploy to GitHub Pages」を手動実行）

公開 URL: `https://<ユーザー名>.github.io/3d_model_studio/`

## PWA（アプリとしてインストール）

GitHub Pages で公開したページは PWA に対応しています。

- **インストール**: Chrome / Edge ではツールバー右端の「⬇ インストール」ボタン（またはアドレスバーのインストールアイコン）から。iPhone / iPad は Safari の共有メニュー →「ホーム画面に追加」。
- **オフライン**: 一度開けば、ネットがなくても起動・編集・保存・書き出しができます（ツールバーに「オフライン」と表示）。
- **更新**: 新しい版を公開すると、次に開いたときに「新しいバージョンがあります」と表示され、「更新する」で切り替わります。作業内容は自動保存されているので消えません。

Service Worker（`dist/sw.js`）はビルド時に `vite.config.js` のプラグインが `src/sw.js` をもとに生成し、ビルド成果物すべてを事前キャッシュします。
そのため `npm run dev` では登録されません。動作確認は `npm run build && npm run preview` で行ってください。

## できること

| 分類 | 機能 |
| --- | --- |
| 部品 | 立方体 / 球 / 半球 / 円柱 / 円錐 / 四角錐 / ドーナツ / カプセル / 板 / 四面体 / 八面体 / 多面体 / 結び目 |
| 変形 | ギズモで移動・回転・拡大縮小、ローカル／ワールド座標切替、スナップ（0.25 / 15° / 0.1） |
| 数値編集 | 位置・回転・スケールの数値入力、X/Y/Z ラベルの左右ドラッグで値を調整 |
| 形状 | 部品ごとのパラメータ（半径・高さ・上下の半径・分割数・ドーナツの角度など） |
| 見た目 | 色（カラーピッカー＋パレット）、金属っぽさ、ざらつき、不透明度、ワイヤーフレーム、カクカク表示 |
| 組み立て | 複数選択、グループ化／解除、アウトライナーのドラッグ＆ドロップで入れ子・並べ替え、複製、左右反転コピー、床に置く |
| 管理 | 表示／非表示、名前変更、元に戻す／やり直し、ブラウザへの自動保存 |
| ファイル | JSON で保存／読み込み、GLB / glTF / OBJ / STL（3D プリント向け）/ PNG 画像で書き出し |

## 操作方法

| 操作 | 内容 |
| --- | --- |
| 左ドラッグ / 右ドラッグ / ホイール | 視点の回転 / 平行移動 / ズーム |
| クリック | 選択（グループはまとめて選択） |
| Alt+クリック / ダブルクリック | グループの中の部品を直接選択 |
| Shift（Ctrl）+クリック | 複数選択 |
| `W` / `E` / `R` | 移動 / 回転 / 拡大縮小 |
| `Q` | ローカル／ワールド座標の切替 |
| `X` | スナップ ON/OFF |
| `F` | 選択物（なければ全体）にズーム |
| `G` | 床に置く |
| `M` | 左右反転コピー（X 軸で反転） |
| `Ctrl+D` | 複製 |
| `Ctrl+G` / `Ctrl+Shift+G` | グループ化 / グループ解除 |
| `Ctrl+Z` / `Ctrl+Shift+Z`（`Ctrl+Y`） | 元に戻す / やり直し |
| `Ctrl+A` | すべて選択 |
| `Ctrl+S` / `Ctrl+O` | 保存 / 開く |
| `Delete` / `Backspace` | 削除 |
| `Esc` | 選択解除 |

## ファイル構成

```
index.html          画面レイアウト
src/main.js         起動処理・ツールバー・ショートカット・ファイル入出力
src/editor.js       Three.js のシーン、選択、ギズモ、編集操作、履歴、書き出し
src/ui.js           部品パレット・アウトライナー・プロパティパネル
src/primitives.js   部品の定義（形状パラメータとジオメトリ生成）
src/serializer.js   シーン ⇔ JSON の変換、マテリアル
src/history.js      Undo / Redo（スナップショット方式）
src/sample.js       サンプルモデル（ロボットと木）
src/pwa.js          Service Worker の登録・更新通知・インストールボタン・オフライン表示
src/sw.js           Service Worker のテンプレート（ビルド時にキャッシュ一覧を埋め込む）
src/style.css       スタイル
public/             マニフェストとアイコン（そのまま dist/ にコピーされる）
```

### 部品を増やすには

`src/primitives.js` の `PRIMITIVES` に 1 項目追加するだけで、パレット・プロパティパネル・保存形式すべてに反映されます。

```js
ring: {
  label: 'リング',
  icon: '◎',
  params: [
    { key: 'inner', label: '内径', min: 0, max: 5, step: 0.05, default: 0.3 },
    { key: 'outer', label: '外径', min: 0.05, max: 5, step: 0.05, default: 0.5 },
  ],
  build: (p) => new THREE.RingGeometry(p.inner, p.outer, 48),
},
```
