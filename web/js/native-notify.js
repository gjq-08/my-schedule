// native-notify.js - 原生本地通知（Capacitor / Android）
// 关闭 App 后由系统闹钟触发，替代 reminder.js 的 JS 定时器路径
import { getTodayStr } from './date.js';
import { loadTodos, isTodoCompleted } from './pages/todos.js';
import { showToast } from './ui.js';

const REMINDER_WINDOW_DAYS = 30;
const SCHEDULE_BATCH = 50;
const SYNC_DEBOUNCE_MS = 800;

const IMPORTANCE_HIGH = 4;
const IMPORTANCE_LOW = 2;

function getLN() {
  return window.Capacitor?.Plugins?.LocalNotifications || null;
}

export function isNative() {
  return !!getLN();
}

let nativeActive = false;
let channelSupport = false;
let lastError = null;

function errorText(e) {
  return String(e?.message || e || 'unknown');
}
let navigateFn = null;
let getDataFn = null;
let syncTimer = null;
let lastSync = { requested: 0, scheduled: 0, ok: true, at: null };

export function areNativeNotificationsActive() {
  return nativeActive;
}

function getReminderSettings() {
  try {
    const stored = localStorage.getItem('reminderSettings');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && parsed.activity && parsed.todo) return parsed;
    }
  } catch { /* 数据损坏时用默认值 */ }
  return {
    activity: { sound: true, vibrate: true, notify: false },
    todo: { sound: true, vibrate: true, notify: false },
  };
}

// 渠道 id 同时由「来源类型 × 铃声/振动组合」决定；Android 8+ 的铃声与振动只认渠道，且建成后不可改
function channelIdFor(type, settings) {
  const suffix = settings.sound && settings.vibrate
    ? 'alert'
    : settings.sound
      ? 'sound'
      : settings.vibrate
        ? 'vibrate'
        : 'silent';
  return `${type}-${suffix}`;
}

const CHANNEL_DEFS = [
  { id: 'activity-alert', name: '日程提醒（铃声+振动）', importance: IMPORTANCE_HIGH, vibration: true },
  { id: 'activity-sound', name: '日程提醒（仅铃声）', importance: IMPORTANCE_HIGH, vibration: false },
  { id: 'activity-vibrate', name: '日程提醒（仅振动）', importance: IMPORTANCE_LOW, vibration: true },
  { id: 'activity-silent', name: '日程提醒（静默）', importance: IMPORTANCE_LOW, vibration: false },
  { id: 'todo-alert', name: '待办提醒（铃声+振动）', importance: IMPORTANCE_HIGH, vibration: true },
  { id: 'todo-sound', name: '待办提醒（仅铃声）', importance: IMPORTANCE_HIGH, vibration: false },
  { id: 'todo-vibrate', name: '待办提醒（仅振动）', importance: IMPORTANCE_LOW, vibration: true },
  { id: 'todo-silent', name: '待办提醒（静默）', importance: IMPORTANCE_LOW, vibration: false },
];

