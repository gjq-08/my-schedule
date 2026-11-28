// pages/timetable.js - 课表页面（学期切换 + 课程绑定学期 + 作息读存储）
import { state, loadData } from '../app.js';
import { getSemesterWeek, getTodayStr, getWeekday, getMondayOfWeek, formatDate, getWeekDates, getHolidayName, getDayCourses } from '../date.js';
import { WEEKDAY_NAMES, WEEKDAY_NAMES_SHORT, MAX_PERIOD, COURSE_COLORS } from '../config.js';
import { getPeriodTimes, bulkImportCourses } from '../store.js';
import { escapeHtml, showConfirm, showToast, Modal } from '../ui.js';
import { createCourse, updateCourse, deleteCourse, createException, deleteException, createSemester } from '../api.js';
import { parseTimetableFile } from '../import.js';
import { isPortalAvailable, startPortalImport, prepareImport } from '../portal.js';
import { ICON_UPLOAD, ICON_PLUS, ICON_BACK, ICON_CHEVRON } from '../icons.js';

const PERIODS = Array.from({ length: MAX_PERIOD }, (_, i) => i + 1);

let selectedSemesterId = null;
let selectedWeek = null;
let selectedDayDate = null;
let ttView = 'week';

function mondayOfSemesterWeek(sem, week) {
  const [y, m, d] = sem.start_monday.split('-').map(Number);
  const mon = new Date(y, m - 1, d);
  mon.setDate(mon.getDate() + (week - 1) * 7);
  return formatDate(mon);
}

// 学期名已在下方下拉框里，页眉只补充它没有的信息：本周日期范围
function weekRangeLabel(dates) {
  if (!dates || dates.length < 7) return '';
  const a = dates[0].slice(5).split('-');
  const b = dates[6].slice(5).split('-');
  return `${+a[0]}月${+a[1]}日 – ${+b[0]}月${+b[1]}日`;
}

