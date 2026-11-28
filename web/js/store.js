// store.js - v3.0 本地存储层（PRD §23）
// 校验与级联语义逐条对齐 functions/handler.mjs，改动后端时此处需同步。
// 本机存储是唯一运行时数据源；config 里的种子仅用于首启初始化与旧数据迁移。
import { ApiError } from './errors.js';
import { PERIOD_TIMES } from './config.js';

const APP_KEY = 'appData';
const META_KEY = 'localMeta';

const uuid_re = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const date_re = /^\d{4}-\d{2}-\d{2}$/;
const time_re = /^\d{2}:\d{2}$/;

const EMPTY = () => ({
  semesters: [], holidays: [], courses: [], exceptions: [], activities: [], tags: [],
  settings: { sound: true, vibrate: true, notify: false },
  periodTimes: {},
});

// 一次性迁移：旧配色池（含演示快照用过的色）→ 活力晴空蓝配色池，按色相一一对应。
// 只认这些精确值，用户自选的其它颜色原样保留；迁移后不再命中，天然幂等。
const LEGACY_COLORS = {
  '#4E9CD6': '#2878D0', '#E08073': '#F07868', '#5FAF96': '#35B58A', '#E8B44F': '#FFC857',
  '#8FA6CC': '#8B78D6', '#6FA9A0': '#22A6C6', '#D3A0A6': '#E45C7A', '#AAB093': '#6DBE5C',
  '#7FB7DE': '#3B91EA', '#AFA6CC': '#6678DB', '#D9AC91': '#F5A04A', '#8FB3BE': '#B8845E',
  '#4A9FE8': '#3B91EA', '#2B7CD8': '#2878D0', '#FF8C6B': '#F07868', '#6DD5B3': '#35B58A',
  '#14B8A6': '#22A6C6', '#FFD166': '#FFC857', '#A5B4FC': '#8B78D6', '#6366F1': '#6678DB',
  '#84CC16': '#6DBE5C', '#F97316': '#F5A04A', '#E11D48': '#E45C7A', '#06B6D4': '#22A6C6',
  '#FF6B6B': '#F07868',
};
const remapColor = (c) => (c && LEGACY_COLORS[String(c).toUpperCase()]) || c;

const fail = (code, status = 400) => { throw new ApiError(code, status); };
const uuid = () => crypto.randomUUID();
const cut = (s, n) => (s == null ? null : String(s).slice(0, n));
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const pad2 = (n) => String(n).padStart(2, '0');
const toDateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function read() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(APP_KEY));
  } catch { /* 损坏视为未初始化 */ }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.courses)) return null;
  const data = { ...EMPTY(), ...raw };
  let dirty = false;

  // 一次性迁移：旧数据无作息时间表（或导入快照不含它而为空）→ 用内置初始值写入存储
  if (!raw.periodTimes || typeof raw.periodTimes !== 'object' || Object.keys(raw.periodTimes).length === 0) {
    data.periodTimes = { ...PERIOD_TIMES };
    dirty = true;
  }

  // 一次性迁移：旧课程无所属学期 → 绑定到包含今天的学期，否则首个学期
  if (data.semesters.length && data.courses.some(c => !c.semester_id)) {
    const now = new Date();
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let def = data.semesters[0];
    for (const s of data.semesters) {
      const [y, m, d] = s.start_monday.split('-').map(Number);
      const start = new Date(y, m - 1, d);
      const end = new Date(start);
      end.setDate(end.getDate() + s.total_weeks * 7 - 1);
      if (t >= start && t <= end) { def = s; break; }
    }
    data.courses = data.courses.map(c => (c.semester_id ? c : { ...c, semester_id: def.id }));
    dirty = true;
  }

  // 一次性迁移：旧配色 → 活力晴空蓝配色（只改颜色值，不动结构与存储键）
  for (const list of [data.courses, data.tags]) {
    for (const item of list) {
      const next = remapColor(item.color);
      if (next !== item.color) { item.color = next; dirty = true; }
    }
  }

  if (dirty) write(data);
  return data;
}

function write(data) {
  localStorage.setItem(APP_KEY, JSON.stringify(data));
  // 桌面小组件等观察者据此增量同步（浏览器/Node 环境无副作用）
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('schedule:data-changed', { detail: { source: 'store' } }));
  }
  return data;
}

export function isReady() {
  return read() !== null;
}