async function ensureChannels(LN) {
  try {
    const existing = await LN.listChannels();
    channelSupport = true;
    const known = new Set((existing.channels || []).map(c => c.id));
    for (const def of CHANNEL_DEFS) {
      if (known.has(def.id)) continue;
      await LN.createChannel({ ...def, description: '' });
    }
  } catch {
    // Android 7 及以下无渠道概念，插件返回 unavailable
    channelSupport = false;
  }
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// 通知 id 必须是 int32；字符串标识先稳定哈希，保证同一提醒恒等
function notificationId(type, refId, dateStr) {
  return fnv1a(`${type}:${refId}:${dateStr}`) & 0x7fffffff;
}

function remindAt(dateStr, timeStr, remindMinutes, now) {
  if (!dateStr || !timeStr) return null;
  const at = new Date(`${dateStr}T${timeStr}:00`);
  if (isNaN(at.getTime())) return null;
  at.setMinutes(at.getMinutes() - (remindMinutes || 0));
  if (at.getTime() <= now.getTime()) return null;
  return at;
}

function addDays(dateStr, delta) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + delta);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function buildReminderList(data, todayStr, now) {
  const settings = getReminderSettings();
  const items = [];

  if (settings.activity.notify) {
    const horizon = addDays(todayStr, REMINDER_WINDOW_DAYS);
    for (const act of (data.activities || [])) {
      if (act.remind_minutes == null || act.all_day || !act.start_time) continue;
      if (act.date < todayStr || act.date > horizon) continue;
      const at = remindAt(act.date, act.start_time, act.remind_minutes, now);
      if (!at) continue;
      items.push({
        id: notificationId('activity', act.id, act.date),
        title: act.title || '日程提醒',
        body: `${act.start_time} 开始 · ${act.location || '日程'}（提前 ${act.remind_minutes} 分钟）`,
        at,
        channelId: channelIdFor('activity', settings.activity),
        extra: { page: 'activities', source: 'activity', refId: act.id },
      });
    }
  }

  if (settings.todo.notify) {
    const horizon = addDays(todayStr, REMINDER_WINDOW_DAYS);
    for (const todo of loadTodos()) {
      if (todo.remind_minutes == null || !todo.due_time) continue;

      if (todo.daily_repeat) {
        // 重复待办的完成状态按天计（last_done_date），只跳过已完成的那一天
        for (let i = 0; i <= REMINDER_WINDOW_DAYS; i++) {
          const dateStr = addDays(todayStr, i);
          if (todo.last_done_date === dateStr) continue;
          const at = remindAt(dateStr, todo.due_time, todo.remind_minutes, now);
          if (!at) continue;
          items.push({
            id: notificationId('todo', todo.id, dateStr),
            title: `待办：${todo.title}`,
            body: `${dateStr === todayStr ? '今天' : dateStr} ${todo.due_time} 截止${todo.note ? ' · ' + todo.note : ''}`,
            at,
            channelId: channelIdFor('todo', settings.todo),
            extra: { page: 'todos', source: 'todo', refId: todo.id },
          });
        }
      } else {
        if (isTodoCompleted(todo, todayStr)) continue;
        if (!todo.due_date || todo.due_date < todayStr || todo.due_date > horizon) continue;
        const at = remindAt(todo.due_date, todo.due_time, todo.remind_minutes, now);
        if (!at) continue;
        items.push({
          id: notificationId('todo', todo.id, todo.due_date),
          title: `待办：${todo.title}`,
          body: `${todo.due_date} ${todo.due_time} 截止${todo.note ? ' · ' + todo.note : ''}`,
          at,
          channelId: channelIdFor('todo', settings.todo),
          extra: { page: 'todos', source: 'todo', refId: todo.id },
        });
      }
    }
  }

  return items;
}

let permissionPromise = null;

// 并发调用共用同一次请求，避免启动时连弹两个授权框（§17 测试 14）；
// 结算后清空，后续同步仍会重新查询，以便发现用户在系统设置里撤销了权限
function ensurePermission(LN) {
  if (permissionPromise) return permissionPromise;
  permissionPromise = requestPermissionOnce(LN).finally(() => { permissionPromise = null; });
  return permissionPromise;
}

async function requestPermissionOnce(LN) {
  try {
    let perm = await LN.checkPermissions();
    if (perm.display === 'prompt') {
      perm = await LN.requestPermissions();
    }
    nativeActive = perm.display === 'granted';
    return nativeActive;
  } catch {
    nativeActive = false;
    return false;
  }
}

async function refreshExactAlarmSetting(LN) {
  try {
    const res = await LN.checkExactNotificationSetting();
    return res.exact_alarm || 'unknown';
  } catch {
    return 'unknown';
  }
}

// 幂等重建：取消全部待处理 → 按当前数据整体重排（禁止增量 diff）
async function cancelAllPending(LN) {
  try {
    const pending = await LN.getPending();
    // 正在计时的"测试定时"通知不在数据里，整体重建会把它一起取消掉，必须留下
    const list = (pending.notifications || []).filter(n => !pendingTestIds.has(n.id));
    if (list.length) {
      await LN.cancel({ notifications: list.map(n => ({ id: n.id })) });
    }
  } catch (e) {
    lastError = `清理旧提醒失败：${errorText(e)}`;
  }
  try {
    await LN.removeAllDeliveredNotifications();
  } catch (e) {
    // 部分 ROM 不支持，不影响新提醒注册
  }
}