export function renderTimetablePage(container, data) {
  const today = getTodayStr();
  const semesters = data.semesters || [];
  const todayInfo = getSemesterWeek(today);

  // 解析所选学期：手动选择 > 含今天的学期 > 首个学期
  let sem = semesters.find(s => s.id === selectedSemesterId) || todayInfo.semester || semesters[0] || null;
  if (sem) selectedSemesterId = sem.id;

  // 解析所选周次：手动选择（夹取边界）> 今天所在周 > 第 1 周
  let week = null;
  if (sem) {
    if (selectedWeek == null) {
      week = (todayInfo.semester && todayInfo.semester.id === sem.id) ? todayInfo.weekNum : 1;
    } else {
      week = Math.min(Math.max(selectedWeek, 1), sem.total_weeks);
    }
    selectedWeek = week;
  }

  const weekDates = sem && week
    ? getWeekDates(mondayOfSemesterWeek(sem, week))
    : getWeekDates(formatDate(getMondayOfWeek(new Date())));

  const atCurrent = sem && week && todayInfo.semester && todayInfo.semester.id === sem.id && todayInfo.weekNum === week;

  container.innerHTML = `
    <div class="page-header">
      <div class="page-heading">
        <h2 class="page-title">课表</h2>
        <span class="page-meta">${sem ? weekRangeLabel(weekDates) : '还没有学期'}</span>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-secondary btn-sm" id="import-course-btn">${ICON_UPLOAD}<span>导入</span></button>
        <button class="btn btn-primary btn-sm" id="add-course-btn">${ICON_PLUS}<span>添加课程</span></button>
      </div>
      <input type="file" id="import-file-input" accept=".xlsx,.xls,.csv,.json" style="display:none">
    </div>
    <div class="timetable-toolbar">
      <div class="tt-topline">
        <select class="form-select semester-select" id="semester-select" aria-label="选择学期">
          ${semesters.length
            ? semesters.map(s => `<option value="${s.id}" ${sem && s.id === sem.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')
            : '<option value="">暂无学期</option>'}
        </select>
        <button class="back-today" id="back-today-btn" ${atCurrent ? 'disabled' : ''}>回本周</button>
      </div>
      <div class="week-nav">
        <button class="week-btn" id="prev-week-btn" aria-label="上一周" ${!sem || week <= 1 ? 'disabled' : ''}>${ICON_BACK}</button>
        <span class="week-label" id="week-label">${sem && week ? `第 ${week} 周 <span>/ ${sem.total_weeks}</span>` : '假期中'}</span>
        <button class="week-btn" id="next-week-btn" aria-label="下一周" ${!sem || week >= sem.total_weeks ? 'disabled' : ''}>${ICON_CHEVRON}</button>
      </div>
    </div>
    ${sem ? '' : '<div class="empty-state">还没有学期，请到 设置 → 学期管理 新建一个学期，再添加课程。</div>'}
    ${sem && !todayInfo.semester ? '<div class="semester-hint">今天不在任何学期的起止范围内，请到 设置 → 学期管理 检查学期日期。</div>' : ''}
    <div class="tt-body ${ttView === 'week' ? 'week-mode' : ''}" id="tt-body">
      <div class="view-switch" id="view-switch" role="tablist" aria-label="课表视图">
        <button type="button" data-view="day" class="${ttView === 'day' ? 'active' : ''}">日视图</button>
        <button type="button" data-view="week" class="${ttView === 'week' ? 'active' : ''}">周视图</button>
      </div>
      <div class="day-strip" id="day-strip"></div>
      <div class="day-view-meta" id="day-view-meta"></div>
      <div class="day-timeline" id="day-timeline"></div>
      <div class="timetable-grid" id="timetable-grid"></div>
      <div class="timetable-table-wrap" id="timetable-table-wrap"></div>
    </div>
  `;

  document.getElementById('semester-select').addEventListener('change', (e) => {
    selectedSemesterId = e.target.value || null;
    selectedWeek = null;
    selectedDayDate = null;
    renderTimetablePage(container, data);
  });
  document.getElementById('prev-week-btn').addEventListener('click', () => { selectedWeek = week - 1; selectedDayDate = null; renderTimetablePage(container, data); });
  document.getElementById('next-week-btn').addEventListener('click', () => { selectedWeek = week + 1; selectedDayDate = null; renderTimetablePage(container, data); });
  document.getElementById('back-today-btn').addEventListener('click', () => {
    if (!todayInfo.semester) {
      showToast('今天不在任何学期起止范围内，请到 设置 → 学期管理 检查学期日期', 'error');
      return;
    }
    selectedSemesterId = todayInfo.semester.id;
    selectedWeek = null;
    selectedDayDate = null;
    renderTimetablePage(container, data);
  });
  document.getElementById('add-course-btn').addEventListener('click', () => {
    if (!sem) { showToast('请先在设置里创建学期', 'error'); return; }
    openCourseForm(null, data, sem);
  });
  document.querySelectorAll('#view-switch button').forEach(btn => {
    btn.addEventListener('click', () => {
      ttView = btn.dataset.view;
      renderTimetablePage(container, data);
    });
  });
  const importInput = document.getElementById('import-file-input');
  document.getElementById('import-course-btn').addEventListener('click', () => {
    if (isPortalAvailable()) {
      openImportEntry(sem, data);
      return;
    }
    if (!sem) { showToast('请先在设置里创建学期', 'error'); return; }
    importInput.value = '';
    importInput.click();
  });
  importInput.addEventListener('change', () => {
    const file = importInput.files && importInput.files[0];
    if (file) handleImportFile(file, sem, data);
  });

  if (sem) {
    renderDayView(data, weekDates, week, today, sem);
    renderGrid(data, weekDates, week, today, sem);
    renderTimetableTable(data, weekDates, week, today, sem);
  }
}

function renderDayView(data, weekDates, weekNum, today, sem) {
  const strip = document.getElementById('day-strip');
  const metaEl = document.getElementById('day-view-meta');
  const listEl = document.getElementById('day-timeline');
  if (!strip || !metaEl || !listEl) return;

  const dateStr = selectedDayDate && weekDates.includes(selectedDayDate)
    ? selectedDayDate
    : (weekDates.includes(today) ? today : weekDates[0]);
  selectedDayDate = dateStr;

  strip.innerHTML = weekDates.map((d, i) => {
    const hasCourse = getDayCourses(data.courses, data.exceptions, d, sem, weekNum).length > 0;
    const holiday = getHolidayName(d);
    return `
      <button type="button"
        class="day-chip ${hasCourse ? 'has-course' : ''} ${d === today ? 'is-today' : ''} ${d === dateStr ? 'is-selected' : ''} ${holiday ? 'is-holiday' : ''}"
        data-date="${d}" aria-label="${d} ${WEEKDAY_NAMES[i]}">
        <span class="day-chip-w">${WEEKDAY_NAMES_SHORT[i]}</span>
        <span class="day-chip-d">${Number(d.slice(8, 10))}</span>
        <span class="day-chip-dot" aria-hidden="true"></span>
      </button>
    `;
  }).join('');

  strip.querySelectorAll('.day-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedDayDate = btn.dataset.date;
      renderTimetablePage(document.getElementById('page-content'), data);
    });
  });

  const dt = new Date(dateStr + 'T00:00:00');
  const weekdayName = WEEKDAY_NAMES[getWeekday(dt) - 1];
  const courses = getDayCourses(data.courses, data.exceptions, dateStr, sem, weekNum);
  const PT = getPeriodTimes();

  metaEl.innerHTML = `
    <span class="day-view-date">${dt.getMonth() + 1} 月 ${dt.getDate()} 日 · ${weekdayName}</span>
    <span class="day-view-count">${courses.length ? `${courses.length} 节` : '没课'}</span>
  `;

  if (!courses.length) {
    listEl.innerHTML = `
      <div class="day-empty">
        <div class="empty-text">这天没有课</div>
        <div class="empty-subtext">${dateStr === today ? '出去走走，或者安排点自己的事' : '可以在周视图里看看整周安排'}</div>
      </div>
    `;
    return;
  }

  listEl.innerHTML = courses.map(c => {
    const start = PT[c.startPeriod]?.start || '';
    const end = PT[c.endPeriod]?.end || '';
    const meta = [];
    if (c.location) meta.push(escapeHtml(c.location));
    meta.push(`${c.startPeriod}–${c.endPeriod}节`);
    if (c.teacher) meta.push(escapeHtml(c.teacher));
    return `
      <div class="dc-row" data-course-id="${c.courseId}" style="--course-color:${c.color || '#2878D0'}">
        <div class="dc-time">${start}<span>${end}</span></div>
        <div class="dc-main">
          <div class="dc-title">${escapeHtml(c.name)}</div>
          <div class="dc-meta">
            ${meta.map((m, i) => `${i ? '<span class="dot-sep"></span>' : ''}<span>${m}</span>`).join('')}
            ${c.parity && c.parity !== 'all' ? `<span class="dc-parity">${c.parity === 'odd' ? '单周' : '双周'}</span>` : ''}
          </div>
        </div>
        <span class="dc-chevron">${ICON_CHEVRON}</span>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.dc-row').forEach(row => {
    row.addEventListener('click', () => openCourseDetail(row.dataset.courseId, data, dateStr, sem));
  });
}

