// config.js - 内置常量

// 节次时间表（北航教学作息时间表，含 14 节）
export const PERIOD_TIMES = {
  1:  { start: '08:00', end: '08:45' },
  2:  { start: '08:50', end: '09:35' },
  3:  { start: '09:50', end: '10:35' },
  4:  { start: '10:40', end: '11:25' },
  5:  { start: '11:30', end: '12:15' },
  6:  { start: '14:00', end: '14:45' },
  7:  { start: '14:50', end: '15:35' },
  8:  { start: '15:50', end: '16:35' },
  9:  { start: '16:40', end: '17:25' },
  10: { start: '17:30', end: '18:15' },
  11: { start: '19:00', end: '19:45' },
  12: { start: '19:50', end: '20:35' },
  13: { start: '20:40', end: '21:25' },
  14: { start: '21:30', end: '22:15' },
};
export const MAX_PERIOD = 14;

// 学期种子（2026—2027 学年校历：秋季学期第1周周一 2026-09-07 共19周，春季学期第1周周一 2027-03-01 共18周）
export const SEMESTERS_SEED = [
  { name: '2026-2027 学年秋季学期', start_monday: '2026-09-07', total_weeks: 19 },
  { name: '2026-2027 学年春季学期', start_monday: '2027-03-01', total_weeks: 18 },
];

// 节假日种子（附录 B）
export const HOLIDAYS_SEED = [
  { date: '2026-09-25', name: '中秋节' },
  { date: '2026-10-01', name: '国庆节' },
  { date: '2026-10-02', name: '国庆节' },
  { date: '2026-10-03', name: '国庆节' },
  { date: '2027-01-01', name: '元旦' },
  { date: '2027-04-05', name: '清明节' },
  { date: '2027-05-01', name: '劳动节' },
  { date: '2027-05-02', name: '劳动节' },
  { date: '2027-06-09', name: '端午节' },
];

// 课程颜色池
export const COURSE_COLORS = [
  '#4A9FE8', '#FF8C6B', '#6DD5B3', '#FFD166', '#A5B4FC',
  '#2B7CD8', '#14b8a6', '#84cc16', '#f97316', '#6366f1',
  '#e11d48', '#06b6d4',
];

// 标签默认颜色
export const TAG_COLORS = [
  '#4A9FE8', '#FF8C6B', '#6DD5B3', '#FFD166', '#A5B4FC',
  '#2B7CD8', '#14b8a6', '#84cc16',
];

// 星期名称
export const WEEKDAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
export const WEEKDAY_NAMES_SHORT = ['一', '二', '三', '四', '五', '六', '日'];

// 提醒提前量选项
export const REMIND_OPTIONS = [
  { value: null, label: '不提醒' },
  { value: 5, label: '提前 5 分钟' },
  { value: 15, label: '提前 15 分钟' },
  { value: 30, label: '提前 30 分钟' },
  { value: 60, label: '提前 1 小时' },
];

// 响应式断点
export const MOBILE_BREAKPOINT = 768;
