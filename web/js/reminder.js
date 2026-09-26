// reminder.js - 提醒引擎
import { getTodayStr } from './date.js';
import { playReminderSound, vibrate } from './audio.js';
import { isTodoCompleted } from './pages/todos.js';

const triggered = new Set();

function getReminderSettings() {
  const stored = localStorage.getItem('reminderSettings');
  if (stored) return JSON.parse(stored);
  return {
    course: { sound: true, vibrate: true, notify: false },
    activity: { sound: true, vibrate: true, notify: false },
    todo: { sound: true, vibrate: true, notify: false },
  };
}

export function initReminderEngine(data) {
  setInterval(() => scan(data), 60000);
  scan(data);
}

function scan(data) {
  const today = getTodayStr();
  const reminderSettings = getReminderSettings();
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const todayActivities = data.activities.filter(a =>
    a.date === today &&
    a.remind_minutes != null &&
    !a.all_day &&
    a.start_time
  );

  for (const act of todayActivities) {
    const [sh, sm] = act.start_time.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const triggerMin = startMin - act.remind_minutes;
    const key = `${act.id}-${today}`;

    if (triggered.has(key)) continue;

    if (nowMin === triggerMin) {
      triggered.add(key);
      fireReminder(act, reminderSettings.activity, data);
    }
  }

  scanTodos(today, nowMin, reminderSettings);
}

function scanTodos(today, nowMin, reminderSettings) {
  let todos;
  try {
    const raw = localStorage.getItem('todos');
    if (!raw) return;
    todos = JSON.parse(raw);
  } catch { return; }

  const dueTodos = todos.filter(t => {
    if (t.remind_minutes == null || !t.due_time) return false;
    if (isTodoCompleted(t, today)) return false;
    // 每天待办每天都提醒；普通待办只在到期日提醒
    return t.daily_repeat || t.due_date === today;
  });

  for (const todo of dueTodos) {
    const [th, tm] = todo.due_time.split(':').map(Number);
    const dueMin = th * 60 + tm;
    const triggerMin = dueMin - todo.remind_minutes;
    const key = `${todo.id}-${today}`;

    if (triggered.has(key)) continue;

    if (nowMin === triggerMin) {
      triggered.add(key);
      fireTodoReminder(todo, reminderSettings.todo || reminderSettings.activity);
    }
  }
}

function fireTodoReminder(todo, settings) {
  showTodoBanner(todo);

  if (settings.sound) playReminderSound();
  if (settings.vibrate) vibrate([200, 100, 200]);

  if (settings.notify && 'Notification' in window && Notification.permission === 'granted') {
    new Notification(`待办：${todo.title}`, {
      body: `${todo.due_time} 截止${todo.note ? ' · ' + todo.note : ''}`,
      tag: todo.id,
    });
  }
}

function showTodoBanner(todo) {
  let banner = document.getElementById('reminder-banner');
  if (banner) banner.remove();

  banner = document.createElement('div');
  banner.id = 'reminder-banner';
  banner.className = 'reminder-banner';
  banner.innerHTML = `
    <span class="reminder-text">🔔 待办提醒：${escapeHtml(todo.title)} ${todo.remind_minutes}分钟后截止</span>
    <button class="btn-view">查看</button>
    <button class="btn-dismiss">&times;</button>
  `;

  const topBar = document.getElementById('top-bar');
  if (topBar) topBar.after(banner);

  banner.querySelector('.btn-dismiss').addEventListener('click', () => banner.remove());
  banner.querySelector('.btn-view').addEventListener('click', () => {
    banner.remove();
    document.querySelectorAll('.tab, .btab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === 'todos');
    });
    import('./app.js').then(m => m.switchTab('todos'));
  });

  setTimeout(() => {
    if (banner.parentNode) banner.remove();
  }, 30000);
}

function fireReminder(activity, settings, data) {
  showInAppBanner(activity, data);

  if (settings.sound) {
    playReminderSound();
  }

  if (settings.vibrate) {
    vibrate([200, 100, 200]);
  }

  if (settings.notify && 'Notification' in window && Notification.permission === 'granted') {
    const [sh, sm] = (activity.start_time || '').split(':').map(Number);
    new Notification(`${activity.title}`, {
      body: `${sh}:${String(sm).padStart(2, '0')} 开始${activity.location ? ' · ' + activity.location : ''}`,
      tag: activity.id,
    });
  }
}

function showInAppBanner(activity, data) {
  let banner = document.getElementById('reminder-banner');
  if (banner) banner.remove();

  const tag = activity.tag_id ? data.tags.find(t => t.id === activity.tag_id) : null;
  const [sh, sm] = (activity.start_time || '').split(':').map(Number);

  banner = document.createElement('div');
  banner.id = 'reminder-banner';
  banner.className = 'reminder-banner';
  banner.innerHTML = `
    <span class="reminder-text">🔔 ${escapeHtml(activity.title)} ${activity.remind_minutes}分钟后开始${activity.location ? ' · ' + escapeHtml(activity.location) : ''}</span>
    <button class="btn-view">查看</button>
    <button class="btn-dismiss">&times;</button>
  `;

  const topBar = document.getElementById('top-bar');
  if (topBar) topBar.after(banner);

  banner.querySelector('.btn-dismiss').addEventListener('click', () => banner.remove());
  banner.querySelector('.btn-view').addEventListener('click', () => {
    banner.remove();
    import('./pages/activities.js').then(m => {
      if (m.openActivityFormModal) m.openActivityFormModal(activity, data);
    });
  });

  setTimeout(() => {
    if (banner.parentNode) banner.remove();
  }, 30000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
