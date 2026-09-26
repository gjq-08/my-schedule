// pages/activities.js - 日程活动页面
import { state, loadData } from '../app.js';
import { getTodayStr, formatDate, parseDate, getWeekday } from '../date.js';
import { WEEKDAY_NAMES, REMIND_OPTIONS, TAG_COLORS } from '../config.js';
import { escapeHtml, showConfirm, showToast, Modal } from '../ui.js';
import { createActivity, updateActivity, deleteActivity, createTag } from '../api.js';

let activeTagFilter = null;
let historyExpanded = false;

export function renderActivitiesPage(container, data) {
  const today = getTodayStr();

  container.innerHTML = `
    <div class="page-header">
      <h2 class="page-title">日程活动</h2>
      <button class="btn btn-primary btn-sm" id="add-activity-btn">+ 新建</button>
    </div>
    <div class="tag-filter" id="tag-filter"></div>
    <div id="activities-list"></div>
  `;

  renderTagFilter(data);
  renderActivitiesList(data, today);

  document.getElementById('add-activity-btn').addEventListener('click', () => openActivityForm(null, data));
}

function renderTagFilter(data) {
  const filterEl = document.getElementById('tag-filter');
  if (!filterEl) return;

  let html = `<button class="tag-filter-chip ${activeTagFilter === null ? 'active' : ''}" data-tag-id="">全部</button>`;
  for (const tag of data.tags) {
    html += `<button class="tag-filter-chip ${activeTagFilter === tag.id ? 'active' : ''}" data-tag-id="${tag.id}" style="${activeTagFilter === tag.id ? `background:${tag.color}` : ''}">${escapeHtml(tag.name)}</button>`;
  }
  filterEl.innerHTML = html;

  filterEl.querySelectorAll('.tag-filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const tagId = chip.dataset.tagId || null;
      activeTagFilter = tagId;
      renderActivitiesPage(document.getElementById('page-content'), data);
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
    html = '<div class="empty-state">暂无日程活动，点击"+ 新建"添加</div>';
  }

  for (const group of groups) {
    html += renderActivityGroup(group.label, group.items, data, false);
  }

  if (past.length > 0) {
    const pastGroups = groupByDate(past, today);
    html += `
      <div class="history-toggle" id="history-toggle">
        <span>${historyExpanded ? '▾' : '▸'}</span>
        <span>历史 (${past.length})</span>
      </div>
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

  listEl.querySelectorAll('.activity-card').forEach(card => {
    card.addEventListener('click', () => {
      const act = data.activities.find(a => a.id === card.dataset.activityId);
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
  const weekday = WEEKDAY_NAMES[getWeekday(d) - 1];
  return `${dateStr} ${weekday}`;
}

function renderActivityGroup(label, items, data, isHistory) {
  const dateStr = items[0]?.date || '';
  let html = `
    <div class="activity-group ${isHistory ? 'history-section' : ''}">
      <div class="activity-group-header">
        <span>${escapeHtml(label)}</span>
        <span class="date-badge">${dateStr}</span>
      </div>
  `;

  for (const act of items) {
    const tag = act.tag_id ? data.tags.find(t => t.id === act.tag_id) : null;
    const remindOpt = act.remind_minutes != null ? REMIND_OPTIONS.find(r => r.value === act.remind_minutes) : null;

    html += `
      <div class="activity-card" data-activity-id="${act.id}">
        <div class="card-time">
          ${act.all_day ? '<span class="all-day-badge">全天</span>' : `<span>${act.start_time || ''}</span>`}
          ${act.end_time ? `<span style="font-size:0.7rem;color:#666;font-weight:500">~ ${act.end_time}</span>` : ''}
        </div>
        <div class="card-body">
          <div class="card-title">${escapeHtml(act.title)}</div>
          ${act.location ? `<div class="card-location">${escapeHtml(act.location)}</div>` : ''}
          ${act.note ? `<div class="card-note">${escapeHtml(act.note.slice(0, 50))}</div>` : ''}
          <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
            ${tag ? `<span class="tag-chip" style="background:${tag.color}">${escapeHtml(tag.name)}</span>` : ''}
            ${remindOpt ? `<span class="remind-icon">🔔 ${remindOpt.label}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  html += '</div>';
  return html;
}

export { openActivityForm as openActivityFormModal };
function openActivityForm(activity, data) {
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
                ${TAG_COLORS.map((c, i) => `<div class="color-swatch ${i === 0 ? 'selected' : ''}" data-color="${c}" style="background:${c};width:28px;height:28px;border-radius:2px"></div>`).join('')}
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
      <button type="submit" class="btn btn-primary" style="width:100%">保存</button>
      ${isEdit ? '<button type="button" class="btn btn-danger" style="width:100%;margin-top:8px" id="delete-activity-btn">删除</button>' : ''}
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
