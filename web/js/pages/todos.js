// pages/todos.js - 待办功能（localStorage 存储）+ 作业关联课程（方案A）
import { getTodayStr, getMondayOfWeek, formatDate } from '../date.js';
import { REMIND_OPTIONS, WEEKDAY_NAMES } from '../config.js';
import { escapeHtml, showToast, showConfirm, Modal } from '../ui.js';
import { requestReminderSync } from '../native-notify.js';
import { listCourses, getSemesters } from '../store.js';
import { ICON_EDIT, ICON_TRASH, ICON_BELL, ICON_PLUS } from '../icons.js';
import { MASCOT_PEEK } from '../mascot.js';

const STORAGE_KEY = 'todos';

export function loadTodos() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveTodos(todos) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
  requestReminderSync();
  window.dispatchEvent(new CustomEvent('schedule:data-changed', { detail: { source: 'todos' } }));
}

function genId() {
  return 'todo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

// color 只用于选择器描边与文字，需保证小字号下 ≥4.5:1（存储的是 value，不是颜色）
const PRIORITY_OPTIONS = [
  { value: 'low', label: '低', color: '#5F6F88', cls: 'prio-low' },
  { value: 'medium', label: '中', color: '#8A5A00', cls: 'prio-medium' },
  { value: 'high', label: '高', color: '#B03A2E', cls: 'prio-high' },
];

let filterMode = 'active'; // 'all' | 'active' | 'completed'
let courseFilter = null;   // 课程 id 或 null（全部）

export function isTodoCompleted(todo, today) {
  if (todo.daily_repeat) return todo.last_done_date === today;
  return !!todo.completed;
}

function shortCourseName(name) {
  let s = String(name || '').replace(/[（(]\s*\d+\s*[)）]\s*$/, '').trim();
  if (!s) s = String(name || '');
  return s.length > 8 ? s.slice(0, 8) + '…' : s;
}

const GROUPS = [
  { key: 'overdue', label: '逾期' },
  { key: 'today', label: '今天' },
  { key: 'week', label: '本周' },
  { key: 'later', label: '之后' },
  { key: 'nodue', label: '无截止' },
  { key: 'done', label: '已完成' },
];

function groupOf(todo, today, weekEnd) {
  if (isTodoCompleted(todo, today)) return 'done';
  if (todo.daily_repeat) return 'nodue';
  if (!todo.due_date) return 'nodue';
  if (todo.due_date < today) return 'overdue';
  if (todo.due_date === today) return 'today';
  if (todo.due_date <= weekEnd) return 'week';
  return 'later';
}

export function renderTodosPage(container) {
  const todos = loadTodos();
  const today = getTodayStr();
  const activeCount = todos.filter(t => !isTodoCompleted(t, today)).length;
  // 逾期数比"共 N 项"更值得放在页眉；未完成总数由下方汇总条承担，避免重复
  const overdueCount = todos.filter(t =>
    !isTodoCompleted(t, today) && !t.daily_repeat && t.due_date && t.due_date < today).length;

  container.innerHTML = `
    <div class="page-header">
      <div class="page-heading">
        <h2 class="page-title">待办</h2>
        <span class="page-meta ${overdueCount ? 'is-overdue' : ''}">${overdueCount ? `${overdueCount} 项已逾期` : `共 ${todos.length} 项`}</span>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-primary btn-sm" id="add-todo-btn">${ICON_PLUS}<span>新建</span></button>
      </div>
    </div>
    <div class="todo-summary">
      <div class="todo-summary-text"><strong>${activeCount}</strong> 件待完成</div>
      <div class="seg" id="todo-filter" role="tablist" aria-label="筛选待办">
        <button class="seg-item ${filterMode === 'all' ? 'active' : ''}" data-mode="all">全部</button>
        <button class="seg-item ${filterMode === 'active' ? 'active' : ''}" data-mode="active">未完成</button>
        <button class="seg-item ${filterMode === 'completed' ? 'active' : ''}" data-mode="completed">已完成</button>
      </div>
    </div>
    <div class="course-filter" id="todo-course-filter"></div>
    <div id="todos-list"></div>
  `;

  renderCourseFilter(todos, container);
  renderTodosList(todos);

  document.getElementById('add-todo-btn').addEventListener('click', () => {
    openTodoForm(null, (newTodo) => {
      const all = loadTodos();
      all.unshift(newTodo);
      saveTodos(all);
      rerenderTodos();
      showToast('待办已创建', 'success');
    });
  });

  container.querySelectorAll('#todo-filter .seg-item').forEach(btn => {
    btn.addEventListener('click', () => {
      filterMode = btn.dataset.mode;
      rerenderTodos();
    });
  });
}

function rerenderTodos() {
  const container = document.getElementById('page-content');
  const top = container ? container.scrollTop : 0;
  renderTodosPage(container);
  if (container) container.scrollTop = top;
}

function renderCourseFilter(todos, container) {
  const holder = document.getElementById('todo-course-filter');
  if (!holder) return;
  const courses = listCourses();
  const usedIds = [...new Set(todos.map(t => t.course_id).filter(Boolean))];
  const used = usedIds.map(id => courses.find(c => c.id === id)).filter(Boolean);
  if (!used.length) { holder.innerHTML = ''; return; }

  holder.innerHTML = `
    <button class="course-filter-chip ${courseFilter === null ? 'active' : ''}" data-course="">全部课程</button>
    ${used.map(c => `
      <button class="course-filter-chip ${courseFilter === c.id ? 'active' : ''}" data-course="${c.id}" title="${escapeHtml(c.name)}">
        <span class="todo-course-dot" style="background:${c.color || '#2878D0'}"></span>${escapeHtml(shortCourseName(c.name))}
      </button>
    `).join('')}
  `;
  holder.querySelectorAll('.course-filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      courseFilter = chip.dataset.course || null;
      rerenderTodos();
    });
  });
}

