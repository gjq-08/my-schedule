// pages/todos.js - 待办功能（localStorage 存储）
import { getTodayStr } from '../date.js';
import { REMIND_OPTIONS } from '../config.js';
import { escapeHtml, showToast, showConfirm, Modal } from '../ui.js';

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
}

function genId() {
  return 'todo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

const PRIORITY_OPTIONS = [
  { value: 'low', label: '低', color: '#666666' },
  { value: 'medium', label: '中', color: '#FFD700' },
  { value: 'high', label: '高', color: '#FF3333' },
];

let filterMode = 'active'; // 'all' | 'active' | 'completed'

// 每天重复的待办按"今天是否完成"判断（last_done_date === today），普通待办看 completed
export function isTodoCompleted(todo, today) {
  if (todo.daily_repeat) return todo.last_done_date === today;
  return !!todo.completed;
}

export function renderTodosPage(container) {
  const todos = loadTodos();

  container.innerHTML = `
    <div class="page-header">
      <h2 class="page-title">待办</h2>
      <button class="btn btn-primary btn-sm" id="add-todo-btn">+ 新建</button>
    </div>
    <div class="todo-filter">
      <button class="todo-filter-chip ${filterMode === 'all' ? 'active' : ''}" data-mode="all">全部</button>
      <button class="todo-filter-chip ${filterMode === 'active' ? 'active' : ''}" data-mode="active">未完成</button>
      <button class="todo-filter-chip ${filterMode === 'completed' ? 'active' : ''}" data-mode="completed">已完成</button>
    </div>
    <div id="todos-list"></div>
  `;

  renderTodosList(todos);

  document.getElementById('add-todo-btn').addEventListener('click', () => {
    openTodoForm(null, (newTodo) => {
      const all = loadTodos();
      all.unshift(newTodo);
      saveTodos(all);
      renderTodosPage(container);
      showToast('待办已创建', 'success');
    });
  });

  container.querySelectorAll('.todo-filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      filterMode = chip.dataset.mode;
      renderTodosPage(container);
    });
  });
}

function renderTodosList(todos) {
  const listEl = document.getElementById('todos-list');
  if (!listEl) return;

  const today = getTodayStr();

  let filtered = todos;
  if (filterMode === 'active') filtered = todos.filter(t => !isTodoCompleted(t, today));
  else if (filterMode === 'completed') filtered = todos.filter(t => isTodoCompleted(t, today));

  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="empty-state">${filterMode === 'completed' ? '暂无已完成的待办' : filterMode === 'active' ? '所有待办已完成！' : '暂无待办，点击右上角新建'}</div>`;
    return;
  }

  listEl.innerHTML = filtered.map(todo => {
    const completed = isTodoCompleted(todo, today);
    const isOverdue = !completed && !todo.daily_repeat && todo.due_date && todo.due_date < today;
    const priorityInfo = PRIORITY_OPTIONS.find(p => p.value === todo.priority) || PRIORITY_OPTIONS[1];

    return `
      <div class="todo-card ${completed ? 'completed' : ''} ${isOverdue ? 'overdue' : ''}" data-id="${todo.id}">
        <div class="todo-check" data-id="${todo.id}">
          <input type="checkbox" ${completed ? 'checked' : ''}>
        </div>
        <div class="todo-body">
          <div class="todo-title-row">
            <span class="todo-title">${escapeHtml(todo.title)}</span>
            <span class="todo-priority" style="background:${priorityInfo.color}">${priorityInfo.label}</span>
          </div>
          <div class="todo-meta">
            ${todo.due_date ? `<span class="todo-due ${isOverdue ? 'due-overdue' : ''}">${todo.due_date}${todo.due_time ? ' ' + todo.due_time : ''}${isOverdue ? ' (已过期)' : ''}</span>` : ''}
            ${todo.daily_repeat ? '<span class="todo-repeat">每天</span>' : ''}
            ${todo.remind_minutes != null ? '<span class="todo-remind">🔔</span>' : ''}
          </div>
          ${todo.note ? `<div class="todo-note">${escapeHtml(todo.note)}</div>` : ''}
        </div>
        <div class="todo-actions">
          <button class="btn-icon todo-edit" data-id="${todo.id}" title="编辑">✏</button>
          <button class="btn-icon todo-delete" data-id="${todo.id}" title="删除">🗑</button>
        </div>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.todo-check input').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = e.target.closest('.todo-check').dataset.id;
      toggleTodo(id, listEl);
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
            renderTodosPage(document.getElementById('page-content'));
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
        renderTodosPage(document.getElementById('page-content'));
        showToast('已删除', 'success');
      });
    });
  });
}

function toggleTodo(id, listEl) {
  const all = loadTodos();
  const todo = all.find(t => t.id === id);
  if (!todo) return;

  const today = getTodayStr();

  if (todo.daily_repeat) {
    // 单条每日重置：只记录今天是否完成，不生成副本
    todo.last_done_date = (todo.last_done_date === today) ? null : today;
  } else {
    todo.completed = !todo.completed;
  }

  saveTodos(all);
  renderTodosPage(document.getElementById('page-content'));
}

export function openTodoForm(todo, onSave) {
  const isEdit = !!todo;
  const title = isEdit ? '编辑待办' : '新建待办';

  const modal = new Modal(title, `
    <div class="form-group">
      <label class="form-label">标题 *</label>
      <input class="form-input" type="text" id="todo-title" maxlength="100" required value="${isEdit ? escapeHtml(todo.title) : ''}">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">截止日期</label>
        <input class="form-input" type="date" id="todo-due-date" value="${isEdit && todo.due_date ? todo.due_date : ''}">
      </div>
      <div class="form-group">
        <label class="form-label">截止时间</label>
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
      <label class="form-label">提醒</label>
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
      <label class="form-label">备注</label>
      <textarea class="form-textarea" id="todo-note" maxlength="500">${isEdit && todo.note ? escapeHtml(todo.note) : ''}</textarea>
    </div>
    <div style="display:flex;gap:12px;margin-top:16px">
      <button class="btn btn-primary" id="todo-save-btn">${isEdit ? '保存' : '创建'}</button>
      <button class="btn btn-secondary" id="todo-cancel-btn">取消</button>
    </div>
  `);
  modal.show();

  const body = modal.getContent();
  let selectedPriority = (isEdit && todo.priority) ? todo.priority : 'medium';

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

    const todoData = {
      title: titleVal,
      due_date: dueDate,
      due_time: dueTime,
      priority: selectedPriority,
      remind_minutes: remindMinutes,
      daily_repeat: dailyRepeat,
      note,
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
