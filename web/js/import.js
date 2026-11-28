// import.js - 课表多格式导入（xlsx / xls / csv 共用北航网格解析 + JSON 复用备份格式）
// 一律先解析→预览→确认再写库；认不出的排版明确报错，绝不导入垃圾数据。
// SheetJS 已离线内置于 js/vendor/，按需动态注入，不依赖任何 CDN。
import { COURSE_COLORS } from './config.js';

const WEEKDAY_HEADER = /^星期([一二三四五六日天])$/;
const WD_MAP = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
const ENTRY_PREFIX = /^（[\u4e00-\u9fa5]）/;
const PERIOD_RE = /第\s*(\d+)\s*(?:-\s*(\d+))?\s*节/;
const TEACHER_RE = /([^,[\]]+)\[([^\]]*)\]/g;
const WEEK_RE = /(\d+)(?:\s*-\s*(\d+))?\s*周(?:\s*[（(]\s*(单|双)\s*[）)])?/g;

const sig = (c) => [c.name, c.teacher || '', c.location || '', c.weekday, c.start_period, c.end_period, c.week_start, c.week_end, c.parity].join('|');

// === 离线加载 SheetJS（经典脚本注入 → window.XLSX）===
let xlsxPromise = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxPromise) return xlsxPromise;
  xlsxPromise = new Promise((resolve, reject) => {
    const url = new URL('vendor/xlsx.full.min.js', import.meta.url).href;
    const s = document.createElement('script');
    s.src = url;
    s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error('表格解析库初始化失败')));
    s.onerror = () => reject(new Error('表格解析库加载失败（离线文件缺失）'));
    document.head.appendChild(s);
  });
  return xlsxPromise;
}

// === 格式识别：先扩展名，再内容嗅探 ===
export async function detectFormat(file) {
  const name = (file.name || '').toLowerCase();
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1) : '';
  if (['xlsx', 'xls', 'csv', 'json'].includes(ext)) return ext;
  const buf = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (buf[0] === 0x50 && buf[1] === 0x4b) return 'xlsx';           // PK.. zip
  if (buf[0] === 0xd0 && buf[1] === 0xcf) return 'xls';            // OLE2 复合文档
  const head = (await file.slice(0, 512).text()).trim();
  if (head.startsWith('{') || head.startsWith('[')) return 'json';
  if (head.includes(',') || head.includes('\t') || head.includes('\n')) return 'csv';
  return 'unknown';
}

// === 周次解析：`2-4周 6周` / `2-16周(双)` / `3周 7-17周(单)` → 多个连续区间 ===
function parseWeeks(str) {
  const ranges = [];
  let m;
  WEEK_RE.lastIndex = 0;
  while ((m = WEEK_RE.exec(str))) {
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : start;
    const parity = m[3] === '单' ? 'odd' : m[3] === '双' ? 'even' : 'all';
    if (start >= 1 && end >= start) ranges.push({ start, end, parity });
  }
  return ranges;
}

// 按"第A-B节"行切分一个单元格里的多门课程（与是否有（本）前缀无关）
function splitEntries(text) {
  const lines = text.split('\n');
  const entries = [];
  let cur = [];
  for (const line of lines) {
    cur.push(line);
    if (PERIOD_RE.test(line)) { entries.push(cur.join('\n')); cur = []; }
  }
  if (cur.join('').trim()) entries.push(cur.join('\n'));
  return entries;
}

