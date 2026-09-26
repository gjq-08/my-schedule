// pages/home.js - 首页（只读派生视图）
import { state } from '../app.js';
import { getSemesterWeek, getTodayStr, getHolidayName, formatDate, getWeekday, getDayCourses, parseDate } from '../date.js';
import { WEEKDAY_NAMES } from '../config.js';
import { escapeHtml } from '../ui.js';
import { loadTodos, isTodoCompleted } from './todos.js';
import { loadUpcomingCountdowns } from './countdown.js';

export function renderHomePage(container, data) {
  const today = getTodayStr();
  const todayDate = new Date();
  const { semester, weekNum } = getSemesterWeek(today);
  const weekday = getWeekday(todayDate);
  const holiday = getHolidayName(today);

  const termName = semester ? (semester.name.includes('秋') ? '秋季学期' : '春季学期') : null;

  container.innerHTML = `
    <div class="home-header">
      <div>
        <span class="today-date">${formatDate(todayDate).slice(5).replace('-', '月')}日</span>
        <span class="today-weekday">${WEEKDAY_NAMES[weekday - 1]}</span>
      </div>
      <div class="semester-info">
        ${termName && weekNum ? `${termName} · 第${weekNum}周` : '假期中'}
      </div>
    </div>
    ${holiday ? `<div class="holiday-banner">今日${escapeHtml(holiday)}，祝${escapeHtml(holiday)}快乐</div>` : ''}
    <div class="next-upcoming-section" id="next-upcoming"></div>
    <div class="today-overview">
      <div class="section-title">今天概览</div>
      <div class="timeline-section" id="today-timeline"></div>
      <div class="today-todos-section" id="today-todos"></div>
      <div class="today-countdown-section" id="today-countdown"></div>
    </div>
  `;

  renderNextUpcoming(data, today, holiday);
  renderTodayTimeline(data, today, holiday);
  renderTodayTodos();
  renderTodayCountdown();
}

