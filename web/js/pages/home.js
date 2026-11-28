// pages/home.js - 首页（只读派生视图）
import { switchTab } from '../app.js';
import { getSemesterWeek, getTodayStr, getHolidayName, formatDate, getWeekday, getDayCourses, parseDate } from '../date.js';
import { WEEKDAY_NAMES } from '../config.js';
import { escapeHtml } from '../ui.js';
import { loadTodos, isTodoCompleted } from './todos.js';
import { loadUpcomingCountdowns } from './countdown.js';
import { ICON_BELL, ICON_CALENDAR, ICON_CHECK_SQUARE } from '../icons.js';
import { MASCOT_GLIDE } from '../mascot.js';

let touchClone = null;

function greeting(hour) {
  if (hour < 5) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 13) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function homeEmptyHtml({ id, icon, title, desc, action, tone = '' }) {
  return `
    <div class="home-empty ${tone ? `home-empty-${tone}` : ''}">
      <span class="home-empty-icon">${icon}</span>
      <div class="home-empty-copy">
        <div class="home-empty-title">${title}</div>
        <div class="home-empty-desc">${desc}</div>
      </div>
      <button type="button" class="home-empty-action" id="${id}">${action}</button>
    </div>
  `;
}

export function renderHomePage(container, data) {
  const today = getTodayStr();
  const todayDate = new Date();
  const { semester, weekNum } = getSemesterWeek(today);
  const weekday = getWeekday(todayDate);
  const holiday = getHolidayName(today);

  const termName = semester ? (semester.name.includes('秋') ? '秋季学期' : '春季学期') : null;

  container.innerHTML = `
    <div class="home-header">
      <div class="home-date">
        <span class="home-greeting">${greeting(todayDate.getHours())}</span>
        <div class="home-date-line">
          <span class="today-date">${formatDate(todayDate).slice(5).replace('-', '月')}日</span>
          <span class="today-weekday">${WEEKDAY_NAMES[weekday - 1]}</span>
        </div>
        <span class="home-week">${termName && weekNum ? `${termName} · 第 ${weekNum} 周` : '假期中'}</span>
      </div>
      <div class="home-mascot">${MASCOT_GLIDE}</div>
    </div>
    ${holiday ? `<div class="holiday-banner">今天${escapeHtml(holiday)}，慢一点，也开心一点</div>` : ''}
    <section class="next-upcoming-section" id="next-upcoming"></section>
    <div class="home-dash">
      <section class="home-day home-card">
        <div class="section-head">
          <h3 class="section-title">今日日程</h3>
          <span class="section-sub" id="today-count"></span>
        </div>
        <div class="timeline" id="today-timeline"></div>
      </section>
      <aside class="home-side">
        <section class="side-block home-card">
          <div class="section-head">
            <h3 class="section-title">待办</h3>
            <button class="mini-more" id="go-todos" type="button">全部 ›</button>
          </div>
          <div id="today-todos"></div>
        </section>
        <section class="side-block home-card" id="today-countdown"></section>
      </aside>
    </div>
  `;

  renderNextUpcoming(data, today);
  renderTodayTimeline(data, today);
  renderTodayTodos();
  renderTodayCountdown();

  document.getElementById('go-todos')?.addEventListener('click', () => switchTab('todos'));
}

function renderTodayTimeline(data, today) {
  const el = document.getElementById('today-timeline');
  if (!el) return;

  const { semester, weekNum } = getSemesterWeek(today);
  const dayCourses = getDayCourses(data.courses, data.exceptions, today, semester, weekNum);
  const dayActivities = data.activities.filter(a => a.date === today);
  const items = buildTimelineItems(dayCourses, dayActivities, data);

  const countEl = document.getElementById('today-count');
  if (countEl) countEl.textContent = items.length ? `${items.length} 项` : '空闲';

  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();

  if (items.length === 0) {
    el.innerHTML = homeEmptyHtml({
      id: 'empty-agenda-btn',
      icon: ICON_CALENDAR,
      title: '今天没有课程和日程',
      desc: '空出来的时间，留给自己。',
      action: '添加日程',
    });
    el.querySelector('#empty-agenda-btn')?.addEventListener('click', () => switchTab('activities'));
    return;
  }

  el.innerHTML = items.map(item => renderTimelineItem(item, isItemOngoing(item, nowMin), data)).join('');

  el.querySelectorAll('[data-course-id]').forEach(row => {
    row.addEventListener('click', () => {
      import('./timetable.js').then(m => {
        if (m.openCourseDetailModal) m.openCourseDetailModal(row.dataset.courseId, data, today);
      });
    });
  });

  el.querySelectorAll('[data-activity-id]').forEach(row => {
    row.addEventListener('click', () => {
      import('./activities.js').then(m => {
        const act = data.activities.find(a => a.id === row.dataset.activityId);
        if (m.openActivityFormModal) m.openActivityFormModal(act, data);
      });
    });
  });
}

