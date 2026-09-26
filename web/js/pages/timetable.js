// pages/timetable.js - 课表页面
import { state, loadData } from '../app.js';
import { getSemesterWeek, getTodayStr, getWeekday, getMondayOfWeek, formatDate, getWeekDates, getHolidayName, getDayCourses, periodToTimeRange } from '../date.js';
import { WEEKDAY_NAMES, WEEKDAY_NAMES_SHORT, PERIOD_TIMES, MAX_PERIOD } from '../config.js';

const PERIODS = Array.from({ length: MAX_PERIOD }, (_, i) => i + 1);
import { escapeHtml, showConfirm, showToast, Modal } from '../ui.js';
import { createCourse, updateCourse, deleteCourse, createException, deleteException } from '../api.js';

let currentWeekOffset = 0;

export function renderTimetablePage(container, data) {
  const today = getTodayStr();
  const { semester, weekNum: currentWeekNum } = getSemesterWeek(today);

  // Calculate target week
  const todayDate = new Date();
  const currentMonday = getMondayOfWeek(todayDate);
  const targetMonday = new Date(currentMonday);
  targetMonday.setDate(targetMonday.getDate() + currentWeekOffset * 7);
  const targetMondayStr = formatDate(targetMonday);
  const weekDates = getWeekDates(targetMondayStr);

  // Calculate target week number
  let targetWeekNum = currentWeekNum;
  let targetSemester = semester;
  if (currentWeekOffset !== 0) {
    const { semester: s, weekNum: w } = getSemesterWeek(targetMondayStr);
    targetSemester = s;
    targetWeekNum = w;
  }

  container.innerHTML = `
    <div class="page-header">
      <h2 class="page-title">课表</h2>
      <button class="btn btn-primary btn-sm" id="add-course-btn">+ 添加课程</button>
    </div>
    <div class="timetable-toolbar">
      <button class="btn btn-secondary btn-sm" id="prev-week-btn">‹ 上周</button>
      <span class="week-label" id="week-label"></span>
      <button class="btn btn-secondary btn-sm" id="next-week-btn">下周 ›</button>
      <button class="btn btn-secondary btn-sm" id="back-today-btn" ${currentWeekOffset === 0 ? 'disabled' : ''}>回本周</button>
    </div>
    <div class="timetable-grid" id="timetable-grid"></div>
    <div class="timetable-table-wrap" id="timetable-table-wrap"></div>
  `;

  // Update week label
  const weekLabel = document.getElementById('week-label');
  if (targetSemester && targetWeekNum) {
    weekLabel.textContent = `第 ${targetWeekNum} 周`;
  } else {
    weekLabel.textContent = '假期中';
  }

  // Check week bounds
  const prevBtn = document.getElementById('prev-week-btn');
  const nextBtn = document.getElementById('next-week-btn');
  if (targetSemester) {
    if (targetWeekNum <= 1) prevBtn.disabled = true;
    if (targetWeekNum >= targetSemester.total_weeks) nextBtn.disabled = true;
  }

  // Event handlers
  prevBtn.addEventListener('click', () => { currentWeekOffset--; renderTimetablePage(container, data); });
  nextBtn.addEventListener('click', () => { currentWeekOffset++; renderTimetablePage(container, data); });
  document.getElementById('back-today-btn').addEventListener('click', () => { currentWeekOffset = 0; renderTimetablePage(container, data); });
  document.getElementById('add-course-btn').addEventListener('click', () => openCourseForm(null, data));

  // Render grid (desktop)
  renderGrid(data, weekDates, targetWeekNum, today);

  // Render table (mobile)
  renderTimetableTable(data, weekDates, targetWeekNum, today);
}