export function getMeta() {
  try {
    return JSON.parse(localStorage.getItem(META_KEY));
  } catch {
    return null;
  }
}

export function setMeta(meta) {
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

// 整体导入（首次启动 / 重新导入），覆盖现有数据
export function importAll(data, meta) {
  write({ ...EMPTY(), ...data });
  setMeta(meta);
  return meta;
}

export function getAll() {
  const data = read();
  if (!data) fail('local_data_missing', 0);
  return {
    semesters: [...data.semesters].sort((a, b) => cmp(a.start_monday, b.start_monday)),
    holidays: [...data.holidays].sort((a, b) => cmp(a.date, b.date)),
    courses: sortCourses(data.courses),
    exceptions: [...data.exceptions].sort((a, b) => cmp(a.orig_date || '', b.orig_date || '')),
    activities: [...data.activities].sort((a, b) => cmp(a.date, b.date) || cmp(a.start_time || '', b.start_time || '')),
    tags: [...data.tags].sort((a, b) => cmp(a.name, b.name)),
    settings: data.settings,
    periodTimes: data.periodTimes,
  };
}

// === 集中读取（运行时唯一数据源 = 本机存储）===
export function getSemesters() {
  const data = read();
  return data ? [...data.semesters].sort((a, b) => cmp(a.start_monday, b.start_monday)) : [];
}

export function getHolidays() {
  const data = read();
  return data ? data.holidays : [];
}

export function getPeriodTimes() {
  const data = read();
  return data ? data.periodTimes : {};
}

const sortCourses = (list) => [...list].sort((a, b) => (a.weekday - b.weekday) || (a.start_period - b.start_period));

// === Courses ===
function validateCourse(body) {
  if (!body || typeof body !== 'object') fail('invalid_body');
  const { name, teacher, location, weekday, start_period, end_period, week_start, week_end, parity, color, note, semester_id } = body;
  if (!name || typeof name !== 'string') fail('invalid_name');
  if (!uuid_re.test(semester_id || '')) fail('invalid_semester_id');
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) fail('invalid_weekday');
  if (!Number.isInteger(start_period) || start_period < 1 || start_period > 14) fail('invalid_start_period');
  if (!Number.isInteger(end_period) || end_period < 1 || end_period > 14) fail('invalid_end_period');
  if (start_period > end_period) fail('invalid_period_range');
  if (!Number.isInteger(week_start) || week_start < 1 || week_start > 30) fail('invalid_week_start');
  if (!Number.isInteger(week_end) || week_end < 1 || week_end > 30) fail('invalid_week_end');
  if (week_start > week_end) fail('invalid_week_range');
  if (!['all', 'odd', 'even'].includes(parity)) fail('invalid_parity');
  return {
    name: cut(name, 100), teacher: cut(teacher, 200), location: cut(location, 100),
    weekday, start_period, end_period, week_start, week_end, parity,
    color: cut(color, 20), note: cut(note, 500), semester_id,
  };
}

export function listCourses() {
  return sortCourses(read().courses);
}

export function createCourse(body) {
  const data = read();
  const row = { id: uuid(), ...validateCourse(body) };
  data.courses.push(row);
  write(data);
  return row;
}

export function updateCourse(id, body) {
  const data = read();
  const idx = data.courses.findIndex(c => c.id === id);
  if (idx === -1) fail('not_found', 404);
  data.courses[idx] = { id, ...validateCourse(body) };
  write(data);
  return data.courses[idx];
}

export function deleteCourse(id) {
  const data = read();
  const idx = data.courses.findIndex(c => c.id === id);
  if (idx === -1) fail('not_found', 404);
  data.courses.splice(idx, 1);
  data.exceptions = data.exceptions.filter(e => e.course_id !== id);
  write(data);
  return { ok: true };
}

// 课程去重签名：名称/教师/地点/星期/节次/周次/单双周完全一致视为同一门课
const courseSig = (c) => [c.name, c.teacher || '', c.location || '', c.weekday, c.start_period, c.end_period, c.week_start, c.week_end, c.parity].join('|');

