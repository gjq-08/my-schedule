// test-portal.mjs - v4.0 教务导入：周次区间、学期对齐、课程转换用例（纯函数）
const s = await import('./web/js/portal.js');

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ok ${name}`); }
  else { failed++; console.log(`FAIL ${name} ${detail}`); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- weeksToRuns ---
check('连续周次→一段 all', eq(s.weeksToRuns([1, 2, 3, 4]), [{ start: 1, end: 4, parity: 'all' }]));
check('奇数周→单周段', eq(s.weeksToRuns([1, 3, 5, 7]), [{ start: 1, end: 7, parity: 'odd' }]));
check('偶数周→双周段', eq(s.weeksToRuns([2, 4, 6]), [{ start: 2, end: 6, parity: 'even' }]));
check('连续后接单双周', eq(s.weeksToRuns([1, 2, 3, 5, 7]), [
  { start: 1, end: 3, parity: 'all' },
  { start: 5, end: 7, parity: 'odd' },
]));
check('零散单周分开', eq(s.weeksToRuns([4, 9]), [
  { start: 4, end: 4, parity: 'all' },
  { start: 9, end: 9, parity: 'all' },
]));
check('重复与越界周次被清理', eq(s.weeksToRuns([1, 1, 2, 0, 31]), [{ start: 1, end: 2, parity: 'all' }]));
check('空周次返回空', eq(s.weeksToRuns([]), []));

// --- matchSemester ---
const sems = [
  { id: 'a', name: '2026-2027 学年秋季学期', start_monday: '2026-09-07', total_weeks: 19 },
  { id: 'b', name: '2026-2027 学年春季学期', start_monday: '2027-03-01', total_weeks: 18 },
  { id: 'c', name: '2025-2026 学年春季学期', start_monday: '2026-02-23', total_weeks: 18 },
];
check('termCode 学年季次精确匹配',
  s.matchSemester({ code: '2026-2027-2', name: '2026-2027学年春季学期', startMonday: '2027-03-01' }, sems)?.id === 'b');
check('termCode 秋季匹配',
  s.matchSemester({ code: '2026-2027-1', name: '2026-2027学年秋季学期', startMonday: '2026-09-07' }, sems)?.id === 'a');
check('termCode 不匹配时不误中',
  s.matchSemester({ code: '2024-2025-1', name: '2024-2025学年秋季学期', startMonday: '2024-09-02' }, sems) === null);
check('起始周一相近兜底',
  s.matchSemester({ code: 'X', name: '某学期', startMonday: '2026-09-09' }, sems)?.id === 'a');
check('无匹配返回 null（将新建）',
  s.matchSemester({ code: '2023-2024-1', name: '2023-2024学年秋季学期', startMonday: '2023-09-04' }, sems) === null);
check('天大学期名+代码可对齐',
  s.matchSemester({ code: '2026-2027-2', name: '2026-2027学年第二学期', startMonday: '2027-03-01' }, sems)?.id === 'b');

// --- prepareImport ---
const periodTimes = { 1: { start: '08:00', end: '08:45' }, 2: { start: '08:50', end: '09:35' } };
const payload = {
  term: { code: '2026-2027-1', name: '2026-2027学年秋季学期', startMonday: '2026-09-07', totalWeeks: 18 },
  courses: [
    { name: '高等数学', teacher: '王老师', position: 'A101', day: 1, startSection: 1, endSection: 2, weeks: [1, 2, 3, 4, 6, 8] },
    { name: '高等数学', teacher: '王老师', position: 'A101', day: 1, startSection: 1, endSection: 2, weeks: [1, 2, 3, 4, 6, 8] },
    { name: '大学物理', teacher: '李老师', position: 'B202', day: 3, startSection: 3, endSection: 4, weeks: [1, 3, 5, 7] },
  ],
  sectionTimes: [{ section: 1, start: '08:00', end: '08:45' }, { section: 2, start: '08:50', end: '09:35' }],
  skipped: 1,
};

const p1 = s.prepareImport(payload, { semesters: sems, periodTimes });
check('已有学期命中，不新建', !!p1.target.sem && p1.target.sem.id === 'a');
check('课程去重后 2 条高数运行', p1.result.courses.filter(c => c.name === '高等数学').length === 2);
check('周次区间与单双周正确',
  eq(p1.result.courses.filter(c => c.name === '高等数学').map(c => [c.week_start, c.week_end, c.parity]),
    [[1, 4, 'all'], [6, 8, 'even']]));
check('教师在教师字段、教室在 location',
  p1.result.courses[0].teacher === '王老师' && p1.result.courses[0].location === 'A101');
check('作息一致时不提示', !p1.result.warnings.some(w => w.includes('作息')));
check('跳过条数进 warning', p1.result.warnings.some(w => w.includes('已跳过')));
check('格式标签为 buaa', p1.result.format === 'buaa');

const newPayload = {
  term: { code: '2023-2024-1', name: '2023-2024学年秋季学期', startMonday: '2023-09-04', totalWeeks: 16 },
  courses: [{ name: '线性代数', teacher: '赵老师', position: 'C301', day: 2, startSection: 5, endSection: 6, weeks: [16, 17, 2] }],
};
const p2 = s.prepareImport(newPayload, { semesters: sems, periodTimes });
check('无匹配学期→返回待建 spec', p2.target.spec?.name === '2023-2024学年秋季学期'
  && p2.target.spec.start_monday === '2023-09-04' && p2.target.spec.total_weeks === 16);
check('超出学期周次被忽略并提示',
  p2.result.courses.length === 2
  && p2.result.courses.every(c => c.week_start >= 2 && c.week_end <= 16)
  && p2.result.warnings.some(w => w.includes('超出学期范围')));

const p3 = s.prepareImport({ term: newPayload.term, courses: [{ name: 'X', day: 1, startSection: 1, weeks: [99] }] },
  { semesters: sems, periodTimes });
check('全部周次越界→错误', !!p3.error);

const p4 = s.prepareImport({ term: { code: '2023-2024-1', name: '新', totalWeeks: 16 }, courses: newPayload.courses },
  { semesters: sems, periodTimes });
check('待建学期缺起始日→错误', p4.error === 'NO_START');

const p5 = s.prepareImport({
  term: payload.term,
  courses: payload.courses,
  sectionTimes: [{ section: 1, start: '08:10', end: '08:55' }, { section: 2, start: '08:50', end: '09:35' }],
}, { semesters: sems, periodTimes });
check('作息不一致→提示', p5.result.warnings.some(w => w.includes('作息')));

const p6 = s.prepareImport({
  term: { code: '2026-2027-1', name: '2026-2027学年第一学期', startMonday: '2026-09-07', totalWeeks: 18 },
  courses: [{ name: '概率论', day: 2, startSection: 1, endSection: 2, weeks: [1, 2] }],
  source: 'tju',
  estimatedStart: true,
}, { semesters: sems, periodTimes });
check('天大格式标签', p6.result.format === 'tju');
check('天大估算开学日→提示', p6.result.warnings.some(w => w.includes('估算')));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
