// date.js - 日期与周次计算工具

import { SEMESTERS_SEED, HOLIDAYS_SEED, PERIOD_TIMES } from './config.js';

// 解析 YYYY-MM-DD 为本地 Date（避免时区偏移）
export function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Date → YYYY-MM-DD
export function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 获取星期几（1=周一 … 7=周日）
export function getWeekday(d) {
  const w = d.getDay();
  return w === 0 ? 7 : w;
}

// 获取某周的周一日期
export function getMondayOfWeek(d) {
  const result = new Date(d);
  const wd = getWeekday(result);
  result.setDate(result.getDate() - (wd - 1));
  return result;
}

// 查找给定日期所属学期及周次
export function getSemesterWeek(dateStr) {
  const d = typeof dateStr === 'string' ? parseDate(dateStr) : dateStr;
  const todayStr = typeof dateStr === 'string' ? dateStr : formatDate(d);

  for (const sem of SEMESTERS_SEED) {
    const start = parseDate(sem.start_monday);
    const endWeekDate = new Date(start);
    endWeekDate.setDate(endWeekDate.getDate() + sem.total_weeks * 7 - 1);

    if (d >= start && d <= endWeekDate) {
      const diffDays = Math.floor((d - start) / (1000 * 60 * 60 * 24));
      const weekNum = Math.floor(diffDays / 7) + 1;
      if (weekNum >= 1 && weekNum <= sem.total_weeks) {
        return { semester: sem, weekNum };
      }
    }
  }
  return { semester: null, weekNum: null };
}

// 获取今天的日期字符串
export function getTodayStr() {
  return formatDate(new Date());
}

// 判断是否为节假日
export function getHolidayName(dateStr) {
  const h = HOLIDAYS_SEED.find(h => h.date === dateStr);
  return h ? h.name : null;
}

// 获取某周所有日期（周一到周日）
export function getWeekDates(mondayStr) {
  const monday = parseDate(mondayStr);
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    dates.push(formatDate(d));
  }
  return dates;
}

// 节次 → 时间区间
export function periodToTimeRange(startPeriod, endPeriod) {
  const start = PERIOD_TIMES[startPeriod];
  const end = PERIOD_TIMES[endPeriod];
  if (!start || !end) return null;
  return { start: start.start, end: end.end };
}

// 判断课程在指定日期是否出现
export function isCourseOnDate(course, dateStr, semester, weekNum, exceptions) {
  const d = parseDate(dateStr);
  const weekday = getWeekday(d);

  // 节假日不出现
  if (getHolidayName(dateStr)) return false;

  // 检查 cancel 异常
  const cancelExc = exceptions?.find(e =>
    e.course_id === course.id && e.type === 'cancel' && e.orig_date === dateStr
  );
  if (cancelExc) return false;

  // 检查 move 异常（该课被移走）
  const moveExc = exceptions?.find(e =>
    e.course_id === course.id && e.type === 'move' && e.orig_date === dateStr
  );
  if (moveExc) return false;

  // 常规出现性检查
  if (weekday !== course.weekday) return false;
  if (weekNum < course.week_start || weekNum > course.week_end) return false;
  if (course.parity === 'odd' && weekNum % 2 === 0) return false;
  if (course.parity === 'even' && weekNum % 2 === 1) return false;

  return true;
}

// 获取某天的所有课程实例（含异常添加/调课）
export function getDayCourses(courses, exceptions, dateStr, semester, weekNum) {
  const result = [];

  // 常规课程
  for (const course of courses) {
    if (isCourseOnDate(course, dateStr, semester, weekNum, exceptions)) {
      result.push({
        type: 'course',
        courseId: course.id,
        name: course.name,
        teacher: course.teacher,
        location: course.location,
        startPeriod: course.start_period,
        endPeriod: course.end_period,
        color: course.color,
        parity: course.parity,
        timeRange: periodToTimeRange(course.start_period, course.end_period),
      });
    }
  }

  // move 异常：调到的新日期
  const moveIn = exceptions?.filter(e =>
    e.type === 'move' && e.new_date === dateStr
  ) || [];
  for (const exc of moveIn) {
    const course = courses.find(c => c.id === exc.course_id);
    if (course) {
      result.push({
        type: 'course',
        courseId: course.id,
        name: course.name,
        teacher: course.teacher,
        location: exc.new_location || course.location,
        startPeriod: exc.new_start_period || course.start_period,
        endPeriod: exc.new_end_period || course.end_period,
        color: course.color,
        parity: course.parity,
        timeRange: periodToTimeRange(
          exc.new_start_period || course.start_period,
          exc.new_end_period || course.end_period
        ),
        isException: true,
      });
    }
  }

  // add 异常：补课
  const addExc = exceptions?.filter(e =>
    e.type === 'add' && e.new_date === dateStr
  ) || [];
  for (const exc of addExc) {
    const course = courses.find(c => c.id === exc.course_id);
    if (course) {
      result.push({
        type: 'course',
        courseId: course.id,
        name: course.name,
        teacher: course.teacher,
        location: exc.new_location || course.location,
        startPeriod: exc.new_start_period || course.start_period,
        endPeriod: exc.new_end_period || course.end_period,
        color: course.color,
        parity: course.parity,
        timeRange: periodToTimeRange(
          exc.new_start_period || course.start_period,
          exc.new_end_period || course.end_period
        ),
        isException: true,
      });
    }
  }

  // 按开始节次排序
  result.sort((a, b) => a.startPeriod - b.startPeriod);
  return result;
}

// 比较时间字符串 "HH:MM"
export function compareTime(a, b) {
  return a.localeCompare(b);
}