function buildTimelineItems(dayCourses, dayActivities, data) {
  const items = [];

  for (const c of dayCourses) {
    items.push({
      kind: 'course',
      time: c.timeRange?.start || '',
      timeEnd: c.timeRange?.end || '',
      data: c,
    });
  }

  for (const a of dayActivities) {
    if (a.all_day) {
      items.push({ kind: 'activity', time: '00:00', timeEnd: '23:59', data: a, allDay: true });
    } else {
      items.push({ kind: 'activity', time: a.start_time || '', timeEnd: a.end_time || '', data: a });
    }
  }

  items.sort((a, b) => {
    if (a.allDay && !b.allDay) return -1;
    if (!a.allDay && b.allDay) return 1;
    return a.time.localeCompare(b.time);
  });

  return items;
}

function isItemOngoing(item, nowMin) {
  if (item.allDay) return true;
  if (!item.timeEnd) return false;
  const [sh, sm] = (item.time || '00:00').split(':').map(Number);
  const [eh, em] = item.timeEnd.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  return nowMin >= startMin && nowMin <= endMin;
}

function isItemFuture(item, nowMin) {
  if (item.allDay) return false;
  const [sh, sm] = (item.time || '00:00').split(':').map(Number);
  return sh * 60 + sm > nowMin;
}

