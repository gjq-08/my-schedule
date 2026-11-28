// widget-snapshot.js - 桌面小组件数据桥（仅在原生 App 内生效，网页版自动跳过）
// 排课/调课/周次/作息时间全部复用 date.js，保证小组件与 App 显示一致。
import { getSemesterWeek, getDayCourses, getHolidayName, getWeekday, formatDate, getTodayStr } from './date.js';
import { getAll } from './store.js';
import { loadTodos, isTodoCompleted } from './pages/todos.js';
import { getUpcomingCountdownsForWidget } from './pages/countdown.js';
import { requestReminderSync } from './native-notify.js';

const DAYS_AHEAD = 7;
const DEFAULT_COLOR = '#3B91EA';
const WEEKDAY_SHORT = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

let plugin = null;
let navigateFn = null;
let booted = false;
let syncTimer = null;

function getPlugin() {
  return window.Capacitor?.Plugins?.WidgetBridge || null;
}

export function isWidgetNative() {
  return !!getPlugin();
}

function parseMinutes(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

// 生成小组件快照：未来 7 天的课程/日程 + 未完成待办。
// 原生端只做时间比较与渲染；跨天后可直接从 days 里换到新的一天，无需 WebView 存活。
export function buildWidgetSnapshot(now = new Date()) {
  const data = getAll();
  const today = formatDate(now);
  const tagColor = (id) => data.tags.find(t => t.id === id)?.color || DEFAULT_COLOR;

  const days = [];
  for (let i = 0; i < DAYS_AHEAD; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const dateStr = formatDate(d);
    const { semester, weekNum } = getSemesterWeek(dateStr);
    const holiday = getHolidayName(dateStr) || '';
    const events = [];

    if (semester && weekNum) {
      for (const c of getDayCourses(data.courses, data.exceptions, dateStr, semester, weekNum)) {
        if (!c.timeRange) continue;
        const startMin = parseMinutes(c.timeRange.start);
        const endMin = parseMinutes(c.timeRange.end);
        if (startMin == null || endMin == null) continue;
        events.push({
          kind: 'course',
          title: c.name,
          location: c.location || '',
          startMin, endMin,
          timeText: `${c.timeRange.start}-${c.timeRange.end}`,
          periodText: `${c.startPeriod}-${c.endPeriod}节`,
          color: c.color || DEFAULT_COLOR,
          allDay: false,
        });
      }
    }

    for (const a of data.activities) {
      if (a.date !== dateStr) continue;
      if (a.all_day) {
        events.push({
          kind: 'activity', title: a.title, location: a.location || '',
          startMin: -1, endMin: -1, timeText: '全天', periodText: '',
          color: tagColor(a.tag_id), allDay: true,
        });
        continue;
      }
      const startMin = parseMinutes(a.start_time);
      if (startMin == null) continue;
      let endMin = parseMinutes(a.end_time);
      if (endMin == null || endMin < startMin) endMin = startMin;
      events.push({
        kind: 'activity', title: a.title, location: a.location || '',
        startMin, endMin,
        timeText: a.end_time ? `${a.start_time}-${a.end_time}` : a.start_time,
        periodText: '',
        color: tagColor(a.tag_id), allDay: false,
      });
    }

    events.sort((x, y) => x.startMin - y.startMin);
    const weekText = semester && weekNum
      ? `第${weekNum}周${holiday ? ' · ' + holiday : ''}`
      : (holiday || '假期');
    days.push({
      date: dateStr,
      label: `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAY_SHORT[getWeekday(d) - 1]}`,
      weekText,
      events,
    });
  }

  const todos = loadTodos()
    .filter(t => !isTodoCompleted(t, today))
    .map(t => ({
      id: t.id,
      title: t.title,
      dueDate: t.due_date || null,
      dueTime: t.due_time || null,
      dueMin: parseMinutes(t.due_time),
      priority: t.priority || 'medium',
      dailyRepeat: !!t.daily_repeat,
    }));

  return { v: 1, generatedAt: now.getTime(), today, days, todos, countdowns: getUpcomingCountdownsForWidget() };
}

// 桌面勾选 → 写回本机待办（与 App 内 toggle 完全一致；重复执行幂等）
export function applyWidgetComplete(todoId, today = getTodayStr()) {
  const todos = loadTodos();
  const todo = todos.find(t => t.id === todoId);
  if (!todo) return false;
  if (todo.daily_repeat) {
    if (todo.last_done_date === today) return false;
    todo.last_done_date = today;
  } else {
    if (todo.completed) return false;
    todo.completed = true;
  }
  localStorage.setItem('todos', JSON.stringify(todos));
  requestReminderSync();
  window.dispatchEvent(new CustomEvent('schedule:data-changed', { detail: { source: 'widget' } }));
  return true;
}

async function pushSnapshot() {
  if (!plugin) return;
  try {
    await plugin.syncSnapshot({ json: JSON.stringify(buildWidgetSnapshot()) });
  } catch { /* 原生异常不影响 App 主流程 */ }
}

export function scheduleWidgetSync(delay = 400) {
  if (!plugin) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    pushSnapshot();
  }, delay);
}