// 解析单门课程条目 → 按"教师组 × 连续周区间"拆成多行
function parseEntry(text, weekday, colorMap, warnings) {
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  if (!lines.length) return [];
  let pIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) { if (PERIOD_RE.test(lines[i])) { pIdx = i; break; } }
  if (pIdx === -1) { warnings.push(`跳过（找不到"第A-B节"）：${lines[0].slice(0, 24)}`); return []; }
  const pm = lines[pIdx].match(PERIOD_RE);
  const start_period = parseInt(pm[1], 10);
  const end_period = pm[2] ? parseInt(pm[2], 10) : start_period;
  if (start_period < 1 || end_period > 14 || start_period > end_period) {
    warnings.push(`跳过（节次超出 1-14）：${lines[0].slice(0, 24)}`); return [];
  }
  const name = lines[0].replace(ENTRY_PREFIX, '').trim();
  if (!name) { warnings.push('跳过（课程名为空）'); return []; }

  const middle = lines.slice(1, pIdx).join('\n');
  const lastBracket = middle.lastIndexOf(']');
  if (lastBracket === -1) { warnings.push(`跳过（找不到周次[…]）：${name.slice(0, 24)}`); return []; }
  const teacherPart = middle.slice(0, lastBracket + 1);
  const location = middle.slice(lastBracket + 1).replace(/\s+/g, ' ').trim() || null;

  const teachers = [];
  let m;
  TEACHER_RE.lastIndex = 0;
  while ((m = TEACHER_RE.exec(teacherPart))) {
    const tname = m[1].replace(/^[,\s]+|[,\s]+$/g, '').trim();
    const weeks = parseWeeks(m[2]);
    if (tname && weeks.length) teachers.push({ name: tname, weeks });
  }
  if (!teachers.length) { warnings.push(`跳过（解析不到教师/周次）：${name.slice(0, 24)}`); return []; }

  // 周次完全相同的教师合并为一行（教师名以逗号连接）
  const groups = new Map();
  for (const t of teachers) {
    const key = JSON.stringify(t.weeks);
    if (!groups.has(key)) groups.set(key, { weeks: t.weeks, names: [] });
    groups.get(key).names.push(t.name);
  }

  if (!colorMap.has(name)) colorMap.set(name, COURSE_COLORS[colorMap.size % COURSE_COLORS.length]);
  const color = colorMap.get(name);

  const out = [];
  for (const g of groups.values()) {
    const teacher = g.names.join(',');
    for (const w of g.weeks) {
      const ws = Math.max(1, Math.min(30, w.start));
      const we = Math.max(ws, Math.min(30, w.end));
      out.push({ name, teacher, location, weekday, start_period, end_period, week_start: ws, week_end: we, parity: w.parity, color, note: null });
    }
  }
  return out;
}

// === 北航网格解析（xlsx/xls/csv 共用）===
export function parseBeihangGrid(grid) {
  const warnings = [];
  let headerRow = -1;
  const colWeekday = new Map();
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];
    const found = new Map();
    for (let c = 0; c < row.length; c++) {
      const m = String(row[c] ?? '').trim().match(WEEKDAY_HEADER);
      if (m) found.set(c, WD_MAP[m[1]]);
    }
    if (found.size >= 3) { headerRow = r; for (const [c, w] of found) colWeekday.set(c, w); break; }
  }
  if (headerRow === -1) {
    throw new Error('认不出课表排版：找不到"星期一…星期日"表头。请确认这是北航网格课表（xlsx / xls / csv），或改用 JSON 备份导入。');
  }

  const colorMap = new Map();
  const rows = [];
  const seenSig = new Set();
  const seenCell = new Set();
  const cols = [...colWeekday.keys()].sort((a, b) => a - b);   // 列优先（周一→周日），配色按首次出现顺序
  for (const c of cols) {
    const weekday = colWeekday.get(c);
    for (let r = headerRow + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      const raw = String(row[c] ?? '').trim();
      if (!raw) continue;
      const label = String(row[0] ?? '').trim();
      if (/其他课程/.test(label) || /不排课/.test(raw) || raw.includes('◇')) continue;
      if (/^(上午|下午|晚上|第[\d,，\-]+节)$/.test(raw)) continue;
      const cellKey = weekday + '::' + raw;
      if (seenCell.has(cellKey)) continue;   // 合并单元格在多个行块重复出现 → 去重
      seenCell.add(cellKey);
      for (const entry of splitEntries(raw)) {
        for (const p of parseEntry(entry, weekday, colorMap, warnings)) {
          const s = sig(p);
          if (seenSig.has(s)) continue;       // 跨单元格的同一门课 → 去重
          seenSig.add(s);
          rows.push(p);
        }
      }
    }
  }
  if (!rows.length) throw new Error('课表里没有解析到任何课程，请检查文件内容是否为空或排版特殊。');
  return { courses: rows, warnings };
}