function renderGrid(data, weekDates, weekNum, today) {
  const grid = document.getElementById('timetable-grid');
  if (!grid) return;

  const todayWeekday = getWeekday(new Date(today));
  let html = '<div class="grid-header"></div>'; // empty top-left corner

  // Header row
  for (let d = 0; d < 7; d++) {
    const dateStr = weekDates[d];
    const holiday = getHolidayName(dateStr);
    const isToday = dateStr === today;
    html += `<div class="grid-header ${isToday ? 'today' : ''}">
      ${WEEKDAY_NAMES_SHORT[d]}
      ${holiday ? `<span class="holiday-badge">休</span>` : ''}
    </div>`;
  }

  // Period rows (1-MAX_PERIOD)
  for (let p = 1; p <= MAX_PERIOD; p++) {
    // Period label
    html += `<div class="grid-period-label">
      <span>${p}</span>
      <span style="font-size:0.55rem;font-weight:600">${PERIOD_TIMES[p].start}</span>
    </div>`;

    // Day cells
    for (let d = 0; d < 7; d++) {
      const dateStr = weekDates[d];
      const isToday = dateStr === today;
      const weekday = d + 1;
      const isCurrentPeriod = isToday && isInPeriod(p, new Date());
      html += `<div class="grid-cell ${isToday ? 'today-col' : ''}" data-day="${d}" data-period="${p}"></div>`;
    }
  }

  grid.innerHTML = html;
  grid.style.gridTemplateRows = `auto repeat(${MAX_PERIOD}, minmax(40px, auto))`;

  // Place course blocks
  const holiday = getHolidayName;
  for (let d = 0; d < 7; d++) {
    const dateStr = weekDates[d];
    const dayCourses = getDayCourses(data.courses, data.exceptions, dateStr, null, weekNum);
    for (const course of dayCourses) {
      const cell = grid.querySelector(`.grid-cell[data-day="${d}"][data-period="${course.startPeriod}"]`);
      if (!cell) continue;

      const span = course.endPeriod - course.startPeriod + 1;
      const block = document.createElement('div');
      block.className = 'course-block';
      block.style.backgroundColor = course.color || '#4A9FE8';
      block.style.height = `calc(${span * 100}% + ${(span - 1) * 1}px - 4px)`;
      block.innerHTML = `
        <span class="block-name">${escapeHtml(course.name)}</span>
        ${course.location ? `<span class="block-location">${escapeHtml(course.location)}</span>` : ''}
        ${course.parity !== 'all' ? `<span class="block-parity">${course.parity === 'odd' ? '单' : '双'}</span>` : ''}
      `;
      block.addEventListener('click', () => openCourseDetail(course.courseId, data, dateStr));
      cell.style.position = 'relative';
      cell.appendChild(block);
    }
  }

  // Now indicator line (only for today's column)
  const now = new Date();
  const todayIdx = weekDates.indexOf(today);
  if (todayIdx >= 0) {
    const currentPeriod = getCurrentPeriod(now);
    if (currentPeriod) {
      const cell = grid.querySelector(`.grid-cell[data-day="${todayIdx}"][data-period="${currentPeriod}"]`);
      if (cell) {
        const progress = getPeriodProgress(now, currentPeriod);
        const line = document.createElement('div');
        line.className = 'now-line';
        line.style.top = `${progress * 100}%`;
        cell.style.position = 'relative';
        cell.appendChild(line);
      }
    }
  }
}