function renderGrid(data, weekDates, weekNum, today, sem) {
  const grid = document.getElementById('timetable-grid');
  if (!grid) return;
  const PT = getPeriodTimes();

  let html = '<div class="grid-header"></div>';
  for (let d = 0; d < 7; d++) {
    const dateStr = weekDates[d];
    const holiday = getHolidayName(dateStr);
    const isToday = dateStr === today;
    html += `<div class="grid-header ${isToday ? 'today' : ''}">
      ${WEEKDAY_NAMES_SHORT[d]}
      ${holiday ? `<span class="holiday-badge">休</span>` : ''}
    </div>`;
  }

  for (let p = 1; p <= MAX_PERIOD; p++) {
    html += `<div class="grid-period-label">
      <span>${p}</span>
      <span>${PT[p] ? PT[p].start : ''}</span>
    </div>`;
    for (let d = 0; d < 7; d++) {
      const isToday = weekDates[d] === today;
      html += `<div class="grid-cell ${isToday ? 'today-col' : ''}" data-day="${d}" data-period="${p}"></div>`;
    }
  }

  grid.innerHTML = html;
  grid.style.gridTemplateRows = `auto repeat(${MAX_PERIOD}, minmax(40px, auto))`;

  for (let d = 0; d < 7; d++) {
    const dateStr = weekDates[d];
    const dayCourses = getDayCourses(data.courses, data.exceptions, dateStr, sem, weekNum);
    for (const course of dayCourses) {
      const cell = grid.querySelector(`.grid-cell[data-day="${d}"][data-period="${course.startPeriod}"]`);
      if (!cell) continue;
      const span = course.endPeriod - course.startPeriod + 1;
      const block = document.createElement('div');
      block.className = 'course-block';
      block.style.setProperty('--course-color', course.color || '#2878D0');
      block.style.height = `calc(${span * 100}% + ${(span - 1) * 1}px - 4px)`;
      block.innerHTML = `
        <span class="block-name">${escapeHtml(course.name)}</span>
        ${course.location ? `<span class="block-location">${escapeHtml(course.location)}</span>` : ''}
        ${course.parity !== 'all' ? `<span class="block-parity">${course.parity === 'odd' ? '单' : '双'}</span>` : ''}
      `;
      block.addEventListener('click', () => openCourseDetail(course.courseId, data, dateStr, sem));
      cell.style.position = 'relative';
      cell.appendChild(block);
    }
  }

  const now = new Date();
  const todayIdx = weekDates.indexOf(today);
  if (todayIdx >= 0) {
    const currentPeriod = getCurrentPeriod(now, PT);
    if (currentPeriod) {
      const cell = grid.querySelector(`.grid-cell[data-day="${todayIdx}"][data-period="${currentPeriod}"]`);
      if (cell) {
        const progress = getPeriodProgress(now, currentPeriod, PT);
        const line = document.createElement('div');
        line.className = 'now-line';
        line.style.top = `${progress * 100}%`;
        cell.style.position = 'relative';
        cell.appendChild(line);
      }
    }
  }
}