function renderTimelineItem(item, isOngoing, data) {
  if (item.kind === 'course') {
    const c = item.data;
    return `
      <div class="tl-item ${isOngoing ? 'is-now' : ''}" style="--dot-color:${c.color || '#2878D0'}" data-course-id="${c.courseId}">
        <div class="tl-time">
          <span class="tl-start">${item.time}</span>
          <span class="tl-end">${item.timeEnd}</span>
        </div>
        <div class="tl-rail"><span class="tl-dot"></span></div>
        <div class="tl-body">
          <div class="tl-title-row">
            <span class="tl-title">${escapeHtml(c.name)}</span>
            ${isOngoing ? '<span class="card-status status-now">进行中</span>' : ''}
          </div>
          <div class="tl-meta">
            ${c.location ? `<span>${escapeHtml(c.location)}</span>` : ''}
            ${c.startPeriod ? `<span class="dot-sep"></span><span>${c.startPeriod}–${c.endPeriod}节</span>` : ''}
            ${c.teacher ? `<span class="dot-sep"></span><span>${escapeHtml(c.teacher)}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  const a = item.data;
  const tag = a.tag_id ? data.tags.find(t => t.id === a.tag_id) : null;
  const remindOpt = a.remind_minutes != null
    ? [{ value: 5, label: '5分钟' }, { value: 15, label: '15分钟' }, { value: 30, label: '30分钟' }, { value: 60, label: '1小时' }].find(r => r.value === a.remind_minutes)
    : null;

  return `
    <div class="tl-item ${isOngoing ? 'is-now' : ''}" style="--dot-color:${tag?.color || '#2878D0'}" data-activity-id="${a.id}">
      <div class="tl-time">
        ${item.allDay ? '<span class="all-day-badge">全天</span>' : `<span class="tl-start">${item.time}</span><span class="tl-end">${item.timeEnd || ''}</span>`}
      </div>
      <div class="tl-rail"><span class="tl-dot"></span></div>
      <div class="tl-body">
        <div class="tl-title-row">
          <span class="tl-title">${escapeHtml(a.title)}</span>
          ${isOngoing && !item.allDay ? '<span class="card-status status-now">进行中</span>' : ''}
        </div>
        <div class="tl-meta">
          ${tag ? `<span class="tl-tag"><span class="tag-dot" style="background:${tag.color}"></span>${escapeHtml(tag.name)}</span>` : ''}
          ${a.location ? `<span class="dot-sep"></span><span>${escapeHtml(a.location)}</span>` : ''}
          ${remindOpt ? `<span class="dot-sep"></span><span class="remind-icon">${ICON_BELL}${remindOpt.label}</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

function renderNextUpcoming(data, today) {
  const el = document.getElementById('next-upcoming');
  if (!el) return;

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const { semester, weekNum } = getSemesterWeek(today);
  const nextItem = findNextUpcomingItem(data, today, nowMin, semester, weekNum);

  if (!nextItem) {
    el.innerHTML = `
      <div class="next-upcoming-card empty">
        <span class="next-label">下一项</span>
        <span class="next-empty">接下来没有安排，留点时间给自己</span>
      </div>
    `;
    return;
  }

  const isOngoing = nextItem.status === 'ongoing';

  if (nextItem.kind === 'course') {
    const c = nextItem.data;
    el.innerHTML = `
      <div class="next-upcoming-card" style="--course-color:${c.color || '#2878D0'}">
        <span class="next-label ${isOngoing ? 'is-now' : ''}">${isOngoing ? '进行中' : '下一项'}</span>
        <div class="next-body">
          <span class="next-time">${nextItem.time}</span>
          <span class="next-name">${escapeHtml(c.name)}</span>
          ${c.location ? `<span class="next-location">${escapeHtml(c.location)}</span>` : ''}
          ${c.startPeriod ? `<span class="next-period">${c.startPeriod}–${c.endPeriod}节</span>` : ''}
          ${nextItem.date !== today ? `<span class="next-date">${nextItem.date}</span>` : ''}
        </div>
      </div>
    `;
  } else {
    const a = nextItem.data;
    const tag = a.tag_id ? data.tags.find(t => t.id === a.tag_id) : null;
    el.innerHTML = `
      <div class="next-upcoming-card" style="--course-color:${tag?.color || '#2878D0'}">
        <span class="next-label ${isOngoing ? 'is-now' : ''}">${isOngoing ? '进行中' : '下一项'}</span>
        <div class="next-body">
          <span class="next-time">${nextItem.allDay ? '全天' : nextItem.time}</span>
          <span class="next-name">${escapeHtml(a.title)}</span>
          ${a.location ? `<span class="next-location">${escapeHtml(a.location)}</span>` : ''}
          ${nextItem.date !== today ? `<span class="next-date">${nextItem.date}</span>` : ''}
        </div>
      </div>
    `;
  }
}

function findNextUpcomingItem(data, today, nowMin, semester, weekNum) {
  const dayCourses = getDayCourses(data.courses, data.exceptions, today, semester, weekNum);
  const dayActivities = data.activities.filter(a => a.date === today);
  const todayItems = buildTimelineItems(dayCourses, dayActivities, data);

  for (const item of todayItems) {
    if (isItemOngoing(item, nowMin)) {
      return { ...item, status: 'ongoing', date: today };
    }
    if (isItemFuture(item, nowMin)) {
      return { ...item, status: 'upcoming', date: today };
    }
  }

  const todayDate = parseDate(today);
  for (let daysAhead = 1; daysAhead <= 30; daysAhead++) {
    const futureDate = new Date(todayDate);
    futureDate.setDate(futureDate.getDate() + daysAhead);
    const futureDateStr = formatDate(futureDate);

    const { semester: futureSem, weekNum: futureWeek } = getSemesterWeek(futureDateStr);
    if (!futureSem) continue;

    const futureDayCourses = getDayCourses(data.courses, data.exceptions, futureDateStr, futureSem, futureWeek);
    const futureDayActivities = data.activities.filter(a => a.date === futureDateStr);
    const futureItems = buildTimelineItems(futureDayCourses, futureDayActivities, data);

    if (futureItems.length > 0) {
      return { ...futureItems[0], status: 'upcoming', date: futureDateStr };
    }
  }

  return null;
}

function renderTodayTodos() {
  const el = document.getElementById('today-todos');
  if (!el) return;

  const todos = loadTodos();
  const today = getTodayStr();

  const allTodayTodos = todos.filter(t => {
    if (t.daily_repeat) return true;
    if (!t.due_date) return false;
    return t.due_date <= today;
  });

  const completedToday = allTodayTodos.filter(t => isTodoCompleted(t, today)).length;
  const totalToday = allTodayTodos.length;
  const todayTodos = allTodayTodos.filter(t => !isTodoCompleted(t, today));

  const progressPercent = totalToday > 0 ? Math.round((completedToday / totalToday) * 100) : 0;
  let html = totalToday > 0 ? `
    <div class="todo-progress-container">
      <div class="todo-progress-bar"><div class="todo-progress-fill" style="width:${progressPercent}%"></div></div>
      <div class="todo-progress-text">${completedToday}/${totalToday}</div>
    </div>
  ` : '';

  if (todayTodos.length === 0) {
    if (totalToday > 0) {
      html += homeEmptyHtml({
        id: 'empty-todo-btn',
        icon: ICON_CHECK_SQUARE,
        title: '今天的待办都完成了',
        desc: '可以安心休息一下。',
        action: '查看全部',
        tone: 'green',
      });
    } else {
      html += homeEmptyHtml({
        id: 'empty-todo-btn',
        icon: ICON_CHECK_SQUARE,
        title: '今天没有到期的待办',
        desc: '有需要时，记一条就好。',
        action: todos.length ? '查看全部' : '添加待办',
      });
    }
  } else {    for (const todo of todayTodos.slice(0, 4)) {
      const isOverdue = !todo.daily_repeat && todo.due_date && todo.due_date < today;
      const dueText = todo.daily_repeat
        ? '每天'
        : todo.due_date
          ? `${todo.due_date.slice(5)}${todo.due_time ? ' ' + todo.due_time : ''}`
          : '';
      html += `
        <div class="mini-todo" data-id="${todo.id}" draggable="true">
          <label class="todo-check mini-check" data-id="${todo.id}">
            <input type="checkbox" aria-label="完成 ${escapeHtml(todo.title)}">
            <span class="check-ui"></span>
          </label>
          <div class="mini-body">
            <span class="mini-title">${escapeHtml(todo.title)}</span>
            <span class="mini-meta">
              ${dueText ? `<span class="${isOverdue ? 'due-overdue' : ''}">${dueText}${isOverdue ? ' 已过期' : ''}</span>` : ''}
              ${todo.note ? `<span>${escapeHtml(todo.note.slice(0, 16))}</span>` : ''}
            </span>
          </div>
        </div>
      `;
    }
    if (todayTodos.length > 4) {
      html += `<button class="mini-more" id="more-todos" type="button">还有 ${todayTodos.length - 4} 项 ›</button>`;
    }
  }

  el.innerHTML = html;
  el.querySelector('#empty-todo-btn')?.addEventListener('click', () => switchTab('todos'));

  el.querySelectorAll('.todo-check input').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = e.target.closest('.todo-check').dataset.id;
      const all = loadTodos();
      const todo = all.find(t => t.id === id);
      if (!todo) return;

      if (todo.daily_repeat) {
        todo.last_done_date = getTodayStr();
      } else {
        todo.completed = true;
      }

      localStorage.setItem('todos', JSON.stringify(all));
      renderTodayTodos();
    });
  });

  el.querySelector('#more-todos')?.addEventListener('click', () => switchTab('todos'));
  initTodoDragReorder(el);
}