function renderTimetableTable(data, weekDates, weekNum, today) {
  const wrap = document.getElementById('timetable-table-wrap');
  if (!wrap) return;

  let html = '<table class="tt-table"><thead><tr><th class="tt-th-time">节次</th>';
  for (let d = 0; d < 7; d++) {
    const dateStr = weekDates[d];
    const holiday = getHolidayName(dateStr);
    const isToday = dateStr === today;
    const dateLabel = dateStr.slice(5);
    html += `<th class="tt-th-day ${isToday ? 'today' : ''}">
      <span class="tt-day-name">${WEEKDAY_NAMES_SHORT[d]}</span>
      <span class="tt-day-date">${dateLabel}</span>
      ${holiday ? '<span class="tt-holiday">休</span>' : ''}
    </th>`;
  }
  html += '</tr></thead><tbody>';

  for (let p = 1; p <= MAX_PERIOD; p++) {
    html += `<tr class="tt-period-row">`;
    html += `<td class="tt-td-time"><span class="tt-period-num">${p}</span><span class="tt-period-time">${PERIOD_TIMES[p].start}</span></td>`;
    for (let d = 0; d < 7; d++) {
      const dateStr = weekDates[d];
      const isToday = dateStr === today;
      html += `<td class="tt-cell ${isToday ? 'today-col' : ''}" data-day="${d}" data-period="${p}"></td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;

  const table = wrap.querySelector('.tt-table');

  for (let d = 0; d < 7; d++) {
    const dateStr = weekDates[d];
    const dayCourses = getDayCourses(data.courses, data.exceptions, dateStr, null, weekNum);
    for (const course of dayCourses) {
      const cell = table.querySelector(`.tt-cell[data-day="${d}"][data-period="${course.startPeriod}"]`);
      if (!cell) continue;
      const span = course.endPeriod - course.startPeriod + 1;
      if (span > 1) cell.rowSpan = span;

      const block = document.createElement('div');
      block.className = 'tt-course';
      block.style.backgroundColor = course.color || '#4A9FE8';
      block.innerHTML = `
        <span class="tt-course-name">${escapeHtml(course.name)}</span>
        ${course.location ? `<span class="tt-course-loc">${escapeHtml(course.location)}</span>` : ''}
        ${course.parity !== 'all' ? `<span class="tt-course-parity">${course.parity === 'odd' ? '单' : '双'}</span>` : ''}
      `;
      block.addEventListener('click', () => openCourseDetail(course.courseId, data, dateStr));
      cell.appendChild(block);
    }
  }

  for (let d = 0; d < 7; d++) {
    const dateStr = weekDates[d];
    const dayCourses = getDayCourses(data.courses, data.exceptions, dateStr, null, weekNum);
    for (const course of dayCourses) {
      for (let p = course.startPeriod + 1; p <= course.endPeriod; p++) {
        const skipped = table.querySelector(`.tt-cell[data-day="${d}"][data-period="${p}"]`);
        if (skipped) skipped.remove();
      }
    }
  }
}

function getCurrentPeriod(now) {
  const h = now.getHours();
  const m = now.getMinutes();
  const t = h * 60 + m;
  for (let p = 1; p <= MAX_PERIOD; p++) {
    const [sh, sm] = PERIOD_TIMES[p].start.split(':').map(Number);
    const [eh, em] = PERIOD_TIMES[p].end.split(':').map(Number);
    if (t >= sh * 60 + sm && t <= eh * 60 + em) return p;
  }
  return null;
}

function isInPeriod(period, now) {
  const p = getCurrentPeriod(now);
  return p === period;
}

function getPeriodProgress(now, period) {
  const [sh, sm] = PERIOD_TIMES[period].start.split(':').map(Number);
  const [eh, em] = PERIOD_TIMES[period].end.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return Math.max(0, Math.min(1, (nowMin - startMin) / (endMin - startMin)));
}

export { openCourseDetail as openCourseDetailModal };
function openCourseDetail(courseId, data, dateStr) {
  const course = data.courses.find(c => c.id === courseId);
  if (!course) return;

  const modal = new Modal(course.name, `
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
      <div style="font-size:0.8rem;color:#555;font-weight:500">第${course.week_start}-${course.week_end}周 ${course.parity === 'odd' ? '(仅单周)' : course.parity === 'even' ? '(仅双周)' : ''}</div>
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
    openCourseForm(course, data);
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

function openCourseForm(course, data) {
  const isEdit = !!course;
  const modal = new Modal(isEdit ? '编辑课程' : '添加课程', `
    <form id="course-form">
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
          <input type="checkbox" id="one-time-toggle" ${course?.week_start === course?.week_end ? 'checked' : ''}>
          <span>仅单次（只上一节）</span>
        </label>
      </div>
      <div class="form-row" id="week-range-row">
        <div class="form-group">
          <label class="form-label">起始周 *</label>
          <input class="form-input" type="number" name="week_start" min="1" max="30" required value="${course?.week_start || 4}">
        </div>
        <div class="form-group">
          <label class="form-label">结束周 *</label>
          <input class="form-input" type="number" name="week_end" min="1" max="30" required value="${course?.week_end || 19}">
        </div>
      </div>
      <div class="form-group" id="specific-date-row" style="display:${course?.week_start === course?.week_end ? 'block' : 'none'}">
        <label class="form-label">上课日期 *</label>
        <input class="form-input" type="date" id="specific-date-input">
      </div>
      <div class="form-group">
        <label class="form-label">颜色</label>
        <div class="color-picker" id="color-picker">
          ${['#4A9FE8','#FF8C6B','#6DD5B3','#FFD166','#A5B4FC','#2B7CD8','#14b8a6','#84cc16','#f97316','#6366f1'].map(c =>
            `<div class="color-swatch ${course?.color === c ? 'selected' : ''}" data-color="${c}" style="background:${c}"></div>`
          ).join('')}
        </div>
        <input type="hidden" name="color" value="${course?.color || '#4A9FE8'}">
      </div>
      <div class="form-group">
        <label class="form-label">备注</label>
        <textarea class="form-textarea" name="note">${escapeHtml(course?.note || '')}</textarea>
      </div>
      <button type="submit" class="btn btn-primary" style="width:100%">保存</button>
    </form>
  `);
  modal.show();

  // One-time toggle
  const oneTimeToggle = modal.getContent().querySelector('#one-time-toggle');
  const weekRangeRow = modal.getContent().querySelector('#week-range-row');
  const specificDateRow = modal.getContent().querySelector('#specific-date-row');
  const specificDateInput = modal.getContent().querySelector('#specific-date-input');
  const weekStartInput = modal.getContent().querySelector('input[name="week_start"]');
  const weekEndInput = modal.getContent().querySelector('input[name="week_end"]');
  const weekdaySelect = modal.getContent().querySelector('select[name="weekday"]');
  const paritySelect = modal.getContent().querySelector('select[name="parity"]');
  const parityGroup = paritySelect.closest('.form-group');

  // Initialize specific date if editing a one-time course
  if (course?.week_start === course?.week_end && course?.weekday) {
    const today = new Date();
    const currentWeek = getSemesterWeek(formatDate(today)).weekNum || 1;
    const weekDiff = course.week_start - currentWeek;
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + weekDiff * 7 + (course.weekday - getWeekday(today)));
    specificDateInput.value = formatDate(targetDate);
  }

  function updateParityVisibility() {
    if (oneTimeToggle.checked) {
      parityGroup.style.display = 'none';
      paritySelect.value = 'all';
    } else {
      parityGroup.style.display = '';
    }
  }
  updateParityVisibility();

  oneTimeToggle.addEventListener('change', () => {
    if (oneTimeToggle.checked) {
      weekRangeRow.style.display = 'none';
      specificDateRow.style.display = 'block';
      weekStartInput.required = false;
      weekEndInput.required = false;
    } else {
      weekRangeRow.style.display = 'flex';
      specificDateRow.style.display = 'none';
      weekStartInput.required = true;
      weekEndInput.required = true;
    }
    updateParityVisibility();
  });

  specificDateInput.addEventListener('change', () => {
    if (specificDateInput.value) {
      const date = new Date(specificDateInput.value);
      const { weekNum } = getSemesterWeek(specificDateInput.value);
      const weekday = getWeekday(date);
      if (weekNum) {
        weekStartInput.value = weekNum;
        weekEndInput.value = weekNum;
      }
      weekdaySelect.value = weekday;
    }
  });

  // Color picker
  const colorInput = modal.getContent().querySelector('input[name="color"]');
  modal.getContent().querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      modal.getContent().querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      colorInput.value = sw.dataset.color;
    });
  });

  // Form submit
  modal.getContent().querySelector('#course-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
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
    const form = e.target;
    const formData = new FormData(form);
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
