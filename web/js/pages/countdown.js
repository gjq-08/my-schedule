// pages/countdown.js - 倒计日功能（localStorage 存储）
import { getTodayStr, formatDate, parseDate } from '../date.js';
import { escapeHtml, showToast, showConfirm, Modal } from '../ui.js';

const STORAGE_KEY = 'countdowns';

const CATEGORIES = [
  { value: 'exam', label: '考试', color: '#FF6B6B' },
  { value: 'birthday', label: '生日', color: '#FFD166' },
  { value: 'holiday', label: '假期', color: '#6DD5B3' },
  { value: 'anniversary', label: '纪念日', color: '#A5B4FC' },
  { value: 'custom', label: '自定义', color: '#4A9FE8' },
];

function loadCountdowns() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCountdowns(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function genId() {
  return 'cd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function calcDays(targetDate) {
  const today = parseDate(getTodayStr());
  const target = parseDate(targetDate);
  const diff = target.getTime() - today.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function getWeekdayName(dateStr) {
  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return days[parseDate(dateStr).getDay()];
}

export function renderCountdownPage(container) {
  const items = loadCountdowns();
  const today = getTodayStr();

  const upcoming = items
    .filter(i => i.target_date >= today)
    .sort((a, b) => a.target_date.localeCompare(b.target_date));

  const past = items
    .filter(i => i.target_date < today)
    .sort((a, b) => b.target_date.localeCompare(a.target_date));

  container.innerHTML = `
    <div class="page-header">
      <h2 class="page-title">倒计日</h2>
      <button class="btn btn-primary btn-sm" id="add-countdown-btn">+ 新建</button>
    </div>
    <div id="countdown-upcoming"></div>
    ${past.length > 0 ? `
      <div class="countdown-past-section">
        <div class="sub-section-title">已过去</div>
        <div id="countdown-past"></div>
      </div>
    ` : ''}
  `;

  const upcomingEl = container.querySelector('#countdown-upcoming');
  if (upcoming.length === 0) {
    upcomingEl.innerHTML = `
      <div class="empty-state-card">
        <div class="empty-text">还没有倒计时</div>
        <div class="empty-subtext">点击右上角添加一个吧</div>
      </div>
    `;
  } else {
    upcomingEl.innerHTML = upcoming.map(item => renderCountdownCard(item, today)).join('');
  }

  const pastEl = container.querySelector('#countdown-past');
  if (pastEl) {
    pastEl.innerHTML = past.map(item => renderCountdownCard(item, today, true)).join('');
  }

  bindCountdownEvents(container);
}

function renderCountdownCard(item, today, isPast = false) {
  const days = calcDays(item.target_date);
  const cat = CATEGORIES.find(c => c.value === item.category) || CATEGORIES[4];
  const weekday = getWeekdayName(item.target_date);

  let daysText, daysClass;
  if (days === 0) {
    daysText = '今天';
    daysClass = 'countdown-today';
  } else if (isPast) {
    daysText = Math.abs(days);
    daysClass = 'countdown-past';
  } else {
    daysText = days;
    daysClass = '';
  }

  return `
    <div class="countdown-card ${isPast ? 'past' : ''}" data-id="${item.id}" style="--cat-color:${cat.color}">
      <div class="countdown-days ${daysClass}">
        <span class="countdown-num">${daysText}</span>
        <span class="countdown-unit">天</span>
      </div>
      <div class="countdown-info">
        <div class="countdown-title-row">
          <span class="countdown-title">${escapeHtml(item.title)}</span>
          <span class="countdown-cat" style="background:${cat.color}">${cat.label}</span>
        </div>
        <div class="countdown-meta">
          ${item.target_date} ${weekday}
          ${!isPast && days > 0 ? ` · 还剩 ${days} 天` : ''}
          ${isPast ? ` · 已过去 ${Math.abs(days)} 天` : ''}
        </div>
      </div>
      <div class="countdown-actions">
        <button class="btn-icon countdown-edit" data-id="${item.id}" title="编辑">✏</button>
        <button class="btn-icon countdown-delete" data-id="${item.id}" title="删除">🗑</button>
      </div>
    </div>
  `;
}

function bindCountdownEvents(container) {
  container.querySelector('#add-countdown-btn')?.addEventListener('click', () => {
    openCountdownForm(null, (newItem) => {
      const all = loadCountdowns();
      all.push(newItem);
      saveCountdowns(all);
      renderCountdownPage(container);
      showToast('倒计时已创建', 'success');
    });
  });

  container.querySelectorAll('.countdown-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const all = loadCountdowns();
      const item = all.find(i => i.id === id);
      if (!item) return;
      openCountdownForm(item, (updated) => {
        const latest = loadCountdowns();
        const idx = latest.findIndex(i => i.id === id);
        if (idx >= 0) {
          latest[idx] = { ...latest[idx], ...updated };
          saveCountdowns(latest);
          renderCountdownPage(container);
          showToast('倒计时已更新', 'success');
        }
      });
    });
  });

  container.querySelectorAll('.countdown-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      showConfirm('确定删除这个倒计时？', () => {
        const all = loadCountdowns();
        saveCountdowns(all.filter(i => i.id !== id));
        renderCountdownPage(container);
        showToast('已删除', 'success');
      });
    });
  });
}