function initTodoDragReorder(container) {
  const cards = container.querySelectorAll('.mini-todo[draggable]');
  if (cards.length < 2) return;

  let dragId = null;
  cards.forEach(card => {
    card.addEventListener('dragstart', (e) => {
      dragId = card.dataset.id;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragId);
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      container.querySelectorAll('.mini-todo').forEach(c => c.classList.remove('drag-over-top', 'drag-over-bottom'));
      dragId = null;
    });

    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!dragId || card.dataset.id === dragId) return;
      const rect = card.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      card.classList.remove('drag-over-top', 'drag-over-bottom');
      card.classList.add(e.clientY < midY ? 'drag-over-top' : 'drag-over-bottom');
    });

    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    card.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!dragId || card.dataset.id === dragId) return;
      const rect = card.getBoundingClientRect();
      const insertBefore = e.clientY < rect.top + rect.height / 2;
      reorderTodos(dragId, card.dataset.id, insertBefore);
      card.classList.remove('drag-over-top', 'drag-over-bottom');
    });
  });

  let touchDragId = null;
  let touchLongPressTimer = null;
  let touchStartY = 0;

  cards.forEach(card => {
    card.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      touchStartY = e.touches[0].clientY;
      touchLongPressTimer = setTimeout(() => {
        touchDragId = card.dataset.id;
        card.classList.add('dragging');
        touchClone = card.cloneNode(true);
        touchClone.style.position = 'fixed';
        touchClone.style.width = card.offsetWidth + 'px';
        touchClone.style.zIndex = '1000';
        touchClone.style.opacity = '0.85';
        touchClone.style.pointerEvents = 'none';
        touchClone.style.boxShadow = '0 8px 24px rgba(15,42,68,0.18)';
        document.body.appendChild(touchClone);
        positionTouchClone(e.touches[0]);
        if (navigator.vibrate) navigator.vibrate(30);
      }, 400);
    }, { passive: true });

    card.addEventListener('touchmove', (e) => {
      if (!touchDragId) {
        const dy = Math.abs(e.touches[0].clientY - touchStartY);
        if (dy > 10) clearTimeout(touchLongPressTimer);
        return;
      }
      e.preventDefault();
      positionTouchClone(e.touches[0]);
      container.querySelectorAll('.mini-todo').forEach(c => {
        c.classList.remove('drag-over-top', 'drag-over-bottom');
        if (c.dataset.id === touchDragId) return;
        const rect = c.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.touches[0].clientY >= rect.top && e.touches[0].clientY <= rect.bottom) {
          c.classList.add(e.touches[0].clientY < midY ? 'drag-over-top' : 'drag-over-bottom');
        }
      });
    }, { passive: false });

    card.addEventListener('touchend', (e) => {
      clearTimeout(touchLongPressTimer);
      if (!touchDragId) return;
      if (touchClone) {
        touchClone.remove();
        touchClone = null;
      }
      card.classList.remove('dragging');
      const touch = e.changedTouches[0];
      let targetCard = null;
      let insertBefore = true;
      container.querySelectorAll('.mini-todo').forEach(c => {
        c.classList.remove('drag-over-top', 'drag-over-bottom');
        if (c.dataset.id === touchDragId) return;
        const rect = c.getBoundingClientRect();
        if (touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
          targetCard = c;
          insertBefore = touch.clientY < rect.top + rect.height / 2;
        }
      });
      if (targetCard) {
        reorderTodos(touchDragId, targetCard.dataset.id, insertBefore);
      }
      touchDragId = null;
    });
  });
}

