// portal.js - 教务导入的 Web 侧衔接：调用原生插件、课程转换、学期自动对齐
// 适配器返回拾光风格数据 {term, courses:[{name,teacher,position,day,startSection,endSection,weeks[]}], sectionTimes, skipped}
import { getSemesters, getPeriodTimes } from './store.js';
import { COURSE_COLORS } from './config.js';

function getPlugin() {
  return window.Capacitor?.Plugins?.PortalBridge || null;
}

export function isPortalAvailable() {
  return !!getPlugin();
}

function waitForResult(plugin) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const cleanup = () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      if (timer) clearTimeout(timer);
    };
    const tryRead = async () => {
      if (settled) return;
      try {
        const res = await plugin.getResult();
        if (!res || !res.ready) return;
        settled = true;
        cleanup();
        let data = res.data;
        if (typeof data === 'string') {
          try { data = JSON.parse(data); } catch { data = null; }
        }
        resolve(data || { ok: false, error: 'BAD_RESULT' });
      } catch { /* 等下一次回到前台再读 */ }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') tryRead();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ ok: false, error: 'TIMEOUT' });
    }, 15 * 60 * 1000);
  });
}

// 打开原生教务页，等用户回到 App 后取结果（school: buaa | tju）
export async function startPortalImport(school = 'buaa') {
  const plugin = getPlugin();
  if (!plugin) return { ok: false, error: 'NOT_NATIVE' };
  try {
    await plugin.open({ school });
  } catch (err) {
    return { ok: false, error: err?.message || 'OPEN_FAILED' };
  }
  const data = await waitForResult(plugin);
  return data || { ok: false, error: 'NO_RESULT' };
}

const sig = (c) => [c.name, c.teacher || '', c.location || '', c.weekday, c.start_period, c.end_period, c.week_start, c.week_end, c.parity].join('|');

// 周次集合 → 连续区间 / 单双周区间
export function weeksToRuns(weeks) {
  const list = [...new Set(weeks.filter(w => Number.isInteger(w) && w >= 1 && w <= 30))].sort((a, b) => a - b);
  if (!list.length) return [];
  const groups = [];
  let cur = [list[0]];
  let mode = null;   // null | 'consecutive' | 'parity'
  for (let i = 1; i < list.length; i++) {
    const w = list[i];
    const prev = cur[cur.length - 1];
    const d = w - prev;
    if (d === 1 && mode !== 'parity') {
      cur.push(w);
      mode = 'consecutive';
      continue;
    }
    if (d === 2 && mode !== 'consecutive') {
      cur.push(w);
      mode = 'parity';
      continue;
    }
    groups.push({ list: cur, mode });
    cur = [w];
    mode = null;
  }
  groups.push({ list: cur, mode });
  return groups.map(g => {
    const start = g.list[0];
    const end = g.list[g.list.length - 1];
    if (g.mode === 'parity' && g.list.length >= 2) {
      return { start, end, parity: start % 2 === 1 ? 'odd' : 'even' };
    }
    return { start, end, parity: 'all' };
  });
}

function parseTermCode(code) {
  const m = String(code || '').match(/^(\d{4})\s*-\s*(\d{4})\s*-\s*([123])$/);
  if (!m) return null;
  return { y1: Number(m[1]), y2: Number(m[2]), season: Number(m[3]) };
}

function seasonOfName(name) {
  const s = String(name || '');
  if (/小学期|夏|暑/.test(s)) return 3;
  if (/第一|秋季|秋/.test(s)) return 1;
  if (/第二|春季|春/.test(s)) return 2;
  return null;
}

function infoOfSemester(sem) {
  const name = String(sem.name || '');
  const m = name.match(/(\d{4})\s*[-—–]\s*(\d{4})/);
  let y1 = m ? Number(m[1]) : null;
  let y2 = m ? Number(m[2]) : null;
  let season = seasonOfName(name);
  const parts = String(sem.start_monday || '').split('-').map(Number);
  if (parts.length === 3 && parts[0]) {
    const [y, mo] = parts;
    if (season == null) season = mo >= 8 ? 1 : 2;
    if (y1 == null) {
      if (mo >= 8) { y1 = y; y2 = y + 1; }
      else { y1 = y - 1; y2 = y; }
    }
  }
  return { y1, y2, season };
}

