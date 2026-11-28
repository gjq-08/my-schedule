// pages/activities.js - 日程活动页面
import { state, loadData } from '../app.js';
import { getTodayStr, formatDate, parseDate, getWeekday } from '../date.js';
import { WEEKDAY_NAMES, REMIND_OPTIONS, TAG_COLORS } from '../config.js';
import { escapeHtml, showConfirm, showToast, Modal } from '../ui.js';
import { createActivity, updateActivity, deleteActivity, createTag } from '../api.js';
import { ICON_BELL, ICON_PLUS, ICON_CHEVRON_DOWN, ICON_CHEVRON } from '../icons.js';
import { MASCOT_PEEK } from '../mascot.js';

let activeTagFilter = null;
let historyExpanded = false;

export function renderActivitiesPage(container, data) {
  const today = getTodayStr();
  const upcomingCount = data.activities.filter(a => a.date >= today).length;

  container.innerHTML = `
    <div class="page-header">
      <div class="page-heading">
        <h2 class="page-title">日程</h2>
        <span class="page-meta">${upcomingCount} 项待发生</span>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-primary btn-sm" id="add-activity-btn">${ICON_PLUS}<span>新建</span></button>
      </div>
    </div>
    <div class="filter-tabs" id="tag-filter"></div>
    <div id="activities-list"></div>
  `;

  renderTagFilter(data);
  renderActivitiesList(data, today);

  document.getElementById('add-activity-btn').addEventListener('click', () => openActivityForm(null, data));
}

function rerenderActivities(data) {
  const container = document.getElementById('page-content');
  const top = container ? container.scrollTop : 0;
  renderActivitiesPage(container, data);
  if (container) container.scrollTop = top;
}

function renderTagFilter(data) {
  const filterEl = document.getElementById('tag-filter');
  if (!filterEl) return;

  let html = `<button class="filter-tab ${activeTagFilter === null ? 'active' : ''}" data-tag-id="">全部</button>`;
  for (const tag of data.tags) {
    html += `<button class="filter-tab ${activeTagFilter === tag.id ? 'active' : ''}" data-tag-id="${tag.id}">
      <span class="tag-dot" style="background:${tag.color}"></span>${escapeHtml(tag.name)}
    </button>`;
  }
  filterEl.innerHTML = html;

  filterEl.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tagId = tab.dataset.tagId || null;
      activeTagFilter = tagId;
      rerenderActivities(data);
    });
  });
}

function renderActivitiesList(data, today) {
  const listEl = document.getElementById('activities-list');
  if (!listEl) return;

  let activities = data.activities;
  if (activeTagFilter) {
    activities = activities.filter(a => a.tag_id === activeTagFilter);
  }

  const upcoming = activities.filter(a => a.date >= today);
  const past = activities.filter(a => a.date < today);
  const groups = groupByDate(upcoming, today);

  let html = '';
  if (groups.length === 0 && past.length === 0) {
    html = `<div class="todo-empty">${MASCOT_PEEK}<div class="empty-text">还没有日程</div><div class="empty-subtext">点右上角新建一个吧</div></div>`;
  }

  for (const group of groups) {
    html += renderActivityGroup(group.label, group.items, data, false);
  }

  if (past.length > 0) {
    const pastGroups = groupByDate(past, today);
    html += `
      <button type="button" class="history-toggle" id="history-toggle">
        ${historyExpanded ? ICON_CHEVRON_DOWN : ICON_CHEVRON}
        <span>历史 ${past.length} 项</span>
      </button>
      <div class="history-section" id="history-section" style="display:${historyExpanded ? 'block' : 'none'}">
        ${pastGroups.map(g => renderActivityGroup(g.label, g.items, data, true)).join('')}
      </div>
    `;
  }

  listEl.innerHTML = html;

  const toggle = document.getElementById('history-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      historyExpanded = !historyExpanded;
      renderActivitiesList(data, today);
    });
  }

  listEl.querySelectorAll('.act-row').forEach(row => {
    row.addEventListener('click', () => {
      const act = data.activities.find(a => a.id === row.dataset.activityId);
      if (act) openActivityForm(act, data);
    });
  });
}