function renderTodosList(todos) {
  const listEl = document.getElementById('todos-list');
  if (!listEl) return;

  const today = getTodayStr();
  const monday = getMondayOfWeek(new Date());
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const weekEnd = formatDate(sunday);
  const courses = listCourses();

  let filtered = todos;
  if (filterMode === 'active') filtered = filtered.filter(t => !isTodoCompleted(t, today));
  else if (filterMode === 'completed') filtered = filtered.filter(t => isTodoCompleted(t, today));
  if (courseFilter) filtered = filtered.filter(t => t.course_id === courseFilter);

  if (filtered.length === 0) {
    const text = courseFilter ? '该课程下暂无待办' : filterMode === 'completed' ? '还没有完成的待办' : filterMode === 'active' ? '所有待办都完成了' : '还没有待办';
    const sub = filterMode === 'active' ? '给自己留一点空档' : '点右上角新建一条';
    listEl.innerHTML = `<div class="todo-empty">${MASCOT_PEEK}<div class="empty-text">${text}</div><div class="empty-subtext">${sub}</div></div>`;
    return;
  }

  const buckets = {};
  for (const t of filtered) {
    const g = groupOf(t, today, weekEnd);
    (buckets[g] = buckets[g] || []).push(t);
  }
  for (const key of Object.keys(buckets)) {
    buckets[key].sort((a, b) => {
      const ad = a.due_date || '9999-12-31';
      const bd = b.due_date || '9999-12-31';
      if (ad !== bd) return ad.localeCompare(bd);
      return (a.due_time || '').localeCompare(b.due_time || '');
    });
  }

  const cardHtml = (todo) => {
    const completed = isTodoCompleted(todo, today);
    const isOverdue = !completed && !todo.daily_repeat && todo.due_date && todo.due_date < today;
    const priorityInfo = PRIORITY_OPTIONS.find(p => p.value === todo.priority) || PRIORITY_OPTIONS[1];
    const course = todo.course_id ? courses.find(c => c.id === todo.course_id) : null;
    const remind = todo.remind_minutes != null ? REMIND_OPTIONS.find(r => r.value === todo.remind_minutes) : null;

    return `
      <div class="todo-row ${completed ? 'completed' : ''} ${isOverdue ? 'overdue' : ''}" data-id="${todo.id}">
        <label class="todo-check" data-id="${todo.id}">
          <input type="checkbox" ${completed ? 'checked' : ''} aria-label="完成 ${escapeHtml(todo.title)}">
          <span class="check-ui"></span>
        </label>
        <div class="todo-main">
          <div class="todo-line">
            <span class="todo-title">${escapeHtml(todo.title)}</span>
            ${todo.priority !== 'low' ? `<span class="todo-priority ${priorityInfo.cls}">${priorityInfo.label}</span>` : ''}
          </div>
          <div class="todo-meta">
            ${course ? `<button type="button" class="todo-course" data-course="${course.id}" title="${escapeHtml(course.name)}"><span class="todo-course-dot" style="background:${course.color || '#2878D0'}"></span>${escapeHtml(shortCourseName(course.name))}</button>` : ''}
            ${todo.due_date ? `<span class="todo-due ${isOverdue ? 'due-overdue' : ''}">${todo.due_date.slice(5)}${todo.due_time ? ' ' + todo.due_time : ''}${isOverdue ? ' 已过期' : ''}</span>` : ''}
            ${todo.daily_repeat ? `<span class="todo-repeat">每天</span>` : ''}
            ${remind ? `<span class="todo-remind remind-icon">${ICON_BELL}${remind.label}</span>` : ''}
          </div>
          ${todo.note ? `<div class="todo-note">${escapeHtml(todo.note)}</div>` : ''}
        </div>
        <div class="todo-actions">
          <button type="button" class="btn-icon todo-edit" data-id="${todo.id}" title="编辑" aria-label="编辑">${ICON_EDIT}</button>
          <button type="button" class="btn-icon todo-delete" data-id="${todo.id}" title="删除" aria-label="删除">${ICON_TRASH}</button>
        </div>
      </div>
    `;
  };

  let html = '';
  for (const g of GROUPS) {
    const items = buckets[g.key];
    if (!items || !items.length) continue;
    html += `<div class="todo-group${g.key === 'overdue' ? ' is-overdue' : ''}">
      <div class="todo-group-header"><span class="todo-group-name">${g.label}</span><span class="todo-group-count">${items.length}</span></div>
      ${items.map(cardHtml).join('')}
    </div>`;
  }
  listEl.innerHTML = html;

  listEl.querySelectorAll('.todo-check input').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = e.target.closest('.todo-check').dataset.id;
      toggleTodo(id);
    });
  });

  listEl.querySelectorAll('.todo-course').forEach(btn => {
    btn.addEventListener('click', () => {
      courseFilter = btn.dataset.course;
      rerenderTodos();
    });
  });

  listEl.querySelectorAll('.todo-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const all = loadTodos();
      const todo = all.find(t => t.id === id);
      if (todo) {
        openTodoForm(todo, (updated) => {
          const latest = loadTodos();
          const idx = latest.findIndex(t => t.id === id);
          if (idx >= 0) {
            latest[idx] = { ...latest[idx], ...updated };
            saveTodos(latest);
            rerenderTodos();
            showToast('待办已更新', 'success');
          }
        });
      }
    });
  });

  listEl.querySelectorAll('.todo-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      showConfirm('确定删除这条待办？', () => {
        const all = loadTodos();
        saveTodos(all.filter(t => t.id !== id));
        rerenderTodos();
        showToast('已删除', 'success');
      });
    });
  });
}