function renderTimetableTable(data, weekDates, weekNum, today, sem) {
  const wrap = document.getElementById('timetable-table-wrap');
  if (!wrap) return;
  const PT = getPeriodTimes();

  let html = '<table class="tt-table"><thead><tr><th class="tt-th-time">节次</th>';
  for (let d = 0; d < 7; d++) {
    const dateStr = weekDates[d];
    const holiday = getHolidayName(dateStr);
    const isToday = dateStr === today;
    html += `<th class="tt-th-day ${isToday ? 'today' : ''}">
      <span class="tt-day-name">${WEEKDAY_NAMES_SHORT[d]}</span>
      <span class="tt-day-date">${dateStr.slice(5)}</span>
      ${holiday ? '<span class="tt-holiday">休</span>' : ''}
    </th>`;
  }
  html += '</tr></thead><tbody>';

  for (let p = 1; p <= MAX_PERIOD; p++) {
    html += `<tr class="tt-period-row">`;
    html += `<td class="tt-td-time"><span class="tt-period-num">${p}</span><span class="tt-period-time">${PT[p] ? PT[p].start : ''}</span></td>`;
    for (let d = 0; d < 7; d++) {
      const isToday = weekDates[d] === today;
      html += `<td class="tt-cell ${isToday ? 'today-col' : ''}" data-day="${d}" data-period="${p}"></td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;

  const table = wrap.querySelector('.tt-table');
  for (let d = 0; d < 7; d++) {
    const dateStr = weekDates[d];
    const dayCourses = getDayCourses(data.courses, data.exceptions, dateStr, sem, weekNum);
    for (const course of dayCourses) {
      const cell = table.querySelector(`.tt-cell[data-day="${d}"][data-period="${course.startPeriod}"]`);
      if (!cell) continue;
      const span = course.endPeriod - course.startPeriod + 1;
      if (span > 1) cell.rowSpan = span;
      const block = document.createElement('div');
      block.className = 'tt-course';
      block.style.setProperty('--course-color', course.color || '#2878D0');
      block.innerHTML = `
        <span class="tt-course-name">${escapeHtml(course.name)}</span>
        ${course.location ? `<span class="tt-course-loc">${escapeHtml(course.location)}</span>` : ''}
        ${course.parity !== 'all' ? `<span class="tt-course-parity">${course.parity === 'odd' ? '单' : '双'}</span>` : ''}
      `;
      block.addEventListener('click', () => openCourseDetail(course.courseId, data, dateStr, sem));
      cell.appendChild(block);
    }
  }

  for (let d = 0; d < 7; d++) {
    const dateStr = weekDates[d];
    const dayCourses = getDayCourses(data.courses, data.exceptions, dateStr, sem, weekNum);
    for (const course of dayCourses) {
      for (let p = course.startPeriod + 1; p <= course.endPeriod; p++) {
        const skipped = table.querySelector(`.tt-cell[data-day="${d}"][data-period="${p}"]`);
        if (skipped) skipped.remove();
      }
    }
  }
}

function getCurrentPeriod(now, PT) {
  const t = now.getHours() * 60 + now.getMinutes();
  for (let p = 1; p <= MAX_PERIOD; p++) {
    const slot = PT[p];
    if (!slot) continue;
    const [sh, sm] = slot.start.split(':').map(Number);
    const [eh, em] = slot.end.split(':').map(Number);
    if (t >= sh * 60 + sm && t <= eh * 60 + em) return p;
  }
  return null;
}

function getPeriodProgress(now, period, PT) {
  const slot = PT[period];
  if (!slot) return 0;
  const [sh, sm] = slot.start.split(':').map(Number);
  const [eh, em] = slot.end.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return Math.max(0, Math.min(1, (nowMin - startMin) / (endMin - startMin)));
}

export { openCourseDetail as openCourseDetailModal };
function openCourseDetail(courseId, data, dateStr, sem) {
  const course = data.courses.find(c => c.id === courseId);
  if (!course) return;
  const boundSem = (data.semesters || []).find(s => s.id === course.semester_id) || sem;

  const modal = new Modal(course.name, `
    <div style="margin-bottom:16px">
      <div class="form-label">所属学期</div>
      <div>${escapeHtml(boundSem ? boundSem.name : '未绑定')}</div>
    </div>
    <div style="margin-bottom:16px">
      <div class="form-label">教师</div>
      <div>${escapeHtml(course.teacher || '未设置')}</div>
    </div>
    <div style="margin-bottom:16px">
      <div class="form-label">地点</div>
      <div>${escapeHtml(course.location || '未设置')}</div>
    </div>
    <div style="margin-bottom:16px">
      <div class="form-label">时间</div>
      <div>${WEEKDAY_NAMES[course.weekday - 1]} 第${course.start_period}-${course.end_period}节</div>
      <div style="font-size:0.8rem;color:var(--ink-500);font-weight:500">第${course.week_start}-${course.week_end}周 ${course.parity === 'odd' ? '(仅单周)' : course.parity === 'even' ? '(仅双周)' : ''}</div>
    </div>
    ${course.note ? `<div style="margin-bottom:16px"><div class="form-label">备注</div><div>${escapeHtml(course.note)}</div></div>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:20px">
      <button class="btn btn-primary btn-sm" id="edit-course-btn">编辑</button>
      <button class="btn btn-secondary btn-sm" id="exception-btn">单日调整</button>
      <button class="btn btn-danger btn-sm" id="delete-course-btn">删除课程</button>
    </div>
  `);
  modal.show();

  modal.getContent().querySelector('#edit-course-btn').addEventListener('click', () => {
    modal.close();
    openCourseForm(course, data, boundSem);
  });
  modal.getContent().querySelector('#exception-btn').addEventListener('click', () => {
    modal.close();
    openExceptionForm(course, data);
  });
  modal.getContent().querySelector('#delete-course-btn').addEventListener('click', () => {
    showConfirm(`确认删除课程"${course.name}"？`, async () => {
      try {
        await deleteCourse(course.id);
        modal.close();
        showToast('已删除', 'success');
        await loadData();
      } catch (err) {
        showToast('删除失败', 'error');
      }
    });
  });
}

function openCourseForm(course, data, sem) {
  const isEdit = !!course;
  const boundSem = isEdit
    ? ((data.semesters || []).find(s => s.id === course.semester_id) || sem)
    : sem;
  if (!boundSem) { showToast('请先在设置里创建学期', 'error'); return; }
  const isOneTime = !!(course && course.week_start === course.week_end);

  const modal = new Modal(isEdit ? '编辑课程' : '添加课程', `
    <form id="course-form">
      <div class="form-group">
        <label class="form-label">所属学期</label>
        <div class="semester-bound">${escapeHtml(boundSem.name)}</div>
      </div>
      <div class="form-group">
        <label class="form-label">课程名称 *</label>
        <input class="form-input" name="name" required value="${escapeHtml(course?.name || '')}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">教师</label>
          <input class="form-input" name="teacher" value="${escapeHtml(course?.teacher || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">地点 *</label>
          <input class="form-input" name="location" required value="${escapeHtml(course?.location || '')}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">星期 *</label>
          <select class="form-select" name="weekday" required>
            ${[1,2,3,4,5,6,7].map(d => `<option value="${d}" ${course?.weekday === d ? 'selected' : ''}>${WEEKDAY_NAMES[d-1]}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">单双周</label>
          <select class="form-select" name="parity">
            <option value="all" ${course?.parity === 'all' ? 'selected' : ''}>每周</option>
            <option value="odd" ${course?.parity === 'odd' ? 'selected' : ''}>仅单周</option>
            <option value="even" ${course?.parity === 'even' ? 'selected' : ''}>仅双周</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">起始节次 *</label>
          <select class="form-select" name="start_period" required>
            ${PERIODS.map(p => `<option value="${p}" ${course?.start_period === p ? 'selected' : ''}>第${p}节</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">结束节次 *</label>
          <select class="form-select" name="end_period" required>
            ${PERIODS.map(p => `<option value="${p}" ${course?.end_period === p ? 'selected' : ''}>第${p}节</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-check">
          <input type="checkbox" id="one-time-toggle" ${isOneTime ? 'checked' : ''}>
          <span>仅单次（只上一节）</span>
        </label>
      </div>
      <div class="form-row" id="week-range-row">
        <div class="form-group">
          <label class="form-label">起始周 *</label>
          <input class="form-input" type="number" name="week_start" min="1" max="30" required value="${course?.week_start || 1}">
        </div>
        <div class="form-group">
          <label class="form-label">结束周 *</label>
          <input class="form-input" type="number" name="week_end" min="1" max="30" required value="${course?.week_end || boundSem.total_weeks}">
        </div>
      </div>
      <div class="form-group" id="specific-date-row" style="display:${isOneTime ? 'block' : 'none'}">
        <label class="form-label">上课日期 *</label>
        <input class="form-input" type="date" id="specific-date-input">
      </div>
      <div class="form-group">
        <label class="form-label">颜色</label>
        <div class="color-picker" id="color-picker">
          ${COURSE_COLORS.map(c =>
            `<div class="color-swatch ${course?.color === c ? 'selected' : ''}" data-color="${c}" style="background:${c}"></div>`
          ).join('')}
        </div>
        <input type="hidden" name="color" value="${course?.color || COURSE_COLORS[0]}">
      </div>
      <div class="form-group">
        <label class="form-label">备注</label>
        <textarea class="form-textarea" name="note">${escapeHtml(course?.note || '')}</textarea>
      </div>
      <button type="submit" class="btn btn-primary" style="width:100%">保存</button>
    </form>
  `);
  modal.show();

  const oneTimeToggle = modal.getContent().querySelector('#one-time-toggle');
  const weekRangeRow = modal.getContent().querySelector('#week-range-row');
  const specificDateRow = modal.getContent().querySelector('#specific-date-row');
  const specificDateInput = modal.getContent().querySelector('#specific-date-input');
  const weekStartInput = modal.getContent().querySelector('input[name="week_start"]');
  const weekEndInput = modal.getContent().querySelector('input[name="week_end"]');
  const weekdaySelect = modal.getContent().querySelector('select[name="weekday"]');
  const paritySelect = modal.getContent().querySelector('select[name="parity"]');
  const parityGroup = paritySelect.closest('.form-group');

  // 编辑单次课程时回填日期（按所属学期推算）
  if (isOneTime && course?.weekday) {
    const [y, m, d] = boundSem.start_monday.split('-').map(Number);
    const mon = new Date(y, m - 1, d);
    mon.setDate(mon.getDate() + (course.week_start - 1) * 7 + (course.weekday - 1));
    specificDateInput.value = formatDate(mon);
  }

  function applyOneTimeState() {
    const oneTime = oneTimeToggle.checked;
    weekRangeRow.style.display = oneTime ? 'none' : 'flex';
    specificDateRow.style.display = oneTime ? 'block' : 'none';
    weekStartInput.required = !oneTime;
    weekEndInput.required = !oneTime;
    parityGroup.style.display = oneTime ? 'none' : '';
    if (oneTime) paritySelect.value = 'all';
  }
  applyOneTimeState();
  oneTimeToggle.addEventListener('change', applyOneTimeState);

  specificDateInput.addEventListener('change', () => {
    if (specificDateInput.value) {
      const date = new Date(specificDateInput.value);
      const [y, m, d] = boundSem.start_monday.split('-').map(Number);
      const start = new Date(y, m - 1, d);
      const diffDays = Math.floor((date - start) / 86400000);
      const weekNum = Math.floor(diffDays / 7) + 1;
      if (weekNum >= 1 && weekNum <= boundSem.total_weeks) {
        weekStartInput.value = weekNum;
        weekEndInput.value = weekNum;
      }
      weekdaySelect.value = getWeekday(date);
    }
  });

  const colorInput = modal.getContent().querySelector('input[name="color"]');
  modal.getContent().querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      modal.getContent().querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      colorInput.value = sw.dataset.color;
    });
  });

  modal.getContent().querySelector('#course-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const payload = {
      name: formData.get('name'),
      teacher: formData.get('teacher'),
      location: formData.get('location'),
      weekday: parseInt(formData.get('weekday')),
      start_period: parseInt(formData.get('start_period')),
      end_period: parseInt(formData.get('end_period')),
      week_start: parseInt(formData.get('week_start')),
      week_end: parseInt(formData.get('week_end')),
      parity: formData.get('parity'),
      color: formData.get('color'),
      note: formData.get('note'),
      semester_id: boundSem.id,
    };
    try {
      if (isEdit) {
        await updateCourse(course.id, payload);
      } else {
        await createCourse(payload);
      }
      modal.close();
      showToast('已保存', 'success');
      await loadData();
    } catch (err) {
      showToast('保存失败: ' + (err.code || '未知错误'), 'error');
    }
  });
}

function openExceptionForm(course, data) {
  const modal = new Modal('单日调整 - ' + course.name, `
    <form id="exception-form">
      <div class="form-group">
        <label class="form-label">调整类型 *</label>
        <select class="form-select" name="type" required>
          <option value="cancel">停课</option>
          <option value="move">调课（移到其他日期）</option>
          <option value="add">补课（额外添加）</option>
        </select>
      </div>
      <div id="orig-date-group" class="form-group">
        <label class="form-label">原上课日期 *</label>
        <input class="form-input" type="date" name="orig_date" required>
      </div>
      <div id="new-fields" style="display:none">
        <div class="form-group">
          <label class="form-label">新日期 *</label>
          <input class="form-input" type="date" name="new_date">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">新起始节次 *</label>
            <select class="form-select" name="new_start_period">
              ${PERIODS.map(p => `<option value="${p}">第${p}节</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">新结束节次 *</label>
            <select class="form-select" name="new_end_period">
              ${PERIODS.map(p => `<option value="${p}">第${p}节</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">新地点</label>
          <input class="form-input" name="new_location" value="${escapeHtml(course.location || '')}">
        </div>
      </div>
      <button type="submit" class="btn btn-primary" style="width:100%">保存</button>
    </form>
  `);
  modal.show();

  const typeSelect = modal.getContent().querySelector('select[name="type"]');
  const origGroup = modal.getContent().querySelector('#orig-date-group');
  const newFields = modal.getContent().querySelector('#new-fields');

  typeSelect.addEventListener('change', () => {
    const type = typeSelect.value;
    if (type === 'cancel') {
      origGroup.style.display = '';
      newFields.style.display = 'none';
    } else if (type === 'move') {
      origGroup.style.display = '';
      newFields.style.display = '';
    } else {
      origGroup.style.display = 'none';
      newFields.style.display = '';
    }
  });

  modal.getContent().querySelector('#exception-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const type = formData.get('type');
    const payload = { course_id: course.id, type };
    if (type === 'cancel') {
      payload.orig_date = formData.get('orig_date');
    } else if (type === 'move') {
      payload.orig_date = formData.get('orig_date');
      payload.new_date = formData.get('new_date');
      payload.new_start_period = parseInt(formData.get('new_start_period'));
      payload.new_end_period = parseInt(formData.get('new_end_period'));
      payload.new_location = formData.get('new_location');
    } else {
      payload.new_date = formData.get('new_date');
      payload.new_start_period = parseInt(formData.get('new_start_period'));
      payload.new_end_period = parseInt(formData.get('new_end_period'));
      payload.new_location = formData.get('new_location');
    }
    try {
      await createException(payload);
      modal.close();
      showToast('已保存', 'success');
      await loadData();
    } catch (err) {
      showToast('保存失败: ' + (err.code || '未知错误'), 'error');
    }
  });
}

function openImportEntry(sem, data) {
  const modal = new Modal('导入课表', `
    <div class="import-entry">
      <button class="import-entry-card" data-mode="file">
        <span class="import-entry-title">从文件导入</span>
        <span class="import-entry-meta">Excel / CSV / JSON</span>
      </button>
      <button class="import-entry-card" data-mode="portal">
        <span class="import-entry-title">从教务导入</span>
        <span class="import-entry-meta">北航 / 天大，自动读取课程安排</span>
      </button>
    </div>
    <div class="import-entry-note">教务导入需连接对应学校的校内网或 VPN，登录在教务页内手动完成，本 App 不保存账号密码。</div>
  `);
  modal.show();
  const body = modal.getContent();
  body.querySelector('[data-mode="file"]').addEventListener('click', () => {
    modal.close();
    if (!sem) { showToast('请先在设置里创建学期', 'error'); return; }
    const input = document.getElementById('import-file-input');
    input.value = '';
    input.click();
  });
  body.querySelector('[data-mode="portal"]').addEventListener('click', () => {
    modal.close();
    openSchoolChooser(data);
  });
}

function openSchoolChooser(data) {
  const modal = new Modal('选择学校', `
    <div class="import-entry">
      <button class="import-entry-card" data-school="buaa">
        <span class="import-entry-title">北航教务</span>
        <span class="import-entry-meta">BYXT，需连校内网或北航 VPN</span>
      </button>
      <button class="import-entry-card" data-school="tju">
        <span class="import-entry-title">天大教务</span>
        <span class="import-entry-meta">EAMS，需连天大校园网或 VPN</span>
      </button>
    </div>
    <div class="import-entry-note">两所学校都需要在教务页内手动登录；天大登录含验证码。</div>
  `);
  modal.show();
  const body = modal.getContent();
  body.querySelector('[data-school="buaa"]').addEventListener('click', () => {
    modal.close();
    openPortalIntro(data, 'buaa');
  });
  body.querySelector('[data-school="tju"]').addEventListener('click', () => {
    modal.close();
    openPortalIntro(data, 'tju');
  });
}

function openPortalIntro(data, school) {
  const isTju = school === 'tju';
  const modal = new Modal(isTju ? '从天大教务导入' : '从北航教务导入', `
    <div class="import-mode-hint">
      · 需要连接${isTju ? '天大校园网或 VPN' : '校内网或北航 VPN'}<br>
      · 登录在教务页内手动完成${isTju ? '（含验证码）' : ''}，本 App 不读取、不保存密码<br>
      · 只读取课表，导入结束即清除登录状态
    </div>
    <div class="import-mode-hint">该功能为实验性，接口变动时可随时改用文件导入。</div>
    <div class="import-actions">
      <button class="btn btn-secondary btn-sm" id="portal-cancel">取消</button>
      <button class="btn btn-primary btn-sm" id="portal-open">打开教务</button>
    </div>
  `);
  modal.show();
  const body = modal.getContent();
  body.querySelector('#portal-cancel').addEventListener('click', () => modal.close());
  body.querySelector('#portal-open').addEventListener('click', () => {
    modal.close();
    runPortalImport(data, school);
  });
}

async function runPortalImport(data, school) {
  showToast('正在打开教务…', 'info');
  const res = await startPortalImport(school);
  if (!res || res.ok === false) {
    if (res && res.cancelled) return;
    const msg = !res || res.error === 'TIMEOUT' ? '教务导入超时，请重试'
      : res.error === 'NOT_NATIVE' ? '当前环境不支持教务导入'
      : res.error === 'NO_RESULT' || res.error === 'BAD_RESULT' ? '未取到导入结果，请重试'
      : '教务导入失败，请重试';
    showToast(msg, 'error');
    return;
  }
  const prepared = prepareImport(res.payload, { semesters: data.semesters, periodTimes: getPeriodTimes() });
  if (prepared.error) {
    const msg = prepared.error === 'NO_START' ? '教务未返回学期起始日期，暂时无法新建学期'
      : prepared.error === 'NO_TERM_NAME' ? '教务未返回学期名称，暂时无法导入'
      : '该学期教务里没有可导入的课程';
    showToast(msg, 'error');
    return;
  }
  const target = prepared.target.sem || {
    id: null,
    name: prepared.target.spec.name,
    start_monday: prepared.target.spec.start_monday,
    total_weeks: prepared.target.spec.total_weeks,
  };
  openImportPreview(prepared.result, target, data, { newSemester: prepared.target.spec || null });
}

const FORMAT_LABEL = { xlsx: 'Excel (xlsx)', xls: 'Excel (xls)', csv: 'CSV', json: 'JSON', buaa: '北航教务', tju: '天大教务' };
const PARITY_LABEL = { all: '', odd: '（单周）', even: '（双周）' };

async function handleImportFile(file, sem, data) {
  let result;
  try {
    showToast('正在解析课表…', 'info');
    result = await parseTimetableFile(file);
  } catch (err) {
    showToast(err.message || '解析失败', 'error');
    return;
  }
  openImportPreview(result, sem, data);
}

async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* 走下面的兜底 */ }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

function openImportPreview(result, sem, data, opts = {}) {
  const { format, courses, warnings } = result;
  const newSemester = opts.newSemester || null;
  const existing = newSemester ? 0 : (data.courses || []).filter(c => c.semester_id === sem.id).length;
  const targetLine = newSemester
    ? `将新建学期：<strong>${escapeHtml(newSemester.name)}</strong>（${escapeHtml(newSemester.start_monday)} 起，共 ${newSemester.total_weeks} 周）`
    : `导入到：<strong>${escapeHtml(sem.name)}</strong>（该学期现有 ${existing} 门）`;
  const newHint = newSemester ? '<div class="import-new-hint">取消导入不会创建该学期。</div>' : '';
  const modal = new Modal('导入课表预览', `
    <div class="import-summary">
      <span class="import-format">${FORMAT_LABEL[format] || format}</span>
      <span>解析到 <strong>${courses.length}</strong> 门课程</span>
    </div>
    <div class="import-target">${targetLine}</div>
    ${newHint}
    ${warnings.length ? `<div class="import-warnings">${warnings.map(w => `<div>· ${escapeHtml(w)}</div>`).join('')}</div>` : ''}
    ${result.diagnostic ? `<div class="import-diag"><button type="button" id="import-copy-diag">复制原始课表数据</button><span>排错用，可粘贴给开发者</span></div>` : ''}
    <div class="import-preview-list">
      ${courses.map(c => `
        <div class="import-row">
          <span class="import-dot" style="background:${c.color}"></span>
          <div class="import-row-main">
            <div class="import-row-name">${escapeHtml(c.name)}</div>
            <div class="import-row-meta">${WEEKDAY_NAMES[c.weekday - 1]} 第${c.start_period}-${c.end_period}节 · 第${c.week_start}-${c.week_end}周${PARITY_LABEL[c.parity]}${c.location ? ' · ' + escapeHtml(c.location) : ''}</div>
            ${c.teacher ? `<div class="import-row-teacher">${escapeHtml(c.teacher)}</div>` : ''}
          </div>
        </div>`).join('')}
    </div>
    <div class="import-mode-hint"><strong>覆盖</strong>：清空该学期现有课程后导入。<strong>合并</strong>：保留现有课程，自动跳过重复。</div>
    <div class="import-actions">
      <button class="btn btn-secondary btn-sm" id="import-cancel">取消</button>
      <button class="btn btn-secondary btn-sm" id="import-merge">合并导入</button>
      <button class="btn btn-primary btn-sm" id="import-overwrite">覆盖导入</button>
    </div>
  `);
  modal.show();
  const body = modal.getContent();
  const doImport = async (mode) => {
    try {
      let semesterId = sem.id;
      if (newSemester) {
        const created = await createSemester(newSemester);
        semesterId = created.id;
      }
      const res = bulkImportCourses(courses, semesterId, mode);
      modal.close();
      selectedSemesterId = semesterId;
      selectedWeek = null;
      const extra = mode === 'merge' && res.skipped ? `，跳过 ${res.skipped} 门重复` : '';
      showToast(`已导入 ${res.added} 门课程${extra}`, 'success');
      loadData();
    } catch (err) {
      const raw = String(err.message || '');
      const msg = /null|undefined/.test(raw)
        ? '导入失败：本地数据暂不可用，请重新打开 App 后再试'
        : '导入失败：' + (err.code || raw || '未知错误');
      showToast(msg, 'error');
    }
  };
  body.querySelector('#import-cancel').addEventListener('click', () => modal.close());
  const copyDiagBtn = body.querySelector('#import-copy-diag');
  if (copyDiagBtn) {
    copyDiagBtn.addEventListener('click', async () => {
      const diag = typeof result.diagnostic === 'string'
        ? result.diagnostic
        : JSON.stringify(result.diagnostic, null, 2);
      const ok = await copyText(diag);
      showToast(ok ? '已复制原始课表数据' : '复制失败，请截图预览中的诊断行', ok ? 'success' : 'error');
    });
  }
  body.querySelector('#import-merge').addEventListener('click', () => doImport('merge'));
  body.querySelector('#import-overwrite').addEventListener('click', () => {
    if (existing > 0) {
      showConfirm(`覆盖将清空「${sem.name}」现有的 ${existing} 门课程，确认导入？`, () => doImport('overwrite'));
    } else {
      doImport('overwrite');
    }
  });
}