export function openCountdownForm(item, onSave) {
  const isEdit = !!item;
  const title = isEdit ? '编辑倒计时' : '新建倒计时';

  const modal = new Modal(title, `
    <div class="form-group">
      <label class="form-label">标题 *</label>
      <input class="form-input" type="text" id="cd-title" maxlength="50" required value="${isEdit ? escapeHtml(item.title) : ''}">
    </div>
    <div class="form-group">
      <label class="form-label">目标日期 *</label>
      <input class="form-input" type="date" id="cd-date" required value="${isEdit ? item.target_date : ''}">
    </div>
    <div class="form-group">
      <label class="form-label">分类</label>
      <div class="cd-category-picker" id="cd-category-picker">
        ${CATEGORIES.map(c => `
          <button type="button" class="cd-cat-option ${(!isEdit && c.value === 'custom') || (isEdit && item.category === c.value) ? 'selected' : ''}" data-value="${c.value}" style="--cat-color:${c.color}">
            ${c.label}
          </button>
        `).join('')}
      </div>
    </div>
    <div style="display:flex;gap:12px;margin-top:16px">
      <button class="btn btn-primary" id="cd-save-btn">${isEdit ? '保存' : '创建'}</button>
      <button class="btn btn-secondary" id="cd-cancel-btn">取消</button>
    </div>
  `);
  modal.show();

  const body = modal.getContent();
  let selectedCategory = (isEdit && item.category) ? item.category : 'custom';

  body.querySelectorAll('.cd-cat-option').forEach(btn => {
    btn.addEventListener('click', () => {
      body.querySelectorAll('.cd-cat-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedCategory = btn.dataset.value;
    });
  });

  body.querySelector('#cd-save-btn').addEventListener('click', () => {
    const titleVal = body.querySelector('#cd-title').value.trim();
    const dateVal = body.querySelector('#cd-date').value;

    if (!titleVal) {
      showToast('请输入标题', 'error');
      return;
    }
    if (!dateVal) {
      showToast('请选择日期', 'error');
      return;
    }

    const data = {
      title: titleVal,
      target_date: dateVal,
      category: selectedCategory,
    };

    if (isEdit) {
      onSave(data);
    } else {
      const newItem = { id: genId(), created_at: new Date().toISOString(), ...data };
      onSave(newItem);
    }
    modal.close();
  });

  body.querySelector('#cd-cancel-btn').addEventListener('click', () => modal.close());
}

// 供首页使用的倒计时数据
export function loadUpcomingCountdowns(limit = 2) {
  const items = loadCountdowns();
  const today = getTodayStr();
  return items
    .filter(i => i.target_date >= today)
    .sort((a, b) => a.target_date.localeCompare(b.target_date))
    .slice(0, limit);
}