// 批量导入课程到指定学期。mode='overwrite' 先清空该学期旧课程；mode='merge' 保留旧课程并按签名去重。
export function bulkImportCourses(rows, semesterId, mode) {
  if (!uuid_re.test(semesterId || '')) fail('invalid_semester_id');
  if (!Array.isArray(rows)) fail('invalid_body');
  const data = read();
  const incoming = rows.map(r => ({ id: uuid(), ...validateCourse({ ...r, semester_id: semesterId }) }));
  let added = 0, skipped = 0;
  if (mode === 'overwrite') {
    const removed = data.courses.filter(c => c.semester_id === semesterId).map(c => c.id);
    data.courses = data.courses.filter(c => c.semester_id !== semesterId);
    data.exceptions = data.exceptions.filter(e => !removed.includes(e.course_id));
    data.courses.push(...incoming);
    added = incoming.length;
  } else {
    const seen = new Set(data.courses.filter(c => c.semester_id === semesterId).map(courseSig));
    for (const c of incoming) {
      const sig = courseSig(c);
      if (seen.has(sig)) { skipped++; continue; }
      seen.add(sig);
      data.courses.push(c);
      added++;
    }
  }
  write(data);
  return { added, skipped, total: data.courses.length };
}

// === Exceptions ===
function validateException(body) {
  if (!body || typeof body !== 'object') fail('invalid_body');
  const { course_id, type, orig_date, new_date, new_start_period, new_end_period, new_location } = body;
  if (!uuid_re.test(course_id || '')) fail('invalid_course_id');
  if (!['cancel', 'move', 'add'].includes(type)) fail('invalid_type');
  if (type === 'cancel' && !(orig_date && date_re.test(orig_date))) fail('invalid_orig_date');
  if (type === 'move') {
    if (!(orig_date && date_re.test(orig_date))) fail('invalid_orig_date');
    if (!(new_date && date_re.test(new_date))) fail('invalid_new_date');
    if (!Number.isInteger(new_start_period) || new_start_period < 1 || new_start_period > 14) fail('invalid_new_start_period');
    if (!Number.isInteger(new_end_period) || new_end_period < 1 || new_end_period > 14) fail('invalid_new_end_period');
  }
  if (type === 'add') {
    if (!(new_date && date_re.test(new_date))) fail('invalid_new_date');
    if (!Number.isInteger(new_start_period) || new_start_period < 1 || new_start_period > 14) fail('invalid_new_start_period');
    if (!Number.isInteger(new_end_period) || new_end_period < 1 || new_end_period > 14) fail('invalid_new_end_period');
  }
  return {
    course_id, type,
    orig_date: orig_date || null, new_date: new_date || null,
    new_start_period: new_start_period || null, new_end_period: new_end_period || null,
    new_location: cut(new_location, 100),
  };
}

export function listExceptions() {
  return [...read().exceptions].sort((a, b) => cmp(a.orig_date || '', b.orig_date || ''));
}

export function createException(body) {
  const data = read();
  const row = { id: uuid(), ...validateException(body) };
  data.exceptions.push(row);
  write(data);
  return row;
}

export function deleteException(id) {
  const data = read();
  const idx = data.exceptions.findIndex(e => e.id === id);
  if (idx === -1) fail('not_found', 404);
  data.exceptions.splice(idx, 1);
  write(data);
  return { ok: true };
}

// === Activities ===
function validateActivity(body) {
  if (!body || typeof body !== 'object') fail('invalid_body');
  const { title, date, start_time, end_time, all_day, location, tag_id, note, remind_minutes } = body;
  if (!title || typeof title !== 'string') fail('invalid_title');
  if (!date || !date_re.test(date)) fail('invalid_date');
  if (typeof all_day !== 'boolean') fail('invalid_all_day');
  if (!all_day && start_time && !time_re.test(start_time)) fail('invalid_start_time');
  if (end_time && !time_re.test(end_time)) fail('invalid_end_time');
  if (tag_id !== null && tag_id !== undefined && !uuid_re.test(tag_id)) fail('invalid_tag_id');
  if (remind_minutes !== null && remind_minutes !== undefined && ![5, 15, 30, 60].includes(remind_minutes)) fail('invalid_remind_minutes');
  return {
    title: cut(title, 200), date, start_time: start_time || null, end_time: end_time || null,
    all_day, location: cut(location, 100), tag_id: tag_id || null, note: cut(note, 1000),
    remind_minutes: remind_minutes ?? null,
  };
}

export function listActivities() {
  return [...read().activities].sort((a, b) => cmp(a.date, b.date) || cmp(a.start_time || '', b.start_time || ''));
}