function groupByDate(activities, today) {
  const sorted = [...activities].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return (a.start_time || '').localeCompare(b.start_time || '');
  });

  const groups = [];
  let currentLabel = null;
  let currentItems = [];

  for (const act of sorted) {
    const label = getDateLabel(act.date, today);
    if (label !== currentLabel) {
      if (currentItems.length > 0) {
        groups.push({ label: currentLabel, items: currentItems });
      }
      currentLabel = label;
      currentItems = [act];
    } else {
      currentItems.push(act);
    }
  }
  if (currentItems.length > 0) {
    groups.push({ label: currentLabel, items: currentItems });
  }
  return groups;
}

function getDateLabel(dateStr, today) {
  if (dateStr === today) return '今天';
  const tomorrow = formatDate(new Date(new Date().getTime() + 86400000));
  if (dateStr === tomorrow) return '明天';
  const d = parseDate(dateStr);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function renderActivityGroup(label, items, data, isHistory) {
  const dateStr = items[0]?.date || '';
  const dt = dateStr ? parseDate(dateStr) : null;
  const weekday = dt ? WEEKDAY_NAMES[getWeekday(dt) - 1] : '';

  let html = `
    <div class="activity-group ${isHistory ? 'history-section' : ''}">
      <div class="day-head ${label === '今天' ? 'is-today' : ''}">
        <span class="day-head-main">${escapeHtml(label)}</span>
        <span class="date-badge">${dt ? `${dt.getMonth() + 1}月${dt.getDate()}日 ${weekday}` : ''}</span>
      </div>
      <div class="day-items">
  `;

  for (const act of items) {
    const tag = act.tag_id ? data.tags.find(t => t.id === act.tag_id) : null;
    const remindOpt = act.remind_minutes != null ? REMIND_OPTIONS.find(r => r.value === act.remind_minutes) : null;

    html += `
      <div class="act-row" data-activity-id="${act.id}">
        <div class="act-time">
          ${act.all_day ? '<span class="all-day-badge">全天</span>' : `${act.start_time || ''}`}
        </div>
        <div class="act-body">
          <div class="act-title">${escapeHtml(act.title)}</div>
          <div class="act-meta">
            ${tag ? `<span class="tag-inline"><span class="tag-dot" style="background:${tag.color}"></span>${escapeHtml(tag.name)}</span>` : ''}
            ${act.location ? `<span>${escapeHtml(act.location)}</span>` : ''}
            ${!act.all_day && act.end_time ? `<span>至 ${act.end_time}</span>` : ''}
            ${remindOpt ? `<span class="remind-icon">${ICON_BELL}${remindOpt.label}</span>` : ''}
          </div>
          ${act.note ? `<div class="act-note">${escapeHtml(act.note.slice(0, 50))}</div>` : ''}
        </div>
      </div>
    `;
  }

  html += '</div></div>';
  return html;
}

export { openActivityForm as openActivityFormModal };
export function openActivityForm(activity, data) {
  const isEdit = !!activity;
  const today = getTodayStr();

  const modal = new Modal(isEdit ? '编辑日程' : '新建日程', `
    <form id="activity-form">
      <div class="form-group">
        <label class="form-label">标题 *</label>
        <input class="form-input" name="title" required value="${escapeHtml(activity?.title || '')}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">日期 *</label>
          <input class="form-input" type="date" name="date" required value="${activity?.date || today}">
        </div>
        <div class="form-group">
          <label class="form-check">
            <input type="checkbox" name="all_day" ${activity?.all_day ? 'checked' : ''}>
            <span>全天</span>
          </label>
        </div>
      </div>
      <div class="form-row" id="time-row" style="${activity?.all_day ? 'display:none' : ''}">
        <div class="form-group">
          <label class="form-label">开始时间 *</label>
          <input class="form-input" type="time" name="start_time" required value="${activity?.start_time || ''}">
        </div>
        <div class="form-group">
          <label class="form-label">结束时间 *</label>
          <input class="form-input" type="time" name="end_time" required value="${activity?.end_time || ''}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">地点</label>
        <input class="form-input" name="location" value="${escapeHtml(activity?.location || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">标签</label>
        <select class="form-select" name="tag_id">
          <option value="">无标签</option>
          ${data.tags.map(t => `<option value="${t.id}" ${activity?.tag_id === t.id ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}
        </select>
        <div style="margin-top:8px">
          <button type="button" class="btn btn-secondary btn-sm" id="new-tag-btn">+ 新建标签</button>
        </div>
        <div id="new-tag-area" style="display:none;margin-top:8px">
          <div class="form-row">
            <div class="form-group">
              <input class="form-input" name="new_tag_name" placeholder="标签名称">
            </div>
            <div class="form-group" style="display:flex;align-items:center">
              <div class="color-picker" id="tag-color-picker">
                ${TAG_COLORS.map((c, i) => `<div class="color-swatch ${i === 0 ? 'selected' : ''}" data-color="${c}" style="background:${c}"></div>`).join('')}
              </div>
              <input type="hidden" name="new_tag_color" value="${TAG_COLORS[0]}">
            </div>
          </div>
          <button type="button" class="btn btn-primary btn-sm" id="create-tag-btn">创建</button>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">提醒</label>
        <select class="form-select" name="remind_minutes">
          ${REMIND_OPTIONS.map(r => `<option value="${r.value ?? ''}" ${activity?.remind_minutes == r.value ? 'selected' : ''}>${r.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">备注</label>
        <textarea class="form-textarea" name="note">${escapeHtml(activity?.note || '')}</textarea>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">保存</button>
      </div>
      ${isEdit ? '<button type="button" class="btn btn-danger settings-full-btn" id="delete-activity-btn">删除日程</button>' : ''}
    </form>
  `);
  modal.show();

  const body = modal.getContent();
  const allDayCheck = body.querySelector('input[name="all_day"]');
  const timeRow = body.querySelector('#time-row');

  allDayCheck.addEventListener('change', () => {
    timeRow.style.display = allDayCheck.checked ? 'none' : '';
  });

  const newTagBtn = body.querySelector('#new-tag-btn');
  const newTagArea = body.querySelector('#new-tag-area');
  newTagBtn.addEventListener('click', () => {
    newTagArea.style.display = newTagArea.style.display === 'none' ? '' : 'none';
  });

  body.querySelectorAll('#tag-color-picker .color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      body.querySelectorAll('#tag-color-picker .color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      body.querySelector('input[name="new_tag_color"]').value = sw.dataset.color;
    });
  });

  body.querySelector('#create-tag-btn').addEventListener('click', async () => {
    const name = body.querySelector('input[name="new_tag_name"]').value.trim();
    const color = body.querySelector('input[name="new_tag_color"]').value;
    if (!name) return;
    try {
      const newTag = await createTag({ name, color });
      data.tags.push(newTag);
      const select = body.querySelector('select[name="tag_id"]');
      const opt = document.createElement('option');
      opt.value = newTag.id;
      opt.textContent = name;
      opt.selected = true;
      select.appendChild(opt);
      newTagArea.style.display = 'none';
      showToast('标签已创建', 'success');
    } catch (err) {
      showToast('创建标签失败', 'error');
    }
  });

  body.querySelector('#activity-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    const allDay = fd.get('all_day') === 'on';
    const remindVal = fd.get('remind_minutes');
    const startTime = allDay ? null : fd.get('start_time');
    let endTime = allDay ? null : fd.get('end_time');

    if (!allDay) {
      if (!startTime || !endTime) {
        showToast('请填写开始和结束时间', 'error');
        return;
      }
      if (endTime <= startTime) {
        showToast('结束时间必须晚于开始时间', 'error');
        return;
      }
    }

    const payload = {
      title: fd.get('title'),
      date: fd.get('date'),
      all_day: allDay,
      start_time: startTime,
      end_time: endTime,
      location: fd.get('location'),
      tag_id: fd.get('tag_id') || null,
      note: fd.get('note'),
      remind_minutes: remindVal === '' ? null : parseInt(remindVal),
    };

    try {
      if (isEdit) {
        await updateActivity(activity.id, payload);
      } else {
        await createActivity(payload);
      }
      modal.close();
      showToast('已保存', 'success');
      await loadData();
    } catch (err) {
      showToast('保存失败: ' + (err.code || '未知错误'), 'error');
    }
  });

  if (isEdit) {
    body.querySelector('#delete-activity-btn').addEventListener('click', () => {
      showConfirm(`确认删除日程"${activity.title}"？`, async () => {
        try {
          await deleteActivity(activity.id);
          modal.close();
          showToast('已删除', 'success');
          await loadData();
        } catch (err) {
          showToast('删除失败', 'error');
        }
      });
    });
  }
}