function renderTodayTimeline(data, today, holiday) {
  const el = document.getElementById('today-timeline');
  if (!el) return;

  const { semester, weekNum } = getSemesterWeek(today);

  let html = '<div class="sub-section-title">课程与日程</div>';

  const dayCourses = getDayCourses(data.courses, data.exceptions, today, semester, weekNum);
  const dayActivities = data.activities.filter(a => a.date === today);

  const items = buildTimelineItems(dayCourses, dayActivities, data);

  if (items.length === 0) {
    html += '<div class="empty-state-card"><div class="empty-text">今天没有课程和日程</div><div class="empty-subtext">好好休息，享受自由时光吧</div></div>';
  }

  for (const item of items) {
    html += renderTimelineItem(item, false, false, data);
  }

  el.innerHTML = html;

  el.querySelectorAll('.course-card').forEach(card => {
    card.addEventListener('click', () => {
      import('./timetable.js').then(m => {
        if (m.openCourseDetailModal) m.openCourseDetailModal(card.dataset.courseId, data, today);
      });
    });
  });

  el.querySelectorAll('.activity-card').forEach(card => {
    card.addEventListener('click', () => {
      import('./activities.js').then(m => {
        const act = data.activities.find(a => a.id === card.dataset.activityId);
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

function renderTimelineItem(item, isOngoing, isNext, data) {
  if (item.kind === 'course') {
    const c = item.data;
    let statusHtml = '';
    if (isOngoing) statusHtml = '<span class="card-status status-now">进行中</span>';

    return `
      <div class="course-card" style="border-left-color:${c.color || '#4A9FE8'};margin-bottom:8px;${isOngoing ? 'border-left-width:6px' : ''}" data-course-id="${c.courseId}">
        <div class="card-time">
          <span>${item.time}</span>
          <span class="period-num">${c.startPeriod}-${c.endPeriod}节</span>
        </div>
        <div class="card-body">
          <div style="display:flex;align-items:center;gap:8px">
            <span class="card-name">${escapeHtml(c.name)}</span>
            ${statusHtml}
          </div>
          ${c.location ? `<div class="card-location">${escapeHtml(c.location)}</div>` : ''}
          ${c.teacher ? `<div class="card-teacher">${escapeHtml(c.teacher)}</div>` : ''}
        </div>
      </div>
    `;
  } else {
    const a = item.data;
    const tag = a.tag_id ? data.tags.find(t => t.id === a.tag_id) : null;
    const remindOpt = a.remind_minutes != null ? [{ value: 5, label: '5分钟' }, { value: 15, label: '15分钟' }, { value: 30, label: '30分钟' }, { value: 60, label: '1小时' }].find(r => r.value === a.remind_minutes) : null;

    let statusHtml = '';
    if (isOngoing) statusHtml = '<span class="card-status status-now">进行中</span>';

    return `
      <div class="activity-card" style="margin-bottom:8px" data-activity-id="${a.id}">
        <div class="card-time">
          ${item.allDay ? '<span class="all-day-badge">全天</span>' : `<span>${item.time}</span>`}
        </div>
        <div class="card-body">
          <div style="display:flex;align-items:center;gap:8px">
            <span class="card-title">${escapeHtml(a.title)}</span>
            ${statusHtml}
          </div>
          ${a.location ? `<div class="card-location">${escapeHtml(a.location)}</div>` : ''}
          <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
            ${tag ? `<span class="tag-chip" style="background:${tag.color}">${escapeHtml(tag.name)}</span>` : ''}
            ${remindOpt ? `<span class="remind-icon">🔔 ${remindOpt.label}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }
}

function renderNextUpcoming(data, today, holiday) {
  const el = document.getElementById('next-upcoming');
  if (!el) return;

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const { semester, weekNum } = getSemesterWeek(today);

  // 查找所有未来安排中的下一项（不仅限今天）
  const nextItem = findNextUpcomingItem(data, today, nowMin, semester, weekNum);

  if (!nextItem) {
    el.innerHTML = `
      <div class="next-upcoming-card empty">
        <span class="next-label">下一项安排</span>
        <span class="next-empty">没有 upcoming 安排</span>
      </div>
    `;
    return;
  }

  const isOngoing = nextItem.status === 'ongoing';
  const statusText = isOngoing ? '进行中' : '下一项';
  const statusClass = isOngoing ? 'status-now' : 'status-next';

  let content = '';
  if (nextItem.kind === 'course') {
    const c = nextItem.data;
    content = `
      <div class="next-upcoming-card" style="border-left-color:${c.color || '#4A9FE8'}">
        <div class="next-header">
          <span class="next-label">下一项安排</span>
        </div>
        <div class="next-body">
          <span class="next-time">${nextItem.time}</span>
          <span class="next-name">${escapeHtml(c.name)}</span>
          ${c.location ? `<span class="next-location">${escapeHtml(c.location)}</span>` : ''}
          <span class="next-period">${c.startPeriod}-${c.endPeriod}节</span>
          ${nextItem.date !== today ? `<span class="next-date">${nextItem.date}</span>` : ''}
        </div>
      </div>
    `;
  } else {
    const a = nextItem.data;
    const tag = a.tag_id ? data.tags.find(t => t.id === a.tag_id) : null;
    content = `
      <div class="next-upcoming-card">
        <div class="next-header">
          <span class="next-label">下一项安排</span>
        </div>
        <div class="next-body">
          <span class="next-time">${nextItem.allDay ? '全天' : nextItem.time}</span>
          <span class="next-name">${escapeHtml(a.title)}</span>
          ${a.location ? `<span class="next-location">${escapeHtml(a.location)}</span>` : ''}
          ${tag ? `<span class="tag-chip" style="background:${tag.color}">${escapeHtml(tag.name)}</span>` : ''}
          ${nextItem.date !== today ? `<span class="next-date">${nextItem.date}</span>` : ''}
        </div>
      </div>
    `;
  }

  el.innerHTML = content;
}

function findNextUpcomingItem(data, today, nowMin, semester, weekNum) {
  // 1. 先检查今天剩余的安排
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

  // 2. 检查未来的安排（最多查找 30 天）
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
      const firstItem = futureItems[0];
      return { ...firstItem, status: 'upcoming', date: futureDateStr };
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

  let html = '<div class="sub-section-title">待办</div>';

  const progressPercent = totalToday > 0 ? Math.round((completedToday / totalToday) * 100) : 0;
  html += `
    <div class="todo-progress-container">
      <div class="todo-progress-bar">
        <div class="todo-progress-fill" style="width: ${progressPercent}%"></div>
      </div>
      <div class="todo-progress-text">${completedToday}/${totalToday} 已完成</div>
    </div>
  `;

  if (todayTodos.length === 0) {
    const hasAnyTodos = todos.some(t => !isTodoCompleted(t, today));
    if (hasAnyTodos) {
      html += '<div class="empty-state-card"><div class="empty-text">今天的待办都完成了</div><div class="empty-subtext">真棒，给自己鼓个掌</div></div>';
    } else {
      html += '<div class="empty-state-card"><div class="empty-text">今天没有待办</div><div class="empty-subtext">轻松一下吧，或者去添加新待办</div></div>';
    }
  } else {
    for (const todo of todayTodos) {
      const isOverdue = !todo.daily_repeat && todo.due_date && todo.due_date < today;
      const priorityInfo = [
        { value: 'low', label: '低', color: '#666666' },
        { value: 'medium', label: '中', color: '#FFD700' },
        { value: 'high', label: '高', color: '#FF3333' },
      ].find(p => p.value === todo.priority) || { value: 'medium', label: '中', color: '#FFD700' };

      html += `
        <div class="todo-card ${isOverdue ? 'overdue' : ''}" data-id="${todo.id}" draggable="true">
          <div class="todo-check" data-id="${todo.id}">
            <input type="checkbox">
          </div>
          <div class="todo-body">
            <div class="todo-title-row">
              <span class="todo-title">${escapeHtml(todo.title)}</span>
              <span class="todo-priority" style="background:${priorityInfo.color}">${priorityInfo.label}</span>
            </div>
            <div class="todo-meta">
              ${todo.due_date ? `<span class="todo-due">${todo.due_date}${todo.due_time ? ' ' + todo.due_time : ''}</span>` : ''}
              ${todo.due_time && !todo.due_date ? `<span class="todo-due">${todo.due_time}</span>` : ''}
              ${isOverdue ? '<span class="due-overdue">已过期</span>' : ''}
              ${todo.daily_repeat ? '<span class="todo-repeat">每天</span>' : ''}
            </div>
            ${todo.note ? `<div class="todo-note">${escapeHtml(todo.note)}</div>` : ''}
          </div>
          <div class="todo-drag-handle" title="拖动排序">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="5" cy="3" r="1.5"/><circle cx="11" cy="3" r="1.5"/><circle cx="5" cy="8" r="1.5"/><circle cx="11" cy="8" r="1.5"/><circle cx="5" cy="13" r="1.5"/><circle cx="11" cy="13" r="1.5"/></svg>
          </div>
        </div>
      `;
    }
  }

  el.innerHTML = html;

  el.querySelectorAll('.todo-check input').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = e.target.closest('.todo-check').dataset.id;
      const all = loadTodos();
      const todo = all.find(t => t.id === id);
      if (!todo) return;

      if (todo.daily_repeat) {
        // 单条每日重置：记录今天完成，不生成副本
        todo.last_done_date = getTodayStr();
      } else {
        todo.completed = true;
      }

      localStorage.setItem('todos', JSON.stringify(all));
      renderTodayTodos();
    });
  });

  initTodoDragReorder(el);
}

function initTodoDragReorder(container) {
  const cards = container.querySelectorAll('.todo-card[draggable]');
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
      container.querySelectorAll('.todo-card').forEach(c => c.classList.remove('drag-over-top', 'drag-over-bottom'));
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
  let touchClone = null;
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
        touchClone.style.boxShadow = '0 8px 24px rgba(0,0,0,0.2)';
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
      container.querySelectorAll('.todo-card').forEach(c => {
        c.classList.remove('drag-over-top', 'drag-over-bottom');
        if (c.dataset.id === touchDragId) return;
        const rect = c.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.touches[0].clientY >= rect.top && e.touches[0].clientY <= rect.bottom) {
          c.classList.add(e.touches[0].clientY < midY ? 'drag-over-top' : 'drag-over-bottom');
        }
      });
    }, { passive: false });

    card.addEventListener('touchend', () => {
      clearTimeout(touchLongPressTimer);
      if (!touchDragId) return;
      if (touchClone) {
        touchClone.remove();
        touchClone = null;
      }
      card.classList.remove('dragging');
      const touch = event.changedTouches[0];
      let targetCard = null;
      let insertBefore = true;
      container.querySelectorAll('.todo-card').forEach(c => {
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
    el.innerHTML = '';
    return;
  }

  const today = getTodayStr();
  const todayDate = parseDate(today);

  let html = '<div class="sub-section-title">倒计时</div>';

  for (const item of countdowns) {
    const target = parseDate(item.target_date);
    const days = Math.ceil((target.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
    const catColors = { exam: '#FF6B6B', birthday: '#FFD166', holiday: '#6DD5B3', anniversary: '#A5B4FC', custom: '#4A9FE8' };
    const color = catColors[item.category] || '#4A9FE8';

    html += `
      <div class="home-countdown-card" style="--cat-color:${color}">
        <div class="home-cd-days">${days === 0 ? '今天' : days}</div>
        <div class="home-cd-info">
          <div class="home-cd-title">${escapeHtml(item.title)}</div>
          <div class="home-cd-date">${item.target_date}${days > 0 ? ` · 还剩${days}天` : ''}</div>
        </div>
      </div>
    `;
  }

  el.innerHTML = html;
}
