// pages/countdown.js - 倒计日功能（localStorage 存储）
import { getTodayStr, formatDate, parseDate } from '../date.js';
import { escapeHtml, showToast, showConfirm, Modal } from '../ui.js';
import { ICON_EDIT, ICON_TRASH, ICON_PLUS } from '../icons.js';
import { MASCOT_PEEK } from '../mascot.js';

const STORAGE_KEY = 'countdowns';

// 分类色会直接当作大号数字的文字颜色，因此取深一档以保证对比度
const CATEGORIES = [
  { value: 'exam', label: '考试', color: '#C0463A' },
  { value: 'birthday', label: '生日', color: '#A5660A' },
  { value: 'holiday', label: '假期', color: '#17795C' },
  { value: 'anniversary', label: '纪念日', color: '#6553B8' },
  { value: 'custom', label: '自定义', color: '#1F5FAE' },
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
  window.dispatchEvent(new CustomEvent('schedule:data-changed', { detail: { source: 'countdowns' } }));
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

export function getUpcomingCountdownsForWidget() {
  const today = getTodayStr();
  return loadCountdowns()
    .filter(i => i.target_date >= today)
    .sort((a, b) => a.target_date.localeCompare(b.target_date))
    .map(item => {
      const cat = CATEGORIES.find(c => c.value === item.category) || CATEGORIES[4];
      const dateLabel = `${Number(item.target_date.slice(5, 7))}月${Number(item.target_date.slice(8, 10))}日`;
      return {
        id: item.id,
        title: item.title,
        targetDate: item.target_date,
        meta: `${dateLabel} · ${cat.label}`,
        color: cat.color,
      };
    });
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
      <div class="page-heading">
        <h2 class="page-title">倒计日</h2>
        <span class="page-meta">${upcoming.length} 个未到来的日子</span>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-primary btn-sm" id="add-countdown-btn">${ICON_PLUS}<span>新建</span></button>
      </div>
    </div>
    <div id="countdown-upcoming"></div>
    ${past.length > 0 ? `
      <div class="countdown-past-section">
        <div class="sub-section-title">已过去 ${past.length} 个</div>
        <div id="countdown-past"></div>
      </div>
    ` : ''}
  `;

  const upcomingEl = container.querySelector('#countdown-upcoming');
  if (upcoming.length === 0) {
    upcomingEl.innerHTML = `<div class="todo-empty">${MASCOT_PEEK}<div class="empty-text">还没有倒计时</div><div class="empty-subtext">记下考试、生日或假期的日子</div></div>`;
  } else {
    const [first, ...rest] = upcoming;
    upcomingEl.innerHTML = renderFeature(first, today) + (rest.length
      ? `<div class="cd-list">${rest.map(item => renderCountdownRow(item, today)).join('')}</div>`
      : '');
  }

  const pastEl = container.querySelector('#countdown-past');
  if (pastEl) {
    pastEl.innerHTML = `<div class="cd-list">${past.map(item => renderCountdownRow(item, today, true)).join('')}</div>`;
  }

  bindCountdownEvents(container);
}

function renderFeature(item, today) {
  const days = calcDays(item.target_date);
  const cat = CATEGORIES.find(c => c.value === item.category) || CATEGORIES[4];
  const weekday = getWeekdayName(item.target_date);

  return `
    <div class="cd-feature" style="--cat-color:${cat.color}">
      <div class="cd-feature-num">
        <span class="cd-big num ${days === 0 ? 'is-today' : ''}">${days === 0 ? '今天' : days}</span>
        ${days !== 0 ? '<span class="cd-unit">天</span>' : ''}
      </div>
      <div>
        <div class="cd-feature-eyebrow">最近</div>
        <div class="cd-feature-title">${escapeHtml(item.title)}</div>
        <div class="cd-feature-meta">${item.target_date} ${weekday} · ${cat.label}${days > 0 ? ` · 还剩 ${days} 天` : ''}</div>
        <div class="cd-feature-actions">
          <button class="btn-icon countdown-edit" data-id="${item.id}" title="编辑" aria-label="编辑">${ICON_EDIT}</button>
          <button class="btn-icon countdown-delete" data-id="${item.id}" title="删除" aria-label="删除">${ICON_TRASH}</button>
        </div>
      </div>
    </div>
  `;
}

function renderCountdownRow(item, today, isPast = false) {
  const days = calcDays(item.target_date);
  const cat = CATEGORIES.find(c => c.value === item.category) || CATEGORIES[4];
  const weekday = getWeekdayName(item.target_date);
  const daysText = days === 0 ? '今天' : Math.abs(days);

  return `
    <div class="cd-row ${isPast ? 'is-past' : ''}" data-id="${item.id}" style="--cat-color:${cat.color}">
      <div class="countdown-days">
        <span class="countdown-num ${days === 0 ? 'countdown-today' : ''}">${daysText}</span>
        <span class="countdown-unit">${days === 0 ? '就是今天' : '天'}</span>
      </div>
      <div class="countdown-info">
        <div class="countdown-title-row">
          <span class="countdown-title">${escapeHtml(item.title)}</span>
          <span class="countdown-cat" style="--cat-color:${cat.color}">${cat.label}</span>
        </div>
        <div class="countdown-meta">
          ${item.target_date} ${weekday}
          ${isPast ? ` · 已过去 ${Math.abs(days)} 天` : days > 0 ? ` · 还剩 ${days} 天` : ''}
        </div>
      </div>
      <div class="countdown-actions">
        <button class="btn-icon countdown-edit" data-id="${item.id}" title="编辑" aria-label="编辑">${ICON_EDIT}</button>
        <button class="btn-icon countdown-delete" data-id="${item.id}" title="删除" aria-label="删除">${ICON_TRASH}</button>
      </div>
    </div>
  `;
}

function rerenderCountdown(container) {
  const top = container.scrollTop;
  renderCountdownPage(container);
  container.scrollTop = top;
}

function bindCountdownEvents(container) {
  container.querySelector('#add-countdown-btn')?.addEventListener('click', () => {
    openCountdownForm(null, (newItem) => {
      const all = loadCountdowns();
      all.push(newItem);
      saveCountdowns(all);
      rerenderCountdown(container);
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
          rerenderCountdown(container);
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
        rerenderCountdown(container);
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
