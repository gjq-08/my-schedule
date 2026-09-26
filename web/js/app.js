// app.js - SPA 主入口与路由
import { fetchBootstrap } from './api.js';
import { getSemesterWeek, getTodayStr, getHolidayName, formatDate, getWeekday, getMondayOfWeek } from './date.js';
import { WEEKDAY_NAMES } from './config.js';
import { showToast, showErrorBanner, hideErrorBanner, showSkeleton } from './ui.js';
import { renderTimetablePage } from './pages/timetable.js';
import { renderActivitiesPage } from './pages/activities.js';
import { renderHomePage } from './pages/home.js';
import { renderTodosPage } from './pages/todos.js';
import { renderCountdownPage } from './pages/countdown.js';
import { initReminderEngine } from './reminder.js';

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

  try {
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
  } catch (err) {
    state.loading = false;
    showErrorBanner('加载失败，请检查网络', loadData);
    if (!state.loaded) {
      content.innerHTML = '<div class="empty-state">加载失败，请点击重试</div>';
    }
  }
}

function updateWeekInfo() {
  const today = getTodayStr();
  const { semester, weekNum } = getSemesterWeek(today);
  const weekday = getWeekday(new Date());
  const weekInfo = document.getElementById('week-info');
  if (semester && weekNum) {
    const termName = semester.name.includes('秋') ? '秋季学期' : '春季学期';
    weekInfo.textContent = `${termName} · 第${weekNum}周 · ${WEEKDAY_NAMES[weekday - 1]}`;
  } else {
    weekInfo.textContent = '假期中';
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
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
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

  // Load data
  loadData();

  // Start reminder engine after data loads
  const checkAndStartReminder = setInterval(() => {
    if (state.loaded) {
      clearInterval(checkAndStartReminder);
      initReminderEngine(state.data);
    }
  }, 1000);
});

// Export for pages to use
export { state, loadData, renderCurrentPage, switchTab };
