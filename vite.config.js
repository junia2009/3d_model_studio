import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { defineConfig } from 'vite';

/** ディレクトリ内のファイルを再帰的に列挙する */
function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

/**
 * ビルド後の全ファイルを事前キャッシュする Service Worker（dist/sw.js）を生成する。
 * キャッシュ名にはファイル内容のハッシュを入れ、中身が変わったときだけ更新が入るようにする。
 */
function serviceWorkerPlugin() {
  let outDir;
  return {
    name: 'model-studio-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const files = listFiles(outDir)
        .map((f) => relative(outDir, f).split(sep).join('/'))
        // Draco（圧縮モデル）の復元プログラムは大きいので、使ったときにだけ取ってきてキャッシュする
        .filter((f) => f !== 'sw.js' && !f.endsWith('.map') && !/\/draco_/.test(f))
        .sort();
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest('hex').slice(0, 12);

      const precache = ['./', ...files.map((f) => `./${f}`)];
      const template = readFileSync(new URL('./src/sw.js', import.meta.url), 'utf8');
      const sw = template
        .replaceAll('__CACHE_VERSION__', version)
        .replaceAll('__PRECACHE__', JSON.stringify(precache, null, 2));
      writeFileSync(join(outDir, 'sw.js'), sw);
    },
  };
}

export default defineConfig({
  // 相対パスでビルドし、GitHub Pages などのサブパスでも動くようにする
  base: './',
  build: {
    // three.js 本体を含むため 500kB を超えるのは想定内
    chunkSizeWarningLimit: 1000,
  },
  plugins: [serviceWorkerPlugin()],
});