function toggleTodo(id) {
  const all = loadTodos();
  const todo = all.find(t => t.id === id);
  if (!todo) return;

  const today = getTodayStr();

  if (todo.daily_repeat) {
    todo.last_done_date = (todo.last_done_date === today) ? null : today;
  } else {
    todo.completed = !todo.completed;
  }

  saveTodos(all);
  rerenderTodos();
}

export function openTodoForm(todo, onSave) {
  const isEdit = !!todo;
  const title = isEdit ? '编辑待办' : '新建待办';

  const courses = listCourses();
  const sems = getSemesters();
  const repMap = new Map();
  for (const c of [...courses].sort((a, b) => (a.weekday - b.weekday) || (a.start_period - b.start_period))) {
    const key = c.name + '||' + (c.semester_id || '');
    if (!repMap.has(key)) repMap.set(key, c);
  }
  const reps = [...repMap.values()];
  const nameCount = {};
  reps.forEach(c => { nameCount[c.name] = (nameCount[c.name] || 0) + 1; });
  const byWeekday = {};
  reps.forEach(c => { (byWeekday[c.weekday] = byWeekday[c.weekday] || []).push(c); });

  let selectedCourseId = '';
  if (isEdit && todo.course_id) {
    const cur = courses.find(c => c.id === todo.course_id);
    if (cur) selectedCourseId = (repMap.get(cur.name + '||' + (cur.semester_id || '')) || cur).id;
  }

  let courseOptions = '<option value="">不关联课程</option>';
  for (let d = 1; d <= 7; d++) {
    const list = byWeekday[d] || [];
    if (!list.length) continue;
    courseOptions += `<optgroup label="${WEEKDAY_NAMES[d - 1]}">` + list.map(c => {
      const sem = sems.find(s => s.id === c.semester_id);
      const tag = nameCount[c.name] > 1 && sem ? `（${sem.name.includes('秋') ? '秋' : '春'}）` : '';
      return `<option value="${c.id}" ${selectedCourseId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}${tag}</option>`;
    }).join('') + '</optgroup>';
  }

  const modal = new Modal(title, `
    <div class="form-group">
      <label class="form-label" for="todo-title">标题 *</label>
      <input class="form-input" type="text" id="todo-title" maxlength="100" required value="${isEdit ? escapeHtml(todo.title) : ''}" placeholder="要做什么">
    </div>
    <div class="form-group">
      <label class="form-label" for="todo-course">关联课程</label>
      <select class="form-select" id="todo-course">${courseOptions}</select>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="todo-due-date">截止日期</label>
        <input class="form-input" type="date" id="todo-due-date" value="${isEdit && todo.due_date ? todo.due_date : ''}">
      </div>
      <div class="form-group">
        <label class="form-label" for="todo-due-time">截止时间</label>
        <input class="form-input" type="time" id="todo-due-time" value="${isEdit && todo.due_time ? todo.due_time : ''}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">优先级</label>
      <div class="todo-priority-picker" id="priority-picker">
        ${PRIORITY_OPTIONS.map(p => `
          <button type="button" class="priority-option ${(!isEdit && p.value === 'medium') || (isEdit && todo.priority === p.value) ? 'selected' : ''}" data-value="${p.value}" style="--pcolor:${p.color}">
            ${p.label}
          </button>
        `).join('')}
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" for="todo-remind">提醒</label>
      <select class="form-select" id="todo-remind">
        ${REMIND_OPTIONS.map(o => `<option value="${o.value ?? ''}" ${(isEdit && todo.remind_minutes === o.value) || (!isEdit && o.value === null) ? 'selected' : ''}>${o.label}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="form-check">
        <input type="checkbox" id="todo-daily-repeat" ${isEdit && todo.daily_repeat ? 'checked' : ''}>
        <span>每天重复（勾选即完成当天，次日自动恢复）</span>
      </label>
    </div>
    <div class="form-group">
      <label class="form-label" for="todo-note">备注</label>
      <textarea class="form-textarea" id="todo-note" maxlength="500" placeholder="补充说明（可选）">${isEdit && todo.note ? escapeHtml(todo.note) : ''}</textarea>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" id="todo-cancel-btn" type="button">取消</button>
      <button class="btn btn-primary" id="todo-save-btn" type="button">${isEdit ? '保存' : '创建'}</button>
    </div>
  `);
  modal.show();

  const body = modal.getContent();
  let selectedPriority = (isEdit && todo.priority) ? todo.priority : 'medium';
  body.querySelector('#todo-title')?.focus();

  body.querySelectorAll('.priority-option').forEach(btn => {
    btn.addEventListener('click', () => {
      body.querySelectorAll('.priority-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedPriority = btn.dataset.value;
    });
  });

  body.querySelector('#todo-save-btn').addEventListener('click', () => {
    const titleVal = body.querySelector('#todo-title').value.trim();
    if (!titleVal) {
      showToast('请输入标题', 'error');
      return;
    }

    const dueDate = body.querySelector('#todo-due-date').value || null;
    const dueTime = body.querySelector('#todo-due-time').value || null;
    const remindVal = body.querySelector('#todo-remind').value;
    const remindMinutes = remindVal === '' ? null : Number(remindVal);
    const dailyRepeat = body.querySelector('#todo-daily-repeat').checked;
    const note = body.querySelector('#todo-note').value.trim() || null;
    const courseId = body.querySelector('#todo-course').value || null;

    const todoData = {
      title: titleVal,
      due_date: dueDate,
      due_time: dueTime,
      priority: selectedPriority,
      remind_minutes: remindMinutes,
      daily_repeat: dailyRepeat,
      note,
      course_id: courseId,
    };

    if (isEdit) {
      onSave(todoData);
    } else {
      const newTodo = { id: genId(), completed: false, created_at: new Date().toISOString(), ...todoData };
      onSave(newTodo);
    }
    modal.close();
  });

  body.querySelector('#todo-cancel-btn').addEventListener('click', () => modal.close());
}

export function getTodosForReminder() {
  const today = getTodayStr();
  return loadTodos().filter(t => !isTodoCompleted(t, today) && t.due_date && t.due_time && t.remind_minutes != null);
}
