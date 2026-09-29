/**
 * PWA 関連：Service Worker の登録、更新の通知、インストールボタン、オフライン表示。
 * Service Worker はビルド時にしか生成されないので、開発サーバーでは登録しない。
 */
export function initPWA({ isIOS = false } = {}) {
  initInstallButton();
  // iOS には beforeinstallprompt がないので、Safari で開いているときは手順を案内する
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (isIOS && !standalone) document.querySelector('.ios-install-note').hidden = false;
  initOnlineStatus();
  if (import.meta.env.PROD && 'serviceWorker' in navigator) registerServiceWorker();
}

function registerServiceWorker() {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      // 既に新しい版が待機している場合
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          // 初回インストール時（controller なし）は通知しない
          if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(worker);
        });
      });
      // 開きっぱなしでも時々更新を確認する
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    } catch (err) {
      console.warn('Service Worker の登録に失敗しました', err);
    }
  });

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    // 作業内容は自動保存済みなので、再読み込みしても復元される
    window.location.reload();
  });
}

function showUpdateBanner(worker) {
  const banner = document.querySelector('#update-banner');
  banner.hidden = false;
  banner.querySelector('[data-update="apply"]').onclick = () => worker.postMessage({ type: 'SKIP_WAITING' });
  banner.querySelector('[data-update="later"]').onclick = () => {
    banner.hidden = true;
  };
}

function initInstallButton() {
  const buttons = [...document.querySelectorAll('[data-install]')];
  let deferred = null;
  const show = (visible) => buttons.forEach((b) => (b.hidden = !visible));

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    show(true);
  });
  for (const button of buttons) {
    button.addEventListener('click', async () => {
      if (!deferred) return;
      deferred.prompt();
      await deferred.userChoice;
      deferred = null;
      show(false);
    });
  }
  window.addEventListener('appinstalled', () => {
    deferred = null;
    show(false);
  });
}

function initOnlineStatus() {
  const badge = document.querySelector('#offline-badge');
  const update = () => {
    badge.hidden = navigator.onLine;
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}
