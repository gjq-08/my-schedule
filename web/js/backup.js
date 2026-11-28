// backup.js - 数据备份导出/导入
// 把 5 个本地存储键打包成单个 JSON；导入前校验 + 预览 + 确认覆盖。
// 导出：浏览器走下载；App 走 Filesystem 写缓存 + Share 分享（需含这两个插件的版本）。
// 导入：<input type=file> + FileReader，浏览器与 App WebView 通用。
import { isNative } from './native-notify.js';

const KEYS = ['appData', 'localMeta', 'todos', 'countdowns', 'reminderSettings'];
const FORMAT = 'my-schedule-backup';
const VERSION = 1;

function readKey(key) {
  const raw = localStorage.getItem(key);
  if (raw == null) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function plugins() {
  return window.Capacitor?.Plugins || {};
}

// 组装备份对象（不含任何网络请求）
export function buildBackup() {
  const payload = {};
  for (const k of KEYS) payload[k] = readKey(k);
  return { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), payload };
}

export function backupFileName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `我的日程备份-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}

// 导出备份。返回 { ok, mode } 或 { ok:false, cancelled } / { ok:false, error }
export async function exportBackup() {
  const json = JSON.stringify(buildBackup(), null, 2);
  const name = backupFileName();
  const { Filesystem, Share } = plugins();

  if (isNative() && Filesystem && Share) {
    try {
      const res = await Filesystem.writeFile({ path: name, data: json, directory: 'CACHE', encoding: 'utf8' });
      await Share.share({ title: '我的日程备份', files: [res.uri], dialogTitle: '导出备份文件' });
      return { ok: true, mode: 'native' };
    } catch (err) {
      const msg = String(err?.message || err || '');
      if (/cancel/i.test(msg)) return { ok: false, cancelled: true };
      // 写入/分享失败时退回下载，尽量不让用户空手而归
    }
  }

  try {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return { ok: true, mode: 'download' };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

// 校验备份文件，返回 payload；任何不合法都抛出带中文说明的错误
export function validateBackup(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('文件内容不是有效的备份');
  if (obj.format !== FORMAT) throw new Error('这不是「我的日程」的备份文件');
  const p = obj.payload;
  if (!p || typeof p !== 'object') throw new Error('备份里没有数据');
  const ad = p.appData;
  if (!ad || typeof ad !== 'object' || !Array.isArray(ad.courses)) throw new Error('备份中的课程数据已损坏');
  if (ad.semesters != null && !Array.isArray(ad.semesters)) throw new Error('备份中的学期数据格式不对');
  if (ad.activities != null && !Array.isArray(ad.activities)) throw new Error('备份中的日程数据格式不对');
  if (p.todos != null && !Array.isArray(p.todos)) throw new Error('备份中的待办数据格式不对');
  if (p.countdowns != null && !Array.isArray(p.countdowns)) throw new Error('备份中的倒计日数据格式不对');
  if (p.reminderSettings != null && (typeof p.reminderSettings !== 'object' || Array.isArray(p.reminderSettings))) throw new Error('备份中的提醒设置格式不对');
  if (p.localMeta != null && (typeof p.localMeta !== 'object' || Array.isArray(p.localMeta))) throw new Error('备份中的元数据格式不对');
  return p;
}

// 预览统计（导入确认前展示）
export function previewCounts(p) {
  const ad = p.appData || {};
  return {
    semesters: (ad.semesters || []).length,
    courses: (ad.courses || []).length,
    exceptions: (ad.exceptions || []).length,
    activities: (ad.activities || []).length,
    tags: (ad.tags || []).length,
    todos: (p.todos || []).length,
    countdowns: (p.countdowns || []).length,
  };
}

// 写回 5 个键，使本机与备份完全一致（备份里缺失的键一并清空）
export function applyBackup(p) {
  localStorage.setItem('appData', JSON.stringify(p.appData));
  if (p.localMeta != null) localStorage.setItem('localMeta', JSON.stringify(p.localMeta));
  else localStorage.removeItem('localMeta');
  localStorage.setItem('todos', JSON.stringify(p.todos || []));
  localStorage.setItem('countdowns', JSON.stringify(p.countdowns || []));
  if (p.reminderSettings != null) localStorage.setItem('reminderSettings', JSON.stringify(p.reminderSettings));
  else localStorage.removeItem('reminderSettings');
}

// 读取用户选中的文件 → 校验 → 返回 payload
export function readBackupFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error('没有选择文件')); return; }
    const reader = new FileReader();
    reader.onload = () => {
      let obj;
      try { obj = JSON.parse(reader.result); }
      catch { reject(new Error('文件不是合法的 JSON')); return; }
      try { resolve(validateBackup(obj)); }
      catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsText(file);
  });
}