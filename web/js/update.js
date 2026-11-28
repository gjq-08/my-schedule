// update.js - Android 版本检查、APK 下载与系统安装
import { UPDATE_API_URL } from './config.js';
import { getTodayStr } from './date.js';
import { escapeHtml, showToast, Modal } from './ui.js';
import { ICON_DOWNLOAD } from './icons.js';

const CHECK_DATE_KEY = 'updateCheckDate';
const CHECK_TIMEOUT_MS = 12000;

let versionCache = null;
let pendingInstallPath = null;

function getBridge() {
  return window.Capacitor?.Plugins?.UpdateBridge || null;
}

export function isUpdateNative() {
  return !!getBridge();
}

export async function getCurrentVersion() {
  if (versionCache) return versionCache;
  const bridge = getBridge();
  if (!bridge) return { versionCode: 0, versionName: '网页版' };
  try {
    const info = await bridge.getVersion();
    versionCache = {
      versionCode: Number(info.versionCode) || 0,
      versionName: String(info.versionName || '未知'),
    };
  } catch {
    versionCache = { versionCode: 0, versionName: '读取失败' };
  }
  return versionCache;
}

function validManifest(latest) {
  if (!latest || typeof latest !== 'object') return false;
  if (!Number.isInteger(latest.versionCode) || latest.versionCode <= 0) return false;
  if (typeof latest.versionName !== 'string' || !latest.versionName.trim()) return false;
  if (typeof latest.notes !== 'string') return false;
  if (typeof latest.downloadUrl !== 'string') return false;
  if (!/^[a-f0-9]{64}$/i.test(String(latest.sha256 || ''))) return false;
  try {
    const dl = new URL(latest.downloadUrl);
    const api = new URL(UPDATE_API_URL);
    return dl.protocol === 'https:' && dl.host === api.host;
  } catch {
    return false;
  }
}

async function fetchLatest(currentVersionCode) {
  const url = new URL(UPDATE_API_URL);
  url.searchParams.set('platform', 'android');
  url.searchParams.set('versionCode', String(currentVersionCode));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), { cache: 'no-store', signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (!body || typeof body.update !== 'boolean') throw new Error('bad response');
    if (!body.update) return null;
    if (!validManifest(body.latest)) throw new Error('bad manifest');
    return body.latest;
  } finally {
    clearTimeout(timer);
  }
}

function rememberCheck() {
  try { localStorage.setItem(CHECK_DATE_KEY, getTodayStr()); } catch { /* ignore */ }
}

function checkedToday() {
  try { return localStorage.getItem(CHECK_DATE_KEY) === getTodayStr(); } catch { return false; }
}

export async function checkForUpdates({ manual = false } = {}) {
  const bridge = getBridge();
  if (!bridge) {
    if (manual) showToast('网页版无需检查 APK 更新', 'info');
    return { status: 'unsupported' };
  }
  if (!manual && checkedToday()) return { status: 'skipped' };

  const current = await getCurrentVersion();
  let latest;
  try {
    latest = await fetchLatest(current.versionCode);
    rememberCheck();
  } catch {
    if (manual) showToast('检查更新失败，请确认网络后重试', 'error');
    return { status: 'error' };
  }

  if (!latest || latest.versionCode <= current.versionCode) {
    if (manual) showToast('已是最新版本', 'success');
    return { status: 'latest' };
  }

  openUpdateDialog(current, latest);
  return { status: 'available', latest };
}