export function createActivity(body) {
  const data = read();
  const row = { id: uuid(), ...validateActivity(body) };
  data.activities.push(row);
  write(data);
  return row;
}

export function updateActivity(id, body) {
  const data = read();
  const idx = data.activities.findIndex(a => a.id === id);
  if (idx === -1) fail('not_found', 404);
  data.activities[idx] = { id, ...validateActivity(body) };
  write(data);
  return data.activities[idx];
}

export function deleteActivity(id) {
  const data = read();
  const idx = data.activities.findIndex(a => a.id === id);
  if (idx === -1) fail('not_found', 404);
  data.activities.splice(idx, 1);
  write(data);
  return { ok: true };
}

// === Tags ===
export function listTags() {
  return [...read().tags].sort((a, b) => cmp(a.name, b.name));
}

export function createTag(body) {
  if (!body || typeof body !== 'object') fail('invalid_body');
  const { name, color } = body;
  if (!name || typeof name !== 'string') fail('invalid_name');
  if (!color || typeof color !== 'string') fail('invalid_color');
  const data = read();
  const row = { id: uuid(), name: cut(name, 50), color: cut(color, 20) };
  data.tags.push(row);
  write(data);
  return row;
}

export function deleteTag(id) {
  const data = read();
  const idx = data.tags.findIndex(t => t.id === id);
  if (idx === -1) fail('not_found', 404);
  data.tags.splice(idx, 1);
  data.activities.forEach(a => { if (a.tag_id === id) a.tag_id = null; });
  write(data);
  return { ok: true };
}

// === Semesters ===
function validateSemester(body) {
  if (!body || typeof body !== 'object') fail('invalid_body');
  const { name, start_monday, total_weeks } = body;
  if (!name || typeof name !== 'string') fail('invalid_name');
  if (!date_re.test(start_monday || '')) fail('invalid_start_monday');
  if (!Number.isInteger(total_weeks) || total_weeks < 1 || total_weeks > 30) fail('invalid_total_weeks');
  // 起始日自动对齐到周一
  const [y, m, d] = start_monday.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const wd = dt.getDay();
  dt.setDate(dt.getDate() - (wd === 0 ? 6 : wd - 1));
  return { name: cut(name, 100), start_monday: toDateStr(dt), total_weeks };
}

export function listSemesters() {
  return getSemesters();
}

export function createSemester(body) {
  const data = read();
  const row = { id: uuid(), ...validateSemester(body) };
  data.semesters.push(row);
  write(data);
  return row;
}

export function updateSemester(id, body) {
  const data = read();
  const idx = data.semesters.findIndex(s => s.id === id);
  if (idx === -1) fail('not_found', 404);
  data.semesters[idx] = { id, ...validateSemester(body) };
  write(data);
  return data.semesters[idx];
}

export function deleteSemester(id) {
  const data = read();
  const idx = data.semesters.findIndex(s => s.id === id);
  if (idx === -1) fail('not_found', 404);
  data.semesters.splice(idx, 1);
  // 该学期下的课程一并移除，避免悬空引用
  const removedCourses = data.courses.filter(c => c.semester_id === id).map(c => c.id);
  data.courses = data.courses.filter(c => c.semester_id !== id);
  data.exceptions = data.exceptions.filter(e => !removedCourses.includes(e.course_id));
  write(data);
  return { ok: true, removedCourses: removedCourses.length };
}

// === Period times（作息时间表）===
export function updatePeriodTimes(map) {
  if (!map || typeof map !== 'object') fail('invalid_body');
  const clean = {};
  for (let p = 1; p <= 14; p++) {
    const slot = map[p];
    if (!slot || !time_re.test(slot.start || '') || !time_re.test(slot.end || '')) fail('invalid_period_time');
    if (slot.start >= slot.end) fail('invalid_period_range');
    clean[p] = { start: slot.start, end: slot.end };
  }
  const data = read();
  data.periodTimes = clean;
  write(data);
  return clean;
}

// === Settings ===
export function getSettings() {
  return read().settings;
}

export function updateSettings(body) {
  if (!body || typeof body !== 'object') fail('invalid_body');
  const { sound, vibrate, notify } = body;
  if (typeof sound !== 'boolean' || typeof vibrate !== 'boolean' || typeof notify !== 'boolean') fail('invalid_settings');
  const data = read();
  data.settings = { sound, vibrate, notify };
  write(data);
  return data.settings;
}

export { EMPTY };