export async function syncReminders(data) {
  const LN = getLN();
  if (!LN) return { native: false, requested: 0, scheduled: 0 };

  const granted = await ensurePermission(LN);
  if (!granted) {
    lastSync = { requested: 0, scheduled: 0, ok: false, at: new Date().toISOString() };
    return { native: true, granted: false, requested: 0, scheduled: 0 };
  }

  await ensureChannels(LN);
  lastError = null;

  const now = new Date();
  const todayStr = getTodayStr();
  const items = buildReminderList(data || getDataFn?.() || { activities: [] }, todayStr, now);

  await cancelAllPending(LN);

  let scheduled = 0;
  let ok = true;
  for (let i = 0; i < items.length; i += SCHEDULE_BATCH) {
    const batch = items.slice(i, i + SCHEDULE_BATCH);
    try {
      const res = await LN.schedule({
        notifications: batch.map(item => ({
          id: item.id,
          title: item.title,
          body: item.body,
          channelId: channelSupport ? item.channelId : undefined,
          schedule: { at: item.at, allowWhileIdle: true },
          autoCancel: true,
          extra: item.extra,
        })),
      });
      scheduled += (res.notifications || []).length;
    } catch (e) {
      ok = false;
      lastError = errorText(e);
    }
  }

  const truncated = items.length > 0 && scheduled < items.length;
  lastSync = { requested: items.length, scheduled, ok, truncated, error: lastError, at: new Date().toISOString() };
  if (truncated) {
    showToast(`仅注册了 ${scheduled}/${items.length} 条提醒，建议清理过期项`, 'error');
  }

  return { native: true, granted: true, requested: items.length, scheduled, ok, truncated, error: lastError };
}

export function requestReminderSync(data) {
  if (!isNative()) return;
  if (data) getDataFn = () => data;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncReminders(getDataFn?.() || { activities: [] }).catch(() => {});
  }, SYNC_DEBOUNCE_MS);
}

export async function initNativeNotify({ navigate, getData }) {
  const LN = getLN();
  if (!LN) return { native: false };
  navigateFn = navigate;
  getDataFn = getData;

  await ensurePermission(LN);

  if (nativeActive) {
    try {
      await LN.addListener('localNotificationActionPerformed', (action) => {
        const page = action?.notification?.extra?.page;
        if (page && navigateFn) navigateFn(page);
      });
    } catch { /* 监听注册失败不影响调度 */ }
    await ensureChannels(LN);
  }

  const exactAlarm = nativeActive ? await refreshExactAlarmSetting(LN) : 'unknown';
  return { native: true, granted: nativeActive, channelSupport, exactAlarm };
}

export async function requestNativePermission() {
  const LN = getLN();
  if (!LN) return null;
  const perm = await LN.requestPermissions();
  nativeActive = perm.display === 'granted';
  if (nativeActive) await ensureChannels(LN);
  return perm;
}

export async function openExactAlarmSetting() {
  const LN = getLN();
  if (!LN) return null;
  return LN.changeExactNotificationSetting();
}

// 通知渠道与电池限制都在应用信息页里，WebView 自身无法可靠打开该页面，
// 因此交给原生 SystemBridge 处理。
export async function openAppSettings() {
  const bridge = window.Capacitor?.Plugins?.SystemBridge || null;
  if (!bridge) return false;
  try {
    await bridge.openAppSettings();
    return true;
  } catch {
    return false;
  }
}

// Android 8+ 的铃声/振动由渠道决定，JS 播不出渠道声音，只能发一条真通知来试听。
// 插件在构建通知时硬编码了 setOnlyAlertOnce(true)：同一个 id 再次发布只刷新、不响铃，
// 所以每次测试都必须用全新的 id。id 占用 0x7fff0000 以上的高位区间，与真实提醒的
// FNV 哈希基本不冲突，也便于在整体重建时把计时中的测试通知排除掉。
// 不能用时间戳低位来生成：两次调用相隔 1ms 且序号同时 +1 时，`Date.now() + seq`
// 会算出完全相同的 id，定时测试因此覆盖掉日程通知（真机实测 id = -1498856503）。
const TEST_ID_BASE = 0x7fff0000;
const TEST_ID_SPAN = 0xf000;
let testSeq = 0;
const pendingTestIds = new Set();

function nextTestId() {
  return TEST_ID_BASE + ((testSeq++ % TEST_ID_SPAN) + 1);
}

// 渠道一旦创建，系统就不允许应用再改它的铃声/振动/优先级（F12），
// 因此把系统实际记录下来的值读出来，才能区分"我们建错了"和"用户/ROM 改过"
async function channelSnapshot(LN, channelId) {
  if (!channelId) return null;
  try {
    const found = (await LN.listChannels()).channels?.find(c => c.id === channelId);
    if (!found) return null;
    return {
      id: found.id,
      importance: found.importance,
      sound: String(found.sound || ''),
      vibration: found.vibration,
    };
  } catch {
    return null;
  }
}