function openUpdateDialog(current, latest) {
  const modal = new Modal(`发现新版本 v${escapeHtml(latest.versionName)}`, '');
  modal.show();
  const content = modal.getContent();
  const notes = latest.notes
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  content.innerHTML = `
    <div class="update-version-line">
      <span>当前 v${escapeHtml(current.versionName)}</span>
      <span class="update-arrow">→</span>
      <strong>v${escapeHtml(latest.versionName)}</strong>
    </div>
    ${notes.length ? `<div class="update-notes"><div class="update-notes-title">更新内容</div><ul>${notes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul></div>` : ''}
    <p class="settings-hint">覆盖安装，课表、日程、待办和倒计时等本地数据都会保留。</p>
    <div class="update-actions" id="update-actions"></div>
    <div class="update-status" id="update-status" role="status"></div>
  `;

  const actions = content.querySelector('#update-actions');
  const status = content.querySelector('#update-status');

  const renderActions = () => {
    actions.innerHTML = pendingInstallPath
      ? `<button type="button" class="btn btn-secondary" id="update-later">以后再说</button>
         <button type="button" class="btn btn-primary" id="update-install">继续安装</button>`
      : `<button type="button" class="btn btn-secondary" id="update-later">以后再说</button>
         <button type="button" class="btn btn-primary" id="update-download">${ICON_DOWNLOAD}<span>下载更新</span></button>`;
    actions.querySelector('#update-later')?.addEventListener('click', () => modal.close());
    actions.querySelector('#update-download')?.addEventListener('click', () => downloadAndInstall(modal, content, current, latest));
    actions.querySelector('#update-install')?.addEventListener('click', () => startInstall(modal, content, current, latest));
  };

  renderActions();
}

function setBusy(content, text) {
  const actions = content.querySelector('#update-actions');
  const status = content.querySelector('#update-status');
  if (actions) actions.innerHTML = '';
  if (status) status.textContent = text;
}

function setError(content, text, retry) {
  const status = content.querySelector('#update-status');
  const actions = content.querySelector('#update-actions');
  if (status) status.textContent = text;
  if (actions) {
    actions.innerHTML = `<button type="button" class="btn btn-secondary" id="update-close">关闭</button>
      <button type="button" class="btn btn-primary" id="update-retry">重试</button>`;
    actions.querySelector('#update-close')?.addEventListener('click', () => content.closest('.modal-overlay')?.remove());
    actions.querySelector('#update-retry')?.addEventListener('click', retry);
  }
}

async function downloadAndInstall(modal, content, current, latest) {
  setBusy(content, '正在下载安装包…');
  try {
    const res = await getBridge().downloadApk({
      url: latest.downloadUrl,
      sha256: latest.sha256,
      fileName: `my-schedule-${latest.versionName}.apk`,
    });
    if (!res?.path) throw new Error('missing path');
    pendingInstallPath = res.path;
    await startInstall(modal, content, current, latest);
  } catch (err) {
    const msg = /sha|checksum|校验/i.test(String(err?.message || err))
      ? '安装包校验失败，请重试'
      : '下载失败，请检查网络后重试';
    setError(content, msg, () => downloadAndInstall(modal, content, current, latest));
  }
}

async function startInstall(modal, content, current, latest) {
  if (!pendingInstallPath) {
    await downloadAndInstall(modal, content, current, latest);
    return;
  }
  setBusy(content, '正在打开系统安装界面…');
  try {
    const res = await getBridge().installApk({ path: pendingInstallPath });
    if (res?.needsPermission) {
      const status = content.querySelector('#update-status');
      if (status) status.textContent = '请先在系统设置里允许「我的日程」安装应用，返回后点「继续安装」。';
      const actions = content.querySelector('#update-actions');
      if (actions) {
        actions.innerHTML = `<button type="button" class="btn btn-secondary" id="update-cancel-install">取消</button>
          <button type="button" class="btn btn-primary" id="update-install">继续安装</button>`;
        actions.querySelector('#update-cancel-install')?.addEventListener('click', () => modal.close());
        actions.querySelector('#update-install')?.addEventListener('click', () => startInstall(modal, content, current, latest));
      }
      return;
    }
    modal.close();
    showToast('安装包已下载，请在系统界面确认安装', 'success');
  } catch (err) {
    setError(content, '无法打开安装界面，请重试', () => startInstall(modal, content, current, latest));
  }
}