function parseDate(dateStr) {
  const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function daysBetween(a, b) {
  return Math.abs((a.getTime() - b.getTime()) / 86400000);
}

// 教务学期 → 本地已有学期（matchSemester 返回 sem 或 null）
export function matchSemester(term, semesters) {
  if (!term) return null;
  const parsed = parseTermCode(term.code);
  const termSeason = parsed ? parsed.season : seasonOfName(term.name);
  const list = Array.isArray(semesters) ? semesters : [];

  if (parsed) {
    for (const sem of list) {
      const info = infoOfSemester(sem);
      if (info.y1 !== parsed.y1 || info.y2 !== parsed.y2) continue;
      if (termSeason && info.season && info.season === termSeason) return sem;
    }
  }

  const start = parseDate(term.startMonday);
  if (start) {
    let best = null;
    let bestDiff = Infinity;
    for (const sem of list) {
      const d = parseDate(sem.start_monday);
      if (!d) continue;
      const diff = daysBetween(start, d);
      if (diff <= 7 && diff < bestDiff) { best = sem; bestDiff = diff; }
    }
    if (best) return best;
  }
  return null;
}

function periodMismatch(periodTimes, sectionTimes) {
  const local = periodTimes || {};
  const remote = Array.isArray(sectionTimes) ? sectionTimes : [];
  let diff = 0;
  for (const item of remote) {
    const slot = local[item?.section];
    if (!slot) continue;
    if (slot.start !== item.start || slot.end !== item.end) diff++;
  }
  return diff;
}

// 适配器结果 → 课程行 + 目标学期（已有学期或待建学期）
export function prepareImport(payload, ctx = {}) {
  const semesters = ctx.semesters ?? getSemesters();
  const periodTimes = ctx.periodTimes ?? getPeriodTimes();
  const term = payload?.term || {};
  const rawCourses = Array.isArray(payload?.courses) ? payload.courses : [];
  if (!rawCourses.length) return { error: 'EMPTY' };

  const sem = matchSemester(term, semesters);
  const termWeeks = Math.min(30, Math.max(1, Number(term.totalWeeks) || 20));
  const totalWeeks = sem && Number.isInteger(sem.total_weeks)
    ? Math.min(termWeeks, sem.total_weeks)
    : termWeeks;

  let spec = null;
  if (!sem) {
    const start = String(term.startMonday || '');
    if (!parseDate(start)) return { error: 'NO_START' };
    const name = String(term.name || '').trim();
    if (!name) return { error: 'NO_TERM_NAME' };
    spec = { name, start_monday: start, total_weeks: totalWeeks };
  }

  const warnings = [];
  const colorMap = new Map();
  const rows = [];
  const seen = new Set();
  let bad = 0;
  let outOfRange = 0;

  for (const raw of rawCourses) {
    const name = String(raw?.name || '').trim();
    const weekday = parseInt(raw?.day, 10);
    const sp = parseInt(raw?.startSection, 10);
    const ep = parseInt(raw?.endSection ?? raw?.startSection, 10);
    if (!name || !(weekday >= 1 && weekday <= 7) || !(sp >= 1 && sp <= 14) || !(ep >= sp && ep <= 14)) {
      bad++;
      continue;
    }
    const weeks = [];
    for (const w of Array.isArray(raw.weeks) ? raw.weeks : []) {
      const n = parseInt(w, 10);
      if (!Number.isInteger(n)) continue;
      if (n < 1 || n > totalWeeks) { outOfRange++; continue; }
      weeks.push(n);
    }
    if (!weeks.length) { bad++; continue; }
    const runs = weeksToRuns(weeks);
    if (!runs.length) { bad++; continue; }
    if (!colorMap.has(name)) colorMap.set(name, COURSE_COLORS[colorMap.size % COURSE_COLORS.length]);
    const color = colorMap.get(name);
    for (const r of runs) {
      const row = {
        name,
        teacher: raw.teacher ? String(raw.teacher) : null,
        location: raw.position ? String(raw.position) : null,
        weekday,
        start_period: sp,
        end_period: ep,
        week_start: r.start,
        week_end: r.end,
        parity: r.parity,
        color,
        note: null,
      };
      const s = sig(row);
      if (seen.has(s)) continue;
      seen.add(s);
      rows.push(row);
    }
  }

  if (!rows.length) return { error: 'EMPTY_AFTER_CLEAN' };

  const skipped = Number(payload?.skipped) || 0;
  if (skipped + bad > 0) warnings.push(`${skipped + bad} 条课程字段或节次不完整，已跳过`);
  if (outOfRange > 0) warnings.push(`${outOfRange} 个周次超出学期范围，已忽略`);
  if (periodMismatch(periodTimes, payload?.sectionTimes) > 0) {
    warnings.push('教务作息与本机不同，课程时间按本机作息显示');
  }
  const debug = payload?.nameDebug;
  if (debug && typeof debug === 'object') {
    const entries = Object.entries(debug).slice(0, 8).map(([k, v]) => {
      const limit = (k === 'fields' || k === 'raw') ? 700 : 220;
      return `${k}=${String(v).slice(0, limit)}`;
    });
    if (entries.length) warnings.push(`教务课名解析诊断（可截图）：${entries.join('；')}`);
  }
  if (payload?.estimatedStart) {
    warnings.push('教务页面未提供开学日期，已按常见校历估算，请在设置里核对学期起始日');
  }

  return {
    result: {
      format: payload?.source === 'tju' ? 'tju' : 'buaa',
      courses: rows,
      warnings,
      diagnostic: payload?.diagnostic || null,
    },
    target: sem ? { sem } : { spec },
  };
}