export function describeChannel(ch) {
  if (!ch) return '渠道信息读取失败';
  const sound = ch.sound && ch.sound !== 'null' ? '有铃声' : '无铃声（渠道被静音）';
  const vibr = ch.vibration ? '有振动' : '无振动';
  const imp = `优先级 ${ch.importance}${ch.importance >= 4 ? '（会响铃并弹横幅）' : ch.importance === 3 ? '（响铃但不弹横幅）' : '（静音）'}`;
  return `${ch.id} · ${imp} · ${sound} · ${vibr}`;
}

// 渠道被静音后应用无法再改回来（F12），只能由用户在系统通知设置里恢复，
// 所以把缺少的能力列出来，配合 openAppSettings 给出可操作的出路
export function channelMuteReason(ch) {
  if (!ch) return '';
  const reasons = [];
  if (!ch.sound || ch.sound === 'null') reasons.push('没有铃声');
  if (!ch.vibration) reasons.push('不会振动');
  if (ch.importance < 4) reasons.push('不会响铃、不弹横幅');
  return reasons.join('、');
}

export async function scheduleTestNotification({ delayMs = 0 } = {}) {
  const LN = getLN();
  if (!LN) return { ok: false, error: '原生通知插件不可用' };

  await ensurePermission(LN);
  if (!nativeActive) return { ok: false, error: '通知权限未授予' };
  await ensureChannels(LN);

  const settings = getReminderSettings();
  const channelId = channelSupport ? channelIdFor('activity', settings.activity) : undefined;
  const id = nextTestId();
  const notification = {
    id,
    title: '提醒试听',
    body: delayMs > 0 ? `${Math.round(delayMs / 1000)} 秒后弹出，用于验证定时链路` : '日程提醒的铃声与振动效果',
    channelId,
    autoCancel: true,
    extra: { source: 'test' },
  };
  if (delayMs > 0) {
    notification.schedule = { at: new Date(Date.now() + delayMs), allowWhileIdle: true };
    pendingTestIds.add(id);
  }

  try {
    await LN.schedule({ notifications: [notification] });
  } catch (e) {
    lastError = errorText(e);
    return { ok: false, error: lastError };
  }

  const channel = await channelSnapshot(LN, channelId);

  if (delayMs > 0) {
    const pending = await LN.getPending().catch(() => null);
    return { ok: true, mode: 'delayed', id, channel, pending: (pending?.notifications || []).length };
  }

  const delivered = await LN.getDeliveredNotifications().catch(() => null);
  const shown = (delivered?.notifications || []).some(n => n.id === id);
  return {
    ok: shown,
    mode: 'immediate',
    id,
    channel,
    error: shown ? '' : '插件已接受，但系统没有显示这条通知（通知总开关、渠道被静音或 ROM 拦截）',
  };
}

export async function getDiagnostics() {
  const LN = getLN();
  if (!LN) return { native: false };
  const out = { native: true, channelSupport, lastSync, lastError };
  try {
    const perm = await LN.checkPermissions();
    nativeActive = perm.display === 'granted';
    out.permission = perm.display;
  } catch (e) { out.permission = errorText(e); }
  // 打开设置页时渠道可能还没建好（首次启动授权失败过），这里补一次，避免诊断读数失真
  if (nativeActive) await ensureChannels(LN);
  out.channelSupport = channelSupport;
  try {
    out.exactAlarm = (await LN.checkExactNotificationSetting()).exact_alarm || 'unknown';
  } catch (e) { out.exactAlarm = errorText(e); }
  try {
    const pending = await LN.getPending();
    out.pending = (pending.notifications || []).length;
  } catch (e) { out.pending = errorText(e); }
  try {
    const delivered = await LN.getDeliveredNotifications();
    out.delivered = (delivered.notifications || []).length;
  } catch (e) { out.delivered = errorText(e); }
  try {
    const channels = await LN.listChannels();
    out.channels = (channels.channels || []).length;
  } catch (e) { out.channels = errorText(e); }
  out.channelDetail = await channelSnapshot(LN, channelSupport ? channelIdFor('activity', getReminderSettings().activity) : null);
  const enabled = await LN.areEnabled().catch(() => null);
  out.enabled = enabled ? enabled.value : 'unknown';
  return out;
}

export async function getPermissionInfo() {
  const LN = getLN();
  if (!LN) return null;
  try {
    const perm = await LN.checkPermissions();
    nativeActive = perm.display === 'granted';
    return { display: perm.display, exactAlarm: await refreshExactAlarmSetting(LN) };
  } catch {
    return null;
  }
}
