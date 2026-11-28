// first-run.js - v3.0 首次启动导入（PRD §25.3 / §26）
// 离线版 APK 从云端一次性拉回全部数据；此后所有读写走本地。
import { ApiError } from './errors.js';
import * as store from './store.js';
import { CLOUD_IMPORT_BASE } from './config.js';

export function isCloudImportEnabled() {
  return !!CLOUD_IMPORT_BASE;
}

// 首启导入：配置了云端地址走云端（PRD §25.3），否则用内置快照
export async function importOnFirstRun() {
  return CLOUD_IMPORT_BASE ? importFromCloud() : importFromSnapshot();
}

async function getJson(path) {
  let resp;
  try {
    resp = await fetch(`${CLOUD_IMPORT_BASE}${path}`, { headers: { Accept: 'application/json' } });
  } catch {
    throw new ApiError('network_error', 0);
  }
  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError(resp.ok ? 'invalid_response' : 'network_error', resp.status);
  }
  if (!resp.ok) throw new ApiError(data?.error || 'unknown_error', resp.status);
  return data;
}

function readLocalArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function summaryOf(data, todos, countdowns) {
  return {
    courses: data.courses.length,
    exceptions: data.exceptions.length,
    activities: data.activities.length,
    tags: data.tags.length,
    todos: todos.length,
    countdowns: countdowns.length,
  };
}

function normalize(boot) {
  return {
    semesters: boot.semesters || [],
    holidays: boot.holidays || [],
    courses: boot.courses || [],
    exceptions: boot.exceptions || [],
    activities: boot.activities || [],
    tags: boot.tags || [],
    settings: boot.settings || { sound: true, vibrate: true, notify: false },
    periodTimes: boot.periodTimes || {},
  };
}

// 云端导入：bootstrap 七集合 + migration 暂存的手机本地数据
export async function importFromCloud() {
  const [boot, mig] = await Promise.all([getJson('/bootstrap'), getJson('/migration')]);
  const data = normalize(boot);
  const payload = mig.payload;
  const todos = Array.isArray(payload?.todos) ? payload.todos : [];
  const countdowns = Array.isArray(payload?.countdowns) ? payload.countdowns : [];
  const staged = payload?.reminderSettings;
  const reminderSettings = staged && typeof staged === 'object' && !Array.isArray(staged) ? staged : null;
  localStorage.setItem('todos', JSON.stringify(todos));
  localStorage.setItem('countdowns', JSON.stringify(countdowns));
  if (reminderSettings) {
    localStorage.setItem('reminderSettings', JSON.stringify(reminderSettings));
  }
  const counts = summaryOf(data, todos, countdowns);
  store.importAll(data, { source: 'cloud', importedAt: new Date().toISOString(), counts });
  return { counts, source: 'cloud' };
}

// 内置快照兜底：快照自带 todos/countdowns 时一并写入（演示快照），否则保持本机现状
export async function importFromSnapshot() {
  const resp = await fetch('js/seed-data.json');
  if (!resp.ok) throw new ApiError('snapshot_missing', resp.status);
  const raw = await resp.json();
  const data = normalize(raw);
  const todos = takeSeededArray(raw, 'todos');
  const countdowns = takeSeededArray(raw, 'countdowns');
  const counts = summaryOf(data, todos, countdowns);
  store.importAll(data, { source: 'snapshot', importedAt: new Date().toISOString(), counts });
  return { counts, source: 'snapshot' };
}

function takeSeededArray(raw, key) {
  if (Array.isArray(raw[key])) {
    localStorage.setItem(key, JSON.stringify(raw[key]));
    return raw[key];
  }
  return readLocalArray(key);
}