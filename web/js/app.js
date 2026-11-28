// app.js - SPA 主入口与路由
import { fetchBootstrap, describeApiError } from './api.js';
import { getSemesterWeek, getTodayStr, getHolidayName, formatDate, getWeekday, getMondayOfWeek } from './date.js';
import { WEEKDAY_NAMES } from './config.js';
import { showToast, showErrorBanner, hideErrorBanner, showSkeleton, escapeHtml } from './ui.js';
import { renderTimetablePage } from './pages/timetable.js';
import { renderActivitiesPage } from './pages/activities.js';
import { renderHomePage } from './pages/home.js';
import { renderTodosPage } from './pages/todos.js';
import { renderCountdownPage } from './pages/countdown.js';
import { initReminderEngine } from './reminder.js';
import { initNativeNotify, requestReminderSync } from './native-notify.js';
import { initWidgetBridge, widgetOnVisible } from './widget-snapshot.js';
import * as store from './store.js';
import { importOnFirstRun, importFromSnapshot } from './first-run.js';
import { maybeSplash } from './splash.js';
import { checkForUpdates } from './update.js';
import { LOGO_MARK } from './icons.js';

// Global state
const state = {
  currentTab: 'home',
  data: {
    semesters: [],
    holidays: [],
    courses: [],
    exceptions: [],
    activities: [],
    tags: [],
    settings: { sound: true, vibrate: true, notify: false },
  },
  loaded: false,
  loading: false,
};

// Make state accessible for pages
window.__appState = state;

async function loadData() {
  if (state.loading) return;
  state.loading = true;
  const content = document.getElementById('page-content');
  if (!state.loaded) showSkeleton(content);

  // 首次启动：从云端一次性导入（PRD §25.3），此后读写全部走本地
  let imported = null;
  try {
    if (!store.isReady()) imported = await importOnFirstRun();

    const data = await fetchBootstrap();
    state.data.semesters = data.semesters || [];
    state.data.holidays = data.holidays || [];
    state.data.courses = data.courses || [];
    state.data.exceptions = data.exceptions || [];
    state.data.activities = data.activities || [];
    state.data.tags = data.tags || [];
    state.data.settings = data.settings || { sound: true, vibrate: true, notify: false };
    state.loaded = true;
    state.loading = false;
    hideErrorBanner();
    renderCurrentPage();
    updateWeekInfo();
    bootReminders();
    requestReminderSync(state.data);
    initWidgetBridge({ navigate: switchTab }).catch(() => {});
    scheduleUpdateCheck();
    if (imported) {
      const c = imported.counts;
      showToast(`导入完成：课程 ${c.courses} · 活动 ${c.activities} · 待办 ${c.todos} · 倒计日 ${c.countdowns}`, 'success');
    }
  } catch (err) {
    state.loading = false;
    if (!store.isReady()) {
      // 导入未完成，页面没有任何可用数据，给出可操作的出路（PRD §26）
      renderImportGate(err);
      return;
    }
    // GET 已在 api.js 内退避重试过两轮仍失败，这里把真实原因显示出来
    const reason = describeApiError(err);
    showErrorBanner(reason, loadData);
    if (!state.loaded) {
      content.innerHTML = `<div class="empty-state">${escapeHtml(reason)}<br>请点击重试</div>`;
    }
  }
}

function renderImportGate(err) {
  const content = document.getElementById('page-content');
  const reason = describeApiError(err);
  content.innerHTML = `
    <div class="empty-state">
      首次使用需要联网导入一次数据<br>${escapeHtml(reason)}
      <div style="display:flex;gap:8px;justify-content:center;margin-top:14px">
        <button class="btn btn-primary" id="import-retry-btn">重试</button>
        <button class="btn btn-secondary" id="import-snapshot-btn">先用内置数据</button>
      </div>
      <p style="margin-top:12px;font-size:12px;opacity:.75">内置数据不含手机上原有的待办与倒计日，联网后可在设置里重新导入</p>
    </div>`;
  content.querySelector('#import-retry-btn').addEventListener('click', loadData);
  content.querySelector('#import-snapshot-btn').addEventListener('click', async () => {
    try {
      await importFromSnapshot();
      showToast('已载入内置数据，待办与倒计日不含旧数据', 'info');
      loadData();
    } catch (err2) {
      showErrorBanner(describeApiError(err2), loadData);
    }
  });
}

function updateWeekInfo() {
  const today = getTodayStr();
  const { semester, weekNum } = getSemesterWeek(today);
  const weekday = getWeekday(new Date());
  const weekInfo = document.getElementById('week-info');
  if (!weekInfo) return;
  if (semester && weekNum) {
    const termName = semester.name.includes('秋') ? '秋季学期' : '春季学期';
    weekInfo.textContent = `第${weekNum}周 · ${termName.replace('学期', '')}`;
    weekInfo.title = `${termName} · 第${weekNum}周 · ${WEEKDAY_NAMES[weekday - 1]}`;
  } else {
    weekInfo.textContent = '假期中';
    weekInfo.title = '当前不在学期内';
  }
}

function renderCurrentPage() {
  const content = document.getElementById('page-content');
  switch (state.currentTab) {
    case 'home':
      renderHomePage(content, state.data);
      break;
    case 'timetable':
      renderTimetablePage(content, state.data);
      break;
    case 'activities':
      renderActivitiesPage(content, state.data);
      break;
    case 'todos':
      renderTodosPage(content);
      break;
    case 'countdown':
      renderCountdownPage(content);
      break;
  }
}

function switchTab(tab) {
  state.currentTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.btab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  renderCurrentPage();
  const content = document.getElementById('page-content');
  content.scrollTop = 0;
  content.classList.remove('page-enter');
  void content.offsetWidth;
  content.classList.add('page-enter');
  clearTimeout(switchTab._enterTimer);
  switchTab._enterTimer = setTimeout(() => content.classList.remove('page-enter'), 240);
}

let remindersBooted = false;
let updateCheckScheduled = false;

function scheduleUpdateCheck() {
  if (updateCheckScheduled) return;
  updateCheckScheduled = true;
  setTimeout(() => { checkForUpdates().catch(() => {}); }, 1800);
}

async function bootReminders() {
  if (remindersBooted) return;
  remindersBooted = true;
  const info = await initNativeNotify({ navigate: switchTab, getData: () => state.data });
  // 原生通知接管时不启动 JS 定时器路径，避免同一条提醒弹两次（PRD §11.8）
  if (!info?.granted) initReminderEngine(state.data);
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  const mark = document.getElementById('brand-mark');
  if (mark) mark.outerHTML = LOGO_MARK;

  // Tab navigation
  document.querySelectorAll('.tab, .btab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Week info click → go to timetable
  document.getElementById('week-info').addEventListener('click', () => switchTab('timetable'));

  // Settings button
  document.getElementById('settings-btn').addEventListener('click', () => {
    import('./pages/settings.js').then(m => m.openSettingsModal(state.data));
  });

  // Load data（提醒引擎在 loadData 成功后启动）；开屏动画与数据加载并行，取两者较晚者退出
  maybeSplash(loadData());

  // 回到前台时整体重建，覆盖"App 长期在后台、期间数据变化"的情形（PRD §11.3 时机 4）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.loaded) {
      requestReminderSync(state.data);
      widgetOnVisible();
    }
  });
});

// Export for pages to use
export { state, loadData, renderCurrentPage, switchTab };