function positionTouchClone(touch) {
  if (!touchClone) return;
  touchClone.style.left = (touch.clientX - touchClone.offsetWidth / 2) + 'px';
  touchClone.style.top = (touch.clientY - 20) + 'px';
}

function reorderTodos(dragId, targetId, insertBefore) {
  const all = loadTodos();
  const dragIdx = all.findIndex(t => t.id === dragId);
  const targetIdx = all.findIndex(t => t.id === targetId);
  if (dragIdx < 0 || targetIdx < 0) return;
  const [moved] = all.splice(dragIdx, 1);
  const newTargetIdx = all.findIndex(t => t.id === targetId);
  all.splice(insertBefore ? newTargetIdx : newTargetIdx + 1, 0, moved);
  localStorage.setItem('todos', JSON.stringify(all));
  renderTodayTodos();
}

function renderTodayCountdown() {
  const el = document.getElementById('today-countdown');
  if (!el) return;

  const countdowns = loadUpcomingCountdowns(2);
  if (countdowns.length === 0) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;

  const today = getTodayStr();
  const todayDate = parseDate(today);
  const catColors = { exam: '#C0463A', birthday: '#A5660A', holiday: '#17795C', anniversary: '#6553B8', custom: '#1F5FAE' };

  let html = `<div class="section-head"><h3 class="section-title">倒计时</h3><button class="mini-more" id="go-countdown" type="button">全部 ›</button></div>`;

  for (const item of countdowns) {
    const target = parseDate(item.target_date);
    const days = Math.ceil((target.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
    const color = catColors[item.category] || '#2878D0';

    html += `
      <div class="home-cd-row" style="--cat-color:${color}">
        <span class="home-cd-days ${days === 0 ? 'is-today' : ''}">${days === 0 ? '今天' : days}</span>
        <div class="home-cd-info">
          <div class="home-cd-title">${escapeHtml(item.title)}</div>
          <div class="home-cd-date">${item.target_date}${days > 0 ? ` · 还剩 ${days} 天` : ''}</div>
        </div>
      </div>
    `;
  }

  el.innerHTML = html;
  el.querySelector('#go-countdown')?.addEventListener('click', () => switchTab('countdown'));
}