export async function syncWidgetsNow() {
  if (!plugin) return;
  clearTimeout(syncTimer);
  syncTimer = null;
  await pushSnapshot();
}

// 读取原生队列 → 落库 → 确认清除。drain 不清空，只有 ack 才删，崩溃可重放（幂等）
async function drainAndApply() {
  if (!plugin) return;
  try {
    const res = await plugin.drainActions();
    const actions = JSON.parse(res?.actions || '[]');
    if (!actions.length) return;
    const today = getTodayStr();
    const acked = [];
    for (const a of actions) {
      if (!a?.id) continue;
      applyWidgetComplete(a.id, today);
      acked.push(a.id);
    }
    if (acked.length) {
      try { await plugin.ackActions({ ids: JSON.stringify(acked) }); } catch { /* 下次启动重放 */ }
    }
  } catch { /* 插件异常时保持静默 */ }
}

export async function initWidgetBridge({ navigate } = {}) {
  plugin = getPlugin();
  if (!plugin) return { native: false };
  if (navigate) navigateFn = navigate;
  if (booted) {
    await drainAndApply();
    await syncWidgetsNow();
    return { native: true };
  }
  booted = true;

  try {
    plugin.addListener('widget:toggle', async (ev) => {
      const id = ev?.todoId;
      if (!id) return;
      applyWidgetComplete(id);
      await syncWidgetsNow();
      try { await plugin.ackActions({ ids: JSON.stringify([id]) }); } catch { /* 已落库，残留动作幂等 */ }
    });
  } catch { /* 监听失败时仍可用队列路径 */ }

  try {
    plugin.addListener('widget:navigate', (ev) => {
      if (ev?.tab && navigateFn) navigateFn(ev.tab);
    });
  } catch { /* 忽略 */ }

  window.addEventListener('schedule:data-changed', () => scheduleWidgetSync());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') widgetOnVisible();
  });

  await drainAndApply();
  await syncWidgetsNow();

  // 冷启动：桌面组件点开 App 时带过来的页签
  try {
    const res = await plugin.getLaunchTab();
    if (res?.tab && navigateFn) navigateFn(res.tab);
  } catch { /* 忽略 */ }

  return { native: true };
}

export function widgetOnVisible() {
  if (!plugin) return;
  drainAndApply().then(() => syncWidgetsNow());
}

export async function getWidgetStatus() {
  if (!plugin) return null;
  try {
    return await plugin.getStatus();
  } catch {
    return null;
  }
}

export async function requestExactAlarmFromWidget() {
  if (!plugin) return false;
  try {
    await plugin.requestExactAlarm();
    return true;
  } catch {
    return false;
  }
}