const status = document.getElementById('pwaStatus');
const button = document.getElementById('checkUpdateButton');
let registration;
let checking = false;

function showStatus() {
  if (registration?.waiting) {
    status.textContent = '更新版を保存しました。このアプリと同じページのChromeタブをすべて閉じ、開き直すと更新されます。案件は保存されたままです。';
  } else if (registration?.installing) {
    status.textContent = 'アプリ一式を保存しています。準備が終わるまで通信をつないでください。';
  } else if (registration?.active) {
    status.textContent = navigator.onLine
      ? 'オフラインで利用できます。通信がなくても案件の入力・編集・保存と休憩計算ができます。'
      : 'オフラインで利用中です。案件と設定はこの端末に保存されます。';
  }
}

function observe(worker) {
  worker?.addEventListener('statechange', () => {
    if (worker.state === 'redundant') {
      status.textContent = 'アプリ一式を取得できませんでした。以前の保存版は維持しています。通信を確認し、更新をもう一度確認してください。';
    } else showStatus();
  });
}

async function checkUpdate() {
  if (!registration || checking) return;
  if (!navigator.onLine) { showStatus(); return; }
  checking = true;
  button.disabled = true;
  status.textContent = '更新を確認しています。';
  try {
    await registration.update();
    showStatus();
  } catch {
    status.textContent = registration.active
      ? '更新を確認できませんでした。保存済みのアプリは引き続き使えます。通信を確認してください。'
      : 'オフライン利用の準備ができませんでした。通信を確認して開き直してください。';
  } finally {
    checking = false;
    button.disabled = false;
  }
}

button.addEventListener('click', checkUpdate);
window.addEventListener('online', checkUpdate);
window.addEventListener('offline', showStatus);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkUpdate();
});

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' })
    .then((value) => {
      registration = value;
      observe(value.installing);
      value.addEventListener('updatefound', () => { observe(value.installing); showStatus(); });
      showStatus();
      navigator.serviceWorker.ready.then(showStatus);
    }).catch(() => {
      status.textContent = 'オフライン利用を準備できませんでした。通信を確認して開き直してください。';
    });
} else {
  status.textContent = 'この画面ではオフライン機能を利用できません。公開URLをChromeで開いてください。';
  button.disabled = true;
}