// === JSON：复用备份格式，或纯课程数组 ===
function coursesFromJson(obj) {
  if (obj && obj.format === 'my-schedule-backup' && obj.payload?.appData?.courses) return obj.payload.appData.courses;
  if (Array.isArray(obj)) return obj;
  if (obj && Array.isArray(obj.courses)) return obj.courses;
  if (obj && Array.isArray(obj.appData?.courses)) return obj.appData.courses;
  throw new Error('JSON 里找不到课程数据（支持「我的日程」备份文件或课程数组）。');
}

function normalizeJsonCourse(c, colorMap) {
  if (!c || typeof c !== 'object') return null;
  const name = String(c.name ?? '').trim();
  if (!name) return null;
  const weekday = parseInt(c.weekday, 10);
  const sp = parseInt(c.start_period, 10);
  const ep = parseInt(c.end_period ?? c.start_period, 10);
  const ws = parseInt(c.week_start, 10);
  const we = parseInt(c.week_end ?? c.week_start, 10);
  if (!(weekday >= 1 && weekday <= 7)) return null;
  if (!(sp >= 1 && sp <= 14 && ep >= sp && ep <= 14)) return null;
  if (!(ws >= 1 && ws <= 30 && we >= ws && we <= 30)) return null;
  const parity = ['all', 'odd', 'even'].includes(c.parity) ? c.parity : 'all';
  if (!colorMap.has(name)) colorMap.set(name, COURSE_COLORS[colorMap.size % COURSE_COLORS.length]);
  return {
    name, teacher: c.teacher ? String(c.teacher) : null, location: c.location ? String(c.location) : null,
    weekday, start_period: sp, end_period: ep, week_start: ws, week_end: we, parity,
    color: c.color || colorMap.get(name), note: c.note ? String(c.note) : null,
  };
}

// === 统一入口：解析文件 → { format, courses, warnings, sheetName } ===
export async function parseTimetableFile(file) {
  if (!file) throw new Error('没有选择文件');
  const format = await detectFormat(file);
  if (format === 'unknown') throw new Error('无法识别的文件类型。支持 xlsx / xls / csv / json。');

  if (format === 'json') {
    let obj;
    try { obj = JSON.parse(await file.text()); }
    catch { throw new Error('文件不是合法的 JSON'); }
    const list = coursesFromJson(obj);
    const colorMap = new Map();
    const courses = [];
    const seen = new Set();
    let bad = 0;
    for (const c of list) {
      const n = normalizeJsonCourse(c, colorMap);
      if (!n) { bad++; continue; }
      const s = sig(n);
      if (seen.has(s)) continue;
      seen.add(s);
      courses.push(n);
    }
    if (!courses.length) throw new Error('JSON 里没有有效的课程（字段缺失或超出范围）。');
    const warnings = bad ? [`${bad} 条课程字段不完整，已跳过`] : [];
    return { format, courses, warnings, sheetName: null };
  }

  const XLSX = await loadXLSX();
  let wb;
  try {
    if (format === 'csv') {
      wb = XLSX.read(await file.text(), { type: 'string' });
    } else {
      wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    }
  } catch {
    throw new Error('表格文件损坏或无法读取，请换一个文件试试。');
  }
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('表格里没有工作表。');
  const ws = wb.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  const { courses, warnings } = parseBeihangGrid(grid);
  return { format, courses, warnings, sheetName };
}